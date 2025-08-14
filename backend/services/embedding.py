import asyncio
import logging
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)
client = AsyncOpenAI()

MAX_RETRIES = 3
EMBEDDING_MODEL = "text-embedding-3-small"


async def create_embedding(text: str, retries: int = MAX_RETRIES) -> list[float]:
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
            await asyncio.sleep(2**attempt)
