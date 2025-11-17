import asyncio
import logging
from openai import AsyncOpenAI
from backend.config import settings
from backend.services.cache import cache_manager

logger = logging.getLogger(__name__)
client = AsyncOpenAI(api_key=settings.openai_api_key)

MAX_RETRIES = 3
EMBEDDING_MODEL = "text-embedding-3-small"


async def create_embedding(text: str, retries: int = MAX_RETRIES) -> list[float]:
    """
    Create embedding for text with caching support.
    First checks cache, generates new embedding only on cache miss.
    """
    text_preview = text[:80].replace("\n", " ")

    # Check cache first
    cached_embedding = await cache_manager.get_embedding(text)
    if cached_embedding is not None:
        logger.info(
            f"[Embedding] Cache HIT for text_len={len(text)}, preview='{text_preview}...'"
        )
        return cached_embedding

    logger.debug(
        f"[Embedding] Cache MISS - Request started model={EMBEDDING_MODEL}, text_len={len(text)}, preview='{text_preview}...'"
    )

    # Generate new embedding
    for attempt in range(retries):
        try:
            response = await client.embeddings.create(
                model=EMBEDDING_MODEL, input=text, encoding_format="float"
            )
            embedding = response.data[0].embedding
            logger.info(
                f"[Embedding] Success model={EMBEDDING_MODEL}, len={len(embedding)}, attempt={attempt}"
            )

            # Store in cache
            await cache_manager.set_embedding(text, embedding)
            logger.debug(f"[Embedding] Cached for text_len={len(text)}")

            return embedding
        except Exception as e:
            logger.warning(
                f"[Embedding] Attempt {attempt}/{retries} failed: {e}",
                exc_info=True if attempt == retries else False,
            )
            if attempt == retries - 1:
                logger.error(
                    f"[Embedding] All {retries} attempts failed for text='{text_preview}...'"
                )
                raise
            await asyncio.sleep(2**attempt)
