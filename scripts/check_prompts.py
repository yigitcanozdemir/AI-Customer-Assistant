#!/usr/bin/env python3
"""Verify every prompt template's {placeholders} are supplied by its .format() call.

Adding a placeholder to a prompt without adding the matching kwarg raises
KeyError at runtime. The agent catches that in a broad `except` and falls back to
a generic reply, so the failure is invisible in production and in review — the
prompt simply stops working. This makes it a build error instead.

Run from the repo root:  python scripts/check_prompts.py
"""

from __future__ import annotations

import ast
import string
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMPT_DIR = ROOT / "backend" / "prompts"
AGENT = ROOT / "backend" / "api" / "agent.py"


def placeholders(text: str) -> set[str]:
    """Field names used by a str.format template ({{ }} escapes excluded)."""
    return {
        field.split("[")[0].split(".")[0]
        for _, field, _, _ in string.Formatter().parse(text)
        if field
    }


def format_call_sites(src: str) -> dict[str, set[str]]:
    """Map prompt filename -> kwargs passed to its load_prompt(...).format(...)."""
    found: dict[str, set[str]] = {}
    for node in ast.walk(ast.parse(src)):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "format"
        ):
            continue

        inner = node.func.value
        if not (
            isinstance(inner, ast.Call)
            and getattr(inner.func, "id", "") == "load_prompt"
            and inner.args
            and isinstance(inner.args[0], ast.Constant)
        ):
            continue

        name = inner.args[0].value
        found.setdefault(name, set()).update(
            keyword.arg for keyword in node.keywords if keyword.arg
        )
    return found


def main() -> int:
    sites = format_call_sites(AGENT.read_text())
    failures = 0

    for path in sorted(PROMPT_DIR.glob("*.txt")):
        text = path.read_text()
        needed = placeholders(text)
        supplied = sites.get(path.name)

        if supplied is None:
            print(f"SKIP {path.name}: no load_prompt(...).format(...) call found")
            continue

        missing = needed - supplied
        if missing:
            failures += 1
            print(f"FAIL {path.name}: missing kwargs {sorted(missing)}")
        else:
            print(f"ok   {path.name}")

        # Unused kwargs are harmless but usually mean a placeholder was renamed
        # in the template and the call site was left behind.
        unused = supplied - needed
        if unused:
            print(f"     note: {path.name} passes unused kwargs {sorted(unused)}")

        # Also prove the template actually renders — catches an unescaped
        # single brace in prose, which .format() rejects.
        try:
            text.format(**{key: f"<{key}>" for key in needed})
        except Exception as exc:  # noqa: BLE001 - report whatever format raises
            failures += 1
            print(f"FAIL {path.name}: does not render — {type(exc).__name__}: {exc}")

    if failures:
        print(f"\n{failures} prompt problem(s) found.")
        return 1

    print("\nAll prompt templates resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
