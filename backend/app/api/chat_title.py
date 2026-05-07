"""POST /chat/title — LLM-generated sidebar title from recent turns."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.chat_title import generate_chat_title

router = APIRouter()


class TitleMessage(BaseModel):
    role: str
    content: str = ""


class ChatTitleRequest(BaseModel):
    messages: list[TitleMessage] = Field(..., min_length=1)
    chat_type: str | None = None


class ChatTitleResponse(BaseModel):
    title: str


@router.post("/chat/title", response_model=ChatTitleResponse)
def chat_title(req: ChatTitleRequest) -> ChatTitleResponse:
    rows = [m.model_dump() for m in req.messages]
    title = generate_chat_title(rows, req.chat_type)
    return ChatTitleResponse(title=title or "Chat")
