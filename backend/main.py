from backend.logging import setup_logging

setup_logging()

from fastapi import FastAPI
from backend.config import settings
from backend.api.routes import router as process_router
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from backend.db.session import get_session
from contextlib import asynccontextmanager
from backend.services.cache import cache_manager
import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


async def clear_expired_orders():
    while True:
        async with get_session() as session:
            result = await session.execute(
                text(
                    "DELETE FROM orders WHERE created_at < NOW() - INTERVAL '10 minutes'"
                )
            )
            await session.commit()
            logger.info(
                "Orders older than 10 minutes cleared. Deleted rows: %s",
                result.rowcount,
            )
        await asyncio.sleep(600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Connecting to Redis...")
    await cache_manager.connect()
    logger.info("Redis connected successfully")

    task = asyncio.create_task(clear_expired_orders())
    logger.info("Clear expired orders task started.")

    yield

    task.cancel()
    logger.info("Clear expired orders task stopped.")

    await cache_manager.close()
    logger.info("Redis connection closed.")


app = FastAPI(debug=settings.debug, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(process_router)
