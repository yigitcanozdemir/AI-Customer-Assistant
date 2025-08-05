from openai import OpenAI
from backend.config import settings

client = OpenAI(api_key=settings.openai_api_key)


async def handle_chat_event(question: str) -> str:
    response = client.responses.create(
        model="gpt-4o-mini",
        input=[
            {"role": "system", "content": "You are a helpful e-commerce assistant."},
            {"role": "user", "content": question},
        ],
    )
    return response.output_text
