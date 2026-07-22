import sys
import os
import argparse

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

from backend.logging import setup_logging

setup_logging()

import json
import logging
from pathlib import Path
from typing import List, Dict, Any
import asyncio
BATCH_SIZE = 100
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load convention-based store catalog and FAQ data."
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=os.getenv("DATA_DIR"),
        help="Directory containing <store>_products.json and <store>_faq.json files. Defaults to DATA_DIR or backend/db/jsons.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help=(
            "Wipe existing products, variants, images, embeddings and FAQs, then "
            "reload from JSON. Use this to RE-EMBED after changing what gets "
            "embedded (composite name+category+tags+description) or to backfill "
            "the new product.category column. Destructive — catalog data only "
            "(orders/sessions are untouched)."
        ),
    )
    return parser.parse_args()


async def main(data_dir: Path | None = None, reset: bool = False):
    # Delay application imports so `--help` remains usable without a configured
    # database/Redis environment, while normal runs still initialize the app.
    from sqlalchemy import delete, func, select
    from backend.db.batcher import process_products_batch
    from backend.db.schema import Product, Variant, Image, Embedding, FAQ
    from backend.db.services.database_logic import process_faq_embeddings
    from backend.db.session import engine, get_session
    from backend.db.utils.doc_converter import json_to_text
    from backend.services.cache import cache_manager

    try:
        # This standalone script runs outside the FastAPI lifespan, so Redis is
        # not connected yet. Connect it here so embedding lookups use the cache
        # instead of spamming "'NoneType' object has no attribute 'get'" errors.
        await cache_manager.connect()

        if reset:
            # Destructive re-embed: clear catalog tables so the reload below
            # regenerates category + composite embeddings from scratch. ON DELETE
            # CASCADE handles variants/images/embeddings, but we delete them
            # explicitly for clarity and to also clear FAQs.
            async with get_session() as session:
                await session.execute(delete(Embedding))
                await session.execute(delete(Image))
                await session.execute(delete(Variant))
                await session.execute(delete(FAQ))
                await session.execute(delete(Product))
                await session.commit()
                logger.warning(
                    "Reset requested: wiped catalog tables before reload",
                    extra={"action": "data_reset"},
                )

        async with get_session() as session:
            result = await session.execute(select(func.count(Product.id)))
            product_count = result.scalar()

            if product_count > 0:
                logger.info(
                    "Data already exists, skipping data load",
                    extra={"product_count": product_count, "action": "skip_data_load"},
                )
                return

            logger.info(
                "No data found, loading initial data",
                extra={"action": "start_data_load"},
            )

        json_folder = (data_dir or Path(__file__).parent / "jsons").expanduser().resolve()
        if not json_folder.is_dir():
            raise FileNotFoundError(f"Data directory does not exist: {json_folder}")
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
            raise FileNotFoundError(
                f"No JSON files found in data directory: {json_folder}"
            )

        async with get_session() as session:
            for store_name, files in stores.items():
                logger.info(
                    "Processing store",
                    extra={"store": store_name, "action": "process_store"},
                )

                store_name_pretty = " ".join(
                    word[0].upper() + word[1:] if word else ""
                    for word in store_name.split("_")
                )

                faq_file = files.get("faq")
                if faq_file and faq_file.exists():
                    with open(faq_file, "r", encoding="utf-8") as f:
                        faq_data = json.load(f)

                    faq_text = json_to_text(faq_data)

                    await process_faq_embeddings(session, faq_text, store_name_pretty)

                    logger.info(
                        "FAQ processed successfully",
                        extra={"store": store_name, "action": "faq_processed"},
                    )
                else:
                    logger.warning(
                        "FAQ file missing", extra={"store": store_name, "file": "faq"}
                    )

                products_file = files.get("products")
                if products_file and products_file.exists():
                    with open(products_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    products = data
                    logger.info(
                        "Loaded products from file",
                        extra={
                            "store": store_name,
                            "product_count": len(products),
                            "action": "products_loaded",
                        },
                    )
                    await process_products_batch(
                        session, products, store_name_pretty, BATCH_SIZE
                    )
                    logger.info(
                        "Products processed successfully",
                        extra={
                            "store": store_name,
                            "product_count": len(products),
                            "action": "products_processed",
                        },
                    )
                else:
                    logger.warning(
                        "Products file missing",
                        extra={"store": store_name, "file": "products"},
                    )

        logger.info(
            "All stores processed successfully", extra={"action": "data_load_complete"}
        )

    except Exception as e:
        logger.error(
            "Critical error in main process (Data Loader)",
            extra={"error": str(e), "action": "data_load_failed"},
            exc_info=True,
        )
        raise
    finally:
        await cache_manager.close()
        await engine.dispose()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(main(args.data_dir, reset=args.reset))
