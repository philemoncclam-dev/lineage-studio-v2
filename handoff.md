# Handoff — Lineage Studio v2

_Last updated: 2026-07-17_

## What this is

A from-scratch rebuild. On 2026-07-17 the old Lineage Studio was wiped locally
(files + git history) and a new full-stack app was scaffolded in the same folder
(`C:\Users\user\Downloads\github\datalineage`, still named `datalineage` on disk).

**Goal:** track data lineage across Microsoft Fabric — workspace → notebooks →
lakehouses → tables → **columns** — with a visual model. Fabric-first. kdb+
lineage and an AI chatbot consumption mode are deferred.

**Stack:** React 19 + Vite + TypeScript frontend, Python + FastAPI backend.

**GitHub:** pushes to the NEW repo **`philemoncclam-dev/lineage-studio-v2`**
(private, remote `origin`, branch `master`). Do **not** push to the old
`lineage-studio` or `datalineage` GitHub repos — they hold prior work and must
stay untouched.

## Phases

- **Phase 1 (in progress):** build the lineage graph from Fabric metadata +
  *static parsing* of notebook PySpark/Spark SQL (no execution). Sources: live
  Fabric REST APIs and a manual JSON upload fallback.
- **Phase 2:** sandbox executor — run notebook code in a local Spark session
  with an OpenLineage/Spline listener to derive accurate column-level lineage
  from Spark's logical plans. Fabric APIs (`notebookutils`, `abfss://`, Delta)
  shimmed; writes intercepted as no-op/dry-run sinks (never mutate real tables).
  Needs a Python 3.11/3.12 venv (local `py` is 3.14, too new for PySpark).
- **Later:** kdb+ lineage; AI chatbot consumption mode.

## Done this session

**Backend** (`backend/`, FastAPI)
- `app/models.py` — generic `LineageGraph` (nodes/edges) contract, shared across
  all ingest paths.
- `app/parser.py` — Phase-1 static, heuristic extraction of table reads/writes +
  best-effort column maps from notebook code.
- `app/sample.py` — built-in demo graph (no Fabric needed).
- `app/main.py` — endpoints `/health`, `/sample`, `/ingest`, `/graph`.
- Verified end-to-end: `raw_orders → clean_orders → orders_clean` with the
  `upper(customer) → customer_name` column map.

**Frontend** (`frontend/`) — three views, all building green:
- **Lineage DAG view** (`src/views/LineageView.tsx`) — expandable table cards,
  column-level edges, hover/click to trace a column's upstream+downstream path,
  right-side inspector (transformation explanation + inputs/outputs).
- **Knowledge-graph view** (`src/views/GraphView.tsx`) — force-directed
  constellation of the workspace; hover to trace, drag/zoom/pan.
- **Drill-down** (same file) — breadcrumb navigation
  Estate → Workspace → Lakehouse → Table, handing off into the column-level
  lineage view via a "View column-level lineage →" button.
- Shared sample model in `src/data.ts`; unified design tokens (light + dark) in
  `src/App.css`; toolbar mode switch in `src/App.tsx`.

Everything is currently driven by the **sample data in `data.ts`**, not yet the
backend. `src/api.ts` (backend client) exists but the views don't use it yet.

## Design decisions (approved via mockups)

- Clean, light, minimal — data-catalog feel. Cool slate neutrals, indigo accent
  (`#4f5bd5`). Apple/San Francisco font stack, SF Mono for column identifiers.
  Dark mode wired via CSS tokens.
- Domain colors: Bronze amber, Silver blue, Gold green, Notebooks violet.
- **Two consumption modes** as siblings via the toolbar switch: structured
  lineage DAG ("trace exact") and knowledge graph ("explore broad").
- **Drill vision:** the knowledge graph is the map of the whole Fabric estate,
  with **multiple workspaces** as super-clusters; zoom/drill down to a single
  table, then punch into the column-level DAG.
- User preferences: **no glyph/node icons on graph nodes, no hint-text bars, no
  top-bar node legends, no minimap, no per-layer labels** on the lineage canvas
  (they echoed the old app).

## Commands

```bash
# backend  → http://localhost:8000
cd backend
py -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/uvicorn app.main:app --reload

# frontend → http://localhost:5173
cd frontend
npm install
npm run dev
npm run build   # tsc -b + vite build — must stay green
```

## Next steps (open)

1. Hook the three views to the backend (`/graph`, `/ingest`) instead of the
   hard-coded `data.ts` sample.
2. Live Fabric REST pull — workspaces, notebooks, lakehouse table/column schemas.
3. Animate the estate→workspace drill as a true zoom-into-the-cluster (currently
   a crossfade).
4. Phase 2: the sandbox Spark + OpenLineage executor (separate 3.11/3.12 venv).
