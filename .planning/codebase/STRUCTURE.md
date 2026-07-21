# Codebase Structure

**Analysis Date:** 2026-07-20

## Directory Layout

```
datalineage/
├── .claude/                          # GSD project configuration
│   └── skills/
│       └── lineage-studio-handoff/   # Handoff doc for work sessions
├── .planning/                        # GSD planning directory
│   └── codebase/                     # Architecture + structure docs
├── backend/                          # FastAPI server
│   ├── app/                          # Source code
│   │   ├── __init__.py
│   │   ├── main.py                   # FastAPI app, routes, CORS
│   │   ├── models.py                 # Pydantic schemas (shared contract)
│   │   ├── parser.py                 # Phase 1 regex-based lineage extraction
│   │   ├── config.py                 # Environment config loader
│   │   ├── sample.py                 # Built-in demo dataset
│   │   ├── fabric/                   # Fabric REST API integration
│   │   │   ├── __init__.py
│   │   │   ├── client.py             # Authenticated HTTP session
│   │   │   └── notebooks.py          # Notebook definition fetcher
│   │   └── purview/                  # Purview (Unified Catalog) integration
│   │       ├── __init__.py
│   │       ├── client.py             # Authenticated HTTP session
│   │       ├── ingest.py             # Build LineageGraph from Purview search
│   │       ├── definitions.py        # Column definition matching + import
│   │       ├── lineage_push.py       # Push lineage back to Purview
│   │       ├── dataproduct.py        # Data product cataloging
│   │       ├── actions.py            # FastAPI router for Purview actions
│   │       └── writer.py             # Orchestrate Purview write operations
│   ├── tests/                        # Test suite
│   │   ├── conftest.py               # Pytest fixtures
│   │   ├── test_*.py                 # Unit/integration tests
│   │   └── __pycache__/
│   ├── requirements.txt              # Python dependencies
│   ├── .pytest_cache/
│   └── .venv/                        # Virtual environment (not committed)
├── frontend/                         # React + TypeScript UI
│   ├── src/                          # Source code
│   │   ├── main.tsx                  # Vite + React entry point
│   │   ├── App.tsx                   # Root component
│   │   ├── App.css                   # App styling
│   │   ├── index.css                 # Global styles
│   │   ├── api.ts                    # HTTP client, type mirrors of backend
│   │   ├── model.tsx                 # LineageGraph → AppModel adapter
│   │   ├── data.ts                   # Sample/demo data (offline fallback)
│   │   ├── assets/                   # Static images/SVGs
│   │   └── views/                    # View components
│   │       ├── LineageView.tsx       # Column-level lineage DAG renderer
│   │       ├── LineageView.css
│   │       ├── GraphView.tsx         # Knowledge graph with drill-down
│   │       ├── graph.css
│   │       ├── SearchPalette.tsx     # Cmd+K search across graph
│   │       ├── search.css
│   │       ├── PurviewPanel.tsx      # Purview write operations UI
│   │       ├── purview.css
│   │       ├── DefinitionsImport.tsx # Column definition spreadsheet importer
│   │       └── definitions.css
│   ├── public/                       # Static files served at root
│   ├── dist/                         # Built output (not committed)
│   │   └── assets/                   # Vite-chunked JS/CSS
│   ├── package.json                  # Dependencies, build scripts
│   ├── tsconfig.json                 # TypeScript config
│   ├── vite.config.ts                # Vite build config
│   └── node_modules/                 # Installed packages (not committed)
├── .env                              # Local credentials (not committed, see .env.example)
├── .env.example                      # Template for required env vars
├── .gitignore                        # Git exclusions
├── CLAUDE.md                         # Project vision + conventions
├── README.md                         # Quick start guide
├── handoff.md                        # Work session handoff (auto-updated)
├── render.yaml                       # Render.com deployment config
└── .mcp.json                         # MCP server config
```

## Directory Purposes

**`.claude/`:**
- Purpose: GSD project configuration and skills.
- Contains: Lineage Studio handoff skill for work session management.
- Key files: `skills/lineage-studio-handoff/SKILL.md`.

**`.planning/`:**
- Purpose: Orchestrator output directory for codebase analysis and phase planning.
- Contains: Architecture/structure/concerns/testing documents for other GSD commands to consume.
- Key files: `codebase/ARCHITECTURE.md`, `codebase/STRUCTURE.md`, etc.

