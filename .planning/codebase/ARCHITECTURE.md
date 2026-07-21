<!-- refreshed: 2026-07-20 -->
# Architecture

**Analysis Date:** 2026-07-20

## System Overview

Lineage Studio is a full-stack web application that visualizes data lineage across Microsoft Fabric. It ingests lineage metadata from Fabric workspaces, lakehouses, tables, and notebooks, and renders it as an interactive graph with multiple view modes.

```text
┌────────────────────────────────────────────────────────────────────┐
│                      Frontend (React + TS)                          │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐   │
│  │  LineageView    │  │   GraphView      │  │  SearchPalette  │   │
│  │  (Column-level) │  │  (Knowledge Graph)   │  PurviewPanel   │   │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬────────┘   │
│           │                    │                      │             │
│           └────────────────────┴──────────────────────┘             │
│                            │                                        │
│           ┌────────────────┴────────────────┐                      │
│           ▼                                 ▼                       │
│    ┌─────────────────┐            ┌──────────────────┐             │
│    │  App.tsx        │            │  model.tsx       │             │
│    │  (Container)    │            │  (Data adapter)  │             │
│    └────────┬────────┘            └────────┬─────────┘             │
│             │                              │                       │
│             └──────────────────┬───────────┘                       │
│                                ▼                                    │
│                        ┌──────────────────┐                        │
│                        │  api.ts          │                        │
│                        │  (HTTP client)   │                        │
│                        └────────┬─────────┘                        │
└─────────────────────────────────┼──────────────────────────────────┘
                                  │
                   HTTP / JSON (LineageGraph)
                                  │
┌─────────────────────────────────▼──────────────────────────────────┐
│                   Backend (FastAPI + Python)                        │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  main.py: FastAPI app, CORS, routers                        │   │
│  │  - GET  /sample          → build_graph(SAMPLE)              │   │
│  │  - POST /ingest          → build_graph(IngestRequest)       │   │
│  │  - GET  /graph           → last built graph                 │   │
│  │  - GET  /purview/status  → configuration state              │   │
│  │  - GET  /purview/graph   → build_graph_from_purview()       │   │
│  └──────────────┬──────────────────────────┬────────────────────┘   │
│                 │                          │                        │
│     ┌───────────┴──────────┐    ┌──────────┴──────────┐             │
│     ▼                      ▼    ▼                     ▼              │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌────────────────────┐   │
│  │parser.py│  │models.py │  │config.py│  │purview/* fabric/*  │   │
│  │(Extract)│  │(Contract)│  │(Env)    │  │(Integration)       │   │
│  └─────────┘  └──────────┘  └─────────┘  └────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  purview/: Unified Catalog read/write paths                 │   │
│  │  - client.py      → authenticated HTTP wrapper              │   │
│  │  - ingest.py      → build LineageGraph from Purview search  │   │
│  │  - definitions.py → column definition matching + ingestion  │   │
│  │  - lineage_push.py → push lineage back to Purview           │   │
│  │  - writer.py      → orchestrate write operations            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  fabric/: Fabric REST API client (Phase 2 preparation)      │   │
│  │  - client.py      → authenticated HTTP wrapper              │   │
│  │  - notebooks.py   → parse notebook code from Fabric API     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  sample.py: Built-in demo data (fallback when backend down)         │
└──────────────────────┬───────────────────────┬──────────────────────┘
                       │                       │
                ┌──────▼───────────────────────▼──────┐
                │  Azure Services                      │
                │  - Azure AD (ClientSecretCredential) │
                │  - Purview Data Map REST API         │
                │  - Fabric REST API                   │
                └──────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **App** | Main React container, view mode toggle, search/Purview panel management | `frontend/src/App.tsx` |
| **LineageView** | Column-level lineage rendering with column edges and transforms | `frontend/src/views/LineageView.tsx` |
| **GraphView** | Knowledge graph drill-down (Estate → Workspace → Lakehouse → Table) | `frontend/src/views/GraphView.tsx` |
| **SearchPalette** | Cmd+K search across tables, columns, and notebook code | `frontend/src/views/SearchPalette.tsx` |
| **PurviewPanel** | UI for Purview-backed operations (definitions import, lineage push, data products) | `frontend/src/views/PurviewPanel.tsx` |
| **DefinitionsImport** | Column definition matching + spreadsheet upload workflow | `frontend/src/views/DefinitionsImport.tsx` |
| **model.tsx** | Adapts backend LineageGraph → frontend AppModel (layout, colors, levels) | `frontend/src/model.tsx` |
| **api.ts** | HTTP client wrapper, mirrors backend type contracts | `frontend/src/api.ts` |
| **FastAPI main** | Route handlers, CORS middleware, in-memory graph store | `backend/app/main.py` |
| **parser.py** | Static regex-based extraction of table reads/writes from notebook code | `backend/app/parser.py` |
| **models.py** | Pydantic schemas: LineageGraph, Node, Edge, ColumnMap (frontend/backend contract) | `backend/app/models.py` |
| **config.py** | Environment config loader, credential validation, CORS allowlist | `backend/app/config.py` |
| **purview/client.py** | Authenticated HTTP session for Purview data-map API | `backend/app/purview/client.py` |
| **purview/ingest.py** | Search Purview, parse Fabric metadata, build LineageGraph | `backend/app/purview/ingest.py` |
| **purview/definitions.py** | Match spreadsheet column definitions to Purview columns via fuzzy search | `backend/app/purview/definitions.py` |
| **purview/lineage_push.py** | Push discovered lineage back into Purview (Phase 2) | `backend/app/purview/lineage_push.py` |
| **fabric/client.py** | Authenticated HTTP session for Fabric REST API | `backend/app/fabric/client.py` |
| **fabric/notebooks.py** | Fetch notebook definitions from Fabric, parse cell code | `backend/app/fabric/notebooks.py` |

## Pattern Overview

**Overall:** Full-stack, layered architecture with a stable data contract (LineageGraph) at the center.

**Key Characteristics:**
- **Phase 1 focus:** Static extraction + manual ingestion. Lineage edges come from regex parsing of notebook code or Purview metadata reads.
- **Phase 2 swappable:** The Phase 1 `parser.build_graph()` output shape is identical to Phase 2's execution-derived shape, so the frontend sees no difference when the extraction engine is swapped.
- **Presentation independence:** Frontend views (Lineage DAG vs. Knowledge Graph) are separate concerns; both read from the same AppModel derived from a single LineageGraph.
- **Graceful degradation:** When Fabric/Purview is unreachable, the app falls back to a bundled sample dataset; Purview UI elements are conditionally shown based on credential availability.

## Layers

**Frontend Layer (React + TypeScript):**
- Purpose: Render interactive lineage visualizations; manage view state and search.
- Location: `frontend/src/`
- Contains: View components (`.tsx`), styling (`.css`), API client (`api.ts`), data adapter (`model.tsx`).
- Depends on: Backend API (HTTP), sample data fallback.
- Used by: Browser clients.

**Backend API Layer (FastAPI):**
- Purpose: Expose lineage data as REST endpoints; delegate ingest/integration work to lower layers.
- Location: `backend/app/main.py`
- Contains: Route handlers (GET /graph, POST /ingest, GET /purview/graph, etc.).
- Depends on: Lineage model (`models.py`), parser/extractors (`parser.py`, `purview/ingest.py`), configuration (`config.py`).
- Used by: Frontend, external tools.

**Lineage Extraction Layer:**
- Purpose: Convert raw inputs (notebook code, Purview metadata) into a normalized LineageGraph.
- Location: `backend/app/parser.py` (Phase 1), `backend/app/purview/ingest.py` (Purview search).
- Contains: Regex patterns, metadata parsing, node/edge construction.
- Depends on: LineageGraph model, Purview/Fabric clients.
- Used by: main.py route handlers.

**Integration Layer (Purview, Fabric):**
- Purpose: Authenticated communication with Azure services; metadata extraction.
- Location: `backend/app/purview/`, `backend/app/fabric/`.
- Contains: HTTP clients, entity mappers, definition importers, lineage writers.
- Depends on: Azure Identity, requests library.
- Used by: main.py, parser layer.

**Data Model Layer:**
- Purpose: Define contracts between frontend and backend, within backend modules.
- Location: `backend/app/models.py`, `frontend/src/api.ts`.
- Contains: Pydantic BaseModel (Node, Edge, LineageGraph) and TypeScript type mirrors.
- Depends on: Pydantic, Python typing.
- Used by: All layers (universal contract).

**Configuration Layer:**
- Purpose: Load and validate environment variables; expose credential state.
- Location: `backend/app/config.py`.
- Contains: Pydantic Settings class, credential checking, CORS allowlist.
- Depends on: pydantic_settings, pathlib.
- Used by: main.py, integration layer.

## Data Flow

### Primary Request Path: "Load from Purview"

1. User clicks "Load from Purview" in toolbar → `App.tsx` calls `fetchPurviewGraph()` (`frontend/src/api.ts:171`)
2. Frontend POSTs to `GET /purview/graph` → `main.py:78`
3. Backend calls `build_graph_from_purview()` → `backend/app/purview/ingest.py`
4. Purview ingest:
   - Uses `PurviewClient.search()` (`backend/app/purview/client.py:75`) to iterate all Fabric entities
   - Parses Fabric qualified names → workspace/lakehouse/table GUIDs
   - Constructs nodes (workspace, lakehouse, table, columns) and edges (reads/writes from Purview lineage)
   - Returns `LineageGraph`
5. `build_graph_from_purview()` returns `LineageGraph` → `main.py` stores it in `_last_graph`
6. Response JSON sent to frontend
7. Frontend calls `adapt(g)` in `model.tsx:50`:
   - Extracts nodes by kind (table, notebook, lakehouse, workspace)
   - Computes layered layout via depth-first longest-path traversal
   - Builds column edges and transform expressions
   - Constructs hierarchical levels for knowledge graph drill-down (Estate → Workspace → Lakehouse → Table → Lineage)
   - Returns `AppModel`
8. `setModel(adapted)` updates React state
9. View renders based on `mode`:
   - **LineageView** (`frontend/src/views/LineageView.tsx`): Draws tables with columns, column edges connecting upstream→downstream, notebook operations as intermediate nodes
   - **GraphView** (`frontend/src/views/GraphView.tsx`): Renders knowledge graph at current level (estate/workspace/lakehouse/table), allows drill-down via node links

### Secondary Path: Manual Ingest (JSON Upload)

1. User uploads JSON via `/ingest` endpoint → `main.py:56`
2. Backend parses `IngestRequest` (workspace, lakehouses, notebooks)
3. Calls `build_graph(req)` → `backend/app/parser.py:119`
4. Parser logic:
   - Creates workspace node
   - Adds lakehouse + table + column nodes from input metadata
   - For each notebook:
     - Parses cells with `parse_notebook()` (`backend/app/parser.py:92`)
     - Scans code for table reads (regex: `spark.table()`, `SELECT FROM`, etc.) and writes (`saveAsTable`, `INSERT INTO`, `CREATE TABLE`)
     - Extracts column derivations from `SELECT ... FROM` lists
     - Creates edges: `table → notebook` (reads), `notebook → table` (writes)
   - Infers placeholder nodes for referenced tables not in metadata
5. Returns `LineageGraph` → stored in `_last_graph`
6. Frontend receives JSON, adapts via `model.tsx`, renders same as Purview path

### Tertiary Path: Column Definition Import (Purview-backed)

1. User clicks "Write..." → `App.tsx` opens `PurviewPanel`
2. Panel shows UI for importing column definitions from spreadsheet (`DefinitionsImport.tsx`)
3. User uploads `.xlsx` file → `matchDefinitions()` call → `backend/app/purview/definitions.py`
4. Backend fuzzy-matches spreadsheet rows to Purview columns, returns proposals with confidence scores
5. User selects/overrides matches, clicks "Apply"
6. `applyDefinitions()` POSTs assignments → `backend/app/purview/definitions.py`
7. Backend writes selected column descriptions back to Purview (if `purview_allow_write=True`)

**State Management:**
- Backend: Single in-memory slot `_last_graph` (LineageGraph). Swapped on each ingest/purview-load.
- Frontend: React state in `App.tsx` (model, mode, focus, search/purview UI open flags) and view-local state (LineageView: expanded tables; GraphView: breadcrumb path).
- No global mutable state; all communication is HTTP + JSON.

## Key Abstractions

**LineageGraph:**
- Purpose: Universal container for lineage data, agnostic to extraction source.
- Examples: Used by manual ingest (parser.py), Purview read (purview/ingest.py), and (in Phase 2) Spark execution output.
- Pattern: Generic DAG — nodes are workspace/lakehouse/table/notebook/column; edges express reads/writes/derivations with optional column-level transformation maps.

**AppModel:**
- Purpose: Frontend-centric lineage with layout, styling, and hierarchical levels.
- Examples: In `model.tsx`, adapts LineageGraph → AppModel for rendering.
- Pattern: Tables and notebooks are pre-positioned via longest-path depth layout; levels enable multi-scale drill-down (Estate/Workspace/Lakehouse/Table).

**Level (in knowledge graph):**
- Purpose: Represent one zoom level of the graph hierarchy (Estate, Workspace, Lakehouse, Table).
- Examples: `levels['estate']` (all workspaces), `levels['ws:<guid>']` (workspaces' lakehouses), `levels['lake:<guid>']` (lakehouse's tables).
- Pattern: Each level has nodes (with labels, colors, sizes) and links (edges); drill path builds breadcrumb navigation.

**ColumnMap (transform expression):**
- Purpose: Record how a target column is derived from source columns.
- Examples: `ColumnMap(from_column='amount', to_column='total_amount', transform='SUM(amount)')`.
- Pattern: Phase 1 extracts simple cases from SELECT lists (aliases, function calls); Phase 2 will refine via Spark logical plans.

**Credentials & Configuration:**
- Purpose: Gate Purview/Fabric integration without blocking the core app.
- Examples: `Settings.purview_configured` → controls whether "Load from Purview" button is shown; `purview_allow_write` → blocks lineage push if False.
- Pattern: Environment-driven, loaded once at startup; absence is not an error (graceful degradation).

## Entry Points

**Frontend:**
- Location: `frontend/src/main.tsx`
- Triggers: Vite dev server or production build.
- Responsibilities: Mount React app to DOM, set up React 19 (no `root.render()`; implicit via `createRoot`).

**React App:**
- Location: `frontend/src/App.tsx`
- Triggers: After React mount.
- Responsibilities: Initialize state (fetch /graph, /purview/status), render toolbar + views, manage view mode and search/purview panel state.

**Backend API:**
- Location: `backend/app/main.py`
- Triggers: `uvicorn app.main:app --reload` or production server.
- Responsibilities: FastAPI app startup, CORS middleware, route registration (main + included routers from purview, fabric modules).

**Notebook Parsing (Phase 1):**
- Location: `backend/app/parser.py:parse_notebook()`
- Triggers: Called by `build_graph()` for each notebook in IngestRequest.
- Responsibilities: Regex extraction of table reads/writes, column derivation from SELECT statements.

**Purview Integration:**
- Location: `backend/app/purview/ingest.py:build_graph_from_purview()`
- Triggers: `GET /purview/graph` endpoint.
- Responsibilities: Search Purview for Fabric entities, map to LineageGraph nodes/edges.

## Architectural Constraints

- **Single graph in memory:** The backend stores only the last-built graph. No session isolation or historical versions. Works fine for single-user or low-concurrency scenarios; scale beyond that requires a database.
- **No circular imports:** Frontend views are self-contained components; model.tsx is a central adapter. Backend modules import upward (views → container, views → model/api, main → routers) but never downward.
- **CORS as credential boundary:** The API holds Purview service principal credentials; any origin allowed in CORS can spend them. Allowlist is explicit and opt-in; Vite dev server is always trusted.
- **Environment-driven credentials:** No UI login flow. Credentials come from `.env` only. Absence disables Purview but doesn't break the app.
- **No mutation of real Fabric tables:** Sandbox executor (Phase 2) will read Fabric/Purview but write only dry-run sinks. No actual data is ever created.

## Anti-Patterns

### Global State in Frontend

**What happens:** Candidate would be to use a global Redux/Zustand store for LineageGraph state, search results, etc.

**Why it's wrong:** React Context + useState in App.tsx is simpler for this single-window app. The graph is loaded once on mount and occasionally refreshed (Purview load). No real-time sync across tabs or complex time-travel debugging is needed.

**Do this instead:** Keep state in `App.tsx` (model, mode, focus) with Context for views to consume via `useModel()` hook. This is already done in `frontend/src/model.tsx` and `App.tsx`.

### Regexes for All Parsing

**What happens:** Phase 1 parser uses regex patterns to extract table names, columns, and transforms from notebook code.

**Why it's wrong:** Regexes are fragile and miss edge cases (subqueries, CTEs, complex expressions, macros). Production lineage needs execution-derived accuracy.

**Do this instead:** Phase 2 will replace regex output with Spark logical-plan listener (OpenLineage/Spline), keeping the `build_graph()` output shape identical so the frontend is unaffected. This is documented and in plan; regex is intentionally a Phase 1 approximation.

### Storing Purview GUIDs as Node IDs

**What happens:** Nodes are identified by their Purview GUID (stable, unique) in `purview/ingest.py`.

**Why it's wrong:** It couples the lineage model to Purview's ID scheme, making it harder to ingest from Fabric directly (where IDs are different).

**Do this instead:** Normalize all sources to a common ID scheme on ingest (e.g., `workspace.<ws-name>/lakehouse.<lh-name>/table.<table-name>`). This is a Phase 2 refactor noted in the codebase; Phase 1 keeps GUIDs for simplicity and to make the lineage-push path trivial (node → Purview entity is a lookup by GUID).

## Error Handling

**Strategy:** Fail fast with descriptive errors. HTTP errors are converted to HTTPException in main.py. Client errors (bad upload, failed Purview search) are caught and surfaced as UI messages.

**Patterns:**
- `PurviewError`, `FabricError` exceptions are raised by integration clients when credentials are missing or API calls fail.
- `main.py` catches `PurviewError` and converts to `HTTPException(status_code=503)` (unavailable).
- Frontend's `fetchPurviewGraph()` is wrapped in try/catch; errors become toast notifications.
- Missing/unconfigured credentials return an empty credentials message (not a 500); "Load from Purview" button is hidden on the UI.

## Cross-Cutting Concerns

**Logging:** No logging framework configured. Phase 1 uses print/stdout for debugging (local dev). Phase 2 should add structured logging (Python logging + frontend error tracking).

**Validation:** Pydantic models validate schema at API boundaries (POST /ingest, POST /purview/definitions/apply). No additional validation middleware.

**Authentication:** Azure AD service principal (ClientSecretCredential) for Purview/Fabric. No per-user auth; the service principal is shared. Credentials come from `.env` (dev) or deployment secrets (prod).

---

*Architecture analysis: 2026-07-20*
