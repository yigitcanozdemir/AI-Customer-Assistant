import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from schema import Base
import nest_asyncio

nest_asyncio.apply()
DATABASE_URL = "postgresql+asyncpg://user:password@localhost:5432/ecommerce"
engine = create_async_engine(DATABASE_URL, echo=True)


async def init_database():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        await conn.run_sync(Base.metadata.create_all)

        await conn.execute(
            text(
                """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_indexes
                ndexes
                WHERE schemaname = 'public'
                AND indexname = 'embeddings_hnsw_idx'
            ) THEN
                CREATE INDEX embeddings_hnsw_idx
                ON embeddings
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 200);
            END IF;
        END
        $$;
        """
            )
        )

        await conn.execute(
            text(
                """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = 'public'
                AND indexname = 'faqs_hnsw_idx'
            ) THEN
                CREATE INDEX faqs_hnsw_idx
                ON faqs
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 200);
            END IF;
        END
        $$;
        """
            )
        )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(init_database())
