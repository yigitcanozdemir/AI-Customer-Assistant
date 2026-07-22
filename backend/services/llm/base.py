"""
Provider-agnostic LLM interface.

The agent talks to an `LLMProvider` rather than to any vendor SDK directly.
Each concrete provider (OpenAI, Anthropic, Gemini) translates the normalized
requests below into its native API shape. Exactly one provider is active per
deployment, selected by `settings.llm_provider` via `get_provider()`.

Three operations cover everything the two-pass agent needs:

- `generate(messages)`        -> plain natural-language text (Pass 2)
- `parse(messages, schema)`   -> a validated Pydantic model (Pass 1, policy gate)
- `embed(text)`               -> an embedding vector (semantic search / RAG)

`embed()` intentionally stays on OpenAI regardless of the active chat provider:
the pgvector column is dimension-locked to 1536 (text-embedding-3-small), so
swapping embedding models would require a schema migration and re-indexing.
See `OpenAIProvider.embed` and `services/embedding.py`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Type, TypeVar

from pydantic import BaseModel

# Bound to the Pydantic model a structured `parse` call returns.
TModel = TypeVar("TModel", bound=BaseModel)


@dataclass
class LLMMessage:
    """A single chat message. `role` is one of "system" | "user" | "assistant"."""

    role: str
    content: str


class LLMProvider(ABC):
    """
    Interface every chat provider implements.

    Implementations must be safe to construct once and reuse (the factory caches
    a singleton), and every method must be async and non-blocking.
    """

    #: Human-readable provider id ("openai" | "anthropic" | "gemini").
    name: str = "base"

    @abstractmethod
    async def generate(
        self,
        messages: List[LLMMessage],
        *,
        max_tokens: int = 4096,
    ) -> str:
        """Return the model's plain-text response for a chat exchange."""

    @abstractmethod
    async def parse(
        self,
        messages: List[LLMMessage],
        schema: Type[TModel],
        *,
        max_tokens: int = 4096,
    ) -> TModel:
        """
        Return a validated instance of `schema`.

        Providers must use their native structured-output mechanism
        (OpenAI `text_format`, Anthropic `messages.parse`, Gemini
        `response_schema`) so the result is schema-valid without brittle
        string parsing. Raises on invalid/unparseable output — callers are
        expected to handle the exception and fail safe.
        """

    @abstractmethod
    async def embed(self, text: str) -> List[float]:
        """
        Return an embedding vector for `text`.

        Must produce 1536-dim vectors to match the pgvector schema. Chat
        provider selection does not change this — see module docstring.
        """

    async def describe_image(
        self,
        image_data_url: str,
        instruction: str,
        *,
        max_tokens: int = 512,
    ) -> str:
        """
        Return a plain-text description of an image (vision → text).

        Used by the "upload a garment, find similar" flow: the description is
        fed as a text query into the existing embedding/pgvector search, so no
        image vectors or schema changes are needed. `image_data_url` is a
        `data:<mime>;base64,...` URL or an http(s) image URL.

        Base implementation raises: providers without vision must not be asked
        to describe images. Callers should guard on `supports_vision`.
        """
        raise NotImplementedError(
            f"{self.name} provider does not support image description"
        )

    @property
    def supports_vision(self) -> bool:
        """Whether `describe_image` is implemented for this provider."""
        return False