**`backend/app/`:**
- Purpose: FastAPI server source code.
- Contains: Route handlers, data models, parsing logic, integration with Purview and Fabric.
- Key files: `main.py` (entry point), `models.py` (contract), `parser.py` (Phase 1 extraction).

**`backend/app/purview/`:**
- Purpose: Purview data-map integration — read and write lineage.
- Contains: Authenticated client, entity search, definition import, lineage push.
- Key files: `client.py` (HTTP wrapper), `ingest.py` (search → LineageGraph), `definitions.py` (column matching).

**`backend/app/fabric/`:**
- Purpose: Fabric REST API integration — fetch notebook source, resolve workspace/item GUIDs.
- Contains: Authenticated client, notebook definition fetcher.
- Key files: `client.py` (HTTP wrapper), `notebooks.py` (definition decoder).

**`backend/tests/`:**
- Purpose: Test suite for backend modules.
- Contains: Pytest unit and integration tests, fixtures, mocks.
- Key files: `conftest.py` (fixtures), `test_*.py` (test modules).

**`frontend/src/`:**
- Purpose: React component source code.
- Contains: Main app, views (Lineage/Graph/Search/Purview), styling, HTTP client.
- Key files: `App.tsx` (root), `model.tsx` (adapter), `api.ts` (HTTP client).

**`frontend/src/views/`:**
- Purpose: Specialized view components.
- Contains: LineageView (column-level DAG), GraphView (knowledge graph), SearchPalette, PurviewPanel, DefinitionsImport.
- Each has a matching `.css` file for styling.

## Key File Locations

**Entry Points:**

- `frontend/src/main.tsx`: Vite entry point — mounts React app to `#root` div in `public/index.html`.
- `frontend/src/App.tsx`: React root component — initializes state, renders toolbar + views.
- `backend/app/main.py`: FastAPI app definition — routes, middleware, in-memory graph store.

**Configuration:**

- `backend/app/config.py`: Pydantic Settings; loads `.env`, validates credentials, computes derived properties.
- `frontend/vite.config.ts`: Vite build config (React plugin, dev server settings).
- `backend/requirements.txt`: Python dependencies (FastAPI, Azure SDK, Purview/Fabric clients).
- `frontend/package.json`: Node dependencies (React, Vite, Reactflow).

**Core Logic:**

- `backend/app/models.py`: LineageGraph, Node, Edge, ColumnMap — universal data contract.
- `backend/app/parser.py`: Regex-based extraction of table lineage from notebook code.
- `frontend/src/model.tsx`: Adapts LineageGraph → AppModel (adds layout, levels, colors).
- `frontend/src/api.ts`: HTTP client functions (fetch graph, ingest, Purview operations).

**Testing:**

- `backend/tests/conftest.py`: Pytest fixtures (mock Purview/Fabric clients, sample data).
- `backend/tests/test_*.py`: Test modules (API, parser, Purview integration, config).

**Documentation:**

- `CLAUDE.md`: Project vision, phases, conventions.
- `handoff.md`: Work session summary (auto-updated by lineage-studio-handoff skill).
- `.env.example`: Template for required environment variables.

## Naming Conventions

**Files:**

- Python modules: `lowercase_with_underscores.py` (e.g., `parser.py`, `client.py`).
- React components: `PascalCase.tsx` (e.g., `App.tsx`, `LineageView.tsx`).
- Stylesheets: `lowercase_matching_component.css` (e.g., `LineageView.css` pairs with `LineageView.tsx`).
- Utility/data: `camelCase.ts` (e.g., `api.ts`, `model.tsx`, `data.ts`).

**Directories:**

- Feature/module directories: `lowercase` (e.g., `backend/app/purview`, `frontend/src/views`).
- Nested feature: Colocate related files in a directory (e.g., `purview/client.py` + `purview/ingest.py`).

**Python Functions & Classes:**

- Classes: `PascalCase` (e.g., `PurviewClient`, `LineageGraph`).
- Functions: `snake_case` (e.g., `build_graph()`, `parse_notebook()`).
- Private functions: Prefix with `_` (e.g., `_find()`, `_column_maps()`).

