"""
OpenAI provider — uses the current Responses API (not the deprecated
chat.completions API) for chat, and the embeddings endpoint for vectors.

This is the default provider and preserves the exact call shapes the agent
used before the abstraction was introduced:
- structured parse : client.responses.parse(..., text_format=Schema)
- plain generate    : client.responses.create(...)  -> .output_text
- embeddings        : client.embeddings.create(...)
"""

from __future__ import annotations

from typing import List, Type

from openai import AsyncOpenAI

from backend.config import settings
from backend.services.llm.base import LLMMessage, LLMProvider, TModel


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self) -> None:
        if not settings.openai_api_key:
            raise ValueError(
                "OPENAI_API_KEY is required for the OpenAI provider "
                "(and for embeddings regardless of the chat provider)."
            )
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._model = settings.openai_model
        self._embedding_model = settings.embedding_model

    @staticmethod
    def _to_input(messages: List[LLMMessage]) -> list[dict]:
        return [{"role": m.role, "content": m.content} for m in messages]

    async def generate(
        self,
        messages: List[LLMMessage],
        *,
        max_tokens: int = 4096,
    ) -> str:
        response = await self._client.responses.create(
            model=self._model,
            input=self._to_input(messages),
            max_output_tokens=max_tokens,
        )
        if getattr(response, "output_text", None):
            return response.output_text
        if getattr(response, "output", None):
            return "".join(getattr(o, "text", "") for o in response.output)
        return ""

    async def parse(
        self,
        messages: List[LLMMessage],
        schema: Type[TModel],
        *,
        max_tokens: int = 4096,
    ) -> TModel:
        response = await self._client.responses.parse(
            model=self._model,
            input=self._to_input(messages),
            text_format=schema,
            max_output_tokens=max_tokens,
        )
        return response.output_parsed

    async def embed(self, text: str) -> List[float]:
        response = await self._client.embeddings.create(
            model=self._embedding_model,
            input=text,
            encoding_format="float",
        )
        return response.data[0].embedding

    @property
    def supports_vision(self) -> bool:
        return True

    async def describe_image(
        self,
        image_data_url: str,
        instruction: str,
        *,
        max_tokens: int = 512,
    ) -> str:
        """Describe an image via the Responses API `input_image` content block.

        The configured chat model (gpt-5.4-nano) is multimodal; a single image
        is only a few hundred tokens (~$0.0002), so this stays cheap and fast.
        """
        response = await self._client.responses.create(
            model=self._model,
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": instruction},
                        {
                            "type": "input_image",
                            "image_url": image_data_url,
                            "detail": "low",
                        },
                    ],
                }
            ],
            max_output_tokens=max_tokens,
        )
        if getattr(response, "output_text", None):
            return response.output_text
        if getattr(response, "output", None):
            return "".join(getattr(o, "text", "") for o in response.output)
        return ""
