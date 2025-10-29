from fastapi import APIRouter
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "ecommerce-api",
    }


@router.get("/")
async def root():
    return {"message": "E-Commerce API", "version": "1.0.0", "status": "running"}
