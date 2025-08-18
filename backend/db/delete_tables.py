import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.getcwd(), "..")))
import asyncio
from session import get_session
from services.db_operations import delete_rows, delete_all_table
from schema import Product, Variant, Image, Embedding, FAQ
import nest_asyncio

nest_asyncio.apply()


async def main():
    async with get_session() as session:
        # await delete_rows(session, Product, [{"id": 123}])
        # filters = [{"id": 1}, {"id": 2}, {"id": 3}]
        # deleted_count = await delete_rows(session, Product, filters)
        await delete_all_table(session, [Product, Variant, Image, Embedding, FAQ])
        await session.commit()


if __name__ == "__main__":
    asyncio.run(main())
