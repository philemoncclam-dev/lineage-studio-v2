"""Static, heuristic lineage extraction from notebook code.

This is the Phase-1 approximation: it does NOT execute anything. It scans
PySpark / Spark SQL text for table reads and writes to draw object-level edges,
and makes a best-effort pass at column-level maps from simple SELECT lists.

Phase 2 replaces this module's output with execution-derived lineage from a
Spark logical-plan listener (OpenLineage/Spline), which is far more accurate.
The public shape (`build_graph`) stays the same so the frontend is unaffected.
"""

from __future__ import annotations

import re

from .models import (
    ColumnMap,
    ColumnMapEvidence,
    Edge,
    IngestRequest,
    LineageGraph,
    Node,
    NodeKind,
    NotebookSource,
)

# --- table reference patterns -------------------------------------------------

# Kept deliberately in step with `app/sandbox/child_stub.py`, which duplicates
# these on purpose (it must not import `app`). See the notes there: file-format
# reader/writer methods, and a path class that tolerates globs.
_FMT = r"parquet|csv|json|orc|text|avro|delta|xml"
_PATH = r"""[^'"\n]+"""

_READ_PATTERNS = [
    re.compile(r"""spark\.table\(\s*['"]([\w.]+)['"]""", re.I),
    re.compile(r"""spark\.read[\w.]*\.table\(\s*['"]([\w.]+)['"]""", re.I),
    re.compile(rf"""\.load\(\s*['"]({_PATH})['"]""", re.I),
    re.compile(rf"""\.read[\w.]*\.(?:{_FMT})\(\s*['"]({_PATH})['"]""", re.I),
    re.compile(r"""\bFROM\s+([\w.]+)""", re.I),
    re.compile(r"""\bJOIN\s+([\w.]+)""", re.I),
]

_WRITE_PATTERNS = [
    re.compile(r"""\.saveAsTable\(\s*['"]([\w.]+)['"]""", re.I),
    re.compile(r"""\.insertInto\(\s*['"]([\w.]+)['"]""", re.I),
    re.compile(rf"""\.save\(\s*['"]({_PATH})['"]""", re.I),
    re.compile(rf"""\.write[\w.()'"= ]*\.(?:{_FMT})\(\s*['"]({_PATH})['"]""", re.I),
    re.compile(r"""\bINSERT\s+INTO\s+([\w.]+)""", re.I),
    re.compile(r"""\bCREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+([\w.]+)""", re.I),
]

_SELECT_RE = re.compile(r"""\bSELECT\b(.*?)\bFROM\b""", re.I | re.S)

# `FROM` means one thing in SQL and another in Python. `from pyspark.sql import
# Row` otherwise parses as a read of a table called `sql`, so notebooks invent a
# phantom upstream table merely by importing something.
_PY_IMPORT_RE = re.compile(r"^\s*(?:from\s+[\w.]+\s+import\b|import\s+[\w.]+)", re.M)


def _without_python_imports(cell: str) -> str:
    """Blank out Python import lines before scanning for SQL table references."""
    return _PY_IMPORT_RE.sub("", cell)


def _short(table_ref: str) -> str:
    """Normalize 'lakehouse.schema.table' or a path to a bare table name."""
    ref = table_ref.strip().strip("`").rstrip("/")
    return ref.split("/")[-1].split(".")[-1]


def _table_node_id(name: str) -> str:
    return f"table.{name.lower()}"


def _find(patterns: list[re.Pattern[str]], text: str) -> set[str]:
    found: set[str] = set()
    for pat in patterns:
        for m in pat.finditer(text):
            found.add(_short(m.group(1)))
    return found


def _find_raw(patterns: list[re.Pattern[str]], text: str) -> set[str]:
    """Matches exactly as written, keeping any workspace/lakehouse qualification.

    `_find` deliberately shortens to a bare table name for the Phase-1 graph.
    The sandbox needs the opposite — the qualification is the identity there,
    because a notebook can read across workspaces.
    """
    return {m.group(1) for pat in patterns for m in pat.finditer(text)}


def _column_maps(cell: str, notebook: str, cell_index: int) -> list[ColumnMap]:
    """Best-effort column derivation from a single flat SELECT list.

    Evidence is per-cell/per-SELECT granularity: every ColumnMap produced from
    this one match shares the same ColumnMapEvidence instance (RESEARCH
    Pitfall 4 — no narrower per-column snippet computation).
    """
    m = _SELECT_RE.search(cell)
    if not m:
        return []
    line = cell[: m.start()].count("\n") + 1
    snippet = m.group(0).strip()
    evidence = ColumnMapEvidence(notebook=notebook, cell_index=cell_index, line=line, snippet=snippet)
    maps: list[ColumnMap] = []
    for raw in m.group(1).split(","):
        expr = raw.strip()
        if not expr or expr == "*":
            continue
        alias_m = re.search(r"\bAS\s+([\w]+)\s*$", expr, re.I)
        target = alias_m.group(1) if alias_m else expr.split(".")[-1]
        target = re.sub(r"[^\w]", "", target) or expr
        transform = None if re.fullmatch(r"[\w.]+", expr) else expr
        maps.append(
            ColumnMap(
                from_column=expr.split(" AS ")[0].strip(),
                to_column=target,
                transform=transform,
                evidence=evidence,
            )
        )
    return maps


def parse_notebook(nb: NotebookSource) -> tuple[Node, list[Edge]]:
    nb_id = f"notebook.{nb.name.lower()}"
    # Full source rides along in meta so the UI can grep it (OpenGrok-style).
    node = Node(id=nb_id, kind=NodeKind.NOTEBOOK, name=nb.name, meta={"source": "\n\n".join(nb.cells)})

    reads: set[str] = set()
    writes: set[str] = set()
    col_maps: list[ColumnMap] = []
    for cell_index, cell in enumerate(nb.cells):
        scannable = _without_python_imports(cell)
        reads |= _find(_READ_PATTERNS, scannable)
        writes |= _find(_WRITE_PATTERNS, scannable)
        col_maps.extend(_column_maps(scannable, nb.name, cell_index))

    # A read that is also written in the same notebook is treated as a write target.
    reads -= writes

    edges: list[Edge] = []
    for t in sorted(reads):
        edges.append(Edge(source=_table_node_id(t), target=nb_id, kind="reads", via=nb_id))
    for t in sorted(writes):
        edges.append(
            Edge(source=nb_id, target=_table_node_id(t), kind="writes", via=nb_id, columns=col_maps)
        )
    return node, edges


def build_graph(req: IngestRequest) -> LineageGraph:
    graph = LineageGraph()

    ws_id = f"workspace.{req.workspace.lower()}"
    graph.nodes.append(Node(id=ws_id, kind=NodeKind.WORKSPACE, name=req.workspace))

    known_tables: set[str] = set()
    for node in req.lakehouses:
        graph.nodes.append(node)
        if node.kind == NodeKind.TABLE:
            known_tables.add(node.id)

    for nb in req.notebooks:
        nb_node, edges = parse_notebook(nb)
        nb_node.parent_id = ws_id
        graph.nodes.append(nb_node)
        graph.edges.extend(edges)

    # Materialize placeholder table nodes referenced by code but not in metadata.
    referenced = {e.source for e in graph.edges} | {e.target for e in graph.edges}
    existing = {n.id for n in graph.nodes}
    for ref in referenced:
        if ref.startswith("table.") and ref not in existing:
            graph.nodes.append(
                Node(id=ref, kind=NodeKind.TABLE, name=ref.removeprefix("table."), meta={"inferred": True})
            )

    return graph
