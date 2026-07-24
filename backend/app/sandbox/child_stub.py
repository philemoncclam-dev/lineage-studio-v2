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

_READ = [
    re.compile(r"""spark\.table\(\s*['"]([\w.]+)['"]""", re.I),
    re.compile(r"""spark\.read[\w.]*\.table\(\s*['"]([\w.]+)['"]""", re.I),
    re.compile(r"""\.load\(\s*['"]([\w./]+)['"]""", re.I),
    re.compile(r"""\bFROM\s+([\w.]+)""", re.I),
    re.compile(r"""\bJOIN\s+([\w.]+)""", re.I),
]
_WRITE = [
    re.compile(r"""\.saveAsTable\(\s*['"]([\w.]+)['"]""", re.I),
    re.compile(r"""\.insertInto\(\s*['"]([\w.]+)['"]""", re.I),
    re.compile(r"""\bINSERT\s+INTO\s+([\w.]+)""", re.I),
    re.compile(r"""\bCREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+([\w.]+)""", re.I),
]
_IMPORT = re.compile(r"^\s*(?:from\s+[\w.]+\s+import\b|import\s+[\w.]+)", re.M)


def _short(ref: str) -> str:
    ref = ref.strip().strip("`").rstrip("/")
    return ref.split("/")[-1].split(".")[-1]


def _find(patterns: list[re.Pattern[str]], text: str) -> list[str]:
    found: set[str] = set()
    for pat in patterns:
        for m in pat.finditer(text):
            found.add(_short(m.group(1)))
    return sorted(found)


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

    log = ["[stub] engine=stub — static analysis only, no Spark session started."]
    if creds:
        log.append("[stub] WARNING: credential env visible to child — isolation breach.")

    cell_results = []
    all_reads: set[str] = set()
    all_writes: set[str] = set()
    for i, cell in enumerate(cells):
        scannable = _IMPORT.sub("", cell)
        reads = _find(_READ, scannable)
        writes = _find(_WRITE, scannable)
        all_reads.update(reads)
        all_writes.update(writes)
        log.append(f"[stub] cell {i}: reads={reads or '—'} writes={writes or '—'}")
        cell_results.append(
            {"index": i, "status": "ok", "reads": reads, "writes": writes, "stdout": "", "error": None}
        )

    result = {
        "ok": True,
        "engine": "stub",
        "cells": cell_results,
        "reads": sorted(all_reads - all_writes),
        "writes": sorted(all_writes),
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
