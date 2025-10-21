import asyncio
import logging
from openai import AsyncOpenAI
from backend.config import settings

logger = logging.getLogger(__name__)
client = AsyncOpenAI(api_key=settings.openai_api_key)

MAX_RETRIES = 3
EMBEDDING_MODEL = "text-embedding-3-small"


async def create_embedding(text: str, retries: int = MAX_RETRIES) -> list[float]:

    text_preview = text[:80].replace("\n", " ")
    logger.debug(
        f"[Embedding] Request started model={EMBEDDING_MODEL}, text_len={len(text)}, preview='{text_preview}...'"
    )
    for attempt in range(retries):
        try:
            response = await client.embeddings.create(
                model=EMBEDDING_MODEL, input=text, encoding_format="float"
            )
            embedding = response.data[0].embedding
            logger.info(
                f"[Embedding] Success model={EMBEDDING_MODEL}, len={len(embedding)}, attempt={attempt}"
            )
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