**React Components & Functions:**

- Components: `PascalCase` (e.g., `LineageView`, `SearchPalette`).
- Hooks: Start with `use` (e.g., `useModel()`).
- Handler callbacks: Prefix with `on` (e.g., `onOpenLineage()`, `onResult()`).
- State variables: `camelCase` (e.g., `focusTable`, `searchOpen`).

**Backend Route Paths:**

- GET for reads: `/graph`, `/purview/graph`, `/purview/status`.
- POST for writes: `/ingest`, `/purview/lineage/push`, `/purview/definitions/apply`.
- Nested paths for domains: `/purview/domains`, `/purview/dataproducts`.

**Frontend Type Definitions:**

- Data models (mirrors backend): `interface LineageGraph { nodes: LineageNode[] ... }`.
- Internal types: `type Mode = 'lineage' | 'graph'`.
- Component props: `interface Props { focusTable?: string ... }`.

## Where to Add New Code

**New Feature (Full Stack):**

- Backend API route: Add to `backend/app/main.py` or a new router in `backend/app/purview/` or `backend/app/fabric/`.
- Backend model: Add Pydantic schema to `backend/app/models.py` or `backend/app/purview/definitions.py` if Purview-specific.
- Frontend API call: Add function to `frontend/src/api.ts` mirroring the route.
- Frontend component: Add to `frontend/src/views/` or create new view if major.
- Styling: Colocate `.css` file with component in `frontend/src/views/ComponentName.css`.

**New Parsing Logic (Phase 2 Spark Executor):**

- Create `backend/app/spark/` directory with:
  - `backend/app/spark/sandbox.py` — SparkSession setup, OpenLineage listener.
  - `backend/app/spark/executor.py` — Execute notebook cells, intercept I/O.
- Modify `backend/app/parser.py` to conditionally call Spark path (or create a new `build_graph()` variant).
- Keep `LineageGraph` output shape identical so frontend sees no change.

**New Test:**

- Unit tests: `backend/tests/test_module_name.py` (mirrors module path).
- Fixtures: Add to `backend/tests/conftest.py` if reusable across tests.
- Mocks: Use `unittest.mock.patch` or create mock classes in test files.

**New View (UI Feature):**

- Component: `frontend/src/views/NewViewName.tsx`.
- Styling: `frontend/src/views/newViewName.css`.
- State management: Lift to `App.tsx` if shared with other views; keep local if isolated.
- Integration: Import in `App.tsx`, conditionally render or route via `mode` state.

**Utilities & Helpers:**

- Shared Python utilities: `backend/app/util.py` or domain-specific file (e.g., `backend/app/purview/util.py`).
- Shared React utilities: `frontend/src/util.ts` or domain-specific file.
- Regex patterns: Keep in module where used (e.g., `backend/app/parser.py` has `_READ_PATTERNS`, `_WRITE_PATTERNS`).

## Special Directories

**`backend/.venv/`:**
- Purpose: Python virtual environment.
- Generated: Yes (run `py -m venv .venv` to create).
- Committed: No (excluded by `.gitignore`).

**`frontend/node_modules/`:**
- Purpose: Installed Node packages.
- Generated: Yes (run `npm install` to create).
- Committed: No (excluded by `.gitignore`).

**`frontend/dist/`:**
- Purpose: Built production bundle (Vite output).
- Generated: Yes (run `npm run build` to create).
- Committed: No (excluded by `.gitignore`).

**`backend/.pytest_cache/`:**
- Purpose: Pytest cache for test collection speed-up.
- Generated: Yes (created by pytest automatically).
- Committed: No (excluded by `.gitignore`).

**`.env` (local secrets):**
- Purpose: Development credentials (Purview, Fabric service principal, etc.).
- Generated: Manual (copy from `.env.example`, fill in secrets).
- Committed: No (excluded by `.gitignore`; never commit secrets).

**`.planning/codebase/`:**
- Purpose: Generated codebase analysis documents (ARCHITECTURE.md, STRUCTURE.md, CONCERNS.md, etc.).
- Generated: Yes (by GSD mapper, `/gsd-map-codebase`).
- Committed: Yes (reference docs for planning/execution).

---

*Structure analysis: 2026-07-20*
