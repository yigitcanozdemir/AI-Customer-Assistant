"""
Two-Pass Agent Architecture Implementation

This module implements a reliable two-pass agent system:
- Pass 1: Intent Recognition & Tool Planning (JSON-only output)
- Pass 2: Natural Language Response Generation

The architecture separates intent parsing from response generation,
providing better reliability and clearer debugging.

Architecture Flow:
1. User message → Pass 1 (Intent Recognition)
2. Parse JSON output → Validate with Pydantic
3. Execute planned tools (parallel where possible)
4. Tool results → Pass 2 (Response Generation)
5. Return final response to user
"""

import base64
import json
import logging
import time
import uuid
import asyncio
from typing import List, Dict, Any, Optional
from datetime import date, datetime, timezone

from backend.config import settings
from backend.api.agent_schema import (
    Pass1Output,
    Pass2Input,
    ToolCall,
    ToolResult,
    ToolName,
    IntentType,
    ContextUnderstanding,
    AssessmentInfo,
    ConversationContext,
    AgentState,
    TwoPassExecutionTrace,
    PolicyValidationResult,
    LANGUAGE_NAMES,
    filter_tool_params,
)
from backend.api.schema import (
    MessageResponse,
    Message,
    PendingAction,
)
from backend.api.context_policy import (
    apply_intent_transitions,
    is_modification_flow,
    should_update_current_order_from_tracking,
)
from backend.services.tool import call_tool as execute_tool
from backend.services.context_manager import context_manager
from backend.services.llm import get_provider, LLMMessage
from backend.services.llm.tracing import turn_trace
from backend.prompts.loader import load_prompt
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)

#: Flagging reasons that genuinely warrant a human. `unclear_request` is
#: excluded on purpose — asking a clarifying question is normal conversation,
#: and flagging it surfaced "Team reviewing for assistance" on an ordinary
#: "I'm looking for a dress".
ESCALATING_FLAGS = (
    "abusive_language",
    "policy_violation",
    "prompt_injection",
    "potential_error",
)

#: Queries that describe the *relationship* rather than the garment. They match
#: nothing in the catalog, so a "similar products" search using one returns zero
#: results — substitute the source product's own name instead.
_NON_SPECIFIC_SIMILAR_QUERIES = frozenset(
    {
        "similar",
        "similar products",
        "similar product",
        "similar items",
        "similar item",
        "products like this",
        "product like this",
        "items like this",
        "like this",
        "this product",
        "this item",
        "show me similar products",
        "show me similar",
        "more like this",
        "something like this",
        "recommendations",
        "recommendation",
    }
)


