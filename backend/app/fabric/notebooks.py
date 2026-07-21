"""Turn a Fabric notebook definition into the parser's `NotebookSource`.

Fabric returns a notebook as base64 `parts`, and in one of two encodings: the
default `notebook-content.py`, a flat script with `# CELL ***…` banner comments,
or a real `.ipynb` JSON document when `?format=ipynb` is asked for. Both appear
in the wild, so both are decoded here rather than pinning one and breaking the
day the default changes.

Everything in this module is pure given a definition dict, which matters because
the service principal may be refused Fabric workspace access entirely. The
fetch is one thin function at the bottom; the decode path stays usable with a
definition supplied by hand, so the rest of the pipeline is testable and
operable with no Fabric access at all.
"""

from __future__ import annotations

import base64
import binascii
import json
import re

from ..models import NotebookSource

# The banner Fabric writes between cells in the `notebook-content.py` encoding.
# The star run is padding to a fixed width and its length is not contractual.
_CELL_BANNER = re.compile(r"^#\s*(CELL|MARKDOWN)\s*\*+\s*$", re.M)

# Qualified name of a scanned notebook:
#   https://app.fabric.microsoft.com/groups/<ws-guid>/synapsenotebooks/<item-guid>
_NOTEBOOK_QN = re.compile(
    r"/groups/([0-9a-f-]{36})/synapsenotebooks/([0-9a-f-]{36})", re.I
)

_CODE_PART = ("notebook-content.py", "notebook-content.ipynb")


class NotebookDecodeError(ValueError):
    """A definition was returned but could not be read as notebook source."""


def parse_notebook_qualified_name(qualified_name: str) -> tuple[str, str] | None:
    """`(workspace_id, item_id)` for a notebook, or None if not a notebook QN."""
    m = _NOTEBOOK_QN.search(qualified_name or "")
    if not m:
        return None
    return m.group(1).lower(), m.group(2).lower()


def _decode_part(part: dict) -> str:
    payload = part.get("payload") or ""
    try:
        return base64.b64decode(payload).decode("utf-8", errors="replace")
    except (binascii.Error, ValueError) as exc:
        raise NotebookDecodeError(
            f"part {part.get('path')!r} is not valid base64: {exc}"
        ) from exc


def _cells_from_ipynb(text: str) -> list[str]:
    doc = json.loads(text)
    cells: list[str] = []
    for cell in doc.get("cells") or []:
        if cell.get("cell_type") != "code":
            continue
        src = cell.get("source")
        # nbformat allows either a list of lines or one pre-joined string.
        joined = "".join(src) if isinstance(src, list) else (src or "")
        if joined.strip():
            cells.append(joined)
    return cells


def _cells_from_script(text: str) -> list[str]:
    """Split the `notebook-content.py` encoding on its cell banners.

    Markdown cells are dropped along with the leading metadata block: the parser
    only looks for table references in code, and prose that happens to contain
    the word FROM would otherwise invent edges.
    """
    chunks = _CELL_BANNER.split(text)
    cells: list[str] = []
    # split() yields [preamble, kind, body, kind, body, ...] — the preamble is
    # Fabric's generated metadata header and is never user code.
    for kind, body in zip(chunks[1::2], chunks[2::2]):
        if kind.upper() != "CELL":
            continue
        # `# META {...}` lines are Fabric's per-cell metadata, not source.
        code = "\n".join(
            ln for ln in body.splitlines() if not ln.lstrip().startswith("# META")
        ).strip()
        if code:
            cells.append(code)
    return cells


def notebook_source_from_ipynb(
    name: str, text: str, lakehouse_default: str | None = None
) -> NotebookSource:
    """Decoded notebook text (either encoding) -> parser input."""
    stripped = text.lstrip()
    cells = (
        _cells_from_ipynb(text)
        if stripped.startswith("{") and '"cells"' in text
        else _cells_from_script(text)
    )
    return NotebookSource(name=name, lakehouse_default=lakehouse_default, cells=cells)


def notebook_source_from_definition(
    name: str, definition: dict, lakehouse_default: str | None = None
) -> NotebookSource:
    """The `definition` payload of `getDefinition` -> parser input.

    This is the seam the fallback path uses: a definition captured by any means
    — the REST call, a manual export, a fixture — decodes identically.
    """
    parts = (definition or {}).get("parts") or []
    code = [p for p in parts if (p.get("path") or "").lower().endswith((".py", ".ipynb"))]
    # Prefer the canonical content part; `.platform` and friends are metadata.
    preferred = [p for p in code if (p.get("path") or "").lower() in _CODE_PART]
    chosen = (preferred or code)
    if not chosen:
        raise NotebookDecodeError(
            f"notebook {name!r} definition has no code part "
            f"(parts: {[p.get('path') for p in parts]})"
        )
    return notebook_source_from_ipynb(name, _decode_part(chosen[0]), lakehouse_default)


def fetch_notebook_source(
    client, workspace_id: str, item_id: str, name: str
) -> NotebookSource:
    """Fetch and decode one notebook from live Fabric.

    Raises `FabricError` when the service principal cannot reach the workspace;
    callers that need to keep going should catch it and fall back to a supplied
    definition rather than treating the notebook as empty, since an empty
    notebook and an unreadable one produce very different lineage.
    """
    definition = client.get_notebook_definition(workspace_id, item_id)
    return notebook_source_from_definition(name, definition)
