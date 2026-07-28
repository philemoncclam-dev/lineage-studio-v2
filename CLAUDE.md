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

- `frontend/` — React 19 + TypeScript + Vite. Renders the lineage graph.
- `backend/` — Python + FastAPI. Lineage model, parser, and (Phase 2) the
  Spark sandbox executor.
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

# frontend
cd frontend
npm install
npm run dev     # http://localhost:5173
```

Note: Phase 2's PySpark needs Python 3.11/3.12 — the local `py` is 3.14, so the
sandbox executor will get its own pinned venv when we build it.

## Conventions

- TypeScript strict; Python typed (pydantic models are the contract).
- Keep the `LineageGraph` shape stable — it's the frontend/backend contract and
  survives the Phase-1 → Phase-2 swap.
- No writes to real Fabric tables, ever, from the sandbox. Dry-run sinks only.
- Commit only when asked.
