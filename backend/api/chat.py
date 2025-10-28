from openai import AsyncOpenAI
from backend.config import settings
from backend.api.schema import MessageResponse, PendingAction, ResponseAssessment
from datetime import datetime, timezone
from backend.services.tool import call_tool
import json
from backend.api.schema import (
    MessageResponse,
    Product as ProductModel,
    Message,
    ListOrdersResponse,
)
from fastapi.encoders import jsonable_encoder
from typing import List, Any
from backend.api.convert import convert_messages
import logging
import time
import uuid
import asyncio
from backend.prompts.loader import load_prompt

logger = logging.getLogger(__name__)

client = AsyncOpenAI(api_key=settings.openai_api_key)

TOOLS = [
    {
        "type": "function",
        "name": "product_search",
        "description": "Search products in the database",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "store": {"type": "string"}},
            "required": ["query", "store"],
        },
    },
    {
        "type": "function",
        "name": "faq_search",
        "description": "Search faqs in the database",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "store": {"type": "string"}},
            "required": ["query", "store"],
        },
    },
    {
        "type": "function",
        "name": "variant_check",
        "description": "Check if a product variant is in stock",
        "parameters": {
            "type": "object",
            "properties": {
                "product_id": {"type": "string"},
                "size": {"type": "string"},
                "color": {"type": "string"},
            },
            "required": ["product_id"],
        },
    },
    {
        "type": "function",
        "name": "process_order",
        "description": "Process order cancellation or return - REQUIRES USER CONFIRMATION",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string"},
                "action": {"type": "string"},
                "store": {"type": "string"},
            },
            "required": ["order_id", "action", "store"],
        },
    },
    {
        "type": "function",
        "name": "list_orders",
        "description": "List users orders",
        "parameters": {
            "type": "object",
            "properties": {"store": {"type": "string"}},
            "required": ["store"],
        },
    },
]


async def get_llm_assessment(
    user_input: str,
    assistant_response: str,
    tool_calls_used: bool,
    products_found: int,
) -> ResponseAssessment:
    """
    Let the LLM assess its own response quality using structured output
    """
    assessment_prompt = load_prompt("assessment_prompt.txt").format(
        user_input=user_input,
        assistant_response=assistant_response,
        tools_used="Yes" if tool_calls_used else "No",
        products_found=products_found,
    )

    try:

        response = await client.responses.parse(
            model=settings.openai_model,
            input=[
                {
                    "role": "system",
                    "content": "You are a strict evaluator ensuring AI stays within e-commerce scope. Flag anything off-topic for human review.",
                },
                {"role": "user", "content": assessment_prompt},
            ],
            text_format=ResponseAssessment,
        )

        assessment = response.output_parsed

        logger.info(
            "LLM self-assessment completed",
            extra={
                "confidence": assessment.confidence_score,
                "requires_human": assessment.requires_human,
                "is_relevant": assessment.is_context_relevant,
                "reasoning": assessment.reasoning,
            },
        )

        return assessment

    except Exception as e:
        logger.error(f"Error in LLM assessment: {e}", exc_info=True)
        return ResponseAssessment(
            confidence_score=0.5,
            is_context_relevant=True,
            requires_human=False,
            reasoning="Assessment failed, using default values",
            warning_message=None,
        )


from backend.services.cache import cache_manager


