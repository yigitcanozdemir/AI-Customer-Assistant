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

import asyncio
import nest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from schema import Base
from session import engine

nest_asyncio.apply()


async def reset_database():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


if __name__ == "__main__":
    asyncio.run(reset_database())
