# Lineage Studio (v2)

A full-stack app for tracking **data lineage across Microsoft Fabric** — from
workspace → notebooks → lakehouses → tables → **columns** — and rendering it as
a visual model. Fabric-first; kdb+ support and an AI chatbot consumption mode
are planned but out of scope for now.

## Vision & phases

- **Phase 1 (current):** Build the lineage graph from Fabric metadata plus
  *static parsing* of notebook code (no execution). Sources: live Fabric REST
  APIs and a manual JSON upload fallback. Ship a usable visual model.
- **Phase 2:** **Sandbox executor** — run notebook PySpark/Spark SQL in a local
  Spark session with an OpenLineage/Spline listener to derive *accurate
  column-level* lineage from Spark's own logical plans. Fabric APIs
  (`notebookutils`, `abfss://`, Delta) are shimmed; writes are intercepted as
  no-op/dry-run sinks so no real table is ever mutated.
- **Later:** kdb+ lineage; AI chatbot consumption mode.

## Layout

- `backend/`
  - `app/models.py` — the generic node/edge lineage graph (shared across all
    ingest paths).
  - `app/parser.py` — Phase-1 static, heuristic extraction. Phase 2 swaps its
    output for execution-derived lineage behind the same `build_graph` shape.

## Commands

```bash
# backend
cd backend
py -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/uvicorn app.main:app --reload   # http://localhost:8000

# assistant eval — COSTS MONEY, calls a live provider. Not part of pytest.
cd backend && .venv/Scripts/python -m evals.run
.venv/Scripts/python -m evals.run --model claude-haiku-4-5 --repeat 3

# frontend — standard Vite: npm install && npm run dev (http://localhost:5173)
```

Note: the sandbox executor runs PySpark 4.0 on Python 3.12 — the local `py` is
3.14, so it needs its own pinned venv locally (the container installs PySpark
into the app interpreter and the runner detects that). It tracks **Fabric
Runtime 2.0** (Spark 4.1, Delta 4.2, Python 3.13, Java 21), one Spark minor
behind on purpose; see the note in `backend/requirements.txt`.

Notebook SQL is parsed with sqlglot's **`databricks`** dialect, not `spark` —
Spark 4.x VARIANT path access (`payload:user.id`) is a parse error in the
latter, and `analyze` degrades silently, so the table vanishes from the graph
with nothing said.

## Conventions

- TypeScript strict; Python typed (pydantic models are the contract).
- Keep the `LineageGraph` shape stable — it's the frontend/backend contract and
  survives the Phase-1 → Phase-2 swap.
- No writes to real Fabric tables, ever, from the sandbox. Dry-run sinks only.
- Commit only when asked.
