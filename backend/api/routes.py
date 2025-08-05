from fastapi import APIRouter

import backend.api.endpoint as endpoint


router = APIRouter()

router.include_router(endpoint.router, prefix="/events", tags=["events"])