async def handle_chat_event(
    user_input: str,
    store: str,
    message_history: List[Message],
    user_id: str,
    user_name: str,
    confirm_action_id: str = None,
    selected_order: Any = None,
) -> MessageResponse:
    start = time.perf_counter()

    selected_order_id = None
    order_context_info = ""
    if selected_order:
        selected_order_id = str(selected_order.order_id)
        order_status = selected_order.status
        product_name = (
            selected_order.product.name
            if hasattr(selected_order, "product")
            else "Unknown"
        )

        order_context_info = f"""
        
        **ORDER CONTEXT AVAILABLE**:
        The user has selected order ID: {selected_order_id}
        Order status: {order_status}
        Product: {product_name}
        
        IMPORTANT: Since an order is selected and the user is requesting a modification:
        1. You MUST call faq_search to check the relevant policy BEFORE any action
        2. Evaluate if the request is allowed based on the policy
        3. Only proceed with process_order if the policy allows it
        
        When the user asks to do something with "this order" or uses phrases like "cancel it", "return this", 
        they are referring to the order above.
        """

    try:
        if confirm_action_id:
            pending_action = await cache_manager.get_pending_action(confirm_action_id)
            if pending_action:
                logger.info(f"Executing confirmed action: {confirm_action_id}")

                tool_name = pending_action["action_type"]
                tool_params = pending_action["parameters"]

                try:
                    result = await call_tool(tool_name, tool_params)
                    await cache_manager.delete_pending_action(confirm_action_id)

                    action_type = tool_params.get("action", "process")
                    order_id = tool_params.get("order_id", "unknown")

                    confirmation_context = {
                        "role": "system",
                        "content": (
                            f"CONFIRMATION EXECUTED: The user confirmed the {action_type} action. "
                            f"The {action_type} for order {order_id} has been successfully completed. "
                            f"Result from system: {json.dumps(result)}. "
                            f"Now provide a detailed, helpful response about what was done, what happens next, "
                            f"and ask if there's anything else you can help with. Include relevant policy information "
                            f"if you previously retrieved it via faq_search."
                        ),
                    }

                    message_history.append(
                        Message(
                            id=f"sys-{confirm_action_id}",
                            type="system",
                            content=confirmation_context["content"],
                            timestamp=datetime.utcnow(),
                        )
                    )

                except Exception as tool_error:
                    logger.error(f"Error executing confirmed action: {tool_error}")

                    error_context = {
                        "role": "system",
                        "content": (
                            f"CONFIRMATION FAILED: The {tool_params.get('action', 'action')} for order "
                            f"{tool_params.get('order_id', 'unknown')} could not be completed. "
                            f"Error: {str(tool_error)}. "
                            f"Apologize to the user, explain the issue, and suggest they contact support or try again later."
                        ),
                    }

                    message_history.append(
                        Message(
                            id=f"sys-error-{confirm_action_id}",
                            type="system",
                            content=error_context["content"],
                            timestamp=datetime.utcnow(),
                        )
                    )

            else:
                logger.warning(
                    f"No pending action found for confirmation ID: {confirm_action_id}"
                )

        message_history = manage_context_window(message_history, max_messages=20)

        estimated_tokens = calculate_token_estimate(
            message_history
            + [
                Message(
                    id="temp",
                    type="user",
                    content=user_input,
                    timestamp=datetime.utcnow(),
                )
            ]
        )
        recent_products = extract_recent_products(message_history)

        if estimated_tokens > 3000:
            message_history = manage_context_window(message_history, max_messages=10)

        system_prompt_text = load_prompt("assistant_prompt.txt").format(
            store=str(store).title(),
            user_name=user_name,
            order_context_info=order_context_info,
        )
        system_prompt = {"role": "system", "content": system_prompt_text}

        input_list = [
            system_prompt,
            {
                "role": "system",
                "content": json.dumps(jsonable_encoder(recent_products)),
            },
        ] + convert_messages(message_history)

        logger.info(
            "OpenAI request started",
            extra={
                "event": "openai_request_start",
                "user_id": user_id,
                "store": store,
                "model": settings.openai_model,
                "message_count": len(message_history),
            },
        )
        response = await client.responses.create(
            model=settings.openai_model,
            input=input_list,
            tools=TOOLS,
        )
        duration = time.perf_counter() - start

        logger.info(
            "OpenAI response received",
            extra={
                "event": "openai_response",
                "user_id": user_id,
                "duration_ms": round(duration * 1000, 2),
                "usage": getattr(response, "usage", {}),
            },
        )
        content = ""
        products: list[ProductModel] = []
        orders = None
        pending_action = None

        input_list += response.output
        tool_calls_found = False
        tools_used_count = 0

        tool_tasks = []
        tool_metadata = []

        for output_item in response.output:
            if getattr(output_item, "type", None) == "function_call":
                tool_calls_found = True

                try:
                    args = json.loads(output_item.arguments)
                except json.JSONDecodeError:
                    logger.warning(
                        "Failed to parse tool arguments",
                        extra={
                            "event": "tool_argument_parse_error",
                            "name": getattr(output_item, "name", None),
                            "arguments": getattr(output_item, "arguments", None),
                            "user_id": user_id,
                        },
                    )
                    args = {}

                if output_item.name == "process_order":
                    action_id = str(uuid.uuid4())
                    order_id = args.get("order_id") or selected_order_id
                    args["order_id"] = order_id
                    action_type = args.get("action", "unknown")

                    confirmation_msg = (
                        f"Are you sure you want to {action_type} order {order_id}? "
                        "Please confirm to proceed."
                    )

                    await cache_manager.store_pending_action(
                        action_id=action_id,
                        action_data={
                            "action_type": output_item.name,
                            "parameters": args,
                        },
                        ttl=300,
                    )

                    pending_action = PendingAction(
                        action_id=action_id,
                        action_type="process_order",
                        parameters=args,
                        requires_confirmation=True,
                        confirmation_message=confirmation_msg,
                    )

                    input_list.append(
                        {
                            "type": "function_call_output",
                            "call_id": output_item.call_id,
                            "output": json.dumps(
                                {
                                    "status": "pending_confirmation",
                                    "message": confirmation_msg,
                                }
                            ),
                        }
                    )
                    continue

                if output_item.name == "list_orders":
                    args["user_id"] = user_id

                tool_tasks.append(call_tool(output_item.name, args))
                tool_metadata.append(
                    {
                        "name": output_item.name,
                        "call_id": output_item.call_id,
                        "args": args,
                    }
                )

        tool_results = await asyncio.gather(*tool_tasks, return_exceptions=True)

        for meta, result in zip(tool_metadata, tool_results):
            tool_name = meta["name"]
            call_id = meta["call_id"]

            if isinstance(result, Exception):
                logger.error(f"Tool {tool_name} failed: {result}", exc_info=True)
                continue

            if tool_name == "product_search" and isinstance(result, list):
                products = result
                input_list.append(
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": json.dumps(jsonable_encoder(result)),
                    }
                )
            elif tool_name == "variant_check":
                input_list.append(
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": json.dumps(jsonable_encoder(result)),
                    }
                )
            elif tool_name == "list_orders" and isinstance(result, ListOrdersResponse):
                orders = result.orders
                input_list.append(
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": json.dumps({"success": True}),
                    }
                )
            elif tool_name == "faq_search":
                input_list.append(
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": json.dumps(jsonable_encoder(result)),
                    }
                )

        if tool_calls_found:
            followup = await client.responses.create(
                model=settings.openai_model,
                input=input_list,
                tools=TOOLS,
            )

            if hasattr(followup, "output_text"):
                content = followup.output_text
            elif hasattr(followup, "output") and followup.output:
                content = "".join([getattr(o, "text", "") for o in followup.output])
            else:
                content = "I'm here to help!"
        else:
            if hasattr(response, "output_text"):
                content = response.output_text
            elif hasattr(response, "output") and response.output:
                content = "".join([getattr(o, "text", "") for o in response.output])
            else:
                content = "I'm here to help you find the perfect items!"

        assessment = await get_llm_assessment(
            user_input=user_input,
            assistant_response=content,
            tool_calls_used=tool_calls_found,
            products_found=len(products),
        )

        logger.info(
            "OpenAI chat handled successfully",
            extra={
                "event": "openai_chat_success",
                "user_id": user_id,
                "duration_ms": round((time.perf_counter() - start) * 1000, 2),
                "tools_used": tool_calls_found,
                "confidence_score": assessment.confidence_score,
                "requires_human": assessment.requires_human,
                "is_relevant": assessment.is_context_relevant,
            },
        )

        return MessageResponse(
            content=content,
            store=store,
            suggestions=[],
            products=products,
            orders=orders,
            timestamp=datetime.now(timezone.utc),
            requires_human=assessment.requires_human,
            confidence_score=assessment.confidence_score,
            is_context_relevant=assessment.is_context_relevant,
            pending_action=pending_action,
            warning_message=assessment.warning_message,
            assessment_reasoning=assessment.reasoning,
        )

    except Exception as e:
        logger.error(
            f"Error during OpenAI chat event for user {user_id}, store {store}: {e}",
            exc_info=True,
        )

        user_friendly_message = (
            "I'm having a little trouble completing your request right now. "
            "Please try again in a moment or contact support if the issue persists."
        )

        return MessageResponse(
            content=user_friendly_message,
            suggestions=["Try again", "Browse catalog", "Contact support"],
            store=store,
            products=[],
            orders=None,
            timestamp=datetime.now(timezone.utc),
            requires_human=True,
            confidence_score=0.0,
            is_context_relevant=True,
            warning_message="System error - human assistance required",
        )


