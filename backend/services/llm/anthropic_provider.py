"""
Anthropic / Claude provider — uses the official `anthropic` SDK Messages API.

Follows current Claude API guidance:
- default model claude-opus-4-8
- adaptive thinking (`thinking={"type": "adaptive"}`) for reasoning-heavy calls
  (Pass 1 intent planning, policy validation) — no `budget_tokens`/`temperature`,
  which are rejected on Opus 4.8
- structured output via `client.messages.parse()` for schema-validated results
- plain text via `client.messages.create()`

Anthropic takes the system prompt as a separate `system` argument rather than a
message with role "system", so normalized messages are split accordingly.
"""

from __future__ import annotations

from typing import List, Tuple, Type

from anthropic import AsyncAnthropic

from backend.config import settings
from backend.services.llm.base import LLMMessage, LLMProvider, TModel

# Embeddings are dimension-locked to OpenAI's text-embedding-3-small (1536-dim);
# Anthropic does not serve embeddings, so we delegate to OpenAI for `embed()`.
from backend.services.llm.openai_provider import OpenAIProvider


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self) -> None:
        if not settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is required for the Anthropic provider.")
        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self._model = settings.anthropic_model
        # Delegate embeddings to OpenAI (schema is locked to 1536-dim).
        self._embedder = OpenAIProvider()

    @staticmethod
    def _split(messages: List[LLMMessage]) -> Tuple[str, list[dict]]:
        """Split normalized messages into (system_prompt, anthropic_messages).

        The agent replays prior conversation turns, so this normalizes the two
        shapes Anthropic rejects: a leading assistant turn (a session's stored
        transcript can start with the assistant's greeting) and two consecutive
        turns with the same role.
        """
        system_parts = [m.content for m in messages if m.role == "system"]
        chat = [
            {"role": m.role, "content": m.content}
            for m in messages
            if m.role in ("user", "assistant") and m.content
        ]

        # Anthropic requires the conversation to start with a user turn.
        while chat and chat[0]["role"] == "assistant":
            chat.pop(0)

        merged: list[dict] = []
        for message in chat:
            if merged and merged[-1]["role"] == message["role"]:
                merged[-1]["content"] += "\n\n" + message["content"]
            else:
                merged.append(dict(message))

        if not merged:
            merged = [{"role": "user", "content": "Continue."}]
        return "\n\n".join(system_parts), merged

    async def generate(
        self,
        messages: List[LLMMessage],
        *,
        max_tokens: int = 4096,
    ) -> str:
        system, chat = self._split(messages)
        response = await self._client.messages.create(
            model=self._model,
            max_tokens=max_tokens,
            thinking={"type": "adaptive"},
            system=system,
            messages=chat,
        )
        return "".join(
            block.text for block in response.content if block.type == "text"
        )

    async def parse(
        self,
        messages: List[LLMMessage],
        schema: Type[TModel],
        *,
        max_tokens: int = 4096,
    ) -> TModel:
        system, chat = self._split(messages)
        response = await self._client.messages.parse(
            model=self._model,
            max_tokens=max_tokens,
            thinking={"type": "adaptive"},
            system=system,
            messages=chat,
            output_format=schema,
        )
        return response.parsed_output

    async def embed(self, text: str) -> List[float]:
        return await self._embedder.embed(text)
