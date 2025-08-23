from openai import AsyncOpenAI
from backend.config import settings
from backend.api.schema import MessageResponse
from datetime import datetime, timezone
from backend.services.tool import call_tool
import json

client = AsyncOpenAI(api_key=settings.openai_api_key)


async def handle_chat_event(
    user_input: str, store: str, message_history: str
) -> MessageResponse:
    try:

        system_prompt = {
            "role": "system",
            "content": f"You are a helpful e-commerce assistant for {store.title()} store. "
            f"You have access to tools: product_search, variant_check, process_order."
            "If the user asks about products, call the 'product_search' tool with proper arguments. Return only the tool output if a tool is used.",
        }

        response = await client.responses.create(
            model="gpt-4o-mini",
            input=[system_prompt]
            + message_history
            + [{"role": "user", "content": user_input}],
            tools=[
                {
                    "type": "function",
                    "name": "product_search",
                    "description": "Search products in the database",
                    "parameters": {
                        "type": "object",
                        "properties": {"query": {"type": "string"}},
                        "required": ["query"],
                    },
                },
                {
                    "type": "function",
                    "name": "variant_check",
                    "description": "Check if a product variant is in stock",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "product_id": {"type": "integer"},
                            "size": {"type": "string"},
                            "color": {"type": "string"},
                        },
                        "required": ["product_id", "size"],
                    },
                },
                {
                    "type": "function",
                    "name": "process_order",
                    "description": "Process order cancellation or return",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "order_id": {"type": "integer"},
                            "action": {"type": "string"},
                        },
                        "required": ["order_id", "action"],
                    },
                },
            ],
        )
        if hasattr(response, "output") and response.output:
            for output_item in response.output:
                print(f"Output item type: {type(output_item)}")
                print(f"Output item: {output_item}")
                if hasattr(output_item, "type") and output_item.type == "function_call":
                    tool_name = output_item.name
                    try:
                        args = json.loads(output_item.arguments)
                    except json.JSONDecodeError:
                        print(f"Failed to parse arguments: {output_item.arguments}")
                        args = {}
                    print(f"Calling tool {tool_name} with args: {args}")
                    tool_result = await call_tool(tool_name, args)
                    print(f"Tool result: {tool_result}")

                    return MessageResponse(
                        content=f"Tool `{tool_name}` executed:\n{json.dumps(tool_result, indent=2)}",
                        store=store,
                        suggestions=[],
                        products=tool_result if tool_name == "product_search" else [],
                        timestamp=datetime.now(timezone.utc),
                    )

                elif hasattr(output_item, "text"):
                    content = output_item.text
                    return MessageResponse(
                        content=content,
                        store=store,
                        suggestions=[],
                        products=[],
                        timestamp=datetime.now(timezone.utc),
                    )
        if hasattr(response, "output_text"):
            content = response.output_text
        else:
            content = (
                str(response.output) if response.output else "No response generated."
            )
        return MessageResponse(
            content=content,
            store=store,
            suggestions=[],
            products=[],
            timestamp=datetime.now(timezone.utc),
        )
    except Exception as e:
        print(f"OpenAI API error: {e}")
        import traceback

        traceback.print_exc()
        return MessageResponse(
            content="I apologize, but I'm having trouble processing your request right now. Please try again.",
            suggestions=["Try again", "Browse catalog", "Contact support"],
            store=store,
            products=[],
            timestamp=datetime.now(timezone.utc),
        )
