"""
Best-effort inserts into public.rag_query_metrics via PostgREST (service role).
Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on the backend; otherwise no-ops.

Uses one shared httpx.Client for connection reuse (closed on app shutdown).
"""

from __future__ import annotations

import logging
import threading
import uuid
from typing import Any

import httpx

from app.core.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

logger = logging.getLogger(__name__)

_REST_TIMEOUT = 8.0

_client: httpx.Client | None = None
_client_lock = threading.Lock()


def _headers() -> dict[str, str]:
    key = SUPABASE_SERVICE_ROLE_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def get_metrics_http_client() -> httpx.Client | None:
    """Return shared client when metrics are enabled; otherwise None."""
    if not is_metrics_enabled():
        return None
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(timeout=_REST_TIMEOUT)
        return _client


def close_metrics_http_client() -> None:
    global _client
    with _client_lock:
        if _client is not None:
            try:
                _client.close()
            finally:
                _client = None


def is_metrics_enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def fetch_user_id_for_chat(chat_id: str) -> str | None:
    if not is_metrics_enabled():
        return None
    try:
        cid = str(uuid.UUID(chat_id.strip()))
    except (ValueError, AttributeError):
        return None
    base = SUPABASE_URL.rstrip("/")
    url = f"{base}/rest/v1/chats"
    params = {"id": f"eq.{cid}", "select": "user_id"}
    client = get_metrics_http_client()
    if not client:
        return None
    try:
        r = client.get(url, headers=_headers(), params=params)
        r.raise_for_status()
        rows = r.json()
    except Exception:
        logger.warning("rag_metrics: failed to resolve user_id for chat", exc_info=True)
        return None
    if not rows or not isinstance(rows, list):
        return None
    uid = rows[0].get("user_id") if isinstance(rows[0], dict) else None
    if isinstance(uid, str) and uid:
        return uid
    return None


def insert_rag_query_metrics_row(row: dict[str, Any]) -> None:
    if not is_metrics_enabled():
        return
    base = SUPABASE_URL.rstrip("/")
    url = f"{base}/rest/v1/rag_query_metrics"
    client = get_metrics_http_client()
    if not client:
        return
    try:
        r = client.post(url, headers=_headers(), json=row)
        r.raise_for_status()
    except Exception:
        logger.warning("rag_metrics: insert failed", exc_info=True)


def fetch_recent_messages_for_rag_history(
    chat_id: str, limit: int = 8, content_max_chars: int = 1200
) -> list[dict[str, str]]:
    """
    Last ``limit`` messages from public.messages (chronological), for server RAG memory.
    Requires the same Supabase service credentials as metrics. Returns [] on failure.
    """
    if not is_metrics_enabled():
        return []
    try:
        cid = str(uuid.UUID(chat_id.strip()))
    except (ValueError, AttributeError):
        return []
    base = SUPABASE_URL.rstrip("/")
    url = f"{base}/rest/v1/messages"
    params = {
        "chat_id": f"eq.{cid}",
        "select": "role,content,created_at",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    client = get_metrics_http_client()
    if not client:
        return []
    try:
        r = client.get(url, headers=_headers(), params=params)
        r.raise_for_status()
        rows = r.json()
    except Exception:
        logger.warning("rag_history: failed to load messages from Supabase", exc_info=True)
        return []
    if not isinstance(rows, list):
        return []
    out: list[dict[str, str]] = []
    for row in reversed(rows):
        if not isinstance(row, dict):
            continue
        role = row.get("role")
        content = row.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        c = content.strip()
        if len(c) > content_max_chars:
            c = c[: content_max_chars - 1].rstrip() + "…"
        out.append({"role": role, "content": c})
    return out
