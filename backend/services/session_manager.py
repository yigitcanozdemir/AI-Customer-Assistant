from collections import defaultdict
from typing import List
from backend.api.schema import Message

session_store: defaultdict[str, List[Message]] = defaultdict(list)
locked_sessions: set[str] = set()


def get_message_history(session_id: str) -> List[Message]:
    return session_store[session_id]


def add_message(session_id: str, message: Message):
    session_store[session_id].append(message)


def clear_session(session_id: str):
    session_store[session_id] = []


def lock_session(session_id: str):
    locked_sessions.add(session_id)


def unlock_session(session_id: str):
    locked_sessions.discard(session_id)


def is_session_locked(session_id: str) -> bool:
    return session_id in locked_sessions
