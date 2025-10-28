import logging
from backend.db.session import get_session
from backend.db.schema import FlaggedSession
from datetime import datetime, timezone
from typing import List, Optional
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)


async def store_flagged_session(
    session_id: str,
    user_id: str,
    user_name: str,
    store: str,
    user_query: str,
    assistant_response: str,
    confidence_score: float,
    requires_human: bool,
    is_context_relevant: bool,
    warning_message: Optional[str],
    assessment_reasoning: Optional[str],
    message_history: Optional[List] = None,
) -> bool:
    try:
        serializable_history = None
        if message_history:
            serializable_history = jsonable_encoder(message_history)

        async with get_session() as session:
            async with session.begin():
                flagged = FlaggedSession(
                    session_id=session_id,
                    user_id=user_id,
                    user_name=user_name,
                    store=store,
                    user_query=user_query,
                    assistant_response=assistant_response,
                    confidence_score=confidence_score,
                    requires_human=requires_human,
                    is_context_relevant=is_context_relevant,
                    warning_message=warning_message,
                    assessment_reasoning=assessment_reasoning,
                    message_history=serializable_history,
                    flagged_at=datetime.utcnow(),
                    reviewed=False,
                )
                session.add(flagged)

            await session.commit()

            logger.warning(
                "Session flagged for human review",
                extra={
                    "event": "session_flagged",
                    "session_id": session_id,
                    "user_id": user_id,
                    "user_name": user_name,
                    "store": store,
                    "requires_human": requires_human,
                    "confidence_score": confidence_score,
                    "is_context_relevant": is_context_relevant,
                    "warning": warning_message,
                    "reasoning": assessment_reasoning,
                    "user_query": user_query[:200],
                    "flagged_session_id": str(flagged.id),
                },
            )

            return True

    except Exception as e:
        logger.error(
            f"Failed to store flagged session: {e}",
            extra={
                "event": "flagged_session_store_error",
                "session_id": session_id,
                "error": str(e),
            },
            exc_info=True,
        )
        return False


async def get_pending_reviews(limit: int = 50):
    try:
        async with get_session() as session:
            from sqlalchemy import select

            stmt = (
                select(FlaggedSession)
                .where(FlaggedSession.reviewed == False)
                .order_by(FlaggedSession.flagged_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            return result.scalars().all()
    except Exception as e:
        logger.error(f"Error fetching pending reviews: {e}")
        return []


async def mark_reviewed(flagged_id: str, reviewed_by: str, notes: Optional[str] = None):
    try:
        async with get_session() as session:
            async with session.begin():
                from sqlalchemy import select, update

                stmt = (
                    update(FlaggedSession)
                    .where(FlaggedSession.id == flagged_id)
                    .values(
                        reviewed=True,
                        reviewed_at=datetime.now(timezone.utc),
                        reviewed_by=reviewed_by,
                        review_notes=notes,
                    )
                )
                await session.execute(stmt)
            await session.commit()

            logger.info(
                "Flagged session marked as reviewed",
                extra={
                    "event": "session_reviewed",
                    "flagged_id": flagged_id,
                    "reviewed_by": reviewed_by,
                },
            )
            return True
    except Exception as e:
        logger.error(f"Error marking session as reviewed: {e}")
        return False
