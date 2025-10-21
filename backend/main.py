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
from backend.api.middleware import catch_exceptions_middleware
from backend.utility.utils import PrometheusMiddleware, metrics, setup_otlp

logger = logging.getLogger(__name__)

APP_NAME = settings.app_name


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
                "Old orders cleared",
                extra={"deleted_rows": result.rowcount, "job": "clear_expired_orders"},
            )
        await asyncio.sleep(600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()

    logger.info("Connecting to Redis", extra={"service": "redis"})
    await cache_manager.connect()
    logger.info("Redis connected", extra={"service": "redis"})

    task = asyncio.create_task(clear_expired_orders())
    logger.info("Background task started", extra={"task": "clear_expired_orders"})

    yield

    task.cancel()
    logger.info("Background task stopped", extra={"task": "clear_expired_orders"})

    await cache_manager.close()
    logger.info("Redis connection closed", extra={"service": "redis"})


app = FastAPI(debug=settings.debug, lifespan=lifespan)
app.add_middleware(PrometheusMiddleware, app_name=APP_NAME)
app.add_route("/metrics", metrics)
setup_otlp(app, APP_NAME, endpoint="tempo:4317")

app.middleware("http")(catch_exceptions_middleware)

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
