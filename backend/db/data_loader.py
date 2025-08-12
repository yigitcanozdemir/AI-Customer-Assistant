# ======================================================
# Data Loader for Customer Assistants Products and FAQs
# ======================================================
import logging
import os

# Logging setup
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

os.chdir("../..")
logger.info(f"Current dir: {os.getcwd()}")

import asyncio
import json
from typing import List, Dict, Any
from contextlib import asynccontextmanager
from pathlib import Path
import random

from docling.chunking import HybridChunker
from docling.document_converter import DocumentConverter
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError
from backend.db.schema import Product, Variant, Image, Embedding, FAQ
from openai import AsyncOpenAI
from backend.config import settings
from dotenv import load_dotenv
from backend.db.utils.tokenizer import OpenAITokenizerWrapper


load_dotenv()

# Constants
BATCH_SIZE = 10
MAX_RETRIES = 3
EMBEDDING_MODEL = "text-embedding-3-large"

# Global clients and configs
client = AsyncOpenAI()
tokenizer = OpenAITokenizerWrapper()
converter = DocumentConverter()

# Database setup
engine = create_async_engine(
    "postgresql+asyncpg://user:password@localhost:5432/ecommerce",
    pool_size=20,
    max_overflow=30,
    echo=False,
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# ======================================================
# Async context manager for database sessions
# ======================================================
@asynccontextmanager
async def get_session():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ======================================================
# Convert JSON data to plain text format for docling
# ======================================================
def json_to_plain_text(json_data: List[Dict[str, Any]]) -> str:
    result_text = ""

    for item in json_data:
        title = item.get("title", "")
        result_text += title + "\n"

        content = item.get("content", "")

        if isinstance(content, str):
            result_text += content + "\n\n"
        elif isinstance(content, list):
            for sub_item in content:
                if isinstance(sub_item, dict):
                    for key, value in sub_item.items():
                        result_text += f"{value}\n"
                    result_text += "\n"
                else:
                    result_text += str(sub_item) + "\n"
            result_text += "\n"
        else:
            result_text += str(content) + "\n\n"

    return result_text


# ======================================================
# Create embedding with retry mechanism
# ======================================================
async def create_embedding_with_retry(
    text: str, retries: int = MAX_RETRIES
) -> List[float]:
    for attempt in range(retries):
        try:
            response = await client.embeddings.create(
                model=EMBEDDING_MODEL, input=text, encoding_format="float"
            )
            return response.data[0].embedding
        except Exception as e:
            logger.warning(f"Embedding attempt {attempt + 1} failed: {e}")
            if attempt == retries - 1:
                raise
            await asyncio.sleep(2**attempt)  # Exponential backoff


# ======================================================
# Save product with related data and embeddings
# ======================================================
async def save_product_with_embeddings(
    session: AsyncSession, product_data: Dict[str, Any], store: str
):
    try:
        # Create product
        product = Product(
            store=store,
            title=product_data["title"],
            handle=product_data["handle"],
            body_html=product_data.get("body_html"),
            vendor=product_data.get("vendor"),
            product_type=product_data.get("product_type"),
            tags=product_data.get("tags", []),
        )
        session.add(product)
        await session.flush()  # Get product ID

        # Create variants
        variants = []
        for v in product_data.get("variants", []):

            available = v.get("available")
            if available:
                stock_value = random.randint(10, 100)
                logger.info(
                    f"Generated random stock for available variant: {stock_value}"
                )
            else:
                stock_value = 0
            variant = Variant(
                product_id=product.id,
                title=v.get("title"),
                option1=v.get("option1"),
                option2=v.get("option2"),
                option3=v.get("option3"),
                sku=v.get("sku"),
                requires_shipping=v.get("requires_shipping"),
                taxable=v.get("taxable"),
                available=v.get("available"),
                stock=stock_value,
                price=float(v["price"]) if v.get("price") is not None else None,
                grams=v.get("grams"),
            )
            variants.append(variant)

        if variants:
            session.add_all(variants)

        # Create images
        images = []
        for img in product_data.get("images", []):
            image = Image(
                product_id=product.id,
                position=img.get("position"),
                src=img.get("src", ""),
            )
            images.append(image)

        if images:
            session.add_all(images)

        # Create embeddings for product description
        if product.body_html and product.body_html.strip():
            try:
                embedding_vector = await create_embedding_with_retry(product.body_html)
                embedding = Embedding(
                    product_id=product.id,
                    content_type="body_html_chunk",
                    content=product.body_html,
                    embedding=embedding_vector,
                )
                session.add(embedding)
                logger.info(f"Created embedding for product: {product.title}")
            except Exception as e:
                logger.error(
                    f"Failed to create embedding for product {product.title}: {e}"
                )

        await session.commit()
        logger.info(f"Saved product: {product.title}")

    except IntegrityError as e:
        await session.rollback()
        logger.error(
            f"Integrity error saving product {product_data.get('title', 'Unknown')}: {e}"
        )
        raise
    except Exception as e:
        await session.rollback()
        logger.error(
            f"Error saving product {product_data.get('title', 'Unknown')}: {e}"
        )
        raise


# ======================================================
# Save FAQ data with embeddings using chunking
# ======================================================
async def save_faq_with_embedding(session: AsyncSession, faq_data, store: str):
    try:
        chunker = HybridChunker(
            tokenizer=tokenizer,
            max_tokens=585,
            merge_peers=True,
        )

        chunk_iter = chunker.chunk(dl_doc=faq_data.document)
        chunks = list(chunk_iter)

        logger.info(f"Processing {len(chunks)} FAQ chunks")

        faq_objects = []
        for i, chunk in enumerate(chunks):
            try:
                embedding_vector = await create_embedding_with_retry(chunk.text)
                faq = FAQ(
                    store=store,
                    content=chunk.text,
                    embedding=embedding_vector,
                )
                faq_objects.append(faq)
                logger.info(f"Processed FAQ chunk {i+1}/{len(chunks)}")
            except Exception as e:
                logger.error(f"Failed to process FAQ chunk {i+1}: {e}")
                continue

        if faq_objects:
            session.add_all(faq_objects)
            await session.commit()
            logger.info(f"Saved {len(faq_objects)} FAQ entries")

    except Exception as e:
        await session.rollback()
        logger.error(f"Error saving FAQ data: {e}")
        raise


# ======================================================
# Process products in batches
# ======================================================
async def process_products_batch(
    session: AsyncSession, products: List[Dict[str, Any]], store: str
):
    total = len(products)

    for i in range(0, total, BATCH_SIZE):
        batch = products[i : i + BATCH_SIZE]
        logger.info(
            f"Processing products batch {i//BATCH_SIZE + 1} ({i+1}-{min(i+BATCH_SIZE, total)} of {total})"
        )

        for product_data in batch:
            try:
                await save_product_with_embeddings(session, product_data, store)
            except Exception as e:
                logger.error(f"Failed to save product in batch: {e}")
                continue

        # Small delay between batches to avoid rate limits
        await asyncio.sleep(1)


def ensure_directory_exists(file_path: str):
    Path(file_path).parent.mkdir(parents=True, exist_ok=True)


# ======================================================
# Main execution function
# ======================================================
async def main():
    try:
        logger.info("Starting data loading process...")

        # Load and process FAQ data
        faq_file = "backend/db/jsons/pinklily_faq.json"
        if not os.path.exists(faq_file):
            logger.error(f"FAQ file not found: {faq_file}")
            return

        with open(faq_file, "r", encoding="utf-8") as f:
            json_data = json.load(f)

        # Convert JSON to plain text
        plain_text = json_to_plain_text(json_data)

        # Save markdown file
        md_file = "backend/db/jsons/pinklily_faq.md"
        ensure_directory_exists(md_file)
        with open(md_file, "w", encoding="utf-8") as f:
            f.write(plain_text)

        logger.info("Converting FAQ to document format...")
        result = converter.convert(md_file)

        # Load products data
        products_file = "backend/db/jsons/pinklily_cleaned.json"
        if not os.path.exists(products_file):
            logger.error(f"Products file not found: {products_file}")
            return

        with open(products_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        products = data.get("products", [])
        logger.info(f"Loaded {len(products)} products")

        # Process data
        async with get_session() as session:
            # Save FAQ
            logger.info("Processing FAQ data...")
            await save_faq_with_embedding(session, result, "Pink Lily")

            # Save products
            logger.info("Processing products...")
            await process_products_batch(session, products, "Pink Lily")

        logger.info("Data loading completed successfully!")

    except Exception as e:
        logger.error(f"Critical error in main process: {e}")
        raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
