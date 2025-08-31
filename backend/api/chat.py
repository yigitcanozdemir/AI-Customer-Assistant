from openai import AsyncOpenAI
from backend.config import settings
from backend.api.schema import MessageResponse
from datetime import datetime, timezone
from backend.services.tool import call_tool
import json
from backend.api.schema import MessageResponse, Product as ProductModel, Message
from fastapi.encoders import jsonable_encoder
from pprint import pprint
from typing import List
from backend.api.convert import convert_messages


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
]


async def handle_chat_event(
    user_input: str, store: str, message_history: List[Message]
) -> MessageResponse:
    try:
        message_history = manage_context_window(message_history, max_messages=15)

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

        print(f"Estimated tokens: {estimated_tokens}")
        system_prompt = {
            "role": "system",
            "content": f"""You are a helpful and knowledgeable style assistant for {store.title()} store. 

            Your personality:
            - Friendly, enthusiastic, and professional
            - Knowledgeable about fashion and styling
            - Helpful in finding the perfect products for customers

            IMPORTANT RESPONSE RULES:
            - When you use product_search tool, DO NOT include product details, prices, images, or links in your response
            - The product information will be displayed separately by the frontend
            - Your response should only contain conversational text about the search results
            - Focus on being helpful and suggesting styling tips
            - Example: "I found some great dresses for you! Check out the options below - the green backless dress would be perfect for a summer event."
            - Never repeat product descriptions or prices in the text response. Product info is sent separately in JSON, not in text
            - Do NOT use Markdown, bold, bullet points, or section titles like "Products:". Respond in plain text only.

            IMPORTANT CONTEXT RULES:
            - If user asks about products that were ALREADY shown in recent conversation, DO NOT use product_search tool
            - Use the product information from recent messages instead
            - Only use product_search when user wants to find NEW/DIFFERENT products
            - For questions like "tell me more about X product" or "give details about Y" - use existing product data
            
            When using tools:
            - Use product_search to find relevant items based on user queries
            - Provide brief, conversational responses WITHOUT product details
            - Suggest styling tips and complementary items
            - Never include images, prices, or detailed product information in your text response
            - When using variant_check, always use id from recent_products
            
            IMPORTANT: Always use the store name exactly as provided by the user when calling any tool or API. Do not correct spelling.

            Available tools: product_search, faq_search, variant_check, process_order.""",
        }
        input_list = [
            system_prompt,
            {
                "role": "system",
                "content": json.dumps(recent_products),
            },
        ] + convert_messages(message_history)

        response = await client.responses.create(
            model="gpt-4o-mini",
            input=input_list,
            tools=TOOLS,
        )

        content = ""
        products: list[ProductModel] = []

        input_list += response.output
        tool_calls_found = False

        for output_item in response.output:

            if hasattr(output_item, "type") and output_item.type == "function_call":
                tool_calls_found = True
                try:
                    args = json.loads(output_item.arguments)
                except json.JSONDecodeError:
                    print(f"Failed to parse arguments: {output_item.arguments}")
                    args = {}

                print(f"Calling tool {output_item.name} with args: {args}")
                tool_result = await call_tool(output_item.name, args)
                print(f"Tool result: {tool_result}")
                if output_item.name == "product_search" and isinstance(
                    tool_result, list
                ):
                    products = tool_result

                elif output_item.name == "variant_check" and isinstance(
                    tool_result, dict
                ):
                    for p in products:
                        for v in p.variants:
                            if v.size == tool_result.get(
                                "size"
                            ) and v.color == tool_result.get("color"):
                                v.stock = tool_result.get("stock", v.stock)
                                v.available = tool_result.get("available", v.available)
                                p.inStock = any(var.available for var in p.variants)

                input_list.append(
                    {
                        "type": "function_call_output",
                        "call_id": output_item.call_id,
                        "output": json.dumps(jsonable_encoder(tool_result)),
                    }
                )

        if tool_calls_found:
            followup = await client.responses.create(
                model="gpt-4o-mini",
                input=input_list,
                tools=TOOLS,
            )

            if hasattr(followup, "output_text"):
                content = followup.output_text
            elif hasattr(followup, "output") and followup.output:
                content = ""
                for output_item in followup.output:
                    if hasattr(output_item, "text"):
                        content += output_item.text
            else:
                content = "I'm here to help!"

        else:
            if hasattr(response, "output_text"):
                content = response.output_text
            elif hasattr(response, "output") and response.output:
                content = ""
                for output_item in response.output:
                    if hasattr(output_item, "text"):
                        content += output_item.text
            else:
                content = "I'm here to help you find the perfect items! What are you looking for today?"
        print("Final input:")
        pprint(input_list, indent=2)
        return MessageResponse(
            content=content,
            store=store,
            suggestions=[],
            products=products,
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

                        print(f"📊 Product {j}: converted successfully")
                        recent_products.append(product_dict)
                    except Exception as e:
                        print(f"❌ Product {j}: conversion failed: {e}")

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
