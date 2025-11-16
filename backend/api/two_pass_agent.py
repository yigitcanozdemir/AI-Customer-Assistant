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

from openai import AsyncOpenAI
from backend.config import settings
from backend.api.two_pass_schema import (
    Pass1Output,
    Pass2Input,
    ToolCall,
    ToolResult,
    ToolName,
    IntentType,
    ConversationContext,
    AgentState,
    TwoPassExecutionTrace,
)
from backend.api.schema import (
    MessageResponse,
    Message,
    PendingAction,
    ResponseAssessment,
)
from backend.services.tool import call_tool as execute_tool
from backend.services.context_manager import context_manager
from backend.prompts.loader import load_prompt
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)

client = AsyncOpenAI(api_key=settings.openai_api_key)


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
    ) -> MessageResponse:
        """
        Execute the complete two-pass flow.

        Args:
            user_input: User's message
            session_id: Session identifier
            store: Store name
            user_id: User identifier
            user_name: User's display name
            selected_order: Currently selected order (if any)
            confirm_action_id: ID of action to confirm (if any)

        Returns:
            MessageResponse with final response and metadata
        """
        start_time = time.perf_counter()

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
            self.logger.info(f"[Pass 1] Starting intent recognition for session {session_id}")
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

            # CRITICAL: If Pass 1 explicitly set referenced_order to null, clear current_order
            # This happens when user says "my orders", "another order", etc.
            if (pass1_output.context_understanding.referenced_order is None and
                any(tc.tool_name == ToolName.LIST_ORDERS for tc in pass1_output.tool_calls)):
                self.logger.info(f"[Context] Clearing current_order - user requested to see all orders")
                await context_manager.clear_order_context(
                    session_id=session_id,
                    reason="User requested to see all orders"
                )
                # CRITICAL: Re-fetch context so Pass 2 uses the cleared context
                context = await context_manager.get_context(session_id)
                self.logger.info(f"[Context] Context refreshed after clearing order")

            # TOOL EXECUTION LAYER
            # Filter out process_order if confirmation is required
            tools_to_execute = pass1_output.tool_calls
            if pass1_output.requires_confirmation:
                # Skip process_order - it will run after user confirms
                # But execute other tools like faq_search to get policy info
                tools_to_execute = [
                    tc for tc in pass1_output.tool_calls
                    if tc.tool_name != ToolName.PROCESS_ORDER
                ]
                self.logger.info(f"[Tools] Confirmation required - skipping process_order until confirmed")

            self.logger.info(f"[Tools] Executing {len(tools_to_execute)} tool(s)")
            trace.current_state = AgentState.TOOL_EXECUTION

            tool_results = await self._execute_tools(
                tool_calls=tools_to_execute,
                context=context,
                user_id=user_id,
                trace=trace,
            )

            trace.tools_completed_at = time.perf_counter()

            # Extract products, orders, tracking data from tool results
            products, orders, tracking_data = self._extract_data_from_tools(tool_results)

            # Update context with tool results
            if products:
                await context_manager.update_context(
                    session_id=session_id,
                    products=products,
                )

            # Update current_order when tracking is fetched
            if tracking_data:
                # Convert tracking_data to dict for context storage
                order_dict = {
                    'order_id': str(tracking_data.order_id),
                    'status': tracking_data.status,
                    'created_at': str(tracking_data.created_at),
                }
                await context_manager.update_context(
                    session_id=session_id,
                    selected_order=order_dict,
                )

            tool_names = [tc.tool_name.value for tc in pass1_output.tool_calls]
            await context_manager.update_context(
                session_id=session_id,
                tool_calls=tool_names,
            )

            # Check if confirmation is needed
            pending_action = None
            if pass1_output.requires_confirmation and any(
                tc.tool_name == ToolName.PROCESS_ORDER for tc in pass1_output.tool_calls
            ):
                # CRITICAL: Validate policy BEFORE creating pending action
                self.logger.info(f"[Policy Validation] Checking if action is allowed by FAQ policy")

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
                    # Action is DENIED - Pass 2 already generated denial message
                    self.logger.info(f"[Policy Validation] Action DENIED by policy: {validation_result['reason']}")
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

            # Assessment
            assessment = await self._assess_response(
                user_input=user_input,
                pass1_output=pass1_output,
                response_content=trace.pass2_output or "Pending confirmation",
                tool_results=tool_results,
                selected_order=selected_order,
                context=context,
            )

            # Build final response
            trace.current_state = AgentState.COMPLETE
            trace.total_duration_ms = (time.perf_counter() - start_time) * 1000

            final_response = MessageResponse(
                content=trace.pass2_output or "Please confirm the action above.",
                store=store,
                suggestions=[],
                products=products,
                orders=orders,
                tracking_data=tracking_data,
                timestamp=datetime.now(timezone.utc),
                requires_human=assessment.requires_human,
                confidence_score=assessment.confidence_score,
                is_context_relevant=assessment.is_context_relevant,
                pending_action=pending_action,
                warning_message=assessment.warning_message,
                assessment_reasoning=assessment.reasoning,
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
                'order_id': str(selected_order.order_id),
                'status': selected_order.status,
                'product_name': (
                    selected_order.product.name
                    if hasattr(selected_order, 'product')
                    else 'Unknown'
                ),
                'created_at': (
                    selected_order.created_at.isoformat()
                    if hasattr(selected_order.created_at, 'isoformat')
                    else str(selected_order.created_at)
                ),
            }
            await context_manager.update_context(
                session_id=session_id,
                selected_order=order_dict,
            )
            context = await context_manager.get_context(session_id)

        return context

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

            # Build order context info
            # Use selected_order from parameter, or fall back to context.current_order
            order_context_info = ""
            if selected_order:
                order_context_info = f"""
**SELECTED ORDER CONTEXT**:
- Order ID: {selected_order.order_id}
- Status: {selected_order.status}
- Product: {selected_order.product.name if hasattr(selected_order, 'product') else 'Unknown'}
- Created: {selected_order.created_at}

The user is referring to this order when they say "this order", "it", "that one", etc.
"""
            elif context.current_order:
                # Use the order from context (e.g., from recent tracking)
                order_id = context.current_order.get('order_id', 'unknown')
                order_status = context.current_order.get('status', 'unknown')
                order_created = context.current_order.get('created_at', 'unknown')
                order_context_info = f"""
**SELECTED ORDER CONTEXT** (from recent conversation):
- Order ID: {order_id}
- Status: {order_status}
- Created: {order_created}

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
                order_context_info=order_context_info,
            )

            # Call LLM with structured output
            response = await client.responses.parse(
                model=settings.openai_model,
                input=[
                    {"role": "system", "content": pass1_prompt},
                    {"role": "user", "content": user_input},
                ],
                text_format=Pass1Output,
            )

            # Extract parsed output
            pass1_output = response.output_parsed

            # Store raw output for debugging
            trace.pass1_raw_output = json.dumps(pass1_output.model_dump(), indent=2)

            self.logger.info(
                f"[Pass 1] Intent: {pass1_output.intent}, Tools: {len(pass1_output.tool_calls)}, Confidence: {pass1_output.confidence}"
            )

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
            # Add user_id to list_orders if not present
            if tool_call.tool_name == ToolName.LIST_ORDERS:
                # Only add user_id if not already present
                if not tool_call.parameters.user_id:
                    tool_call.parameters.user_id = user_id

            # Execute tool
            tool_tasks.append(
                self._execute_single_tool(tool_call, trace)
            )

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
            # Convert ToolParameters to dict, excluding None values
            params_dict = tool_call.parameters.model_dump(exclude_none=True)

            # Filter parameters to only include what each tool accepts
            # This prevents Pass 1 from accidentally including wrong parameters
            valid_params = {
                ToolName.PRODUCT_SEARCH: ['query', 'store'],
                ToolName.FAQ_SEARCH: ['query', 'store'],
                ToolName.VARIANT_CHECK: ['product_id', 'size', 'color'],
                ToolName.PROCESS_ORDER: ['order_id', 'action', 'store'],
                ToolName.LIST_ORDERS: ['store', 'user_id'],
                ToolName.FETCH_ORDER_LOCATION: ['order_id', 'store'],
            }

            # Keep only valid parameters for this tool
            if tool_call.tool_name in valid_params:
                allowed = valid_params[tool_call.tool_name]
                params_dict = {k: v for k, v in params_dict.items() if k in allowed}

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

            if result.tool_name == ToolName.PRODUCT_SEARCH and isinstance(result.data, list):
                products = result.data

            elif result.tool_name == ToolName.LIST_ORDERS:
                if hasattr(result.data, 'orders'):
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
        validation_context: str = "",
    ) -> str:
        """
        Execute Pass 2: Natural Language Response Generation

        Args:
            validation_context: Optional context for policy validation mode

        Returns natural language response string.
        """
        try:
            # Build tool results summary
            tool_results_summary = self._build_tool_results_summary(tool_results)

            # Build tracking guidance
            tracking_guidance = ""
            if tracking_data:
                tracking_guidance = self._build_tracking_guidance(tracking_data)

            # Build policy context (from FAQ results)
            policy_context = self._extract_policy_context(tool_results)

            # Language mapping
            language_names = {
                'en': 'English',
                'es': 'Spanish',
                'fr': 'French',
                'de': 'German',
                'it': 'Italian',
                'pt': 'Portuguese',
                'tr': 'Turkish',
                'ar': 'Arabic',
                'zh': 'Chinese',
                'ja': 'Japanese',
                'ko': 'Korean',
            }
            detected_language_name = language_names.get(detected_language, 'English')

            # Build conversation context summary
            conversation_context_summary = context_manager.build_context_summary(context)

            # If validation_context is provided, use it instead of normal prompt
            if validation_context:
                # Policy validation mode - use simplified prompt
                validation_prompt = f"""You are validating an order action against store policies.

