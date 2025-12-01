import json
import logging
from datetime import datetime
from typing import List
from backend.api.schema import Message
from backend.services.cache import cache_manager

logger = logging.getLogger(__name__)

SESSION_HISTORY_PREFIX = "session_history:"
SESSION_LOCK_PREFIX = "session_lock:"
SESSION_STATE_PREFIX = "session_state:"
SESSION_HISTORY_TTL = 3600 * 24
SESSION_LOCK_TTL = 3600 * 24
SESSION_STATE_TTL = 300


def _history_key(session_id: str) -> str:
    return f"{SESSION_HISTORY_PREFIX}{session_id}"


def _lock_key(session_id: str) -> str:
    return f"{SESSION_LOCK_PREFIX}{session_id}"


def _state_key(session_id: str) -> str:
    return f"{SESSION_STATE_PREFIX}{session_id}"


async def get_message_history(session_id: str) -> List[Message]:
    """
    Retrieve chat history for a session from Redis.
    """
    try:
        history_data = await cache_manager.get(_history_key(session_id))
        if not history_data:
            return []

        history = json.loads(history_data)
        messages: List[Message] = []
        for msg_dict in history:
            timestamp = msg_dict.get("timestamp")
            if isinstance(timestamp, str):
                try:
                    msg_dict["timestamp"] = datetime.fromisoformat(timestamp)
                except ValueError:
                    logger.warning(
                        "Invalid timestamp format in session %s", session_id
                    )
                    msg_dict["timestamp"] = datetime.utcnow()
            messages.append(Message(**msg_dict))

        return messages
    except Exception as exc:
        logger.error("Failed to get session history for %s: %s", session_id, exc)
        return []


async def add_message(session_id: str, message: Message) -> bool:
    """
    Append a message to a session history in Redis.
    """
    try:
        history_data = await cache_manager.get(_history_key(session_id))
        history = json.loads(history_data) if history_data else []

        message_dict = message.model_dump(mode="json")
        timestamp = message_dict.get("timestamp")
        if isinstance(timestamp, datetime):
            message_dict["timestamp"] = timestamp.isoformat()

        history.append(message_dict)
        await cache_manager.set(
            _history_key(session_id),
            json.dumps(history),
            ttl=SESSION_HISTORY_TTL,
        )
        return True
    except Exception as exc:
        logger.error("Failed to add message for %s: %s", session_id, exc)
        return False


async def clear_session(session_id: str) -> bool:
    """
    Remove all stored history for a session.
    """
    try:
        await cache_manager.delete(_history_key(session_id))
        return True
    except Exception as exc:
        logger.error("Failed to clear session %s: %s", session_id, exc)
        return False


async def lock_session(session_id: str) -> bool:
    """
    Mark a session as locked (e.g., policy violation) in Redis.
    """
    try:
        await cache_manager.set(
            _lock_key(session_id),
            "locked",
            ttl=SESSION_LOCK_TTL,
        )
        return True
    except Exception as exc:
        logger.error("Failed to lock session %s: %s", session_id, exc)
        return False


async def unlock_session(session_id: str) -> bool:
    try:
        await cache_manager.delete(_lock_key(session_id))
        return True
    except Exception as exc:
        logger.error("Failed to unlock session %s: %s", session_id, exc)
        return False


async def is_session_locked(session_id: str) -> bool:
    try:
        lock_value = await cache_manager.get(_lock_key(session_id))
        return lock_value is not None
    except Exception as exc:
        logger.error("Failed to check lock for %s: %s", session_id, exc)
        return False


async def set_typing_state(session_id: str, is_typing: bool) -> bool:
    """
    Set the typing indicator state for a session.
    """
    try:
        state = {
            "is_typing": is_typing,
            "last_updated": datetime.now().isoformat()
        }
        await cache_manager.set(
            _state_key(session_id),
            json.dumps(state),
            ttl=SESSION_STATE_TTL,
        )
        return True
    except Exception as exc:
        logger.error("Failed to set typing state for %s: %s", session_id, exc)
        return False


async def get_typing_state(session_id: str) -> bool:
    """
    Get the typing indicator state for a session.
    """
    try:
        state_data = await cache_manager.get(_state_key(session_id))
        if not state_data:
            return False

        state = json.loads(state_data)
        return state.get("is_typing", False)
    except Exception as exc:
        logger.error("Failed to get typing state for %s: %s", session_id, exc)
        return False
