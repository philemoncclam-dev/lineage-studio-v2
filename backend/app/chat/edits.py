"""Proposed model edits — the assistant's write path, which does not write.

Everything else in `app/chat` reads. This is the one place the assistant can
change something, and the shape of it is the whole design: **it proposes, the
user applies.** Nothing here mutates a model, and nothing downstream of here
does either — the backend has no model to mutate, because the document lives in
the browser's localStorage (see `model.py`). A proposal travels back with the
answer, the panel renders it with an Apply button, and the edit lands through
`model/edit.ts` and the existing undo history, exactly as if a person had drawn
it. A bad edit is therefore one ⌃Z, not a support ticket.

That is the same gate `purview/writer.py` puts in front of catalog writes, for
the same reason, and it is the rule CLAUDE.md states for the sandbox. An
assistant that edits a model directly is one bad inference away from silently
rewriting lineage a team depends on.

**Every proposal is validated here, against the real model, before the user
ever sees it.** An unapplicable proposal is worse than no proposal: it puts an
Apply button in front of somebody, and either it does nothing when pressed or
it does something other than what the sentence beside it promised. So an edge
whose endpoints do not exist, a duplicate transition, a self-loop, a rename to
the name it already has — all are rejected here with a reason the model is told,
so it can correct itself in the same turn rather than the user discovering it.

**Deletion is deliberately not offered.** Every operation here is additive or
corrective, and the worst case of a rubber-stamped Apply is a wrong edge or a
wrong property — visible on the canvas, and undoable. A `delete_entity` in this
list would make the worst case "a chunk of the model is gone", from a single
approval click on a sentence that sounded reasonable. That asymmetry is not
worth the convenience, and nothing about the read tools needs it.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .graph import build_index, ref_of
from .model import LineageModel

#: One turn's worth. A proposal list longer than this is not something a person
#: can meaningfully review, and an unreviewed Apply-all is the failure mode the
#: approval gate exists to prevent.
MAX_EDITS = 20

#: Tags live in the property bag under a reserved key, so they are a distinct
#: operation rather than a `set_property` — writing the key directly would
#: bypass the tag normalisation the editor applies. See `model/tags.ts`.
TAGS_KEY = "Tags"

EditKind = Literal["add_transition", "set_property", "add_tag", "rename"]


class ProposedEdit(BaseModel):
    """One reviewable change. Field use depends on `kind`."""

    kind: EditKind
    #: A sentence for the person deciding — written by the model, in its words.
    #: This is what somebody actually reads before pressing Apply, so it is a
    #: required field rather than a nicety.
    describes: str = ""

    #: add_transition
    source_id: str | None = None
    target_id: str | None = None
    #: set_property / add_tag / rename
    entity_id: str | None = None
    key: str | None = None
    value: str | None = None

    #: Filled in by validation — the human path of each entity named above, so
    #: the panel can show "Bronze / orders / amount" rather than a raw uuid.
    source_path: str | None = None
    target_path: str | None = None
    entity_path: str | None = None


class RejectedEdit(BaseModel):
    edit: ProposedEdit
    reason: str


class EditProposal(BaseModel):
    accepted: list[ProposedEdit] = Field(default_factory=list)
    rejected: list[RejectedEdit] = Field(default_factory=list)


TOOLS: list[dict[str, Any]] = [
    {
        "name": "propose_edits",
        "description": (
            "Propose changes to the authored model for the USER TO REVIEW. "
            "Nothing is applied by this call — the proposals appear beside your "
            "answer with an Apply button, and only the user can accept them. "
            "Say that you have proposed the changes, never that you have made "
            "them.\n\n"
            "Use it when the user asks you to fix, add, tag or annotate "
            "something — for example after finding an untraced column, or a "
            "table that has drifted from Fabric. Every entity id must come from "
            "find_entity; invalid proposals are rejected and returned to you "
            "with a reason, so you can correct them in this turn.\n\n"
            "Deletion is not available. If something needs removing, say so and "
            "let the user do it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "edits": {
                    "type": "array",
                    "description": "The changes to propose, in the order they should be applied.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {
                                "type": "string",
                                "enum": ["add_transition", "set_property", "add_tag", "rename"],
                                "description": (
                                    "add_transition draws lineage between two entities; "
                                    "set_property writes one property (Transform, Source, "
                                    "Data type, Step…); add_tag adds a tag; rename changes "
                                    "an entity's name."
                                ),
                            },
                            "describes": {
                                "type": "string",
                                "description": (
                                    "One plain sentence the user will read before "
                                    "approving. Say what changes and why."
                                ),
                            },
                            "source_id": {"type": "string", "description": "add_transition: the upstream entity."},
                            "target_id": {"type": "string", "description": "add_transition: the downstream entity."},
                            "entity_id": {"type": "string", "description": "set_property / add_tag / rename."},
                            "key": {"type": "string", "description": "set_property: the property name."},
                            "value": {
                                "type": "string",
                                "description": "set_property: the value. add_tag: the tag. rename: the new name.",
                            },
                        },
                        "required": ["kind", "describes"],
                    },
                }
            },
            "required": ["edits"],
        },
    }
]

TOOL_NAMES = {t["name"] for t in TOOLS}


def validate(model: LineageModel, edits: list[dict[str, Any]]) -> EditProposal:
    """Check each proposed edit against the model. Never mutates anything."""
    index = build_index(model)
    proposal = EditProposal()

    existing_edges = {(t.source, t.target) for t in model.transitions}
    # Proposals are checked against each OTHER as well as against the model: two
    # identical edges in one batch would both pass a model-only check, and the
    # second would silently do nothing when applied.
    proposed_edges: set[tuple[str, str]] = set()

    for raw in edits[:MAX_EDITS]:
        try:
            edit = ProposedEdit.model_validate(raw)
        except Exception as exc:  # noqa: BLE001 - pydantic's error tree is broad
            proposal.rejected.append(
                RejectedEdit(edit=ProposedEdit(kind="rename", describes=str(raw)[:120]), reason=str(exc))
            )
            continue

        reason = _check(model, index, edit, existing_edges, proposed_edges)
        if reason:
            proposal.rejected.append(RejectedEdit(edit=edit, reason=reason))
            continue

        if edit.kind == "add_transition":
            proposed_edges.add((edit.source_id or "", edit.target_id or ""))
        proposal.accepted.append(edit)

    if len(edits) > MAX_EDITS:
        proposal.rejected.append(
            RejectedEdit(
                edit=ProposedEdit(kind="rename", describes=f"{len(edits) - MAX_EDITS} further edits"),
                reason=(
                    f"Only {MAX_EDITS} edits can be proposed at once — more than that "
                    f"is not something a person can review before approving."
                ),
            )
        )

    return proposal


def _check(
    model: LineageModel,
    index,
    edit: ProposedEdit,
    existing_edges: set[tuple[str, str]],
    proposed_edges: set[tuple[str, str]],
) -> str | None:
    """`None` if the edit is applicable, else why it is not."""
    if not edit.describes.strip():
        return "Every edit needs a `describes` sentence — it is what the user reads before approving."

    if edit.kind == "add_transition":
        src, tgt = edit.source_id, edit.target_id
        if not src or not tgt:
            return "add_transition needs both source_id and target_id."
        if src not in index.entries:
            return f"No entity with id {src!r} — use find_entity to get real ids."
        if tgt not in index.entries:
            return f"No entity with id {tgt!r} — use find_entity to get real ids."
        if src == tgt:
            return "An entity cannot flow into itself."
        if (src, tgt) in existing_edges:
            return "That transition already exists in the model."
        if (src, tgt) in proposed_edges:
            return "That transition is already proposed earlier in this batch."
        edit.source_path = ref_of(index, src).path
        edit.target_path = ref_of(index, tgt).path
        return None

    if edit.entity_id is None or edit.entity_id not in index.entries:
        return f"No entity with id {edit.entity_id!r} — use find_entity to get real ids."
    edit.entity_path = ref_of(index, edit.entity_id).path

    if edit.kind == "set_property":
        if not (edit.key or "").strip():
            return "set_property needs a key."
        if (edit.key or "").strip().lower() == TAGS_KEY.lower():
            # Writing the reserved key directly would bypass the editor's tag
            # normalisation and produce tags the tag panel cannot see.
            return "Use add_tag for tags rather than writing the Tags property."
        if not (edit.value or "").strip():
            return (
                "set_property needs a value. Clearing a property is a deletion, "
                "which the user should do themselves."
            )
        current = model.properties.get(edit.entity_id, {}).get((edit.key or "").strip())
        if current == edit.value:
            return f"{edit.key!r} is already {edit.value!r} on that entity."
        return None

    if edit.kind == "add_tag":
        if not (edit.value or "").strip():
            return "add_tag needs a tag in `value`."
        current = model.properties.get(edit.entity_id, {}).get(TAGS_KEY, "")
        tags = {t.strip().lower() for t in current.split(",") if t.strip()}
        if (edit.value or "").strip().lower() in tags:
            return f"That entity already carries the tag {edit.value!r}."
        return None

    # rename
    if not (edit.value or "").strip():
        return "rename needs the new name in `value`."
    if index.entries[edit.entity_id].name == edit.value:
        return "That is already the entity's name."
    return None


def edits_of(args: dict[str, Any]) -> list[dict[str, Any]]:
    """The `edits` argument, or a TypeError the loop can report back."""
    edits = args.get("edits")
    if not isinstance(edits, list):
        raise TypeError("'edits' must be a list")
    return edits


def describe(proposal: EditProposal) -> dict[str, Any]:
    """The tool result — written FOR THE MODEL, not for the user.

    The wording matters more than usual here. If this reads as a success the
    model will report the edits as done, and the user will be told their model
    changed when it did not. Hence `applied: false` and a status line that says
    so in words as well as in a flag.
    """
    return {
        "proposed": len(proposal.accepted),
        "rejected": [
            {"reason": r.reason, "describes": r.edit.describes} for r in proposal.rejected
        ],
        "applied": False,
        "status": (
            f"{len(proposal.accepted)} edit(s) are now shown to the user for approval. "
            f"NOTHING HAS BEEN CHANGED — say you have proposed them, not that you have "
            f"made them. The user may accept or discard each one."
            if proposal.accepted
            else "No edits were proposed — every one was rejected. See `rejected` and try again."
        ),
    }


def run_tool(model: LineageModel, name: str, args: dict[str, Any]) -> Any:
    """Validate and describe. The assistant loop calls `validate` itself as well,
    because it needs the accepted edits to carry back to the browser."""
    if name not in TOOL_NAMES:
        raise KeyError(name)
    return describe(validate(model, edits_of(args)))
