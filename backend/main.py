from fastapi import FastAPI
from backend.config import settings
from backend.api.routes import router as process_router

app = FastAPI(debug=settings.debug)

app.include_router(process_router)
