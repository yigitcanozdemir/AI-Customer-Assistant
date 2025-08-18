from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio
import logging
import logging
from services.database_logic import process_product_embeddings

logger = logging.getLogger(__name__)


async def process_products_batch(
    session: AsyncSession, products: List[Dict[str, Any]], store: str, BATCH_SIZE: int
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