def extract_recent_products(message_history: List[Message]) -> List[dict]:
    recent_products = []

    for i, message in enumerate(message_history[-5:]):
        if hasattr(message, "products"):
            if message.products:
                for j, product in enumerate(message.products):
                    try:
                        if hasattr(product, "dict"):
                            product_dict = product.dict()
                        elif hasattr(product, "__dict__"):
                            product_dict = product.__dict__
                        else:
                            product_dict = vars(product)

                        recent_products.append(product_dict)
                    except Exception as e:
                        logger.error(
                            f"Product {j}: conversion failed: {e}", exc_info=True
                        )

    seen_ids = set()
    unique_products = []
    for product in recent_products:
        product_id = product.get("id")
        if product_id and product_id not in seen_ids:
            seen_ids.add(product_id)
            unique_products.append(product)

    return unique_products[-10:]


def manage_context_window(
    message_history: List[Message], max_messages: int = 20
) -> List[Message]:
    if len(message_history) <= max_messages:
        return message_history

    system_messages = [msg for msg in message_history if msg.type == "system"]
    other_messages = [msg for msg in message_history if msg.type != "system"]

    recent_messages = other_messages[-max_messages:]

    return system_messages + recent_messages


def calculate_token_estimate(messages: List[Message]) -> int:
    total_chars = 0
    for msg in messages:
        if isinstance(msg.content, str):
            total_chars += len(msg.content)
        if hasattr(msg, "output") and msg.output:
            total_chars += len(str(msg.output))
    return total_chars // 4
