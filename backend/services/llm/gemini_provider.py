"""
Google Gemini provider — uses the current `google-genai` SDK
(`from google import genai`), not the deprecated `google-generativeai`.

- plain text via `client.aio.models.generate_content(...)`
- structured output via `config.response_mime_type="application/json"` +
  `config.response_schema=<PydanticModel>`, which returns a parsed instance on
  `response.parsed`
- the system prompt is passed via `config.system_instruction`

Embeddings delegate to OpenAI to stay dimension-locked to the pgvector schema.
"""

from __future__ import annotations

from typing import List, Tuple, Type

from google import genai
from google.genai import types

from backend.config import settings
from backend.services.llm.base import LLMMessage, LLMProvider, TModel
from backend.services.llm.openai_provider import OpenAIProvider


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self) -> None:
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required for the Gemini provider.")
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._model = settings.gemini_model
        # Delegate embeddings to OpenAI (schema is locked to 1536-dim).
        self._embedder = OpenAIProvider()

    @staticmethod
    def _split(messages: List[LLMMessage]) -> Tuple[str, list]:
        """
        Split into (system_instruction, contents).

        Roles are preserved as a real multi-turn `contents` list. The agent
        replays prior conversation turns, and flattening them into one string
        made the current question indistinguishable from history — the model
        could not tell what it was being asked. Gemini names the assistant role
        "model" rather than "assistant".
        """
        system_parts = [m.content for m in messages if m.role == "system"]
        contents = [
            types.Content(
                role="model" if m.role == "assistant" else "user",
                parts=[types.Part.from_text(text=m.content)],
            )
            for m in messages
            if m.role in ("user", "assistant") and m.content
        ]
        if not contents:
            contents = [
                types.Content(
                    role="user", parts=[types.Part.from_text(text="Continue.")]
                )
            ]
        return "\n\n".join(system_parts), contents

    async def generate(
        self,
        messages: List[LLMMessage],
        *,
        max_tokens: int = 4096,
    ) -> str:
        system, prompt = self._split(messages)
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system or None,
                max_output_tokens=max_tokens,
            ),
        )
        return response.text or ""

    async def parse(
        self,
        messages: List[LLMMessage],
        schema: Type[TModel],
        *,
        max_tokens: int = 4096,
    ) -> TModel:
        system, prompt = self._split(messages)
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system or None,
                max_output_tokens=max_tokens,
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )
        # google-genai validates + parses into the Pydantic schema on `.parsed`.
        parsed = response.parsed
        if parsed is None:
            # Fall back to validating the raw JSON text if `.parsed` is unset.
            return schema.model_validate_json(response.text)
        return parsed

    async def embed(self, text: str) -> List[float]:
        return await self._embedder.embed(text)
