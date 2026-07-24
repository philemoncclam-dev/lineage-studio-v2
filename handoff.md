# Handoff — Lineage Studio v2

_Last updated: 2026-07-24 — as of commit 0b2037b (master, pushed)_

## Where things stand

Big session: replaced the dead **Purview** and **Lineage** modes with a new
**Fabric Toolkit** mode, and built the notebook **sandbox** all the way to real
Spark execution. The whole arc works locally, verified live against the tenant:
**Explore workspace → open a notebook in Sandbox → Run (real local Spark) →
column-level lineage → one-click column-level authored model.** Backend 131
pytest green, frontend 66 tests + `tsc` clean. Tree is level with origin/master.

## The Fabric Toolkit (new mode, replaces Purview + Lineage)

- Modes are now: **Graph · Modeling · Fabric Toolkit · Data Products** (see
  `frontend/src/shell/railConfig.ts`). Fabric rail = **Explore · Sandbox ·
  Definitions** (Definitions rescued from the old Purview mode).
- **Explore** (`routes/fabric/explore.tsx`) — lazy tree over new read-only
  `/fabric/*` endpoints (`backend/app/fabric/router.py`): workspaces → folders +
  notebooks + lakehouses → tables. Rows have "open in Fabric ↗"; notebooks open
  in Sandbox. Schema-enabled lakehouses' tables are listed via **OneLake**
  (`client.list_lakehouse_tables_onelake`) because the REST tables endpoint 400s
  on them.
- Graph/command-palette "open lineage" now resolve in-place as a graph selection
  (the old Lineage DAG is deleted).

## The sandbox (M2a stub → M2b real Spark)

- **Contract** `backend/app/sandbox/protocol.py` (RunRequest/RunResult +
  ColumnFlow) is the stable seam; frontend/router speak only it.
- **Isolation is real**: the executor is a **standalone child process**
  (`child_stub.py` / `child_spark.py`) launched by path in a throwaway cwd with a
  **scrubbed env** — no `PURVIEW_*`/`AZURE_*` reachable. Tested by setting a
  secret in the parent and asserting the child can't see it.
- **Engine = plan capture, not execution.** On this stack (PySpark 4 / Py3.12 /
  Windows) any Spark *action* crashes the Python worker, but the **analyzed
  logical plan** resolves fine. So `child_spark.py` runs the notebook's
  DataFrame/SQL (building plans), registers empty temp views from real schemas,
  and **intercepts writes** (`saveAsTable`/`insertInto`/SQL CTAS) to capture the
  plan + output schema + **column-level lineage** — no action ever runs.
- **Input schemas** come from OneLake Delta logs (`backend/app/fabric/schema.py`)
  — static-scan reads, map name→lakehouse dir, read `_delta_log` commits
  newest-first for the `metaData.schemaString`.
- **`sandboxRunToGraph.ts`** turns a run into a LineageGraph with column maps on
  the write edges, then reuses `adapt → graphToModel → saveNew` → **column-level
  authored model** ("Create model from this run").

## In flight / next step

Nothing half-written. The open thread is **hosting the backend online** (user
asked; Vercel can't run Spark). Decision landed on **Google Cloud Run**, and the
**Dockerfile is done** (repo root: Py3.12 + Java 17 + PySpark 4.0; runner now
also detects Spark via `importlib.find_spec` in-container). **Not yet built**
(no Docker on this machine) and **not deployed**. Next action if resumed: the
Cloud Run deploy itself — `gcloud run deploy --source .` with `--memory 4Gi`,
`--no-allow-unauthenticated`, secrets as env — then set Vercel `VITE_API_BASE`
to the Cloud Run URL and add that origin to `CORS_ORIGINS`.

## Uncommitted work

Clean — everything pushed through 0b2037b.

## Gotchas still live

- **The Spark sandbox only runs where the pinned venv is** (`sandbox/.venv312`,
  gitignored, this machine) **or in the container**. Everywhere else (deployed
  Vercel, any backend without it) the runner falls back to the **stub** engine →
  the model comes out **tables-only, no columns**. The run banner shows
  `engine: spark` vs `stub` — that's the diagnostic. This is why "port to model"
  looked table-only online: the deployed site has no Spark backend.
- **`--reload` leaves a stale worker holding :8000**, so edits look like they
  didn't land (cost real time twice this session). Run uvicorn **without
  `--reload`** for clean restarts; kill via PowerShell `Stop-Process` by port.
- **`gold_customer_ltv`** (the aggregated write in the live test notebook) came
  back with **no captured schema/column-lineage** — its write form or an
  aggregation plan didn't capture. Silver (join) captured fully. Worth chasing if
  every write must be typed.
- Column matching is **by name, first-lakehouse-wins**; post-join same-named
  columns attribute to the first read table that has them.
- Env passthrough to the Spark child now also keeps `JAVA_HOME/SPARK_HOME/HOME`
  (needed in the Linux container).

## Verified live this session (real tenant, ws 03e777db…)

- Explore lists `SalesLakehouse-P-S (TEST)` → `LH_Sales` (schema-enabled) tables.
- Sandbox run of `Notebook_1build_customer_ltv`: `engine=spark`, reads
  `raw_customers`+`raw_orders` (schemas from OneLake), writes
  `silver_orders_enriched`+`gold_customer_ltv`, real joined output schema, 7
  column flows into silver, `saw_credentials=false`, no cell errors.

## Env facts for next session

- Local `py`: 3.14 + 3.13; **Python 3.12.10 installed** this session (winget) for
  the sandbox venv. **Java 21** on PATH. PySpark **4.0.0** in `sandbox/.venv312`.
- Backend run: `cd backend && .venv/Scripts/uvicorn app.main:app --port 8000`
  (no `--reload`). Frontend: `cd frontend && npm run dev`.
- Deferred: OpenLineage column mapping (we roll our own from the plan);
  `gold_customer_ltv` schema gap; deploy.