def _coerce_to_date(value: Any) -> Optional[date]:
    """Best-effort parse of an order timestamp into a date.

    Order timestamps reach the policy gate in several shapes: a tz-aware
    `datetime` straight from the ORM, or a string produced by `str(datetime)`
    when the order was round-tripped through the Redis conversation context.
    Returning None made the policy gate DENY a legitimate return (it could not
    confirm the window), so handle every shape we actually produce.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text = str(value).strip()
    if not text or text.lower() in ("none", "unknown", "null", "n/a"):
        return None

    # Normalize a trailing "Z" so fromisoformat accepts it on older Pythons.
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        return datetime.fromisoformat(normalized).date()
    except ValueError:
        pass

    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f%z",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


class TwoPassAgent:
    """
    Two-Pass Agent Handler

    Orchestrates the complete two-pass flow:
    - Pass 1: Intent recognition and tool planning
    - Tool execution layer
    - Pass 2: Natural language response generation
    """

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    async def execute(
        self,
        user_input: str,
        session_id: str,
        store: str,
        user_id: str,
        user_name: str,
        selected_order: Any = None,
        selected_product: Any = None,
        confirm_action_id: Optional[str] = None,
        confirm_decision: Optional[str] = None,
        image: Optional[str] = None,
        message_history: Optional[List[Message]] = None,
    ) -> MessageResponse:
        """
        Execute the complete two-pass flow.

        Wraps the turn in one named Langfuse root trace (`chat_turn`, tagged with
        session_id/user_id) so Pass 1 / Pass 2 / policy / embedding generations
        nest under a single named, session-filterable trace instead of scattering
        as separate unnamed single-call traces. `turn_trace` is a no-op when
        Langfuse is unconfigured.

        Args:
            user_input: User's message
            session_id: Session identifier
            store: Store name
            user_id: User identifier
            user_name: User's display name
            selected_order: Currently selected order (if any)
            selected_product: Product the customer picked this turn (if any).
                Authoritative for "similar products" / "this product" — passed
                explicitly rather than read back from the Redis ring buffer,
                whose tail pointed at the wrong item on a re-selection.
            confirm_action_id: ID of action to confirm (if any)
            confirm_decision: "accept" or "decline" for `confirm_action_id`.
            image: Optional user-uploaded image (data:/http URL) — described to
                text and folded into the query for "find similar outfits".
            message_history: Recent transcript for this session, so both passes
                can resolve references to earlier turns.

        Returns:
            MessageResponse with final response and metadata
        """
        with turn_trace(
            session_id=session_id,
            user_id=user_id,
            user_input=user_input,
        ):
            return await self._execute_turn(
                user_input=user_input,
                session_id=session_id,
                store=store,
                user_id=user_id,
                user_name=user_name,
                selected_order=selected_order,
                selected_product=selected_product,
                confirm_action_id=confirm_action_id,
                confirm_decision=confirm_decision,
                image=image,
                message_history=message_history,
            )

    async def _execute_turn(
        self,
        user_input: str,
        session_id: str,
        store: str,
        user_id: str,
        user_name: str,
        selected_order: Any = None,
        selected_product: Any = None,
        confirm_action_id: Optional[str] = None,
        confirm_decision: Optional[str] = None,
        image: Optional[str] = None,
        message_history: Optional[List[Message]] = None,
    ) -> MessageResponse:
        """Run the two-pass flow. Called within the `turn_trace` root span."""
        start_time = time.perf_counter()

        # Capture the message as the customer actually sent it, BEFORE the image
        # describer rewrites it. History matching compares against this, since
        # the transcript stores the original text.
        raw_user_input = user_input

        # Vision → text: if the user attached an image, describe the garment and
        # fold that description into the query so Pass 1 produces a product_search
        # with a rich, attribute-laden query against the existing pgvector index.
        if image and not confirm_action_id:
            user_input = await self._describe_image_into_query(image, user_input)

        # The endpoint appends the current user message to the session log before
        # calling us, so the tail of message_history IS this turn's input. Drop it:
        # Pass 1 receives it as the live user turn, Pass 2 via {user_message}.
        history_messages = self._build_history_messages(
            message_history, current_user_input=raw_user_input
        )

        # Initialize execution trace
        trace = TwoPassExecutionTrace(
            session_id=session_id,
            turn_number=await context_manager.increment_turn(session_id),
            started_at=start_time,
            user_input=user_input,
        )

        try:
            # Get or create conversation context
            context = await self._get_or_create_context(
                session_id, user_id, user_name, store, selected_order, selected_product
            )

            # Handle confirmation flow if applicable.
            # NOTE: this short-circuits BEFORE Pass 1, so no language detection
            # runs on the canned "User confirmed the action" text — the reply
            # deliberately reuses the stored session language. Do not "fix" that.
            if confirm_action_id:
                return await self._handle_confirmation(
                    confirm_action_id,
                    context,
                    trace,
                    user_input,
                    confirm_decision=confirm_decision,
                    history=history_messages,
                )

            # PASS 1: Intent Recognition & Tool Planning
            self.logger.info(
                f"[Pass 1] Starting intent recognition for session {session_id}"
            )
            trace.current_state = AgentState.PASS_1_INTENT_RECOGNITION

            pass1_output = await self._execute_pass1(
                user_input=user_input,
                context=context,
                selected_order=selected_order,
                selected_product=selected_product,
                trace=trace,
                history=history_messages,
            )

            if not pass1_output:
                # Fallback response if Pass 1 fails
                return await self._create_fallback_response(store, trace)

            trace.pass1_completed_at = time.perf_counter()
            trace.pass1_parsed = pass1_output

            # Update context with Pass 1 results
            detected_language = pass1_output.context_understanding.language_detected
            await context_manager.update_context(
                session_id=session_id,
                pass1_output=pass1_output,
                language=detected_language,
            )

            # Apply all intent-driven context clears in one place. This replaces
            # the previous four near-duplicate "clear -> re-fetch" branches and
            # is the fix for the context-carryover bug (stale product/order
            # context leaking into a new question). See api/context_policy.py.
            context = await apply_intent_transitions(
                session_id=session_id,
                pass1=pass1_output,
                context=context,
            )

            # TOOL EXECUTION LAYER
            # Filter out process_order if confirmation is required
            tools_to_execute = pass1_output.tool_calls
            if pass1_output.requires_confirmation:
                # Skip process_order - it will run after user confirms
                # But execute other tools like faq_search to get policy info
                tools_to_execute = [
                    tc
                    for tc in pass1_output.tool_calls
                    if tc.tool_name != ToolName.PROCESS_ORDER
                ]
                self.logger.info(
                    f"[Tools] Confirmation required - skipping process_order until confirmed"
                )

            self.logger.info(f"[Tools] Executing {len(tools_to_execute)} tool(s)")
            trace.current_state = AgentState.TOOL_EXECUTION

            tool_results = await self._execute_tools(
                tool_calls=tools_to_execute,
                context=context,
                user_id=user_id,
                store=store,
                pass1_output=pass1_output,
                trace=trace,
                selected_order=selected_order,
                selected_product=selected_product,
            )

            trace.tools_completed_at = time.perf_counter()

            # Extract products, orders, tracking data from tool results
            products, orders, tracking_data = self._extract_data_from_tools(
                tool_results
            )

            # Update context with tool results
            if products:
                await context_manager.update_context(
                    session_id=session_id,
                    products=products,
                )

            # Adopt tracking data as current_order only on a genuine tracking
            # intent — never overwrite a modification target (see context_policy).
            if tracking_data and should_update_current_order_from_tracking(
                pass1_output, context
            ):
                order_dict = {
                    "order_id": str(tracking_data.order_id),
                    "status": tracking_data.status,
                    "created_at": str(tracking_data.created_at),
                }
                await context_manager.update_context(
                    session_id=session_id,
                    selected_order=order_dict,
                )
                self.logger.info(
                    "[Context] Updated current_order from tracking data "
                    f"(order_id={tracking_data.order_id}, intent={pass1_output.intent})"
                )

            # Reconcile Pass 1's *predicted* assessment against what actually
            # happened. Pass 1 runs BEFORE any tool, so its counts are guesses;
            # it would write products_found=0 for a search it had not run yet,
            # reason "a search that found nothing is a problem", and set
            # potential_error — flagging every successful search for human
            # review and showing "There may be an issue with your request"
            # above five perfectly good results.
            self._reconcile_assessment(
                pass1_output=pass1_output,
                tool_results=tool_results,
                products=products,
                orders=orders,
                tracking_data=tracking_data,
            )

            # Record this turn's intent and tool calls in context.
            tool_names = [tc.tool_name.value for tc in pass1_output.tool_calls]
            await context_manager.update_context(
                session_id=session_id,
                pass1_output=pass1_output,
                tool_calls=tool_names,
            )

            # Check if confirmation is needed
            pending_action = None
            policy_denied = False
            if pass1_output.requires_confirmation and any(
                tc.tool_name == ToolName.PROCESS_ORDER for tc in pass1_output.tool_calls
            ):
                # CRITICAL: Validate policy BEFORE creating pending action
                self.logger.info(
                    f"[Policy Validation] Checking if action is allowed by FAQ policy"
                )

                validation_result = await self._validate_action_against_policy(
                    user_input=user_input,
                    pass1_output=pass1_output,
                    tool_results=tool_results,
                    context=context,
                    selected_order=selected_order,
                    detected_language=detected_language,
                    tracking_data=tracking_data,
                    trace=trace,
                )

                if validation_result["allowed"]:
                    # Action is ALLOWED - create pending action and confirmation message
                    self.logger.info(f"[Policy Validation] Action ALLOWED by policy")
                    pending_action = await self._create_pending_action(
                        pass1_output, selected_order, context, trace
                    )
                    trace.current_state = AgentState.CONFIRMATION_WAITING
                    trace.pass2_output = validation_result["message"]
                else:
                    # Action is DENIED - the validator produced the denial message.
                    self.logger.info(
                        f"[Policy Validation] Action DENIED by policy: {validation_result['reason']}"
                    )
                    policy_denied = True
                    trace.current_state = AgentState.PASS_2_RESPONSE_GENERATION
                    trace.pass2_output = validation_result["message"]
                    trace.pass2_completed_at = time.perf_counter()
            else:
                # PASS 2: Natural Language Response Generation
                self.logger.info(f"[Pass 2] Generating natural language response")
                trace.current_state = AgentState.PASS_2_RESPONSE_GENERATION

                pass2_output = await self._execute_pass2(
                    user_input=user_input,
                    pass1_output=pass1_output,
                    tool_results=tool_results,
                    context=context,
                    detected_language=detected_language,
                    tracking_data=tracking_data,
                    trace=trace,
                    history=history_messages,
                    turn_number=trace.turn_number,
                )

                trace.pass2_completed_at = time.perf_counter()
                trace.pass2_output = pass2_output

            # Use assessment from Pass 1 (no separate LLM call needed)
            pass1_assessment = pass1_output.assessment

            # Determine if human intervention is needed based on Pass 1 assessment.
            # A successful policy denial is the system working as intended, so it
            # must not be flagged for human review.
            # `unclear_request` is deliberately NOT here: asking one clarifying
            # question is normal conversation, not a handoff. Flagging it made
            # "I'm looking for a dress" show "Team reviewing for assistance".
            # `off_topic` was also dead code — it is an IntentType, never a valid
            # flagging_reason (see AssessmentInfo), so genuine off-topic arrives
            # as "policy_violation".
            requires_human = (
                pass1_assessment.confidence < 0.5
                or pass1_assessment.flagging_reason in ESCALATING_FLAGS
            ) and not policy_denied

            # Use suggested fallback if provided and confidence is low
            response_content = trace.pass2_output or "Please confirm the action above."
            if (
                pass1_assessment.suggested_fallback
                and pass1_assessment.confidence < 0.7
            ):
                response_content = pass1_assessment.suggested_fallback

            # Convert flagging reason to warning message.
            # `unclear_request` gets no banner: the response body already IS the
            # clarifying question (suggested_fallback replaces response_content
            # above), so a "needs clarification" warning just restates it.
            warning_message = None
            if pass1_assessment.flagging_reason == "potential_error":
                warning_message = "There may be an issue with your request."

            self.logger.info(
                f"[Assessment] From Pass 1: confidence={pass1_assessment.confidence:.2f}, "
                f"flagging={pass1_assessment.flagging_reason}, requires_human={requires_human}"
            )

            # Build final response
            trace.current_state = AgentState.COMPLETE
            trace.total_duration_ms = (time.perf_counter() - start_time) * 1000

            # Build detailed natural language assessment reasoning
            reasoning_parts = []

            # Main intent and confidence
            intent_name = pass1_output.intent.value.replace("_", " ").title()
            reasoning_parts.append(
                f"Detected {intent_name} request with {pass1_assessment.confidence:.0%} confidence"
            )

            # Context usage
            if pass1_assessment.context_used:
                context_details = []
                if pass1_assessment.orders_found > 0:
                    context_details.append(f"{pass1_assessment.orders_found} order(s)")
                if pass1_assessment.products_found > 0:
                    context_details.append(
                        f"{pass1_assessment.products_found} product(s)"
                    )

                if context_details:
                    reasoning_parts.append(
                        f"using conversation context with {' and '.join(context_details)}"
                    )

            # Tool usage
            if len(pass1_output.tool_calls) > 0:
                tool_names = [
                    tc.tool_name.value.replace("_", " ")
                    for tc in pass1_output.tool_calls
                ]
                reasoning_parts.append(f"Called: {', '.join(tool_names)}")

            # Flagging reason (if any)
            if pass1_assessment.flagging_reason != "none":
                flag_messages = {
                    "potential_error": "Potential issue detected",
                    "unclear_request": "Request needs clarification",
                    "policy_violation": "Request outside e-commerce domain",
                    "abusive_language": "Abusive language detected",
                    "prompt_injection": "Attempt to override instructions detected",
                }
                reasoning_parts.append(
                    flag_messages.get(
                        pass1_assessment.flagging_reason,
                        pass1_assessment.flagging_reason,
                    )
                )

            assessment_reasoning = ". ".join(reasoning_parts) + "."

            # Extract tool names for logging
            tools_used = (
                [tc.tool_name.value for tc in pass1_output.tool_calls]
                if pass1_output.tool_calls
                else []
            )

            final_response = MessageResponse(
                content=response_content,
                store=store,
                suggestions=[],
                products=products,
                orders=orders,
                tracking_data=tracking_data,
                timestamp=datetime.now(timezone.utc),
                requires_human=requires_human,
                confidence_score=pass1_assessment.confidence,
                is_context_relevant=(
                    pass1_assessment.flagging_reason
                    not in ["policy_violation", "abusive_language", "prompt_injection"]
                ),
                pending_action=pending_action,
                warning_message=warning_message,
                assessment_reasoning=assessment_reasoning,
                tools_used=tools_used,
                flagging_reason=pass1_assessment.flagging_reason,
            )

            trace.final_response = final_response.model_dump()

            # Log execution trace
            self._log_trace(trace)

            return final_response

        except Exception as e:
            self.logger.error(f"Error in two-pass execution: {e}", exc_info=True)
            trace.current_state = AgentState.ERROR
            trace.errors.append(str(e))

            return await self._create_error_response(store, str(e))

    async def _get_or_create_context(
        self,
        session_id: str,
        user_id: str,
        user_name: str,
        store: str,
        selected_order: Any,
        selected_product: Any = None,
    ) -> ConversationContext:
        """Get existing context or create a new one"""
        context = await context_manager.get_context(session_id)

        if not context:
            context = ConversationContext(
                session_id=session_id,
                user_id=user_id,
                user_name=user_name,
                store=store,
            )
            await context_manager.save_context(context)

        # A product picked this turn must end up at the TAIL of recent_products,
        # because that tail is what resolves "this product" / "similar products".
        # update_context skips ids already in the buffer, so re-clicking a product
        # that appeared in an earlier result list left the tail pointing at a
        # different item — the reason "show me similar products" searched for, and
        # excluded, the wrong source.
        if selected_product is not None:
            product_id = str(getattr(selected_product, "id", "") or "")
            if product_id:
                product_dict = (
                    selected_product.model_dump()
                    if hasattr(selected_product, "model_dump")
                    else dict(selected_product)
                )
                context.recent_products = [
                    p
                    for p in context.recent_products
                    if str(p.get("id", "")) != product_id
                ]
                context.recent_products.append(product_dict)
                context.recent_products = context.recent_products[
                    -context_manager.MAX_RECENT_PRODUCTS :
                ]
                await context_manager.save_context(context)

        # Update selected order if provided
        if selected_order:
            order_dict = {
                "order_id": str(selected_order.order_id),
                "status": selected_order.status,
                "product_name": (
                    selected_order.product.name
                    if hasattr(selected_order, "product")
                    else "Unknown"
                ),
                "created_at": (
                    selected_order.created_at.isoformat()
                    if hasattr(selected_order.created_at, "isoformat")
                    else str(selected_order.created_at)
                ),
            }
            await context_manager.update_context(
                session_id=session_id,
                selected_order=order_dict,
            )
            context = await context_manager.get_context(session_id)

        return context

    _IMAGE_DESCRIBE_INSTRUCTION = (
        "You are helping a fashion shopper search a catalog by image. Describe "
        "ONLY the main clothing item/outfit in this picture as a concise search "
        "phrase: garment type, colour(s), pattern, material, style, and occasion. "
        "Do not mention the person, background, or pose. Output the phrase only."
    )

    #: Magic-byte signatures for the formats the vision API accepts. The MIME
    #: declared in a `data:` URL is client-supplied and therefore untrusted —
    #: an AVIF renamed to .png arrives labelled "image/png" and is rejected
    #: downstream with an opaque 400.
    _IMAGE_MAGIC: Dict[bytes, str] = {
        b"\xff\xd8\xff": "image/jpeg",
        b"\x89PNG\r\n\x1a\n": "image/png",
        b"GIF87a": "image/gif",
        b"GIF89a": "image/gif",
    }

    def _sniff_data_url_image(self, image: str) -> Optional[str]:
        """Real MIME of a `data:` image from its bytes, or None if unsupported.

        Returns None for anything we cannot positively identify as a supported
        format. http(s) URLs return None too — they are not ours to inspect and
        the provider fetches them itself.
        """
        if not image.startswith("data:"):
            return None
        try:
            _, b64 = image.split(",", 1)
            # 32 base64 chars decode to 24 bytes — plenty for every signature,
            # and padded so a non-multiple-of-4 slice still decodes.
            raw = base64.b64decode(b64[:32] + "===", validate=False)
        except Exception:
            return None

        for magic, mime in self._IMAGE_MAGIC.items():
            if raw.startswith(magic):
                return mime
        if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
            return "image/webp"
        return None

    async def _describe_image_into_query(self, image: str, user_input: str) -> str:
        """Describe an uploaded garment image and fold it into the search query.

        Returns an augmented `user_input`. On any failure (provider without
        vision, API error), falls back to the original text so the turn still
        proceeds as a normal text search.
        """
        provider = get_provider()
        if not getattr(provider, "supports_vision", False):
            self.logger.warning(
                "[Vision] Image provided but active provider lacks vision support"
            )
            return user_input

        # Defence in depth: the frontend validates by magic bytes, but it is not
        # a trust boundary. Skip the vision call for anything we cannot confirm
        # is a supported image rather than burning a request on a certain 400.
        if image.startswith("data:") and not self._sniff_data_url_image(image):
            self.logger.warning(
                "[Vision] Rejecting attachment — bytes do not match a supported "
                "image format (declared prefix: %r)",
                image[:32],
            )
            return user_input
        try:
            description = await provider.describe_image(
                image, self._IMAGE_DESCRIBE_INSTRUCTION
            )
            description = (description or "").strip()
            if not description:
                return user_input

            self.logger.info(f"[Vision] Image described as: {description}")
            base = (user_input or "").strip()
            # Keep any typed text (e.g. "cheaper than this") as intent, and add
            # the visual description as the concrete thing to search for.
            if base:
                return f"{base}\n\n[Attached image shows: {description}]"
            return f"Find outfits similar to this: {description}"
        except Exception as e:
            self.logger.error(f"[Vision] describe_image failed: {e}", exc_info=True)
            return user_input

    async def _enrich_similar_product_search(
        self,
        tool_call: ToolCall,
        context: ConversationContext,
        pass1_output: Pass1Output,
        store: str,
        selected_product: Any = None,
    ) -> Optional[str]:
        """Make "find similar to THIS shop item" visual, and exclude the source.

        When the customer refers to a specific item ("similar", "like this",
        "this product"), we:
          1. exclude that product's id from results (so "similar" never returns
             the same item),
          2. replace a non-specific query ("similar products") with something the
             catalog can actually match, and
          3. where the provider supports vision, upgrade to a VISUAL description
             of the item's own catalog image, reusing the same vision→text path
             as user-uploaded images.

        Everything is best-effort: with no source product, no image, or a
        provider without vision, the name-based query stays intact (still
        applying the exclusion when we know the id).

        Returns a broader fallback query to retry with if the (narrow) visual
        search returns nothing, else None.
        """
        # Resolve the SOURCE product, most authoritative first. The ring-buffer
        # tail alone used to decide this, which silently picked the wrong item.
        source: Optional[Dict[str, Any]] = None

        if selected_product is not None:
            product_id = str(getattr(selected_product, "id", "") or "")
            if product_id:
                source = {
                    "id": product_id,
                    "name": getattr(selected_product, "name", "") or "",
                }

        referenced = pass1_output.context_understanding.referenced_product
        if source is None and referenced:
            wanted = referenced.strip().lower()
            for product in reversed(context.recent_products or []):
                candidates = {
                    str(product.get("name", "")).strip().lower(),
                    str(product.get("id", "")).strip().lower(),
                }
                if wanted in candidates:
                    source = product
                    break

        if source is None and referenced and context.recent_products:
            source = context.recent_products[-1]

        if not source or not source.get("id"):
            return None

        source_id = source["id"]

        # 1) Always exclude the source item from its own "similar" results.
        tool_call.parameters.exclude_product_id = str(source_id)

        # 2) Never search a phrase the catalog cannot match. Pass 1 is told not to
        # search "similar products" verbatim, but when it does the embedding
        # search returns nothing and the customer is told we found nothing and
        # asked which item they meant — while we knew all along.
        query = (tool_call.parameters.query or "").strip()
        if not query or query.lower() in _NON_SPECIFIC_SIMILAR_QUERIES:
            fallback = str(source.get("name") or "").strip()
            if fallback:
                tool_call.parameters.query = fallback
                self.logger.info(
                    "[Similar] Replaced non-specific query %r with source product name %r",
                    query,
                    fallback,
                )

        # 3) Upgrade to visual similarity using the item's own image.
        provider = get_provider()
        if not getattr(provider, "supports_vision", False):
            return None
        try:
            from backend.services.tool import get_product_primary_image

            image_url = await get_product_primary_image(str(source_id), store)
            if not image_url:
                return None  # keep the name-based query
            description = await provider.describe_image(
                image_url, self._IMAGE_DESCRIBE_INSTRUCTION
            )
            description = (description or "").strip()
            if description:
                # Remember the broader query. A visual description is very
                # specific ("sleeveless V-neck, contrast gold belt, tailored
                # crepe"), which on a small catalogue can fall outside the
                # relevance cutoff and return NOTHING — the customer then hears
                # "no matches" for an item sitting right next to two similar
                # ones. The caller retries with this if the search comes back
                # empty. Returned rather than stashed on self, so concurrent
                # turns cannot interfere with each other.
                #
                # Prefer the product's own NAME over whatever Pass 1 wrote: its
                # query often carries the relationship word ("… similar
                # dresses"), which is noise the catalogue cannot match on.
                fallback_query = (
                    str(source.get("name") or "").strip()
                    or (tool_call.parameters.query or "").strip()
                )
                tool_call.parameters.query = description
                self.logger.info(
                    f"[Vision] Similar-item search using visual query: {description}"
                )
                return fallback_query or None
        except Exception as e:
            self.logger.error(
                f"[Vision] similar-item enrichment failed: {e}", exc_info=True
            )
        return None

    async def _execute_pass1(
        self,
        user_input: str,
        context: ConversationContext,
        selected_order: Any,
        trace: TwoPassExecutionTrace,
        selected_product: Any = None,
        history: Optional[List[LLMMessage]] = None,
    ) -> Optional[Pass1Output]:
        """
        Execute Pass 1: Intent Recognition & Tool Planning

        Returns JSON-only output parsed into Pass1Output schema.
        """
        try:
            # Build context summary
            context_summary = context_manager.build_context_summary(context)

            # Build product context info.
            #
            # CRITICAL distinction: a product the customer CLICKED this turn is
            # authoritative and unambiguous; the tail of `recent_products` is
            # merely the last item we happened to show them. Both used to render
            # under the same "SELECTED PRODUCT CONTEXT" heading, so after any
            # product search that heading pointed at an item nobody had chosen.
            # The model learned the block was unreliable and hedged even on a
            # real click — "Which item do you mean (the RUFFLED SLEEVE SKIRT
            # SET), or a different product?" — naming the right product while
            # still asking. Two distinct headings restore the signal.
            product_context_info = ""
            if selected_product is not None:
                sp_id = getattr(selected_product, "id", "unknown")
                sp_name = getattr(selected_product, "name", "Unknown")
                sp_price = getattr(selected_product, "price", "N/A")
                sp_currency = getattr(selected_product, "currency", "USD")

                product_context_info = f"""
