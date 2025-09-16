from fastapi import FastAPI
from backend.config import settings
from backend.api.routes import router as process_router
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from backend.db.session import get_session
from contextlib import asynccontextmanager


async def clear_expired_orders():
    while True:
        async with get_session() as session:
            await session.execute(
                "DELETE FROM orders WHERE created_at < NOW() - INTERVAL '10 minutes';"
            )
            await session.commit()
            print("🗑 Orders older than 10 minutes cleared.")
        await asyncio.sleep(600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(clear_expired_orders())
    print("🚀 Clear expired orders task started.")

    yield

    task.cancel()
    print("🛑 Clear expired orders task stopped.")


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
