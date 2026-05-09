"""Liveness / config probes for hosting (no secrets in response)."""

import os

from fastapi import APIRouter
from fastapi.responses import Response

from app.core import config

router = APIRouter(tags=["health"])


@router.head("/health", include_in_schema=False)
def health_head() -> Response:
    """Liveness probes often use HEAD; avoid relying on implicit GET-only behavior."""
    return Response(status_code=200)


@router.get("/health")
def health() -> dict:
    groq_ok = bool((config.GROQ_API_KEY or "").strip())
    supabase_metrics_ok = bool(config.SUPABASE_URL and config.SUPABASE_SERVICE_ROLE_KEY)
    vector_dir = config.VECTOR_STORE_DIR
    vector_ready = vector_dir.is_dir() and any(vector_dir.iterdir())

    status = "ok" if groq_ok else "degraded"
    hints: list[str] = []
    if not groq_ok:
        hints.append(
            "Set GROQ_API_KEY on the server (Groq console). Without it, POST /chat cannot call the LLM."
        )
    if not vector_ready:
        hints.append(
            "No FAISS index under backend/data/vector_store/. Build with "
            "create_vector_store() locally, deploy index.faiss + index.pkl, or answers run LLM-only."
        )
    if config.is_production() and not (os.getenv("CORS_ORIGINS") or "").strip():
        hints.append(
            "CORS_ORIGINS env not set — browsers can only call this API from localhost Vite defaults. "
            "Set CORS_ORIGINS to your deployed frontend URL(s), comma-separated."
        )

    return {
        "status": status,
        "groq_configured": groq_ok,
        "supabase_metrics_configured": supabase_metrics_ok,
        "vector_store_ready": vector_ready,
        "deployment_hints": hints,
    }
