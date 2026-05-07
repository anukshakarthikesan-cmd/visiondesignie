from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.chat import router as chat_router
from app.api.chat_title import router as chat_title_router
from app.api.health import router as health_router
from app.core.config import (
    CORS_ALLOW_ORIGIN_REGEX,
    CORS_ORIGINS,
    ENABLE_OPENAPI_DOCS,
    is_production,
)
from app.limiter import limiter
from app.services.rag_metrics_supabase import close_metrics_http_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    close_metrics_http_client()


def _expose_openapi() -> bool:
    return (not is_production()) or ENABLE_OPENAPI_DOCS


_docs_url = "/docs" if _expose_openapi() else None
_redoc_url = "/redoc" if _expose_openapi() else None
_openapi_url = "/openapi.json" if _expose_openapi() else None

app = FastAPI(
    lifespan=lifespan,
    docs_url=_docs_url,
    redoc_url=_redoc_url,
    openapi_url=_openapi_url,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/", include_in_schema=False)
def root():
    """Browser hits / on the API port — return a hint instead of 404."""
    hint = {
        "service": "VisionDesignie API",
        "note": "Frontend runs separately (e.g. Vite on port 5173).",
    }
    if _expose_openapi():
        hint["docs"] = "/docs"
    return hint


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    """Browsers request this automatically; avoid noisy 404 in logs."""
    return Response(status_code=204)


# CORS: explicit origins (required when allow_credentials=True; see CORS_ORIGINS in .env.example)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ALLOW_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(chat_router)
app.include_router(chat_title_router)