**PRODUCT EXPLICITLY SELECTED BY THE CUSTOMER THIS TURN** (they clicked its card
in the chat — this is a deliberate, unambiguous choice):
- Product ID: {sp_id}
- Product Name: {sp_name}
- Price: {sp_price} {sp_currency}

THIS IS AUTHORITATIVE. Any question the customer asks this turn — "what sizes are
available?", "is this in stock?", "what colours?", "similar items", "how much?" —
refers to THIS product. Therefore:
- You MUST set context_understanding.referenced_product to "{sp_name}".
- You MUST NOT ask which product they mean. There is no ambiguity to resolve.
- You MUST NOT set flagging_reason="unclear_request" on the grounds of not knowing
  which item is meant — you know exactly which item.
- Sizes / stock / availability / colour question → emit variant_check with
  product_id="{sp_id}" (add size or color only if the customer named one).
- "Similar"/"like this" → emit product_search describing THIS garment.
"""
            elif context.recent_products:
                # No click this turn — these are just items previously displayed.
                # Use them to resolve a reference the customer actually makes;
                # do NOT treat the newest as "selected".
                latest_product = context.recent_products[-1]
                product_name = latest_product.get("name", "Unknown")
                product_id = latest_product.get("id", "Unknown")
                product_price = latest_product.get("price", "N/A")
                product_currency = latest_product.get("currency", "USD")

                product_context_info = f"""
