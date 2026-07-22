"""Provider-agnostic LLM layer.

Import `get_provider()` and the normalized `LLMMessage` type from here:

    from backend.services.llm import get_provider, LLMMessage

    provider = get_provider()
    text = await provider.generate([LLMMessage("system", ...), LLMMessage("user", ...)])
"""

from backend.services.llm.base import LLMMessage, LLMProvider
from backend.services.llm.factory import get_provider

__all__ = ["LLMMessage", "LLMProvider", "get_provider"]
