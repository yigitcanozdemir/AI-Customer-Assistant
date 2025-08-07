from fastapi import FastAPI
from backend.config import settings
from backend.api.routes import router as process_router
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(debug=settings.debug)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(process_router)
