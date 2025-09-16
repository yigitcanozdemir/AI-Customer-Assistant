import sys
import os

current_file = os.path.abspath(__file__) if "__file__" in globals() else os.getcwd()
project_root = current_file

while True:
    if os.path.isdir(os.path.join(project_root, "backend")):
        break
    parent = os.path.dirname(project_root)
    if parent == project_root:
        raise Exception("Project root with 'backend' folder not found.")
    project_root = parent

if project_root not in sys.path:
    sys.path.insert(0, project_root)

print(sys.path)
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from backend.db.schema import Base
import nest_asyncio
from backend.db.session import engine

nest_asyncio.apply()


async def create_extensions(conn):
    await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))


async def create_tables(conn):
    await conn.run_sync(Base.metadata.create_all)


async def create_hnsw_index(conn, table_name, index_name):
    await conn.execute(
        text(
            f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = 'public'
                AND indexname = '{index_name}'
            ) THEN
                CREATE INDEX {index_name}
                ON {table_name}
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 200);
            END IF;
        END
        $$;
        """
        )
    )


async def init_database():
    async with engine.begin() as conn:
        await create_extensions(conn)
        await create_tables(conn)
        await create_hnsw_index(conn, "embeddings", "embeddings_hnsw_idx")
        await create_hnsw_index(conn, "faqs", "faqs_hnsw_idx")


if __name__ == "__main__":
    asyncio.run(init_database())
