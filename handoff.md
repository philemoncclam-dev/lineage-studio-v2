# Handoff — Lineage Studio v2

_Last updated: 2026-07-20 — as of commit 2f6301b (master, pushed, tree clean)_

## Where things stand

The zero-edges gap is closed. Notebook source is fetched from Fabric, parsed to
edges, and pushed to Purview; `/purview/graph` now returns real lineage
(`00_seed_sources → raw_orders/raw_customers → Notebook_1build_customer_ltv`).
All three write paths — lineage push, data-product cataloguing, column
definitions — are implemented, wired into the UI, and **verified against the
live catalog**. 95 tests pass; `npm run build` is clean.

Every mutation goes through `backend/app/purview/writer.py`. Dry run is the
default and builds the identical payload, so a preview cannot drift from the
real send. Transmitting needs both an explicit `apply` and
`PURVIEW_ALLOW_WRITE`.

## In flight / next step

**Nothing is half-written.** The next action is deployment, which is blocked
only on manual steps:

1. Render → New + → Blueprint → pick the repo (`render.yaml` is at the root and
   configures the service). Paste the four `PURVIEW_*` secrets.
2. Set `VITE_API_BASE=<render url>` in Vercel and **redeploy** — Vite inlines it
   at build time, so saving the variable alone does nothing.
3. Set `CORS_ORIGINS=<vercel url>` in Render.

**The UI has never been opened in a browser.** Every endpoint behind it is
proven live and it type-checks, but layout and interaction are unverified.
`npm run dev` before trusting it.

## Uncommitted work

Clean. `master` is pushed and matches `origin/master`.

Local tag `backup-before-rewrite` (30583eb) holds the pre-author-rewrite
commits; never pushed, safe to delete.

## Decisions & dead ends

- **The classic lineage endpoint cannot see API-pushed lineage.**
  `/atlas/v2/lineage/{guid}` reads a scan-populated index and stays empty
  forever — polled 90s+ after a confirmed write while the relationships were
  already ACTIVE. `/next` serves them immediately. This is the single most
  expensive thing to rediscover: a successful push looks like a silent no-op,
  and the obvious conclusion is a permissions problem that does not exist.
- **No synthetic process entities.** `fabric_synapse_notebook` already inherits
  `Process` with empty `inputs`/`outputs`, so a push *updates the notebook*.
  One node in the UI, and a re-scan updates rather than racing a duplicate.
- **Unified Catalog swagger is wrong in four places**, each found by being
  refused, all now encoded in `dataproduct.py`: `contacts` is required; status
  is Title case; onboarding needs `name`/`type` with `type` limited to
  ADLSGen2Path/AzureSqlTable/General; and **the service assigns its own product
  id and ignores the one we send** — linking against the proposed id 404s with
  "does not exist" even though the product was created. That last one reads
  exactly like a permissions failure and is not.
- **Reached the governance plane without touching `client.py`** by escaping the
  `/datamap/api` base with a relative prefix (`/../../datagovernance/catalog`).
  Slightly cheeky, but it keeps the single-write-chokepoint rule intact.
- **Purview account name ≠ app registration.** `Phil-purview-dev` is the
  account; the app is `Lineage-Studio-Dev-2`
  (app `da314ac2-…`, SP object `187b5830-…`). Searching workspace access for the
  account name finds nothing.
- Parallel subagents were partitioned by file ownership, with `main.py`,
  `writer.py`, `ingest.py`, `client.py` reserved for the orchestrator. Agents
  returned router objects instead of editing `main.py`. Worked well; the UI
  ended up two features behind because they were told not to touch `frontend/`.

## Gotchas still live

- **Empty means "no permission" in three different places.** Purview search
  returns 0 instead of 403 without a collection role; Fabric `GET /v1/workspaces`
  returns `200 {"value":[]}`; and `get_next_lineage` 404s for an entity with no
  lineage. Never read emptiness as "configured correctly, nothing there."
- **`uvicorn` has no `--reload` in the run commands here.** Two separate
  debugging detours came from testing edits against a stale server; `pkill -f`
  does not reach it on Windows — use `Stop-Process`.
- **`/tmp` in the Bash tool is not visible to Windows Python.** Use the
  scratchpad path for files handed between the two.
- Column data types are spelled `dataType` on lakehouse table columns and
  `data_type` on tabular_schema columns; view columns hang off a separate
  `tabular_schema` entity; the container path segment is `lakewarehouses`.
- A lakehouse and its SQL endpoint share a display name but are distinct GUIDs.
  The endpoint is suffixed `(SQL endpoint)` in the UI so the graph does not show
  two identical nodes.
- **Live artefacts left behind, safe to delete:** data product
  `LineageStudio Verified Product` (403422d3-…) with two linked assets, and
  `raw_orders.order_date` carries a test `userDescription`.

## Blocked on grants

- `Dataproduct-P-S` workspace lacks the Contributor grant for the SP, so the
  `Test` notebook cannot be read. `SalesLakehouse-P-S (TEST)` is done.
- `gold_customer_ltv` and `silver_orders_enriched` are derived by the parser but
  are not in Purview, so those two edges cannot push. Re-run the notebook and
  re-scan and they should land with no code change.

## Security posture

The backend has **no authentication of its own** and holds a service principal
that can write to the catalog. `render.yaml` therefore defaults to
`PURVIEW_ALLOW_WRITE=false`, and CORS is an allow-list rather than a wildcard.
Flip writes on deliberately, not by default, on any reachable URL.

## Commands

```bash
# backend → http://localhost:8000
cd backend && .venv/Scripts/uvicorn app.main:app --reload
.venv/Scripts/python.exe -m pytest -q          # 95 tests

# frontend → http://localhost:5173
cd frontend && npm run dev
npm run build                                   # tsc -b + vite build
```
