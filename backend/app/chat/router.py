"""`/chat/*` — the model assistant's HTTP surface.

The model document travels in the request body rather than being fetched here,
because it lives in the browser's localStorage and this backend has no store for
it (see `model.py`). That makes `/chat/ask` a pure function of what it was sent,
which is also why it needs no session: the browser owns the conversation and
replays it.

`/chat/status` exists so the UI can hide the assistant on a deployment with no
API key instead of offering a button that always fails — the same shape as
`/fabric/status` and `/purview/status`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import get_settings
from .assistant import Answer, AssistantError, Message, ask
from .model import LineageModel

router = APIRouter(prefix="/chat", tags=["chat"])


class AskRequest(BaseModel):
    #: The model on screen. Unknown fields are dropped — a newer frontend still
    #: parses here rather than 422-ing on a field the traversal has no use for.
    model: LineageModel
    #: Full conversation, oldest first, ending with the user's new question.
    messages: list[Message] = Field(default_factory=list)


@router.get("/status")
def status() -> dict[str, bool | str]:
    settings = get_settings()
    return {
        "configured": settings.chat_configured,
        "model": settings.chat_model,
        # Which LLM is answering is worth surfacing: the same question gets a
        # different quality of answer from Gemini's free tier than from Opus,
        # and "which model was that?" is otherwise unanswerable from the UI.
        "provider": settings.chat_provider,
    }


@router.post("/ask", response_model=Answer)
def ask_endpoint(req: AskRequest) -> Answer:
    if not req.messages:
        raise HTTPException(status_code=400, detail="No question was asked.")
    try:
        return ask(req.model, req.messages)
    except AssistantError as exc:
        # 503, not 500: every AssistantError is "this backend cannot serve the
        # assistant right now" — unconfigured, uninstalled, or upstream — and
        # none of them are the caller's request being wrong.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
