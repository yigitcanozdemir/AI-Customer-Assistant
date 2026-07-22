"""
Provider factory — resolves the single active `LLMProvider` from
`settings.llm_provider` and caches it as a process-wide singleton.

Providers are imported lazily so a deployment only needs the SDK for the
provider it actually uses (e.g. a Gemini deployment doesn't require the
`anthropic` package to be importable).
"""

from __future__ import annotations

import logging
from functools import lru_cache

from backend.config import settings
from backend.services.llm.base import LLMProvider

logger = logging.getLogger(__name__)

_SUPPORTED = ("openai", "anthropic", "gemini")


@lru_cache(maxsize=1)
def get_provider() -> LLMProvider:
    """Return the active provider singleton, constructing it on first use."""
    provider = (settings.llm_provider or "openai").strip().lower()

    if provider == "openai":
        from backend.services.llm.openai_provider import OpenAIProvider

        instance: LLMProvider = OpenAIProvider()
    elif provider == "anthropic":
        from backend.services.llm.anthropic_provider import AnthropicProvider

        instance = AnthropicProvider()
    elif provider == "gemini":
        from backend.services.llm.gemini_provider import GeminiProvider

        instance = GeminiProvider()
    else:
        raise ValueError(
            f"Unknown LLM_PROVIDER={provider!r}. Supported: {', '.join(_SUPPORTED)}."
        )

    # Wrap with Langfuse tracing when configured, so every LLM call is recorded
    # (model, input, output, cost/tokens). No keys → no wrapper, no overhead.
    from backend.services.llm.tracing import langfuse_configured

    if langfuse_configured():
        from backend.services.llm.tracing import TracedProvider

        instance = TracedProvider(instance)
        logger.info("Langfuse LLM tracing enabled")

    logger.info("LLM provider initialized: %s", instance.name)
    return instance
