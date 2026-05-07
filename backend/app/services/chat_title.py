"""Short thread titles from recent messages (Groq, no RAG)."""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

MAX_TITLE_LEN = 78

_TITLE_RULES = """You write very short sidebar titles for an architecture assistant app.
Rules:
- Output a single line only (no quotes, no numbering, no leading emoji unless the topic is clearly about one symbol the user used).
- Maximum 8 words; prefer 3–7 words; stay under 60 characters when possible.
- Name the concrete topic (place, plot size, BHK, regulations, etc.)—never generic phrases like "Chat conversation", "User question", or "Follow-up".
- If the user only said hello or filler, infer the topic from the assistant reply; if still unclear, output: Architecture chat."""


def _format_excerpt(messages: list[dict[str, Any]], max_messages: int = 14, max_chars: int = 3000) -> str:
    lines: list[str] = []
    total = 0
    tail = messages[-max_messages:] if len(messages) > max_messages else messages
    for m in tail:
        role = str(m.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        body = str(m.get("content") or "").strip().replace("\r\n", "\n")
        if not body:
            continue
        chunk = body[:900]
        line = f"{role.upper()}: {chunk}"
        if total + len(line) > max_chars:
            break
        lines.append(line)
        total += len(line)
    return "\n".join(lines)


def _sanitize_title(raw: str) -> str:
    t = (raw or "").strip()
    t = re.sub(r'^["\'`]+|["\'`]+$', "", t)
    t = re.sub(r"\s+", " ", t)
    t = t.split("\n")[0].strip()
    if len(t) > MAX_TITLE_LEN:
        t = t[: MAX_TITLE_LEN - 1].rstrip() + "…"
    return t


def generate_chat_title(messages: list[dict[str, Any]], _chat_type: str | None = None) -> str:
    """Return a single-line title; safe fallback on errors."""
    from app.services.rag_pipeline import get_llm

    excerpt = _format_excerpt(messages)
    if not excerpt.strip():
        return "Untitled chat"

    prompt = f"""{_TITLE_RULES}

Conversation excerpt:
---
{excerpt}
---

Title:"""

    try:
        response = get_llm().invoke(prompt)
        text = getattr(response, "content", None) or str(response)
        out = _sanitize_title(str(text).strip())
        return out if out else "Chat"
    except Exception:
        logger.exception("generate_chat_title failed")
        return "Chat"
