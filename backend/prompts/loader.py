"""Prompt loading with in-process caching.

Prompt templates are static files read on nearly every agent turn. Caching the
file contents avoids a blocking disk read on each LLM call. The cache is keyed
by filename; templates are treated as immutable at runtime (edit a `.txt` file
and restart to pick up changes).
"""

from functools import lru_cache
from pathlib import Path

PROMPT_DIR = Path(__file__).parent


@lru_cache(maxsize=None)
def load_prompt(name: str) -> str:
    """Return the raw text of a prompt template, cached after first read."""
    path = PROMPT_DIR / name
    return path.read_text(encoding="utf-8")
