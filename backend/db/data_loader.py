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
import json
import logging

from pathlib import Path
from typing import List, Dict, Any
import asyncio
from backend.db.session import get_session, engine
from sqlalchemy.ext.asyncio import AsyncSession
from backend.db.services.database_logic import (
    process_faq_embeddings,
    process_product_embeddings,
)
from backend.db.utils.doc_converter import json_to_plain_text, converter
from backend.db.utils.helper_funcs import directory_exists, prettify
from batcher import process_products_batch
import nest_asyncio

nest_asyncio.apply()

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
BATCH_SIZE = 100
logger = logging.getLogger(__name__)

# ======================================================
# Main execution function
# ======================================================


async def main():
    try:
        json_folder = Path("jsons")
        json_files = list(json_folder.glob("*.json"))

        stores = {}
        for file in json_files:
            name = file.stem
            if name.endswith("_faq"):
                store_name = name.replace("_faq", "")
                stores.setdefault(store_name, {})["faq"] = file
            elif name.endswith("_products"):
                store_name = name.replace("_products", "")
                stores.setdefault(store_name, {})["products"] = file

        if not stores:
            logger.error("No JSON files found in folder.")
            return

        async with get_session() as session:
            for store_name, files in stores.items():
                logger.info(f"Processing store: {store_name}")

                faq_file = files.get("faq")
                if faq_file and faq_file.exists():
                    with open(faq_file, "r", encoding="utf-8") as f:
                        faq_data = json.load(f)
                    plain_text = json_to_plain_text(faq_data)
                    md_file = json_folder / f"{store_name}_faq.md"
                    directory_exists(md_file)
                    with open(md_file, "w", encoding="utf-8") as f:
                        f.write(plain_text)
                    result = converter.convert(md_file)
                    store_name = prettify(store_name)
                    await process_faq_embeddings(session, result, store_name)
                else:
                    logger.warning(f"FAQ file missing for {store_name}")

                products_file = files.get("products")
                if products_file and products_file.exists():
                    with open(products_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    products = data
                    logger.info(f"Loaded {len(products)} products for {store_name}")
                    store_name = prettify(store_name)
                    await process_products_batch(
                        session, products, store_name, BATCH_SIZE
                    )
                else:
                    logger.warning(f"Products file missing for {store_name}")

        logger.info("All stores processed successfully!")

    except Exception as e:
        logger.error(f"Critical error in main process: {e}")
        raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