{validation_context}

**FAQ POLICY:**
{policy_context}

Generate your validation response now (must start with VALIDATION:ALLOWED or VALIDATION:DENIED).
"""
                pass2_prompt = validation_prompt
            else:
                # Normal response generation mode
                # Load Pass 2 prompt
                pass2_prompt = load_prompt("pass2_response_prompt.txt").format(
                    store=context.store,
                    user_name=context.user_name,
                    detected_language=detected_language,
                    detected_language_name=detected_language_name,
                    user_message=user_input,
                    intent=pass1_output.intent.value,
                    tool_results_summary=tool_results_summary,
                    tracking_guidance=tracking_guidance,
                    policy_context=policy_context,
                    conversation_context_summary=conversation_context_summary,
                    confirmation_context="",  # Will be added if needed
                )

            # Call LLM for natural language response
            response = await client.responses.create(
                model=settings.openai_model,
                input=[
                    {"role": "system", "content": pass2_prompt},
                    {"role": "user", "content": "Generate your response now."},
                ],
            )

            # Extract response text
            if hasattr(response, "output_text"):
                content = response.output_text
            elif hasattr(response, "output") and response.output:
                content = "".join([getattr(o, "text", "") for o in response.output])
            else:
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
            if hasattr(result.data, 'orders'):
                return f"Found {len(result.data.orders)} order(s)"
            return "No orders found"

        elif result.tool_name == ToolName.FETCH_ORDER_LOCATION:
            if result.data:
                status = getattr(result.data, 'status', 'unknown')
                return f"Tracking data retrieved (status: {status})"
            return "Tracking data not available"

        elif result.tool_name == ToolName.FAQ_SEARCH:
            if isinstance(result.data, list):
                # Use jsonable_encoder to handle UUID and other non-JSON types
                return f"Found {len(result.data)} FAQ result(s): {json.dumps(jsonable_encoder(result.data))}"
            return "No FAQ results"

        elif result.tool_name == ToolName.VARIANT_CHECK:
            return f"Variant check completed: {json.dumps(jsonable_encoder(result.data))}"

        else:
            return "Completed"

    def _build_tracking_guidance(self, tracking_data: Any) -> str:
        """Build tracking guidance message"""
        if not tracking_data:
            return ""

        status = getattr(tracking_data, 'status', '').lower()

        if status == "created":
            return "The order is still being prepared and hasn't shipped yet."
        elif status == "shipped":
            return "The order is in transit and tracking information is available."
        elif status == "delivered":
            return "The order has been delivered to the destination."
        else:
            return ""

    def _extract_policy_context(self, tool_results: List[ToolResult]) -> str:
        """Extract policy information from FAQ search results"""
        for result in tool_results:
            if result.tool_name == ToolName.FAQ_SEARCH and result.success:
                if isinstance(result.data, list) and result.data:
                    # FAQ tool returns all policies from the store
                    # Pass them to Pass 2 for extraction of ONLY relevant parts
                    policies = [faq.get('content', '') for faq in result.data]
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
            order_id = getattr(selected_order, 'order_id', None)
            order_status = getattr(selected_order, 'status', None)
            order_created_at = getattr(selected_order, 'created_at', None)
            self.logger.info(f"[Policy Validation] Using selected_order: {order_id}, status={order_status}")
        elif context.current_order:
            order_id = context.current_order.get('order_id')
            order_status = context.current_order.get('status')
            order_created_at = context.current_order.get('created_at')
            self.logger.info(f"[Policy Validation] Using context.current_order: {order_id}, status={order_status}")
        else:
            self.logger.warning(f"[Policy Validation] No order found in selected_order or context.current_order")

        # Extract action from process_order tool call
        action = None
        for tc in pass1_output.tool_calls:
            if tc.tool_name == ToolName.PROCESS_ORDER:
                action = tc.parameters.action if hasattr(tc.parameters, 'action') else None
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
                    order_date = datetime.fromisoformat(order_created_at.replace('Z', '+00:00')).date()
                else:
                    order_date = order_created_at.date() if hasattr(order_created_at, 'date') else order_created_at
                days_elapsed = (current_date - order_date).days
            except Exception as e:
                self.logger.warning(f"[Policy Validation] Could not parse order_created_at: {e}")

        # Build validation context for Pass 2
        validation_context = f"""
