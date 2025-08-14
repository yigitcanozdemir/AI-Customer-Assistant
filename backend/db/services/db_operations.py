from sqlalchemy.ext.asyncio import AsyncSession
from db.schema import Product, Variant, Image, Embedding, FAQ


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
