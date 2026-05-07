"""
VisionDesignie chat API: streams SSE chunks from the RAG + Groq pipeline (see rag_pipeline).
`message` is the payload to the model (plain question or bracketed consultation wrapper).
Optional `user_input` is the original user-typed line for RAG retrieval and server history when `message` is wrapped.
`chat_id` scopes in-memory conversation history on the server.
Optional `onboarding_role` carries `profiles.onboarding_role` for LLM tailoring.
"""

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.config import CHAT_RATE_LIMIT
from app.limiter import limiter

router = APIRouter()


def _chat_rate_limit_decorator():
    if not CHAT_RATE_LIMIT:
        return lambda f: f
    return limiter.limit(CHAT_RATE_LIMIT)


class ChatRequest(BaseModel):
    message: str
    user_input: str | None = Field(
        default=None,
        description="Original user-typed text when message is a wrapper; used for RAG and history.",
    )
    chat_id: str | None = None
    design_state: dict | None = None
    # Optional: profiles.onboarding_role (slug or custom text) for LLM tailoring
    onboarding_role: str | None = None
    # Legacy clients may send planner | learning; server uses one unified architect path (learning ignored).
    chat_type: str | None = None


@router.post("/chat")
@_chat_rate_limit_decorator()
def chat(request: Request, body: ChatRequest):
    # Import lazily so web process can bind PORT quickly on cold start.
    from app.services.rag_pipeline import stream_chat_response_chunks

    return StreamingResponse(
        stream_chat_response_chunks(
            body.message,
            body.chat_id,
            design_state=body.design_state,
            onboarding_role=body.onboarding_role,
            chat_type=body.chat_type,
            user_input=body.user_input,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
