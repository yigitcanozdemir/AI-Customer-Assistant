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

import json
import logging
import time
import uuid
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from backend.config import settings
from backend.api.agent_schema import (
    Pass1Output,
    Pass2Input,
    ToolCall,
    ToolResult,
    ToolName,
    IntentType,
    ConversationContext,
    AgentState,
    TwoPassExecutionTrace,
    PolicyValidationResult,
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
        confirm_action_id: Optional[str] = None,
        image: Optional[str] = None,
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
            confirm_action_id: ID of action to confirm (if any)
            image: Optional user-uploaded image (data:/http URL) — described to
                text and folded into the query for "find similar outfits".

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
                confirm_action_id=confirm_action_id,
                image=image,
            )

    async def _execute_turn(
        self,
        user_input: str,
        session_id: str,
        store: str,
        user_id: str,
        user_name: str,
        selected_order: Any = None,
        confirm_action_id: Optional[str] = None,
        image: Optional[str] = None,
    ) -> MessageResponse:
        """Run the two-pass flow. Called within the `turn_trace` root span."""
        start_time = time.perf_counter()

        # Vision → text: if the user attached an image, describe the garment and
        # fold that description into the query so Pass 1 produces a product_search
        # with a rich, attribute-laden query against the existing pgvector index.
        if image and not confirm_action_id:
            user_input = await self._describe_image_into_query(image, user_input)

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
                session_id, user_id, user_name, store, selected_order
            )

            # Handle confirmation flow if applicable
            if confirm_action_id:
                return await self._handle_confirmation(
                    confirm_action_id, context, trace, user_input
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
                trace=trace,
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
                )

                trace.pass2_completed_at = time.perf_counter()
                trace.pass2_output = pass2_output

            # Use assessment from Pass 1 (no separate LLM call needed)
            pass1_assessment = pass1_output.assessment

            # Determine if human intervention is needed based on Pass 1 assessment.
            # A successful policy denial is the system working as intended, so it
            # must not be flagged for human review.
            requires_human = (
                pass1_assessment.confidence < 0.5
                or pass1_assessment.flagging_reason
                in [
                    "off_topic",
                    "unclear_request",
                    "abusive_language",
                    "policy_violation",
                    "prompt_injection",
                    "potential_error",
                ]
            ) and not policy_denied

            # Use suggested fallback if provided and confidence is low
            response_content = trace.pass2_output or "Please confirm the action above."
            if (
                pass1_assessment.suggested_fallback
                and pass1_assessment.confidence < 0.7
            ):
                response_content = pass1_assessment.suggested_fallback

            # Convert flagging reason to warning message
            warning_message = None
            if pass1_assessment.flagging_reason == "potential_error":
                warning_message = "There may be an issue with your request."
            elif pass1_assessment.flagging_reason == "unclear_request":
                warning_message = "Your request needs clarification."

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
                    "off_topic": "Request outside e-commerce domain",
                    "unclear_request": "Request needs clarification",
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
    ) -> None:
        """Make "find similar to THIS shop item" visual, and exclude the source.

        When Pass 1 resolved a `referenced_product` (user said "similar",
        "like this", "this product") and a product is selected in context, we:
          1. exclude that product's id from results (so "similar" never returns
             the same item), and
          2. replace the name-based query with a VISUAL description of the item's
             own catalog image (true visual similarity), reusing the same
             vision→text path as user-uploaded images.

        Everything is best-effort: if there's no selected product, no image, or
        the provider lacks vision, we leave the LLM's name-based query intact
        (still applying the exclusion when we know the id).
        """
        referenced = pass1_output.context_understanding.referenced_product
        if not referenced or not context.recent_products:
            return

        source = context.recent_products[-1]
        source_id = source.get("id")
        if not source_id:
            return

        # 1) Always exclude the source item from its own "similar" results.
        tool_call.parameters.exclude_product_id = str(source_id)

        # 2) Upgrade to visual similarity using the item's own image.
        provider = get_provider()
        if not getattr(provider, "supports_vision", False):
            return
        try:
            from backend.services.tool import get_product_primary_image

            image_url = await get_product_primary_image(str(source_id), store)
            if not image_url:
                return  # keep the name-based query
            description = await provider.describe_image(
                image_url, self._IMAGE_DESCRIBE_INSTRUCTION
            )
            description = (description or "").strip()
            if description:
                tool_call.parameters.query = description
                self.logger.info(
                    f"[Vision] Similar-item search using visual query: {description}"
                )
        except Exception as e:
            self.logger.error(
                f"[Vision] similar-item enrichment failed: {e}", exc_info=True
            )

    async def _execute_pass1(
        self,
        user_input: str,
        context: ConversationContext,
        selected_order: Any,
        trace: TwoPassExecutionTrace,
    ) -> Optional[Pass1Output]:
        """
        Execute Pass 1: Intent Recognition & Tool Planning

        Returns JSON-only output parsed into Pass1Output schema.
        """
        try:
            # Build context summary
            context_summary = context_manager.build_context_summary(context)

            # Build product context info
            product_context_info = ""
            if context.recent_products:
                # Get the most recent product
                latest_product = context.recent_products[-1]
                product_name = latest_product.get("name", "Unknown")
                product_id = latest_product.get("id", "Unknown")
                product_price = latest_product.get("price", "N/A")
                product_currency = latest_product.get("currency", "USD")

                product_context_info = f"""
**SELECTED PRODUCT CONTEXT**:
- Product ID: {product_id}
- Product Name: {product_name}
- Price: {product_price} {product_currency}

The user is referring to this product when they say "similar products", "products like this", "this product", etc.
When searching for similar products, use the product name or characteristics to guide the search query.
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
                conversation_turn=context.conversation_turn,
                context_summary=context_summary,
                product_context_info=product_context_info,
                order_context_info=order_context_info,
            )

            # Call the active provider with structured output.
            pass1_output = await get_provider().parse(
                [
                    LLMMessage("system", pass1_prompt),
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
    ) -> List[ToolResult]:
        """
        Execute tools in parallel where possible.

        Returns list of ToolResult objects.
        """
        if not tool_calls:
            return []

        tool_results = []
        tool_tasks = []

        for tool_call in tool_calls:
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

            # "Find similar to THIS shop item": enrich the search with the source
            # product's own image (visual similarity) and exclude it from results.
            if tool_call.tool_name == ToolName.PRODUCT_SEARCH:
                await self._enrich_similar_product_search(
                    tool_call, context, pass1_output, store
                )

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

        trace.tools_executed = tool_results

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
    ) -> str:
        """
        Execute Pass 2: Natural Language Response Generation.

        Args:
            confirmation_context: Optional context for confirmation/declination
                responses (success/decline messages after a pending action).

        Returns the natural language response string. Policy validation is a
        separate structured call (see `_validate_action_against_policy`).
        """
        try:
            tool_results_summary = self._build_tool_results_summary(tool_results)

            tracking_guidance = ""
            if tracking_data:
                tracking_guidance = self._build_tracking_guidance(tracking_data)

            policy_context = self._extract_policy_context(tool_results)

            language_names = {
                "en": "English",
                "es": "Spanish",
                "fr": "French",
                "de": "German",
                "it": "Italian",
                "pt": "Portuguese",
                "tr": "Turkish",
                "ar": "Arabic",
                "zh": "Chinese",
                "ja": "Japanese",
                "ko": "Korean",
            }
            detected_language_name = language_names.get(detected_language, "English")

            conversation_context_summary = context_manager.build_context_summary(
                context
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
                policy_context=policy_context,
                conversation_context_summary=conversation_context_summary,
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

        # Get current date for validation
        from datetime import datetime, timezone

        current_date = datetime.now(timezone.utc).date()

        # Calculate days elapsed since order creation
        days_elapsed = None
        if order_created_at:
            try:
                # Parse order_created_at (format: YYYY-MM-DD HH:MM:SS or YYYY-MM-DD)
                if isinstance(order_created_at, str):
                    order_date = datetime.fromisoformat(
                        order_created_at.replace("Z", "+00:00")
                    ).date()
                else:
                    order_date = (
                        order_created_at.date()
                        if hasattr(order_created_at, "date")
                        else order_created_at
                    )
                days_elapsed = (current_date - order_date).days
            except Exception as e:
                self.logger.warning(
                    f"[Policy Validation] Could not parse order_created_at: {e}"
                )

        policy_context = self._extract_policy_context(tool_results)

        validation_prompt = load_prompt("policy_validation_prompt.txt").format(
            current_date=current_date,
            order_created_at=order_created_at,
            days_elapsed=(
                days_elapsed if days_elapsed is not None else "Unable to calculate"
            ),
            action=action,
            order_id=order_id,
            order_status=order_status,
            policy_context=policy_context,
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

        # Check if user declined the action
        is_declined = "declined" in user_input.lower() or "cancel" in user_input.lower()

        if is_declined:
            # User declined the action
            await cache_manager.delete_pending_action(confirm_action_id)
            await context_manager.clear_pending_confirmation(context.session_id)

            action_type = pending_action["parameters"].get("action", "action")

            # Get FAQ context for declination response
            from backend.api.agent_schema import ToolResult, ToolName

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
            from backend.api.agent_schema import (
                Pass1Output,
                IntentType,
                ContextUnderstanding,
                AssessmentInfo,
            )

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

                # Return friendly error message to user
                return MessageResponse(
                    content=f"I couldn't complete that action: {error_msg}",
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

            # Get FAQ context for next steps
            from backend.api.agent_schema import ToolResult, ToolName

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
            from backend.api.agent_schema import (
                Pass1Output,
                IntentType,
                ContextUnderstanding,
                AssessmentInfo,
            )

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
            self.logger.error(f"Error executing confirmed action: {e}")

            return MessageResponse(
                content=f"I encountered an error while processing your request: {str(e)}. Please contact support for assistance.",
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
        """Create a fallback response when Pass 1 fails"""
        return MessageResponse(
            content="I'm here to help! Could you please rephrase your question?",
            store=store,
            timestamp=datetime.now(timezone.utc),
            requires_human=True,
            confidence_score=0.0,
            is_context_relevant=True,
            warning_message="System encountered an issue processing your request.",
        )

    async def _create_error_response(
        self,
        store: str,
        error_message: str,
    ) -> MessageResponse:
        """Create an error response"""
        return MessageResponse(
            content="I'm having trouble processing your request right now. Please try again or contact support.",
            store=store,
            timestamp=datetime.now(timezone.utc),
            requires_human=True,
            confidence_score=0.0,
            is_context_relevant=True,
            warning_message=f"Error: {error_message}",
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
