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
        title=product_data["title"],
        handle=product_data["handle"],
        body_html=product_data.get("body_html") or None,
        vendor=product_data.get("vendor") or None,
        product_type=product_data.get("product_type") or None,
        tags=product_data.get("tags", []) or None,
    )

    variants_data = []
    for v in product_data.get("variants", []):
        stock_value = random.randint(10, 100) if v.get("available") else 0
        variants_data.append(
            {
                "product_id": product.id,
                "title": v.get("title"),
                "option1": v.get("option1"),
                "option2": v.get("option2"),
                "option3": v.get("option3"),
                "sku": v.get("sku"),
                "requires_shipping": v.get("requires_shipping"),
                "taxable": v.get("taxable"),
                "available": v.get("available"),
                "stock": stock_value,
                "price": float(v["price"]) if v.get("price") else None,
                "grams": v.get("grams"),
            }
        )
    if variants_data:
        await create_variants(session, variants_data)

    images_data = [
        {
            "product_id": product.id,
            "position": img.get("position"),
            "src": img.get("src", ""),
        }
        for img in product_data.get("images", [])
    ]
    if images_data:
        await create_images(session, images_data)

    if product.body_html and product.body_html.strip():
        try:
            embedding_vector = await create_embedding(product.body_html)
            await create_product_embedding(
                session,
                product_id=product.id,
                content_type="body_html_chunk",
                content=product.body_html,
                embedding=embedding_vector,
            )
        except Exception as e:
            logger.error(f"Embedding creation failed for product {product.title}: {e}")

    await session.commit()


async def process_faq_embeddings(session, faq_data, store):
    chunker = HybridChunker(tokenizer=tokenizer, max_tokens=585, merge_peers=True)
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
