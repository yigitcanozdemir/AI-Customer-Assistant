import redis.asyncio as redis
import pickle
import json
from typing import Optional, List, Any
import hashlib
from backend.config import settings
import logging

logger = logging.getLogger(__name__)


class CacheManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.redis = None
        return cls._instance

    async def connect(self):
        if self.redis is None:
            self.redis = await redis.from_url(
                settings.redis_url, encoding="utf-8", decode_responses=False
            )
            logger.info("Redis connected")

    async def close(self):
        if self.redis:
            await self.redis.close()

    def _hash_key(self, text: str) -> str:
        return hashlib.md5(text.encode()).hexdigest()

    async def get_embedding(self, text: str) -> Optional[List[float]]:
        try:
            key = f"emb:{self._hash_key(text)}"
            cached = await self.redis.get(key)
            if cached:
                return pickle.loads(cached)
        except Exception as e:
            logger.error(f"Cache get embedding error: {e}")
        return None

    async def set_embedding(self, text: str, vector: List[float]):
        try:
            key = f"emb:{self._hash_key(text)}"
            await self.redis.setex(
                key, settings.redis_ttl_embedding, pickle.dumps(vector)
            )
        except Exception as e:
            logger.error(f"Cache set embedding error: {e}")

    async def get_product_search(
        self, query: str, store: str, top_k: int
    ) -> Optional[List]:
        try:
            key = f"search:{store}:{top_k}:{self._hash_key(query)}"
            cached = await self.redis.get(key)
            if cached:
                return pickle.loads(cached)
        except Exception as e:
            logger.error(f"Cache get search error: {e}")
        return None

    async def set_product_search(
        self, query: str, store: str, top_k: int, results: List
    ):
        try:
            key = f"search:{store}:{top_k}:{self._hash_key(query)}"
            await self.redis.setex(
                key, settings.redis_ttl_search, pickle.dumps(results)
            )
        except Exception as e:
            logger.error(f"Cache set search error: {e}")

    async def invalidate_product_cache(self, store: str):
        try:
            pattern = f"search:{store}:*"
            async for key in self.redis.scan_iter(match=pattern):
                await self.redis.delete(key)
        except Exception as e:
            logger.error(f"Cache invalidate error: {e}")

    async def get_product_list(self, store: str, limit: int) -> Optional[List]:
        try:
            key = f"products:{store}:{limit}"
            cached = await self.redis.get(key)
            if cached:
                return pickle.loads(cached)
        except Exception as e:
            logger.error(f"Cache get product list error: {e}")
        return None

    async def set_product_list(self, store: str, limit: int, products: List):
        try:
            key = f"products:{store}:{limit}"
            await self.redis.setex(key, 1200, pickle.dumps(products))
        except Exception as e:
            logger.error(f"Cache set product list error: {e}")

    async def invalidate_product_list(self, store: str):
        try:
            pattern = f"products:{store}:*"
            async for key in self.redis.scan_iter(match=pattern):
                await self.redis.delete(key)
        except Exception as e:
            logger.error(f"Cache invalidate product list error: {e}")

    async def store_pending_action(
        self, action_id: str, action_data: dict, ttl: int = 300
    ) -> bool:
        try:
            key = f"pending_action:{action_id}"
            await self.redis.setex(key, ttl, pickle.dumps(action_data))
            logger.info(f"Stored pending action: {action_id}")
            return True
        except Exception as e:
            logger.error(f"Error storing pending action: {e}")
            return False

    async def get_pending_action(self, action_id: str) -> Optional[dict]:
        try:
            key = f"pending_action:{action_id}"
            cached = await self.redis.get(key)
            if cached:
                return pickle.loads(cached)
        except Exception as e:
            logger.error(f"Error getting pending action: {e}")
        return None

    async def delete_pending_action(self, action_id: str) -> bool:
        try:
            key = f"pending_action:{action_id}"
            await self.redis.delete(key)
            logger.info(f"Deleted pending action: {action_id}")
            return True
        except Exception as e:
            logger.error(f"Error deleting pending action: {e}")
            return False


cache_manager = CacheManager()
