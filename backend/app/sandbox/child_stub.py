"""The stub sandbox executor — the child process of a sandbox run (M2a).

Deliberately standalone: it imports nothing from `app`, is launched by path with
a scrubbed environment in a throwaway working directory, and so has no route to
the repo's `.env`, the Fabric client, or any credential. That isolation is the
whole point — it is the exact boundary the real local-Spark executor (M2b) will
run inside; only the body that turns cells into reads/writes changes.

Contract: reads a RunRequest JSON file (argv[1]), writes a RunResult JSON to
stdout. Both shapes are defined in protocol.py, but this file does not import it
— it stays dependency-free so the pinned Spark venv can run the same pattern.

The stub "runs" nothing: it derives reads/writes by the same static heuristics
as app/parser.py (duplicated here on purpose — the real executor derives them
from Spark's logical plans, sharing no code with this analog).
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

# Sibling module, pure stdlib — importable because this file is launched by
# path, so its own directory leads sys.path. It is NOT part of `app`, so the
# isolation contract above still holds.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _refs  # noqa: E402

_READ = [
    re.compile(r"""spark\.table\(\s*['"]([\w. ]+)['"]""", re.I),
    re.compile(r"""spark\.read[\w.]*\.table\(\s*['"]([\w. ]+)['"]""", re.I),
    re.compile(r"""\.load\(\s*['"]([\w.:/@ -]+)['"]""", re.I),
    re.compile(r"""\bFROM\s+([\w.`]+)""", re.I),
    re.compile(r"""\bJOIN\s+([\w.`]+)""", re.I),
]
_WRITE = [
    re.compile(r"""\.saveAsTable\(\s*['"]([\w. ]+)['"]""", re.I),
    re.compile(r"""\.insertInto\(\s*['"]([\w. ]+)['"]""", re.I),
    re.compile(r"""\.save\(\s*['"]([\w.:/@ -]+)['"]""", re.I),
    re.compile(r"""\bINSERT\s+INTO\s+([\w.`]+)""", re.I),
    re.compile(r"""\bCREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+([\w.`]+)""", re.I),
]
_IMPORT = re.compile(r"^\s*(?:from\s+[\w.]+\s+import\b|import\s+[\w.]+)", re.M)


def _find(patterns: list[re.Pattern[str]], text: str, ctx: dict) -> list[str]:
    """Canonical refs for every table the patterns match in `text`."""
    found: set[str] = set()
    for pat in patterns:
        for m in pat.finditer(text):
            ref = _refs.qualify(m.group(1), **ctx)
            if _refs.table_of(ref):
                found.add(ref)
    return sorted(found)


def _table_refs(refs: set[str]) -> dict:
    return _refs.table_refs(sorted(refs))


def _saw_credentials() -> bool:
    """Whether any Fabric/Azure credential is reachable from this process.

    Must be False: the runner scrubs the environment before spawning us. This is
    the observable half of the safety guarantee, not a functional need.
    """
    for key in os.environ:
        up = key.upper()
        if up.startswith(("PURVIEW_", "AZURE_")) or "SECRET" in up or "TOKEN" in up:
            return True
    return False


def main() -> None:
    req = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    cells = req.get("cells", [])
    creds = _saw_credentials()
    # The notebook's own workspace/lakehouse — what a bare table name means.
    ctx = {
        "default_workspace": req.get("workspace", ""),
        "default_lakehouse": req.get("lakehouse", ""),
        "name_map": req.get("name_map", {}),
    }

    log = ["[stub] engine=stub — static analysis only, no Spark session started."]
    if creds:
        log.append("[stub] WARNING: credential env visible to child — isolation breach.")

    cell_results = []
    all_reads: set[str] = set()
    all_writes: set[str] = set()
    for i, cell in enumerate(cells):
        scannable = _IMPORT.sub("", cell)
        reads = _find(_READ, scannable, ctx)
        writes = _find(_WRITE, scannable, ctx)
        all_reads.update(reads)
        all_writes.update(writes)
        log.append(
            f"[stub] cell {i}: reads={[_refs.table_of(r) for r in reads] or '—'} "
            f"writes={[_refs.table_of(w) for w in writes] or '—'}"
        )
        cell_results.append(
            {"index": i, "status": "ok", "reads": reads, "writes": writes, "stdout": "", "error": None}
        )

    result = {
        "ok": True,
        "engine": "stub",
        "workspace": ctx["default_workspace"],
        "cells": cell_results,
        "reads": sorted(all_reads - all_writes),
        "writes": sorted(all_writes),
        "tables": _table_refs(all_reads | all_writes),
        "log": log,
        "saw_credentials": creds,
        "error": None,
    }
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — any failure becomes a structured error
        sys.stdout.write(
            json.dumps({"ok": False, "engine": "stub", "error": f"{type(exc).__name__}: {exc}"})
        )
        sys.exit(1)
