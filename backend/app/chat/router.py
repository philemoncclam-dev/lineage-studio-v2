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

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..config import get_settings
from ..fabric.router import onelake_token, user_token
from .assistant import Answer, AssistantError, Message, ask
from .fabric_tools import Caller
from .model import LineageModel

router = APIRouter(prefix="/chat", tags=["chat"])


class AskRequest(BaseModel):
    #: The model on screen. Unknown fields are dropped — a newer frontend still
    #: parses here rather than 422-ing on a field the traversal has no use for.
    model: LineageModel
    #: Full conversation, oldest first, ending with the user's new question.
    messages: list[Message] = Field(default_factory=list)
    #: Entity ids selected on the canvas right now. This is what makes "this
    #: column" mean something: the user points at the canvas and types a
    #: pronoun, and without it the assistant has to guess from a name that may
    #: match a dozen entities. Optional, so an older frontend still works.
    selection: list[str] = Field(default_factory=list)


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
        # So the UI can say "sign in to use the assistant" rather than letting
        # somebody type a question and collect a 401 for it.
        "requires_auth": settings.chat_require_auth,
    }


@router.post("/ask", response_model=Answer)
def ask_endpoint(
    req: AskRequest,
    token: Annotated[str | None, Depends(user_token)] = None,
    lake: Annotated[str | None, Depends(onelake_token)] = None,
) -> Answer:
    """Answer as the signed-in user, on a deployment that requires one.

    This is the ONLY route that spends money, and on a public URL that makes it
    the only one where "anyone who knows the address" is a billing problem as
    well as a disclosure one. `chat_require_auth` (default on) refuses a caller
    who brought no identity; turn it off for a local backend where signing in is
    not set up.

    The token also carries into the Fabric tools, so the assistant reads the
    tenant THIS user can see. Without that it answers from the service
    principal's view and can describe workspaces they cannot open — a wrong
    answer as much as a leak.
    """
    if not req.messages:
        raise HTTPException(status_code=400, detail="No question was asked.")
    if get_settings().chat_require_auth and not token:
        raise HTTPException(
            status_code=401,
            detail=(
                "Sign in to use the assistant. (A local backend can set "
                "CHAT_REQUIRE_AUTH=false to allow anonymous questions.)"
            ),
        )
    try:
        return ask(
            req.model,
            req.messages,
            selection=req.selection,
            caller=Caller(fabric=token, onelake=lake),
        )
    except AssistantError as exc:
        # 503, not 500: every AssistantError is "this backend cannot serve the
        # assistant right now" — unconfigured, uninstalled, or upstream — and
        # none of them are the caller's request being wrong.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
