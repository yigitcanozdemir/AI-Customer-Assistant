from collections import defaultdict
from typing import List
from backend.api.schema import Message

session_store: defaultdict[str, List[Message]] = defaultdict(list)


def get_message_history(session_id: str) -> List[Message]:
    return session_store[session_id]


def add_message(session_id: str, message: Message):
    session_store[session_id].append(message)


def clear_session(session_id: str):
    session_store[session_id] = []
