import random
import logging
from docling.chunking import HybridChunker

from services.embedding import create_embedding
from .db_operations import (
    create_product,
    create_variants,
    create_images,
    create_product_embedding,
    create_faq_entries,
)
from db.utils.tokenizer import OpenAITokenizerWrapper

logger = logging.getLogger(__name__)
tokenizer = OpenAITokenizerWrapper()


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
            logger.error(f"Embedding creation failed for product {product.title}: {e}")

    await session.commit()


async def process_faq_embeddings(session, faq_data, store):
    chunker = HybridChunker(tokenizer=tokenizer, max_tokens=600, merge_peers=True)
    chunks = list(chunker.chunk(dl_doc=faq_data.document))
    faq_entries = []

    for chunk in chunks:
        try:
            embedding_vector = await create_embedding(chunk.text)
            faq_entries.append(
                {
                    "store": store,
                    "content": chunk.text,
                    "embedding": embedding_vector,
                }
            )
        except Exception as e:
            logger.error(f"Failed to process FAQ chunk: {e}")

    if faq_entries:
        await create_faq_entries(session, faq_entries)
        await session.commit()
