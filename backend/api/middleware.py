from fastapi import Request
from fastapi.responses import JSONResponse
import logging, traceback

logger = logging.getLogger(__name__)


async def catch_exceptions_middleware(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        logger.error("Unhandled error: %s\n%s", e, traceback.format_exc())
        return JSONResponse(
            status_code=500, content={"detail": "Internal server error"}
        )