**POLICY VALIDATION MODE ACTIVE**

**DATE INFORMATION**:
Current date: {current_date}
Order created at: {order_created_at}
Days elapsed since order creation: {days_elapsed if days_elapsed is not None else 'Unable to calculate'}

**ORDER DETAILS**:
User wants to: {action} order {order_id}
Order current status: {order_status}

**ORDER STATUS DEFINITIONS** (CRITICAL - DO NOT MAKE UP YOUR OWN INTERPRETATION):
- "created" = Payment CONFIRMED, order placed in system. This is AFTER checkout/payment.
- "shipped" = Order dispatched, in transit.
- "delivered" = Order arrived at customer.
- "cancelled" = Order was cancelled.
- "returned" = Order was returned.

Your task:
1. Check the FAQ policy below
2. Determine if this {action} is ALLOWED or DENIED based on:
   - Order status (use definitions above)
   - Time elapsed since order creation (calculated above)
   - Specific policy rules from FAQ

3. Respond with ONE of these formats:

IF ALLOWED:
"VALIDATION:ALLOWED
I have the {action} request for order {order_id} ready. [Explain why it's allowed based on policy, e.g., 'Our policy allows returns within 30 days and it has been X days since your order']. Please select Confirm to proceed or Cancel to keep your order as-is."

IF DENIED:
"VALIDATION:DENIED
I understand you want to {action} this order. However, [explain specific policy rule that prevents it, e.g., 'our policy states orders cannot be canceled once payment is confirmed' OR 'returns are only accepted for delivered orders within X days']. [Offer alternative if available, e.g., 'You can return it after delivery within 30 days']."

CRITICAL RULES FOR VALIDATION:
- Start response with "VALIDATION:ALLOWED" or "VALIDATION:DENIED"
- Extract ONLY the specific rule that applies (NO shipping costs, NO full FAQ copy)
- Use the Days elapsed calculation provided above - DO NOT make up your own date math
- For CANCELLATIONS:
  * If FAQ says "cannot cancel after payment/checkout", DENY for status "created" (payment IS confirmed)
  * "created" status means payment completed - use this for evaluation
- For RETURNS:
  * MUST check TWO conditions:
    1. Status MUST be "delivered" (DENY if "created", "shipped", etc. - order not received yet)
    2. Days elapsed MUST be within policy window (e.g., within 30 days for Aurora Style, within 14 days for Dayifuse Fashion)
  * If status is NOT "delivered", explain: "Returns are only accepted after you receive your order"
  * If days elapsed exceeds window, explain: "Returns are accepted within X days, and it has been Y days since your order"
- Use the status definitions above - DO NOT interpret "created" as "not confirmed"
- Be precise and helpful
"""

        # Use Pass 2 with validation context
        try:
            response = await self._execute_pass2(
                user_input=user_input,
                pass1_output=pass1_output,
                tool_results=tool_results,
                context=context,
                detected_language=detected_language,
                tracking_data=tracking_data,
                trace=trace,
                validation_context=validation_context,
            )

            # Parse validation result
            if response.startswith("VALIDATION:ALLOWED"):
                message = response.replace("VALIDATION:ALLOWED", "").strip()
                return {
                    "allowed": True,
                    "message": message,
                    "reason": None,
                }
            elif response.startswith("VALIDATION:DENIED"):
                message = response.replace("VALIDATION:DENIED", "").strip()
                return {
                    "allowed": False,
                    "message": message,
                    "reason": "Policy violation",
                }
            else:
                # Fallback: If response doesn't start with VALIDATION, assume allowed
                self.logger.warning(f"[Policy Validation] Response doesn't start with VALIDATION marker, assuming ALLOWED")
                return {
                    "allowed": True,
                    "message": response,
                    "reason": None,
                }

        except Exception as e:
            self.logger.error(f"[Policy Validation] Error during validation: {e}", exc_info=True)
            # On error, DENY for safety
            return {
                "allowed": False,
                "message": "I'm having trouble validating this request against our policies. Please contact customer support for assistance.",
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
        process_order_params = process_order_call.parameters.model_dump(exclude_none=True)
        order_id = process_order_params.get('order_id') or (
            str(selected_order.order_id) if selected_order else None
        )
        action_type = process_order_params.get('action', 'process')

        pending_parameters = {
            **process_order_params,
            'order_id': order_id,
            'action': action_type,
        }

        action_payload = {
            'action_type': ToolName.PROCESS_ORDER.value,
            'parameters': pending_parameters,
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
            confirmation_message=f"Are you sure you want to {action_type} order {order_id}?",
        )

    async def _handle_confirmation(
        self,
        confirm_action_id: str,
        context: ConversationContext,
        trace: TwoPassExecutionTrace,
        user_input: str,
    ) -> MessageResponse:
        """Handle confirmation of a pending action"""
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

        # Execute the confirmed action
        try:
            tool_name = pending_action['action_type']
            tool_params = pending_action['parameters']

            result = await execute_tool(tool_name, tool_params)

            await cache_manager.delete_pending_action(confirm_action_id)
            await context_manager.clear_pending_confirmation(context.session_id)

            # Generate response about the completed action
            action_type = tool_params.get('action', 'process')
            order_id = tool_params.get('order_id', 'unknown')
            await context_manager.clear_order_context(
                session_id=context.session_id,
                reason=f"Order operation completed: {action_type} for order {order_id}"
            )
            self.logger.info(
                f"[Context] Cleared order context after successful {action_type} operation on order {order_id}"
            )

            content = f"Your {action_type} request for order {order_id} has been processed successfully. Is there anything else I can help you with?"

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

    async def _assess_response(
        self,
        user_input: str,
        pass1_output: Pass1Output,
        response_content: str,
        tool_results: List[ToolResult],
        selected_order: Any,
        context: 'ConversationContext' = None,
    ) -> ResponseAssessment:
        """Assess the quality of the response"""
        try:
            # Import here to avoid circular dependency
            from backend.api.chat import get_llm_assessment

            tools_used = len(tool_results) > 0
            products_found = sum(
                1 for r in tool_results
                if r.tool_name == ToolName.PRODUCT_SEARCH and r.success
            )
            orders_found = 0
            for r in tool_results:
                if r.tool_name == ToolName.LIST_ORDERS and r.success:
                    if hasattr(r.data, 'orders'):
                        orders_found = len(r.data.orders)
                # Also count tracking as "order data present"
                elif r.tool_name == ToolName.FETCH_ORDER_LOCATION and r.success and r.data:
                    orders_found = 1

            # If frontend provided selected_order, count it as order data present
            if selected_order and orders_found == 0:
                orders_found = 1

            # CRITICAL: If context has current_order but tools didn't find any, count it
            if orders_found == 0 and context and context.current_order:
                orders_found = 1
                self.logger.info(f"[Assessment] Counted context.current_order as orders_found=1")

            selected_order_id = str(selected_order.order_id) if selected_order else None
            product_name = (
                selected_order.product.name
                if selected_order and hasattr(selected_order, 'product')
                else ""
            )

            assessment = await get_llm_assessment(
                user_input=user_input,
                assistant_response=response_content,
                tool_calls_used=tools_used,
                products_found=products_found,
                orders_found=orders_found,
                selected_order_id=selected_order_id,
                product_name=product_name,
            )

            return assessment

        except Exception as e:
            self.logger.error(f"Error in assessment: {e}")

            return ResponseAssessment(
                confidence_score=0.7,
                is_context_relevant=True,
                requires_human=False,
                reasoning="Assessment failed, using default values",
                warning_message=None,
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