**PRODUCTS RECENTLY SHOWN** (nothing was explicitly selected this turn):
- Most recent: {product_name} (ID: {product_id}, {product_price} {product_currency})
- See CONVERSATION CONTEXT above for the full list.

Use these ONLY to resolve a reference the customer actually makes ("this product",
"similar products", "the second one", "that skirt set"). If they refer to one,
set referenced_product to its name and use its characteristics in the search query.
Do NOT assume the customer means the most recent item when they made no reference.
"""

            # Build order context info
            # Use selected_order from parameter, or fall back to context.current_order
            order_context_info = ""
            if selected_order:
                # Build intent-specific context guidance
                intent_guidance = ""
                if context.last_intent == IntentType.ORDER_MODIFICATION:
                    intent_guidance = """
**CRITICAL CONTEXT**: The user previously requested to RETURN or CANCEL an order.
They are now selecting THIS specific order for that modification action.
When they say "this order", "it", "that one", etc., they want to MODIFY/RETURN/CANCEL it - NOT track it.
If they confirm selection, call process_order with action=return, NOT fetch_order_location.
"""
                elif context.last_intent == IntentType.ORDER_TRACKING:
                    intent_guidance = """
**CONTEXT**: The user is tracking this order.
"""

                order_context_info = f"""
**SELECTED ORDER CONTEXT**:
- Order ID: {selected_order.order_id}
- Status: {selected_order.status}
- Product: {selected_order.product.name if hasattr(selected_order, 'product') else 'Unknown'}
- Created: {selected_order.created_at}
{intent_guidance}
The user is referring to this order when they say "this order", "it", "that one", etc.
"""
            elif context.current_order:
                # Use the order from context (e.g., from recent tracking)
                order_id = context.current_order.get("order_id", "unknown")
                order_status = context.current_order.get("status", "unknown")
                order_created = context.current_order.get("created_at", "unknown")

                # Build intent-specific context guidance
                # When using context.current_order, provide neutral guidance
                # because user intent may have changed since last interaction
                intent_guidance = ""
                if context.last_intent == IntentType.ORDER_MODIFICATION:
                    intent_guidance = """
**PREVIOUS CONTEXT**: The user previously requested to RETURN or CANCEL an order.
This order may be the target of that modification request.
IMPORTANT: Check the CURRENT user message to determine if they still want to modify, or if intent has changed.
"""
                elif context.last_intent == IntentType.ORDER_TRACKING:
                    intent_guidance = """
**PREVIOUS CONTEXT**: The user previously tracked this order.
IMPORTANT: Check the CURRENT user message to determine current intent (they may now want to modify/return it).
"""

                order_context_info = f"""
