import random
import logging

from backend.services.embedding import create_embedding
from .db_operations import (
    create_product,
    create_variants,
    create_images,
    create_product_embedding,
    create_faq_entries,
)

logger = logging.getLogger(__name__)


async def process_product_embeddings(session, product_data, store):

    product = await create_product(
        session,
        store=store,
        name=product_data["name"],
        price=product_data.get("price"),
        currency=product_data.get("currency"),
        description=product_data.get("description") or None,
        tags=product_data.get("tags", []) or None,
    )

    variants_data = []
    images_data = []

    for color in product_data.get("colors", []):
        color_name = color.get("name")

        for v in color.get("variants", []):
            variants_data.append(
                {
                    "product_id": product.id,
                    "color": color_name,
                    "size": v.get("size"),
                    "stock": v.get("stock"),
                }
            )

        for img_url in color.get("images", []):
            images_data.append(
                {
                    "product_id": product.id,
                    "url": img_url,
                }
            )

    if variants_data:
        await create_variants(session, variants_data)
    if images_data:
        await create_images(session, images_data)

    if product.description and product.description.strip():
        try:
            embedding_vector = await create_embedding(product.description)
            await create_product_embedding(
                session,
                product_id=product.id,
                description=product.description,
                embedding=embedding_vector,
            )
        except Exception as e:
            logger.error(f"Embedding creation failed for product {product.name}: {e}")

    await session.commit()


async def process_faq_embeddings(session, faq_text, store):
    """
    Process FAQ text directly without chunking.
    Just create one embedding for the entire FAQ.
    """
    try:
        embedding_vector = await create_embedding(faq_text)

        faq_entry = {
            "store": store,
            "content": faq_text,
            "embedding": embedding_vector,
        }

        await create_faq_entries(session, [faq_entry])
        await session.commit()

        logger.info(f"FAQ processed successfully for store: {store}")

    except Exception as e:
        logger.error(f"Failed to process FAQ: {e}")
        raise
