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
from backend.api.health import router as health_router

logger = logging.getLogger(__name__)

APP_NAME = settings.app_name


async def clear_expired_orders():
    """Backstop sweep for orders left behind by sessions that never ended cleanly.

    The primary path is POST /events/session/{id}/end, which deletes a leaving
    visitor's own orders immediately. This job only reaps what that missed
    (crash, force-quit, offline), so DEMO_ORDER_TTL_MINUTES must stay well
    above any realistic session length — the DELETE below is deliberately
    un-scoped by user, and a short TTL therefore destroys active visitors'
    orders mid-session. Set DEMO_ORDER_TTL_MINUTES<=0 to disable entirely."""
    ttl_minutes = settings.demo_order_ttl_minutes
    interval = settings.demo_order_cleanup_interval_seconds
    while True:
        async with get_session() as session:
            result = await session.execute(
                text(
                    "DELETE FROM orders "
                    "WHERE created_at < NOW() - make_interval(mins => :ttl)"
                ),
                {"ttl": ttl_minutes},
            )
            await session.commit()
            logger.info(
                "Old orders cleared",
                extra={"deleted_rows": result.rowcount, "job": "clear_expired_orders"},
            )
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()

    logger.info("Connecting to Redis", extra={"service": "redis"})
    await cache_manager.connect()
    logger.info("Redis connected", extra={"service": "redis"})

    task = None
    if settings.demo_order_ttl_minutes > 0:
        task = asyncio.create_task(clear_expired_orders())
        logger.info("Background task started", extra={"task": "clear_expired_orders"})

    yield

    if task is not None:
        task.cancel()
        logger.info("Background task stopped", extra={"task": "clear_expired_orders"})

    await cache_manager.close()
    logger.info("Redis connection closed", extra={"service": "redis"})


# Never run FastAPI in debug mode in production, even if DEBUG is left true in
# the environment — debug mode leaks tracebacks to clients.
_debug = settings.debug and settings.environment != "production"
app = FastAPI(debug=_debug, lifespan=lifespan)
app.add_middleware(PrometheusMiddleware, app_name=APP_NAME)
app.add_route("/metrics", metrics)

# Tracing is enabled in every environment (including production) whenever an
# OTLP endpoint is configured. setup_otlp resolves the endpoint from
# OTEL_EXPORTER_OTLP_ENDPOINT (OpenObserve) with a legacy TEMPO_ENDPOINT
# fallback, and no-ops gracefully if neither is set.
setup_otlp(app, APP_NAME)

app.middleware("http")(catch_exceptions_middleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(process_router)
app.include_router(health_router)
