from openai import OpenAI
from backend.config import settings
from backend.api.schema import MessageResponse
from datetime import datetime, timezone

client = OpenAI(api_key=settings.openai_api_key)


async def handle_chat_event(question: str) -> MessageResponse:
    try:

        response = client.responses.create(
            model="gpt-4o-mini",
            input=[
                {
                    "role": "system",
                    "content": "You are a helpful e-commerce assistant.",
                },
                {"role": "user", "content": question},
            ],
            temperature=0.7,
        )
        content = response.output_text
        return MessageResponse(
            content=content,
            suggestions=["Add to cart", "Show similart products", "Show more details"],
            products=[],
            timestamp=datetime.now(timezone.utc),
        )
    except Exception as e:
        print(f"OpenAI API error: {e}")
        return MessageResponse(
            content="I apologize, but I'm having trouble processing your request right now. Please try again.",
            suggestions=["Try again", "Browse catalog", "Contact support"],
            products=[],
            timestamp=datetime.now(timezone.utc),
        )
