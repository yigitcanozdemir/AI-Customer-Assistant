from typing import List
from backend.api.schema import Message
from fastapi.encoders import jsonable_encoder


def convert_messages(messages: List[Message]) -> list[dict]:
    api_messages = []
    for msg in messages:
        role = (
            "user"
            if msg.type == "user"
            else "system" if msg.type == "system" else "assistant"
        )
        api_messages.append({"role": role, "content": msg.content})
    return api_messages
