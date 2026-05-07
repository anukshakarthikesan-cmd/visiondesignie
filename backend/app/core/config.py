import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# "production" disables OpenAPI docs by default; any other value keeps /docs.
ENVIRONMENT = (os.getenv("ENVIRONMENT") or os.getenv("APP_ENV") or "development").strip().lower()


def is_production() -> bool:
    return ENVIRONMENT in ("production", "prod")


# SlowAPI limit for POST /chat (e.g. "30/minute"). Set to disabled/0/off/none to turn off.
def _parse_chat_rate_limit() -> str | None:
    if "CHAT_RATE_LIMIT" not in os.environ:
        return "60/minute"
    raw = (os.getenv("CHAT_RATE_LIMIT") or "").strip()
    if not raw or raw.lower() in ("0", "off", "none", "disabled"):
        return None
    return raw


CHAT_RATE_LIMIT = _parse_chat_rate_limit()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")


def _parse_bool_env(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


# Logs top retrieved snippets (source/page + preview) per query when enabled.
RAG_RETRIEVAL_DEBUG = _parse_bool_env("RAG_RETRIEVAL_DEBUG", default=False)

# When ENVIRONMENT=production, hide /docs unless this is true (public demos / thesis — lock down API later).
ENABLE_OPENAPI_DOCS = _parse_bool_env("ENABLE_OPENAPI_DOCS", default=False)

# Optional: RAG analytics rows in Supabase (PostgREST + service role; never expose key to clients).
SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").strip()
SUPABASE_SERVICE_ROLE_KEY = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()


def _parse_cors_origins() -> list[str]:
    """
    Comma-separated list in CORS_ORIGINS.
    Default dev Vite origins. Use explicit production URLs when deploying.
    """
    raw = (os.getenv("CORS_ORIGINS") or "").strip()
    defaults = ["http://127.0.0.1:5173", "http://localhost:5173"]
    if not raw:
        return defaults
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return parts if parts else defaults


CORS_ORIGINS = _parse_cors_origins()
CORS_ALLOW_ORIGIN_REGEX = (os.getenv("CORS_ALLOW_ORIGIN_REGEX") or "").strip() or None

# backend/ root (parent of app/)
BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
VECTOR_STORE_DIR = BACKEND_ROOT / "data" / "vector_store"
