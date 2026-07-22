"""
Langfuse tracing for the LLM layer.

`TracedProvider` wraps any `LLMProvider` so each `generate` / `parse` / `embed`
call is recorded as a Langfuse generation — capturing the model, inputs,
outputs, and (where available) errors — giving per-call LLM traces, cost/token
tracking, and a home for eval scores, separate from the infra/app traces that
go to the OTLP backend (OpenObserve).

If Langfuse isn't configured (no keys) the wrapper is skipped entirely by the
factory, so there is zero overhead and no hard dependency on Langfuse being
reachable.
"""

from __future__ import annotations

import contextlib
import logging
from functools import lru_cache
from typing import List, Optional, Type

from backend.config import settings
from backend.services.llm.base import LLMMessage, LLMProvider, TModel

logger = logging.getLogger(__name__)


def langfuse_configured() -> bool:
    return bool(settings.langfuse_public_key and settings.langfuse_secret_key)


@lru_cache(maxsize=1)
def _get_client():
    """Return a process-wide cached Langfuse client, or None if unavailable.

    Cached so the per-turn root span (`turn_trace`) and the per-call generation
    observations (`TracedProvider`) share one client/tracer — otherwise the
    generations would not nest under the turn span.
    """
    try:
        from langfuse import Langfuse

        return Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host or "https://cloud.langfuse.com",
        )
    except Exception as exc:  # pragma: no cover - tracing must never break calls
        logger.warning("Langfuse disabled (client init failed): %s", exc)
        return None


@contextlib.contextmanager
def turn_trace(
    *,
    name: str = "chat_turn",
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    user_input: Optional[str] = None,
):
    """Open one named root trace for a whole agent turn.

    Every `llm.parse` / `llm.generate` / `llm.embed` generation created by
    `TracedProvider` while this context is active nests underneath, so a single
    turn shows up in Langfuse as one named, session-tagged trace instead of
    several unnamed single-call traces.

    Fully guarded: a no-op when Langfuse is unconfigured, and tracing failures
    never propagate into the turn.
    """
    if not langfuse_configured():
        yield
        return

    client = _get_client()
    if client is None:
        yield
        return

    try:
        from langfuse import propagate_attributes

        with client.start_as_current_observation(
            name=name,
            as_type="span",
            input=user_input,
        ):
            # Propagate trace-level attributes to this span AND every child
            # generation created within the context (v4 API).
            with propagate_attributes(
                trace_name=name,
                session_id=session_id,
                user_id=user_id,
            ):
                yield
    except Exception:  # pragma: no cover - never let tracing mask the turn
        logger.debug("Langfuse turn_trace error (ignored)", exc_info=True)
        yield


class TracedProvider(LLMProvider):
    """Decorator that records each LLM call to Langfuse as a generation."""

    def __init__(self, inner: LLMProvider) -> None:
        self._inner = inner
        self.name = inner.name
        # `_get_client` is self-guarding and returns None on failure.
        self._client = _get_client()

    async def _traced(self, kind: str, model_input, coro_factory, *, model: str):
        if self._client is None:
            return await coro_factory()
        try:
            with self._client.start_as_current_observation(
                as_type="generation",
                name=f"llm.{kind}",
                input=model_input,
                model=model,
            ):
                result = await coro_factory()
                try:
                    self._client.update_current_generation(output=result)
                except Exception:  # pragma: no cover
                    pass
                return result
        except Exception:
            # Never let tracing failures mask or replace the real call/exception.
            logger.debug("Langfuse tracing error (ignored)", exc_info=True)
            return await coro_factory()

    @staticmethod
    def _render(messages: List[LLMMessage]):
        return [{"role": m.role, "content": m.content} for m in messages]

    async def generate(self, messages, *, max_tokens: int = 4096) -> str:
        return await self._traced(
            "generate",
            self._render(messages),
            lambda: self._inner.generate(messages, max_tokens=max_tokens),
            model=self.name,
        )

    async def parse(self, messages, schema: Type[TModel], *, max_tokens: int = 4096):
        return await self._traced(
            "parse",
            self._render(messages),
            lambda: self._inner.parse(messages, schema, max_tokens=max_tokens),
            model=self.name,
        )

    async def embed(self, text: str) -> List[float]:
        return await self._traced(
            "embed",
            text[:200],
            lambda: self._inner.embed(text),
            model="text-embedding",
        )

    @property
    def supports_vision(self) -> bool:
        return self._inner.supports_vision

    async def describe_image(
        self, image_data_url: str, instruction: str, *, max_tokens: int = 512
    ) -> str:
        return await self._traced(
            "describe_image",
            instruction,
            lambda: self._inner.describe_image(
                image_data_url, instruction, max_tokens=max_tokens
            ),
            model=self.name,
        )
