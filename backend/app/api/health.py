"""Liveness / config probes for hosting (no secrets in response)."""

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
    groq_ok = bool(config.GROQ_API_KEY)
    supabase_metrics_ok = bool(config.SUPABASE_URL and config.SUPABASE_SERVICE_ROLE_KEY)
    vector_dir = config.VECTOR_STORE_DIR
    vector_ready = vector_dir.is_dir() and any(vector_dir.iterdir())

    status = "ok" if groq_ok else "degraded"
    return {
        "status": status,
        "groq_configured": groq_ok,
        "supabase_metrics_configured": supabase_metrics_ok,
        "vector_store_ready": vector_ready,
    }
