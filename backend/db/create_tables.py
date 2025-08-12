import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from schema import Base

DATABASE_URL = "postgresql+asyncpg://user:password@localhost:5432/ecommerce"
engine = create_async_engine(DATABASE_URL, echo=True)


async def init_database():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(init_database())
