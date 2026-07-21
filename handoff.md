# Handoff — Lineage Studio v2

_Last updated: 2026-07-21 — as of commit 0e1bf0d (+ uncommitted Purview work)_

## Where things stand

Added a **Microsoft Purview ingest path** as a second source feeding the same
`LineageGraph` contract, alongside the existing notebook parser. It reads live
from the user's Unified Catalog account `Phil-purview-dev` and works end to end:
12 nodes with correct containment and real column lists.

Ported selectively from MarcoOesterlin/Microsoft-Purview-Unified-Catalog (MIT).
That repo was cloned to a **scratch dir outside this repo**, not vendored in —
only patterns were carried over, not files.

## In flight / next step

**The catalog has zero lineage edges.** Purview knows all 12 assets but nothing
about how they connect, so `/purview/graph` renders as disconnected nodes.

Next step: fetch notebook code from Fabric, run it through the existing
`app/parser.py`, and merge those derived edges into the Purview graph. The three
notebooks (`00_seed_sources`, `Notebook_1build_customer_ltv`, `Test`) are what
connect `raw_orders`/`raw_customers` to the views. This is also the prerequisite
for the push path, since those derived edges are what we would write back.

## Uncommitted work

Everything below is being committed now:

```
 M .gitignore              secret rules, incl. .env.* for the Windows .txt trap
 M backend/app/main.py     + /purview/graph, /purview/status
 M backend/requirements.txt  pydantic-settings, azure-identity, requests
?? .env.example           tracked template
?? .mcp.json              Fabric MCP server (empty env, no secrets)
?? backend/app/config.py  pydantic Settings
?? backend/app/purview/   client.py + ingest.py
```

`.env` and `.env.txt` hold real credentials and are gitignored — verified with
`git check-ignore`. **`.env.txt` is a leftover duplicate that should be deleted**
(it was caught one `git add -A` away from being committed, because `*.env` does
not match `.env.txt`).

## Decisions & dead ends

- **Read Purview, don't clone it.** Their repo is 11 projects / ~11.6k lines of
  governance-ops tooling (bulk tagging, deletion, PII labels, a Chrome
  extension). Only `create_lineage.py` and `get_data.py` overlap our problem.
  Curation/deletion surfaces were deliberately skipped — we are a lineage
  visualizer, not a Purview admin console.
- **Skipped `analyze_lineage_with_fabric_agent`** (~640 lines): it is an Azure
  AI Foundry agent inferring lineage via LLM, needing a whole Foundry
  deployment. Different approach from both our Phase 1 (static parse) and
  Phase 2 (Spark plans).
- **azure-identity over their hand-rolled tokens.** Upstream uses the legacy v1
  `oauth2/token` endpoint with `resource=`; we use `get_token` with the v2 scope
  `https://purview.azure.net/.default`, which caches and refreshes, so their
  manual token-renewal loops were not ported.
- **Unified Catalog turned out not to complicate things.** Governance domains
  and data products sit *above* the data map, but lineage and column schema are
  still read/written through the data map API — so `/datamap/api` is the only
  surface used.
- **Node ids are Purview GUIDs**, so the push path can map a node back to its
  entity without a second lookup.

## Gotchas still live

- **Search returns 0 instead of 403** when the service principal lacks a
  collection role. An empty catalog and a permissions failure look identical.
  Typedefs (`/atlas/v2/types/typedefs/headers`) read fine without a collection
  role, so they are a good way to tell auth from authorization.
- **`.env` lives at repo root but the backend runs from `backend/`** —
  `config.py` resolves it absolutely via `_REPO_ROOT`. A relative `env_file`
  silently yields "not configured".
- **`LH_Sales` is scanned twice**, as both `fabric_lakehouse` and
  `fabric_lake_warehouse`. `ingest.py` dedupes on the Fabric GUID.
- **Warehouse views have no columns and parent to the workspace**, not to a
  warehouse — their qualified names carry no container GUID like lakehouse
  tables do. Not yet investigated.
- **The two new endpoints are written but never exercised over HTTP** — the
  `TestClient` run was skipped (needs `httpx`). `build_graph_from_purview()`
  itself was verified directly against the live catalog.
- Client ID and tenant ID are both GUIDs on adjacent portal lines and were
  pasted identically once; symptom is `AADSTS700016`.

## Commands

```bash
# backend → http://localhost:8000
cd backend
.venv/Scripts/uvicorn app.main:app --reload

# frontend → http://localhost:5173
cd frontend && npm run dev
```

Purview endpoints: `GET /purview/status` (configured/write_enabled),
`GET /purview/graph` (build from live catalog).
