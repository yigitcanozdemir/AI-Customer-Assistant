from fastapi import APIRouter
from backend.db.session import get_session
from backend.services.cache import cache_manager
from sqlalchemy import text

router = APIRouter()


@router.get("/health", tags=["health"])
async def health_check():
    try:
        async with get_session() as session:
            await session.execute(text("SELECT 1"))
    except Exception as e:
        return {"status": "fail", "db": str(e)}

    try:
        pong = await cache_manager.redis.ping()
        if not pong:
            return {"status": "fail", "redis": "ping failed"}
    except Exception as e:
        return {"status": "fail", "redis": str(e)}

    return {"status": "ok"}
