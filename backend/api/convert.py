from typing import List, Optional
from backend.api.schema import Message


def convert_messages(message_history: List[Message]):
    openai_messages = []
    for msg in message_history:
        role = "user" if msg.type == "user" else "assistant"
        content = msg.content
        if msg.products:
            product_texts = []
            for p in msg.products:
                product_texts.append(f"{p.name} (${p.price}) - {p.description}")
            content += "\n\nProducts:\n" + "\n".join(product_texts)
        openai_messages.append({"role": role, "content": content})
    return openai_messages
