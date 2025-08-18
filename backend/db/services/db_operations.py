from sqlalchemy.ext.asyncio import AsyncSession
from db.schema import Product, Variant, Image, Embedding, FAQ
from sqlalchemy import delete, text
from typing import Type, List, Optional


async def create_product(session: AsyncSession, **kwargs) -> Product:
    product = Product(**kwargs)
    session.add(product)
    await session.flush()
    return product


async def create_variants(session: AsyncSession, variants_data: list[dict]):
    variants = [Variant(**v) for v in variants_data]
    session.add_all(variants)


async def create_images(session: AsyncSession, images_data: list[dict]):
    images = [Image(**img) for img in images_data]
    session.add_all(images)


async def create_product_embedding(session: AsyncSession, **kwargs):
    embedding = Embedding(**kwargs)
    session.add(embedding)


async def create_faq_entries(session: AsyncSession, faq_list: list[dict]):
    faq_objects = [FAQ(**f) for f in faq_list]
    session.add_all(faq_objects)


async def delete_rows(
    session: AsyncSession, model: Type, filters_list: Optional[List[dict]] = None
) -> int:
    total_deleted = 0
    if not filters_list:
        stmt = delete(model)
        result = await session.execute(stmt)
        total_deleted += result.rowcount or 0
    else:
        for filters in filters_list:
            stmt = delete(model)
            for col_name, value in filters.items():
                stmt = stmt.where(getattr(model, col_name) == value)
            result = await session.execute(stmt)
            total_deleted += result.rowcount or 0

    await session.commit()
    return total_deleted


async def delete_all_table(session: AsyncSession, models: List[Type]):
    dropped_tables = []
    for model in models:
        table_name = model.__tablename__
        stmt = text(f"DROP TABLE IF EXISTS {table_name} CASCADE;")
        await session.execute(stmt)
        dropped_tables.append(table_name)

    await session.commit()
    return f"Dropped tables: {', '.join(dropped_tables)}"