**SELECTED ORDER CONTEXT** (from recent conversation):
- Order ID: {order_id}
- Status: {order_status}
- Created: {order_created}
{intent_guidance}
The user is referring to this order when they say "this order", "it", "that one", etc.
"""

            # Load Pass 1 prompt
            pass1_prompt = load_prompt("pass1_intent_prompt.txt").format(
                store=context.store,
                user_name=context.user_name,
                user_id=context.user_id,
                session_id=context.session_id,
                # trace.turn_number is the authoritative count. context
                # .conversation_turn is inflated: update_context increments it and
                # runs several times per turn.
                conversation_turn=trace.turn_number,
                context_summary=context_summary,
                product_context_info=product_context_info,
                order_context_info=order_context_info,
            )

            # Call the active provider with structured output. Prior turns are
            # sent as real chat turns: Pass 1's job is reference resolution
            # ("that wolf tshirt" → which product), and native chat structure is
            # what models are trained on for anaphora, whereas a system-prompt
            # blob competes with 200+ lines of instructions for attention.
            pass1_output = await get_provider().parse(
                [
                    LLMMessage("system", pass1_prompt),
                    *(history or []),
                    LLMMessage("user", user_input),
                ],
                Pass1Output,
            )

            # Store raw output for debugging
            trace.pass1_raw_output = json.dumps(pass1_output.model_dump(), indent=2)

            self.logger.info(
                f"[Pass 1] Intent: {pass1_output.intent}, Tools: {len(pass1_output.tool_calls)}, Confidence: {pass1_output.assessment.confidence:.2f}, Flagging: {pass1_output.assessment.flagging_reason}"
            )

            # Log detailed Pass 1 output for debugging
            tool_names = [tc.tool_name.value for tc in pass1_output.tool_calls]
            self.logger.info(
                f"[Pass 1 Details] Tools: {tool_names}, "
                f"Referenced Order: {pass1_output.context_understanding.referenced_order}, "
                f"Referenced Product: {pass1_output.context_understanding.referenced_product}, "
                f"Conversation Flow: {pass1_output.context_understanding.conversation_flow}"
            )

            # Log raw JSON for debugging (truncated if too long)
            raw_json = json.dumps(pass1_output.model_dump(), indent=2)
            if len(raw_json) > 2000:
                self.logger.debug(f"[Pass 1 Raw JSON] {raw_json[:2000]}... (truncated)")
            else:
                self.logger.debug(f"[Pass 1 Raw JSON] {raw_json}")

            return pass1_output

        except Exception as e:
            self.logger.error(f"[Pass 1] Error: {e}", exc_info=True)
            trace.pass1_parse_error = str(e)
            trace.errors.append(f"Pass 1 failed: {str(e)}")
            return None

    async def _execute_tools(
        self,
        tool_calls: List[ToolCall],
        context: ConversationContext,
        user_id: str,
        store: str,
        pass1_output: Pass1Output,
        trace: TwoPassExecutionTrace,
        selected_order: Any = None,
        selected_product: Any = None,
    ) -> List[ToolResult]:
        """
        Execute tools in parallel where possible.

        Returns list of ToolResult objects.
        """
        if not tool_calls:
            return []

        tool_results = []
        tool_tasks = []
        # index in `tool_calls` -> a broader query to retry with if that call's
        # narrow visual similar-item search returns nothing. Keyed by index
        # because ToolCall is a Pydantic model and therefore unhashable.
        similar_fallbacks: Dict[int, str] = {}

        for tool_index, tool_call in enumerate(tool_calls):
            # Back-fill server-owned parameters the LLM must not be trusted to
            # supply. `store` comes from the authenticated WS payload and is
            # authoritative, so we always set it (this is what prevents the
            # `Missing required parameters ... ['store']` crash — the validator
            # no longer requires it). `user_id` scopes user-specific tools.
            if not tool_call.parameters.store:
                tool_call.parameters.store = store

            if tool_call.tool_name == ToolName.LIST_ORDERS:
                # Only add user_id if not already present
                if not tool_call.parameters.user_id:
                    tool_call.parameters.user_id = user_id

            # An order the customer picked THIS turn wins over whatever Pass 1
            # inferred. Pass 1 reads the order from a prompt block that falls back
            # to a possibly stale context.current_order, which is how tracking
            # came back for a previously selected order. The frontend clears its
            # selection after every send, so `selected_order` is only set when the
            # customer just clicked a card — that click should win.
            if selected_order is not None and tool_call.tool_name in (
                ToolName.FETCH_ORDER_LOCATION,
                ToolName.PROCESS_ORDER,
            ):
                authoritative_order_id = str(
                    getattr(selected_order, "order_id", "") or ""
                )
                if (
                    authoritative_order_id
                    and tool_call.parameters.order_id != authoritative_order_id
                ):
                    self.logger.warning(
                        "[Tools] Overriding %s order_id %r with this turn's selected order %r",
                        tool_call.tool_name.value,
                        tool_call.parameters.order_id,
                        authoritative_order_id,
                    )
                    tool_call.parameters.order_id = authoritative_order_id

            # "Find similar to THIS shop item": enrich the search with the source
            # product's own image (visual similarity) and exclude it from results.
            if tool_call.tool_name == ToolName.PRODUCT_SEARCH:
                fallback = await self._enrich_similar_product_search(
                    tool_call,
                    context,
                    pass1_output,
                    store,
                    selected_product=selected_product,
                )
                if fallback:
                    similar_fallbacks[tool_index] = fallback

            # Execute tool
            tool_tasks.append(self._execute_single_tool(tool_call, trace))

        # Execute all tools in parallel
        results = await asyncio.gather(*tool_tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, ToolResult):
                tool_results.append(result)
            elif isinstance(result, Exception):
                self.logger.error(f"Tool execution failed: {result}")
                trace.tool_execution_errors.append(str(result))

        # A visual similar-item query is deliberately specific, which on a small
        # catalogue can miss everything. Rather than tell the customer we found
        # nothing while comparable items sit in the same category, retry once
        # with the broader name-based query.
        tool_results = await self._retry_empty_similar_searches(
            tool_calls, tool_results, similar_fallbacks, trace
        )

        trace.tools_executed = tool_results

        return tool_results

    async def _retry_empty_similar_searches(
        self,
        tool_calls: List[ToolCall],
        tool_results: List[ToolResult],
        similar_fallbacks: Dict[int, str],
        trace: TwoPassExecutionTrace,
    ) -> List[ToolResult]:
        """Re-run a similar-item search that came back empty, with a wider query."""
        if not similar_fallbacks:
            return tool_results

        # Only product_search results can be retried, and they appear in
        # `tool_results` in the same relative order as in `tool_calls`.
        empty_search_positions = [
            i
            for i, r in enumerate(tool_results)
            if r.tool_name == ToolName.PRODUCT_SEARCH
            and r.success
            and not (isinstance(r.data, list) and r.data)
        ]
        if not empty_search_positions:
            return tool_results

        for tool_index, fallback in similar_fallbacks.items():
            if tool_index >= len(tool_calls) or not empty_search_positions:
                continue

            tool_call = tool_calls[tool_index]
            current = (tool_call.parameters.query or "").strip()
            if not fallback or fallback == current:
                continue

            self.logger.info(
                "[Similar] Visual query returned nothing; retrying with %r", fallback
            )
            tool_call.parameters.query = fallback
            retried = await self._execute_single_tool(tool_call, trace)
            if retried.success and isinstance(retried.data, list) and retried.data:
                tool_results[empty_search_positions.pop(0)] = retried

        return tool_results

    async def _execute_single_tool(
        self,
        tool_call: ToolCall,
        trace: TwoPassExecutionTrace,
    ) -> ToolResult:
        """Execute a single tool and return result"""
        start = time.perf_counter()

        try:
            # Convert ToolParameters to dict, excluding None values, then keep
            # only the parameters this tool accepts (strips hallucinated args).
            params_dict = tool_call.parameters.model_dump(exclude_none=True)
            params_dict = filter_tool_params(tool_call.tool_name, params_dict)

            result = await execute_tool(
                tool_name=tool_call.tool_name.value,
                arguments=params_dict,
            )

            execution_time = (time.perf_counter() - start) * 1000

            return ToolResult(
                tool_name=tool_call.tool_name,
                success=True,
                data=result,
                execution_time_ms=execution_time,
            )

        except Exception as e:
            self.logger.error(f"Tool {tool_call.tool_name} failed: {e}")
            execution_time = (time.perf_counter() - start) * 1000

            return ToolResult(
                tool_name=tool_call.tool_name,
                success=False,
                error=str(e),
                execution_time_ms=execution_time,
            )

    #: Flags Pass 1 raises about the *customer's message* (abuse, off-topic,
    #: injection, genuine ambiguity). These are knowable from the message alone,
    #: so tool results can never disprove them and reconciliation leaves them be.
    _MESSAGE_LEVEL_FLAGS = frozenset(
        {
            "abusive_language",
            "policy_violation",
            "prompt_injection",
            "unclear_request",
        }
    )

    def _reconcile_assessment(
        self,
        pass1_output: Pass1Output,
        tool_results: List[ToolResult],
        products: List[Any],
        orders: Any,
        tracking_data: Any,
    ) -> None:
        """Replace Pass 1's predicted assessment with post-execution ground truth.

        Pass 1 emits `assessment` before a single tool has run, so
        `products_found` / `orders_found` are predictions and `potential_error`
        is a guess about an outcome it cannot observe. In practice the model
        wrote `products_found: 0` for a search it had not executed, concluded
        that finding nothing was an error, and set `potential_error` — which is
        in ESCALATING_FLAGS, so every successful product search raised the
        "There may be an issue with your request" banner and wrote a row to
        flagged_sessions.

        `potential_error` is an OUTCOME judgement and belongs to the backend,
        which can see what the tools actually returned. Message-level flags
        (abuse, injection, off-topic, ambiguity) are left untouched — tool
        results are irrelevant to whether the customer swore at us.

        Mutates `pass1_output.assessment` in place.
        """
        assessment = pass1_output.assessment

        # 1) Ground truth counts, replacing the pre-execution guess.
        assessment.products_found = len(products) if products else 0
        assessment.orders_found = len(orders) if orders else 0

        if assessment.flagging_reason in self._MESSAGE_LEVEL_FLAGS:
            return

        # 2) A tool that raised, or returned an explicit error payload, is the
        #    one thing that genuinely warrants `potential_error`.
        failed = [r for r in tool_results if not r.success]
        if failed:
            if assessment.flagging_reason != "potential_error":
                self.logger.info(
                    "[Assessment] Raising potential_error — tool(s) failed: %s",
                    [r.tool_name.value for r in failed],
                )
                assessment.flagging_reason = "potential_error"
            return

        # 3) Tools all succeeded. If they produced anything for the customer,
        #    a predicted `potential_error` is disproven — clear it.
        produced_results = bool(products or orders or tracking_data)
        if assessment.flagging_reason == "potential_error" and produced_results:
            self.logger.info(
                "[Assessment] Clearing predicted potential_error — tools returned "
                "results (products=%d, orders=%d, tracking=%s)",
                assessment.products_found,
                assessment.orders_found,
                tracking_data is not None,
            )
            assessment.flagging_reason = "none"
            # Pass 1 lowered confidence to justify a flag that turned out to be
            # wrong; don't let that stale number trip the <0.7 fallback swap or
            # the <0.5 human handoff.
            assessment.confidence = max(assessment.confidence, 0.9)
            return

        # 4) Tools succeeded but returned nothing at all. That is a legitimate
        #    empty result ("no products match"), NOT a system error — Pass 2 has
        #    copy for it. Only flag when a tool that should always return
        #    something came back empty.
        if assessment.flagging_reason == "potential_error" and not produced_results:
            searched_only = all(
                r.tool_name in (ToolName.PRODUCT_SEARCH, ToolName.FAQ_SEARCH)
                for r in tool_results
            )
            if tool_results and searched_only:
                self.logger.info(
                    "[Assessment] Clearing potential_error — empty search result is "
                    "a normal outcome, not a system fault"
                )
                assessment.flagging_reason = "none"
                assessment.confidence = max(assessment.confidence, 0.8)

    def _extract_data_from_tools(
        self,
        tool_results: List[ToolResult],
    ) -> tuple:
        """Extract products, orders, and tracking data from tool results"""
        products = []
        orders = None
        tracking_data = None

        for result in tool_results:
            if not result.success:
                continue

            if result.tool_name == ToolName.PRODUCT_SEARCH and isinstance(
                result.data, list
            ):
                products = result.data

            elif result.tool_name == ToolName.LIST_ORDERS:
                if hasattr(result.data, "orders"):
                    orders = result.data.orders

            elif result.tool_name == ToolName.FETCH_ORDER_LOCATION:
                tracking_data = result.data

        return products, orders, tracking_data

    async def _execute_pass2(
        self,
        user_input: str,
        pass1_output: Pass1Output,
        tool_results: List[ToolResult],
        context: ConversationContext,
        detected_language: str,
        tracking_data: Any,
        trace: TwoPassExecutionTrace,
        confirmation_context: str = "",
        history: Optional[List[LLMMessage]] = None,
        turn_number: int = 1,
    ) -> str:
        """
        Execute Pass 2: Natural Language Response Generation.

        Args:
            confirmation_context: Optional context for confirmation/declination
                responses (success/decline messages after a pending action).
            history: Prior conversation turns, rendered into the prompt as a
                labeled transcript so the reply can resolve references.
            turn_number: Authoritative turn count (`trace.turn_number`), used to
                gate greetings to the first turn.

        Returns the natural language response string. Policy validation is a
        separate structured call (see `_validate_action_against_policy`).
        """
        try:
            tool_results_summary = self._build_tool_results_summary(tool_results)

            tracking_guidance = ""
            if tracking_data:
                tracking_guidance = self._build_tracking_guidance(tracking_data)

            policy_context = self._extract_policy_context(tool_results)
            detected_language_name = LANGUAGE_NAMES.get(detected_language, "English")

            # Tell Pass 2 exactly which price window was enforced. Without this it
            # only sees "Found N product(s)" and cannot know whether a budget was
            # honoured — it used to claim "under $45" over unfiltered results.
            price_filter_note = "No price filter was applied to this search."
            for tc in pass1_output.tool_calls:
                if tc.tool_name != ToolName.PRODUCT_SEARCH:
                    continue
                low = tc.parameters.min_price
                high = tc.parameters.max_price
                if high is not None and low is not None:
                    price_filter_note = (
                        f"Results are filtered to prices between {low} and {high}. "
                        "You may state this budget."
                    )
                elif high is not None:
                    price_filter_note = (
                        f"Results are filtered to a maximum price of {high}. "
                        "You may state this budget."
                    )
                elif low is not None:
                    price_filter_note = (
                        f"Results are filtered to a minimum price of {low}. "
                        "You may state this budget."
                    )
                break

            conversation_context_summary = context_manager.build_context_summary(
                context
            )

            # Decide the ORDER_TRACKING branch here rather than leaving Pass 2 to
            # guess between two competing templates — it used to satisfy both,
            # showing tracking data while also asking the customer to pick an order.
            if tracking_data is not None:
                tracking_branch = (
                    "TRACKING_SHOWN — live tracking for ONE specific order is already "
                    "on screen. Report its status. You MUST NOT ask the customer to "
                    "select or pick an order."
                )
            elif any(
                r.tool_name == ToolName.LIST_ORDERS and r.success for r in tool_results
            ):
                tracking_branch = (
                    "ORDER_LIST_SHOWN — a list of orders is on screen and NO tracking "
                    "data was fetched. Ask the customer to select which order they want "
                    "to track. You MUST NOT describe any tracking status."
                )
            else:
                tracking_branch = (
                    "NO_ORDER_DATA — no order list and no tracking data this turn."
                )

            pass2_prompt = load_prompt("pass2_response_prompt.txt").format(
                store=context.store,
                user_name=context.user_name,
                detected_language=detected_language,
                detected_language_name=detected_language_name,
                user_message=user_input,
                intent=pass1_output.intent.value,
                flagging_reason=pass1_output.assessment.flagging_reason,
                tool_results_summary=tool_results_summary,
                tracking_guidance=tracking_guidance,
                tracking_branch=tracking_branch,
                price_filter_note=price_filter_note,
                policy_context=policy_context,
                conversation_context_summary=conversation_context_summary,
                conversation_transcript=self._render_history_transcript(history),
                turn_number=turn_number,
                is_first_turn="yes" if turn_number <= 1 else "no",
                confirmation_context=confirmation_context,
            )

            content = await get_provider().generate(
                [
                    LLMMessage("system", pass2_prompt),
                    LLMMessage("user", "Generate your response now."),
                ]
            )

            if not content:
                content = "I'm here to help you!"

            self.logger.info(f"[Pass 2] Response generated ({len(content)} chars)")

            return content

        except Exception as e:
            self.logger.error(f"[Pass 2] Error: {e}", exc_info=True)
            trace.errors.append(f"Pass 2 failed: {str(e)}")
            return "I'm here to help! How can I assist you today?"

    #: How many trailing transcript messages are replayed to the LLM. ~8 covers
    #: roughly four exchanges — enough to resolve "that wolf tshirt" without
    #: bloating the prompt or drifting onto stale intent.
    HISTORY_MESSAGE_LIMIT = 8
    #: Total replayed characters, and the per-message truncation length.
    HISTORY_CHAR_BUDGET = 4000
    HISTORY_PER_MESSAGE_CHARS = 600

    def _build_history_messages(
        self,
        message_history: Optional[List[Message]],
        *,
        current_user_input: str = "",
        limit: Optional[int] = None,
    ) -> List[LLMMessage]:
        """Render the recent transcript as prior chat turns for the LLM.

        Neither pass used to see any prior turn, which is why the agent behaved
        as though nothing had happened before.

        Skips:
          - the CURRENT user message. The endpoint appends it to the session log
            before calling us, so it is the tail; Pass 1 receives it as the live
            user turn and Pass 2 via {user_message}.
          - `hide_content` markers. The endpoint writes a hidden "User selected
            order: <uuid>" row per order pick; replaying those teaches the model
            to talk in raw UUIDs.
          - `[SYSTEM_INIT]` bootstrap text, image data URLs, and empty content.

        Truncates per message and enforces a total character budget, keeping the
        most recent turns, so a long session cannot blow up the prompt.
        """
        if not message_history:
            return []

        limit = self.HISTORY_MESSAGE_LIMIT if limit is None else limit
        if limit <= 0:
            return []

        current = (current_user_input or "").strip()
        budget = self.HISTORY_CHAR_BUDGET
        collected: List[LLMMessage] = []

        # Walk newest → oldest so the character budget keeps the newest turns.
        # The slice is generous because skipped rows do not count toward `limit`.
        pending_current_skip = bool(current)
        for message in reversed(list(message_history)[-(limit + 12):]):
            if getattr(message, "hide_content", False):
                continue

            content = (getattr(message, "content", "") or "").strip()
            if not content or content.startswith("data:image"):
                continue
            if content.startswith("[SYSTEM_INIT]"):
                continue

            role = "assistant" if getattr(message, "type", "") == "assistant" else "user"

            # Drop only the newest user message equal to this turn's input.
            if pending_current_skip and role == "user" and content == current:
                pending_current_skip = False
                continue

            if len(content) > self.HISTORY_PER_MESSAGE_CHARS:
                content = (
                    content[: self.HISTORY_PER_MESSAGE_CHARS].rsplit(" ", 1)[0] + "…"
                )
            if len(content) > budget:
                break
            budget -= len(content)

            collected.append(LLMMessage(role, content))
            if len(collected) >= limit:
                break

        collected.reverse()

        # Providers dislike a leading assistant turn; drop it defensively.
        while collected and collected[0].role == "assistant":
            collected.pop(0)
        return collected

    def _render_history_transcript(self, history: Optional[List[LLMMessage]]) -> str:
        """Render prior turns as a labeled transcript block for the Pass 2 prompt.

        Pass 2 receives the current question interpolated into its system prompt
        ({user_message}) plus a dummy user turn, so real message turns would
        appear *before* the question they follow. A labeled transcript keeps the
        ordering unambiguous.
        """
        if not history:
            return "This is the first exchange in the conversation."
        return "\n".join(
            f"{'Assistant' if m.role == 'assistant' else 'Customer'}: {m.content}"
            for m in history
        )

    def _build_tool_results_summary(self, tool_results: List[ToolResult]) -> str:
        """Build a summary of tool results for Pass 2 prompt"""
        if not tool_results:
            return "No tools were executed."

        summary_parts = []

        for result in tool_results:
            if result.success:
                summary_parts.append(
                    f"✓ {result.tool_name.value}: {self._summarize_tool_data(result)}"
                )
            else:
                summary_parts.append(
                    f"✗ {result.tool_name.value}: Error - {result.error}"
                )

        return "\n".join(summary_parts)

    def _summarize_tool_data(self, result: ToolResult) -> str:
        """Summarize tool result data for prompt"""
        if result.tool_name == ToolName.PRODUCT_SEARCH:
            if isinstance(result.data, list):
                return f"Found {len(result.data)} product(s)"
            return "No products found"

        elif result.tool_name == ToolName.LIST_ORDERS:
            if hasattr(result.data, "orders"):
                return f"Found {len(result.data.orders)} order(s)"
            return "No orders found"

        elif result.tool_name == ToolName.FETCH_ORDER_LOCATION:
            if result.data:
                status = getattr(result.data, "status", "unknown")
                return f"Tracking data retrieved (status: {status})"
            return "Tracking data not available"

        elif result.tool_name == ToolName.FAQ_SEARCH:
            if isinstance(result.data, list):
                # Use jsonable_encoder to handle UUID and other non-JSON types
                return f"Found {len(result.data)} FAQ result(s): {json.dumps(jsonable_encoder(result.data))}"
            return "No FAQ results"

        elif result.tool_name == ToolName.VARIANT_CHECK:
            return (
                f"Variant check completed: {json.dumps(jsonable_encoder(result.data))}"
            )

        else:
            return "Completed"

    def _build_tracking_guidance(self, tracking_data: Any) -> str:
        """Build tracking guidance message"""
        if not tracking_data:
            return ""

        status = getattr(tracking_data, "status", "").lower()

        if status == "created":
            return "The order is still being prepared and hasn't shipped yet."
        elif status == "shipped":
            return "The order is in transit and tracking information is available."
        elif status == "delivered":
            return "The order has been delivered to the destination."
        elif status == "returned":
            return (
                "The order is marked as returned. Let the customer know the package is waiting to be handed to the carrier "
                "so it can travel back to the fulfillment center, and remind them that refund/exchange steps will follow."
            )
        elif status == "cancelled":
            return (
                "The order was cancelled before shipping, so no tracking details are available. "
                "Reassure the customer that the cancellation or refund is underway."
            )
        else:
            return ""

    def _extract_policy_context(self, tool_results: List[ToolResult]) -> str:
        """Extract policy information from FAQ search results"""
        for result in tool_results:
            if result.tool_name == ToolName.FAQ_SEARCH and result.success:
                if isinstance(result.data, list) and result.data:
                    # FAQ tool returns all policies from the store
                    # Pass them to Pass 2 for extraction of ONLY relevant parts
                    policies = [faq.get("content", "") for faq in result.data]
                    return "\n\n".join(policies)

        return ""

    async def _validate_action_against_policy(
        self,
        user_input: str,
        pass1_output: Pass1Output,
        tool_results: List[ToolResult],
        context: ConversationContext,
        selected_order: Any,
        detected_language: str,
        tracking_data: Any,
        trace: TwoPassExecutionTrace,
    ) -> dict:
        """
        Validate if the requested action is allowed by FAQ policy.

        Returns:
            dict with keys:
            - allowed (bool): True if action is allowed, False if denied
            - message (str): Response message generated by Pass 2
            - reason (str): Reason for denial (if denied)
        """
        # Get order data for validation
        order_id = None
        order_status = None
        order_created_at = None

        # Extract order info from selected_order or context
        if selected_order:
            order_id = getattr(selected_order, "order_id", None)
            order_status = getattr(selected_order, "status", None)
            order_created_at = getattr(selected_order, "created_at", None)
            self.logger.info(
                f"[Policy Validation] Using selected_order: {order_id}, status={order_status}"
            )
        elif context.current_order:
            order_id = context.current_order.get("order_id")
            order_status = context.current_order.get("status")
            order_created_at = context.current_order.get("created_at")
            self.logger.info(
                f"[Policy Validation] Using context.current_order: {order_id}, status={order_status}"
            )
        else:
            self.logger.warning(
                f"[Policy Validation] No order found in selected_order or context.current_order"
            )

        # Extract action from process_order tool call
        action = None
        for tc in pass1_output.tool_calls:
            if tc.tool_name == ToolName.PROCESS_ORDER:
                action = (
                    tc.parameters.action if hasattr(tc.parameters, "action") else None
                )
                break

        current_date = datetime.now(timezone.utc).date()

        # Days elapsed since order creation. Timestamps arrive in several shapes
        # (ORM datetime, or a str() round-tripped through Redis context), and a
        # parse failure used to leave this as None — which the gate read as
        # "cannot confirm the window" and DENIED a legitimate return.
        order_date = _coerce_to_date(order_created_at)
        days_elapsed = (current_date - order_date).days if order_date else None
        if order_created_at and order_date is None:
            self.logger.warning(
                "[Policy Validation] Unparseable order_created_at=%r — the gate is "
                "told the date is unknown rather than treating it as out-of-window.",
                order_created_at,
            )

        # The Order model has no delivery timestamp, only creation. Delivery is
        # always on or after creation, so days-since-creation is an UPPER BOUND on
        # days-since-delivery: if creation is inside the window, delivery certainly
        # is. Spelling that out keeps the gate from denying for lack of an exact
        # delivery date.
        date_basis = (
            "IMPORTANT: the only timestamp available is the order CREATION date; "
            "there is no delivery timestamp in the system. When a policy window is "
            "measured from DELIVERY, treat days-since-creation as an UPPER BOUND on "
            "days-since-delivery — if days elapsed since creation is within the "
            "window, the delivery-based window is certainly also within it, so the "
            "time condition is SATISFIED."
        )
        days_elapsed_note = (
            ""
            if days_elapsed is not None
            else (
                "NOTE: the order date could not be determined. An UNKNOWN date is NOT "
                "evidence that the window has passed. Do NOT deny on window grounds. "
                "If the status condition is otherwise met, ALLOW the action and let "
                "the confirmation step proceed."
            )
        )

        policy_context = self._extract_policy_context(tool_results)

        validation_prompt = load_prompt("policy_validation_prompt.txt").format(
            current_date=current_date,
            order_created_at=order_created_at,
            days_elapsed=(
                days_elapsed if days_elapsed is not None else "Unable to calculate"
            ),
            date_basis=date_basis,
            days_elapsed_note=days_elapsed_note,
            action=action,
            order_id=order_id,
            order_status=order_status,
            policy_context=policy_context,
            detected_language=detected_language,
            detected_language_name=LANGUAGE_NAMES.get(detected_language, "English"),
        )

        # Structured, fail-closed policy decision. The model returns a
        # PolicyValidationResult (allowed/message/reason) rather than a
        # free-form string, so there is no brittle prefix to parse and a
        # malformed or errored response denies the action instead of allowing it.
        try:
            result: PolicyValidationResult = await get_provider().parse(
                [
                    LLMMessage("system", validation_prompt),
                    LLMMessage(
                        "user",
                        f"Validate the {action} request for order {order_id}.",
                    ),
                ],
                PolicyValidationResult,
            )
            trace.pass2_output = result.message
            self.logger.info(
                "[Policy Validation] allowed=%s reason=%s",
                result.allowed,
                result.reason,
            )
            return {
                "allowed": result.allowed,
                "message": result.message,
                "reason": result.reason if not result.allowed else None,
            }

        except Exception as e:
            # Fail CLOSED: any error validating an order-modifying action denies it.
            self.logger.error(
                f"[Policy Validation] Error during validation: {e}", exc_info=True
            )
            return {
                "allowed": False,
                "message": (
                    "I'm having trouble validating this request against our "
                    "policies right now. Please contact customer support for "
                    "assistance."
                ),
                "reason": f"Validation error: {str(e)}",
            }

    def _build_confirmation_message(
        self,
        pending_action: Optional[PendingAction],
        tool_results: List[ToolResult],
        selected_order: Any,
    ) -> str:
        """Generate a natural language reminder when waiting on user confirmation"""
        if not pending_action:
            return "Please confirm the action above."

        parameters = getattr(pending_action, "parameters", {}) or {}
        if hasattr(parameters, "model_dump"):
            parameters = parameters.model_dump(exclude_none=True)

        action = str(parameters.get("action") or "process").replace("_", " ")
        order_id = parameters.get("order_id")
        if not order_id and selected_order is not None:
            order_id = getattr(selected_order, "order_id", None)

        order_text = f"order {order_id}" if order_id else "this order"

        message = (
            f"I have the {action} request for {order_text} ready. "
            "Please select Confirm to continue or Cancel if you'd like to keep everything as-is."
        )

        policy_context = self._extract_policy_context(tool_results).strip()
        if policy_context:
            trimmed_policy = policy_context
            if len(trimmed_policy) > 600:
                trimmed_policy = trimmed_policy[:600].rsplit(" ", 1)[0] + "..."

            message += f"\n\nPolicy reminder:\n{trimmed_policy}"

        return message

    async def _create_pending_action(
        self,
        pass1_output: Pass1Output,
        selected_order: Any,
        context: ConversationContext,
        trace: TwoPassExecutionTrace,
    ) -> PendingAction:
        """Create a pending action for user confirmation"""
        # Find process_order tool call
        process_order_call = None
        for tc in pass1_output.tool_calls:
            if tc.tool_name == ToolName.PROCESS_ORDER:
                process_order_call = tc
                break

        if not process_order_call:
            return None

        action_id = str(uuid.uuid4())
        process_order_params = process_order_call.parameters.model_dump(
            exclude_none=True
        )
        order_id = process_order_params.get("order_id") or (
            str(selected_order.order_id) if selected_order else None
        )
        action_type = process_order_params.get("action", "process")

        # CRITICAL: Only include valid parameters for process_order
        # Filter out user_id and other invalid parameters to prevent execution errors.
        # `store` is server-owned: fall back to the authoritative context store
        # when the LLM omitted it, so the deferred confirmation execution never
        # runs without a store.
        pending_parameters = {
            "order_id": order_id,
            "action": action_type,
            "store": process_order_params.get("store") or context.store,
        }
        # Remove None values
        pending_parameters = {
            k: v for k, v in pending_parameters.items() if v is not None
        }

        action_payload = {
            "action_type": ToolName.PROCESS_ORDER.value,
            "parameters": pending_parameters,
        }

        # Store in cache
        from backend.services.cache import cache_manager

        await cache_manager.store_pending_action(
            action_id=action_id,
            action_data=action_payload,
            ttl=300,
        )

        # Store in context
        await context_manager.store_pending_confirmation(
            session_id=context.session_id,
            action_id=action_id,
            action_data=action_payload,
        )

        return PendingAction(
            action_id=action_id,
            action_type=ToolName.PROCESS_ORDER.value,
            parameters=pending_parameters,
            requires_confirmation=True,
            confirmation_message=f"Are you sure you want to {action_type} this order?",
        )

    async def _handle_confirmation(
        self,
        confirm_action_id: str,
        context: ConversationContext,
        trace: TwoPassExecutionTrace,
        user_input: str,
        confirm_decision: Optional[str] = None,
        history: Optional[List[LLMMessage]] = None,
    ) -> MessageResponse:
        """Handle confirmation or declination of a pending action"""
        from backend.services.cache import cache_manager

        pending_action = await cache_manager.get_pending_action(confirm_action_id)

        if not pending_action:
            return MessageResponse(
                content="I couldn't find that confirmation request. It may have expired. Please try again.",
                store=context.store,
                timestamp=datetime.now(timezone.utc),
                requires_human=False,
                confidence_score=0.5,
                is_context_relevant=True,
            )

        # Whether the customer accepted or declined. Prefer the explicit signal
        # from the confirm/decline buttons.
        if confirm_decision in ("accept", "decline"):
            is_declined = confirm_decision == "decline"
        else:
            # Legacy fallback for clients that predate `confirm_decision`.
            # Deliberately does NOT test for "cancel": confirming a *cancel
            # order* action sends text containing that word, which used to be
            # misread as a decline so the cancellation never happened.
            lowered = (user_input or "").strip().lower()
            is_declined = "declined" in lowered
            self.logger.warning(
                "[Confirmation] No confirm_decision in payload; inferred from text "
                "(is_declined=%s). Client is out of date.",
                is_declined,
            )

        if is_declined:
            # User declined the action
            await cache_manager.delete_pending_action(confirm_action_id)
            await context_manager.clear_pending_confirmation(context.session_id)

            action_type = pending_action["parameters"].get("action", "action")

            # Get FAQ context for declination response.
            # NOTE: ToolResult/ToolName/Pass1Output/IntentType/ContextUnderstanding/
            # AssessmentInfo are imported at MODULE scope. Do NOT re-import them
            # here — a function-local import binds the name as local for the
            # ENTIRE function body, which made the `ToolName(tool_name)` call on
            # the confirm path raise UnboundLocalError and broke every return and
            # cancel confirmation.
            faq_query = f"{action_type} policy"
            faq_result = await execute_tool(
                "faq_search", {"query": faq_query, "store": context.store}
            )

            # Create tool result for FAQ context
            # FAQ search returns a list directly: [{"id": "...", "content": "..."}]
            tool_results = []
            if isinstance(faq_result, list) and faq_result:
                tool_results.append(
                    ToolResult(
                        tool_name=ToolName.FAQ_SEARCH,
                        success=True,
                        data=faq_result,
                        error=None,
                    )
                )

            # Build declination context
            decline_context = load_prompt(
                "confirmation_declined_prompt.txt"
            ).format(action=action_type)

            # Create a minimal Pass1Output for Pass 2
            pass1_output = Pass1Output(
                intent=IntentType.ORDER_MODIFICATION,
                tool_calls=[],
                context_understanding=ContextUnderstanding(
                    referenced_order=None,
                    referenced_product=None,
                    language_detected=context.detected_language or "en",
                    conversation_flow=f"User declined {action_type} request",
                ),
                requires_confirmation=False,
                assessment=AssessmentInfo(
                    confidence=1.0,
                    flagging_reason="none",
                    orders_found=0,
                    products_found=0,
                    context_used=True,
                    suggested_fallback=None,
                ),
            )

            pass2_response = await self._execute_pass2(
                user_input=f"Declined {action_type} request",
                pass1_output=pass1_output,
                tool_results=tool_results,
                context=context,
                detected_language=context.detected_language or "en",
                tracking_data=None,
                trace=trace,
                confirmation_context=decline_context,
                history=history,
                turn_number=trace.turn_number,
            )

            content = (
                pass2_response
                if pass2_response
                else f"No problem! Your order will remain as-is. Feel free to reach out if you change your mind or need anything else."
            )

            return MessageResponse(
                content=content,
                store=context.store,
                timestamp=datetime.now(timezone.utc),
                requires_human=False,
                confidence_score=1.0,
                is_context_relevant=True,
            )

        # User confirmed the action - execute it
        try:
            tool_name = pending_action["action_type"]
            tool_params = pending_action["parameters"]

            # Filter parameters to match the tool signature (shared whitelist).
            # The stored action_type is a string; map it to the enum to reuse
            # the single source of truth in agent_schema.TOOL_VALID_PARAMS.
            try:
                tool_params = filter_tool_params(ToolName(tool_name), tool_params)
                self.logger.info(
                    f"[Confirmation] Filtered parameters for {tool_name}: {list(tool_params.keys())}"
                )
            except ValueError:
                self.logger.warning(
                    f"[Confirmation] Unknown tool name in pending action: {tool_name}"
                )

            result = await execute_tool(tool_name, tool_params)

            # CRITICAL: Check if tool execution actually succeeded
            if isinstance(result, dict) and result.get("status") == "error":
                error_msg = result.get("message") or result.get("error") or "Unknown error"
                self.logger.error(f"[Confirmation] Tool execution failed: {error_msg}")

                # Only `process_order` returns curated, customer-appropriate
                # messages ("Cannot cancel a shipped order…"). For anything else
                # the string is not vetted for customer eyes, so stay generic.
                if tool_name == ToolName.PROCESS_ORDER.value:
                    content = f"I couldn't complete that action: {error_msg}"
                else:
                    content = (
                        "I couldn't complete that action. Nothing has been changed "
                        "on your order — please try again in a moment."
                    )

                return MessageResponse(
                    content=content,
                    store=context.store,
                    timestamp=datetime.now(timezone.utc),
                    requires_human=False,
                    confidence_score=0.8,
                    is_context_relevant=True,
                )

            await cache_manager.delete_pending_action(confirm_action_id)
            await context_manager.clear_pending_confirmation(context.session_id)

            # Generate dynamic response using Pass 2 with FAQ context
            action_type = tool_params.get("action", "process")
            order_id = tool_params.get("order_id", "unknown")

            # IMPORTANT: Only clear last_intent, NOT current_order
            # This allows users to ask follow-up questions about the processed order
            # Example: After returning order, user might ask "when will I get my refund?"
            # But if user says "track this" or selects different order, Pass 1 will handle new intent
            context.last_intent = None
            await context_manager.save_context(context)
            self.logger.info(
                f"[Context] Cleared last_intent after {action_type} operation. Order {order_id} remains in context for follow-up questions."
            )

            # Get FAQ context for next steps (see the module-scope import note above)
            faq_query = f"{action_type} policy"
            faq_result = await execute_tool(
                "faq_search", {"query": faq_query, "store": context.store}
            )

            # Create tool result for FAQ context
            # FAQ search returns a list directly: [{"id": "...", "content": "..."}]
            tool_results = []
            if isinstance(faq_result, list) and faq_result:
                tool_results.append(
                    ToolResult(
                        tool_name=ToolName.FAQ_SEARCH,
                        success=True,
                        data=faq_result,
                        error=None,
                    )
                )

            # Build context for confirmation success message
            success_context = load_prompt(
                "confirmation_success_prompt.txt"
            ).format(action=action_type)

            # Create a minimal Pass1Output for Pass 2
            pass1_output = Pass1Output(
                intent=IntentType.ORDER_MODIFICATION,
                tool_calls=[],
                context_understanding=ContextUnderstanding(
                    referenced_order=order_id,
                    referenced_product=None,
                    language_detected=context.detected_language or "en",
                    conversation_flow=f"User confirmed {action_type} request",
                ),
                requires_confirmation=False,
                assessment=AssessmentInfo(
                    confidence=1.0,
                    flagging_reason="none",
                    orders_found=1,
                    products_found=0,
                    context_used=True,
                    suggested_fallback=None,
                ),
            )

            pass2_response = await self._execute_pass2(
                user_input=f"Confirmed {action_type} request",
                pass1_output=pass1_output,
                tool_results=tool_results,
                context=context,
                detected_language=context.detected_language or "en",
                tracking_data=None,
                trace=trace,
                confirmation_context=success_context,
                history=history,
                turn_number=trace.turn_number,
            )

            content = (
                pass2_response
                if pass2_response
                else f"Your {action_type} request has been processed successfully. Is there anything else I can help you with?"
            )

            return MessageResponse(
                content=content,
                store=context.store,
                timestamp=datetime.now(timezone.utc),
                requires_human=False,
                confidence_score=1.0,
                is_context_relevant=True,
            )

        except Exception as e:
            # Never surface raw exception text to the customer: it can carry
            # connection strings, table/column names and internal IDs. Detail
            # goes to the logs and the trace only.
            self.logger.error("Error executing confirmed action", exc_info=True)
            trace.errors.append(f"Confirmation execution failed: {str(e)}")

            # `process_order` performs its mutation inside `session.begin()`, so
            # an exception rolls the transaction back — the order really is
            # untouched, and saying so avoids the customer double-submitting.
            return MessageResponse(
                content=(
                    "I wasn't able to complete that request just now, and nothing "
                    "has been changed on your order. Please try again in a moment "
                    "— if it keeps happening I can connect you with our team."
                ),
                store=context.store,
                timestamp=datetime.now(timezone.utc),
                requires_human=True,
                confidence_score=0.0,
                is_context_relevant=True,
            )

    async def _create_fallback_response(
        self,
        store: str,
        trace: TwoPassExecutionTrace,
    ) -> MessageResponse:
        """Create a fallback response when Pass 1 fails.

        A Pass 1 parse failure is recovered by the customer simply rephrasing,
        so this is deliberately NOT a human handoff and carries no warning
        badge — a scary banner above "could you rephrase?" is pure noise.
        """
        return MessageResponse(
            content="I'm here to help! Could you please rephrase your question?",
            store=store,
            timestamp=datetime.now(timezone.utc),
            requires_human=False,
            confidence_score=0.0,
            is_context_relevant=True,
        )

    async def _create_error_response(
        self,
        store: str,
        error_detail: str,
    ) -> MessageResponse:
        """Create an error response.

        `error_detail` is for logs/tracing ONLY. It must never reach the
        response: the frontend renders `warning_message` verbatim into the chat
        bubble, so an exception string there leaks internals to the customer.
        """
        return MessageResponse(
            content="I'm having trouble processing your request right now. Please try again or contact support.",
            store=store,
            timestamp=datetime.now(timezone.utc),
            requires_human=True,
            confidence_score=0.0,
            is_context_relevant=True,
        )

    def _log_trace(self, trace: TwoPassExecutionTrace):
        """Log execution trace for monitoring"""
        self.logger.info(
            "Two-pass execution trace",
            extra={
                "session_id": trace.session_id,
                "turn_number": trace.turn_number,
                "total_duration_ms": trace.total_duration_ms,
                "state": trace.current_state,
                "intent": trace.pass1_parsed.intent if trace.pass1_parsed else None,
                "tools_count": len(trace.tools_executed),
                "errors": trace.errors,
                "warnings": trace.warnings,
            },
        )


# Singleton instance
two_pass_agent = TwoPassAgent()
