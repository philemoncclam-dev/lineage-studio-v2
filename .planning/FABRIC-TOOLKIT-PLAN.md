# Plan: Fabric Toolkit — replace Purview & Lineage modes with an explore + sandbox surface

_Status: DRAFT — planning, no code yet. Author session: 2026-07-24._

## Why

Purview mode (Push / Definitions / Data-products-redirect) and Lineage mode are
dead weight now. Lineage is a thinner clone of Graph whose rail items are all
placeholders. Purview's Push is being retired; its Data-products item already
just redirects into the new Products section. The one screen worth keeping is
**Definitions import**.

In their place: a **Fabric mode** — a toolkit/sandbox for people who have real
Fabric access. Two capabilities:

1. **Explore** the real shape of a workspace: workspace → folders → notebooks +
   lakehouses → tables → **columns**, live from Fabric REST.
2. **Sandbox-run** a notebook to understand what it does — actually executing its
   PySpark/Spark SQL locally, but **never against real Fabric**: real table
   *schemas* with **empty data**, all writes intercepted as dry-run sinks, and
   the subprocess given **no Fabric credentials at all**.

This is CLAUDE.md's Phase 2, framed as a product surface.

## Locked decisions (from this session — do not relitigate)

- **Sandbox = full execution (L2b).** The notebook's code actually runs in a
  local Spark session, not just static/plan analysis.
- **Empty data, real schema.** Referenced tables are registered as empty temp
  views using the *correct* Fabric schema (metadata headers). We do not care
  about real row data; `count() == 0` is fine and expected. No sampling of real
  rows.
- **Explorer source = live Fabric REST.** Design against real `/fabric/*` list
  endpoints hitting the tenant. Empty response = "no permission" (never read as
  "empty workspace") per the handoff's standing trap.
- **Push to Purview is deleted.** Backend Purview *read* client stays (Products'
  domains still use it); only the write/push path and its UI go.

## Hard architectural facts (constraints that shape everything)

- **The Spark sandbox cannot run in-process.** Backend runs on local `py` 3.14;
  PySpark needs 3.11/3.12 + a JVM (Java 17). The sandbox is therefore a
  **separate subprocess** under a pinned venv (`sandbox/.venv311`); FastAPI
  shells out and reads back JSON. Isolation is a feature.
- **Safety is defense-in-depth; the strongest layer is the simplest.** The
  sandbox subprocess is handed **no Fabric/Azure credentials in its
  environment** — even if every shim were bypassed it cannot authenticate to
  Fabric, so it cannot write there. On top of that:
  - `notebookutils` / `mssparkutils` shimmed to no-ops (unavailable off-Fabric
    anyway).
  - `saveAsTable` / `insertInto` / Delta / `abfss://` writes redirected to a
    local temp warehouse (dry-run sinks). CLAUDE.md's "dry-run sinks only, ever"
    holds by construction.
- **"Full execution" still needs the input tables to exist.** Every table the
  notebook reads must be present in the session or the first action dies. Real
  schema + empty temp view satisfies this while moving zero real bytes.

## Run-button flow

1. Explorer pulls workspace shape + referenced table **schemas** (live REST).
2. Backend fetches notebook definition (reuse existing
   `fabric/notebooks.py::fetch_notebook_source`).
3. Backend spawns pinned Spark subprocess: cells + schemas + shimmed env +
   OpenLineage listener → file transport, **no creds**.
4. Subprocess registers empty views, runs cells in order, captures per-cell
   stdout/errors + OpenLineage events.
5. Backend parses OpenLineage events → `LineageGraph` (unchanged frontend
   contract) + a run log.
6. Frontend Sandbox view: run log (what each cell did) + derived lineage graph +
   errors.

## Milestones

### M1 — Explorer + mode surgery (no Spark; fully shippable alone)
- Frontend: delete `lineage` + `purview` from `ModeKey`, `railConfig`,
  `modeFromPathname`, `MODE_LANDING`, `MODE_LABEL`, `ModeMenu`; delete
  `routes/lineage/*`, `routes/purview/*`, `PurviewPanel.tsx`, and the
  `lineage-dag` view if unreferenced. Add `fabric` mode
  (`Explore · Sandbox · Definitions`). Rescue Definitions import under
  `/fabric/definitions`.
- Backend: new `/fabric/*` GET endpoints — list workspaces, list items
  (folders/notebooks/lakehouses), list lakehouse tables, fetch table schema.
  Extend `FabricClient` (today it only does `get_notebook_definition`). Empty =
  no-permission handling.
- Frontend Explore view: workspace → folder → notebook/lakehouse → table →
  column tree.
- **Delivers value on its own AND builds the schema-fetch the sandbox needs.**

### M2 — Sandbox harness (runs safely, no lineage yet)
- Pinned `sandbox/.venv311` (Python 3.11/3.12 + pyspark) + Java 17 detection
  with a clear "prereq missing" surface.
- Subprocess runner: shims (`notebookutils`, write redirects), empty temp views
  from M1 schemas, run cells sequentially, capture per-cell stdout/stderr.
- Frontend: Sandbox view with a Run button + streamed run log.
- **Proves the safety story before any lineage work.**

### M3 — Lineage capture
- OpenLineage Spark listener (`io.openlineage:openlineage-spark`) → file/HTTP
  transport → backend parser → `LineageGraph`.
- Sandbox run now produces a graph in the same contract the frontend already
  renders.

### M4 — Polish
- Definitions import fold-in refinements, run errors UX, freshness, empty/no-
  permission states.

## Open questions / to verify against the live tenant
- Exact Fabric REST shapes for listing lakehouse tables + column schema
  (verify against the account before coding — Fabric swagger has been wrong
  here before, per handoff).
- Whether the workspace items list distinguishes folders natively or we
  synthesize the folder tree from item paths.
- Java 17 availability on the dev machine (M2 prereq).
- OpenLineage vs Spline for the listener (leaning OpenLineage — current, emits
  column-level facets).
