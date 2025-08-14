import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.getcwd(), "..")))
import json
import logging

from pathlib import Path
from typing import List, Dict, Any
import asyncio
from session import get_session, engine
from sqlalchemy.ext.asyncio import AsyncSession
from services.business_logic import (
    process_faq_embeddings,
    process_product_embeddings,
)
from utils.doc_converter import json_to_plain_text, converter
import nest_asyncio

nest_asyncio.apply()

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
BATCH_SIZE = 100
logger = logging.getLogger(__name__)


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
                await process_product_embeddings(session, product_data, store)
            except Exception as e:
                logger.error(f"Failed to save product in batch: {e}")
                continue

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
        faq_file = "jsons/pinklily_faq.json"
        if not os.path.exists(faq_file):
            logger.error(f"FAQ file not found: {faq_file}")
            return

        with open(faq_file, "r", encoding="utf-8") as f:
            json_data = json.load(f)

        # Convert JSON to plain text
        plain_text = json_to_plain_text(json_data)

        # Save markdown file
        md_file = "jsons/pinklily_faq.md"
        ensure_directory_exists(md_file)
        with open(md_file, "w", encoding="utf-8") as f:
            f.write(plain_text)

        logger.info("Converting FAQ to document format...")
        result = converter.convert(md_file)

        # Load products data
        products_file = "jsons/pinklily.json"
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
            await process_faq_embeddings(session, result, "Pink Lily")

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
