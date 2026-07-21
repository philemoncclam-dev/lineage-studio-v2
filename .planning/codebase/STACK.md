# Technology Stack

**Analysis Date:** 2026-07-20

## Languages

**Primary:**
- TypeScript ~6.0.2 - Frontend React application
- Python 3.12.7 - Backend FastAPI application

**Secondary:**
- JavaScript/JSX - React component syntax (transpiled via TypeScript)
- PySpark 3.5.4 (commented in requirements.txt for Phase 2 sandbox executor)

## Runtime

**Environment:**
- Node.js (no specific version pinned; Vite 8.x compatible)
- Python 3.12.7 (specified in `render.yaml` for Render deployment)

**Package Manager:**
- npm - Frontend
- pip - Backend

**Lockfile:**
- `frontend/package-lock.json` or similar (npm standard)
- `backend/requirements.txt` - pinned versions, frozen by design

## Frameworks

**Core:**
- React 19.2.7 - Frontend UI framework with strict TypeScript
- FastAPI 0.115+ - Backend REST API framework with async support

**Visualization:**
- reactflow 11.11.4 - Interactive graph rendering (lineage DAG visualization)

**Build/Dev:**
- Vite 8.1.1 - Frontend build tool and dev server
- @vitejs/plugin-react 6.0.3 - Vite integration for React

**Testing:**
- pytest 8.3+ - Backend unit and integration tests
- No frontend test framework configured in this phase

**Linting:**
- oxlint 1.71.0 - Fast JavaScript/TypeScript linter (replaces ESLint)
- TypeScript compiler in strict mode - Serves as frontend type checker

## Key Dependencies

**Frontend:**
- react-dom 19.2.7 - React DOM rendering
- @types/react 19.2.17 - TypeScript definitions for React
- @types/react-dom 19.2.3 - TypeScript definitions for React DOM
- @types/node 24.13.2 - TypeScript Node.js definitions
- typescript 6.0.2 - TypeScript language

**Backend:**
- uvicorn[standard] 0.34+ - ASGI server for FastAPI
- pydantic 2.11+ - Data validation and serialization (ORM-like layer for API contracts)
- pydantic-settings 2.8+ - Environment variable management via `pydantic_settings.BaseSettings`
- python-multipart 0.0.20+ - Multipart form parsing for file uploads (definitions import)
- requests 2.32+ - HTTP client library for external API calls
- httpx 0.28+ - Async HTTP client (required by FastAPI test client)
- azure-identity 1.20+ - Azure AD authentication (`ClientSecretCredential` for Purview/Fabric)
- openpyxl 3.1+ - Excel file parsing for column definition imports

## Configuration

**Environment:**
- Frontend: Built-time `VITE_API_BASE` env var (defaults to `http://localhost:8000`)
  - Vite inlines this at build time into the bundle (not a runtime secret)
- Backend: `.env` file at repo root loaded via `pydantic-settings`
  - Configuration class: `Settings` in `backend/app/config.py`
  - Key vars:
    - `PURVIEW_ACCOUNT_NAME` - Microsoft Purview catalog name (optional, read-only mode without it)
    - `PURVIEW_TENANT_ID` - Azure AD tenant ID
    - `PURVIEW_CLIENT_ID` - Service principal app ID
    - `PURVIEW_CLIENT_SECRET` - Service principal secret
    - `PURVIEW_ALLOW_WRITE` - Boolean, default false (opt-in for lineage pushes)
    - `CORS_ORIGINS` - Comma-separated allowed browser origins (Vercel URL for deployed frontend)
    - `PYTHON_VERSION` - Pinned to 3.12.7 in Render deployment

**Build:**
- Frontend: `vite.config.ts` - Minimal config, uses React plugin
- Frontend TypeScript: `tsconfig.json` (references `tsconfig.app.json` and `tsconfig.node.json`)
  - Target: ES2023
  - Strict mode enabled (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`)
  - JSX preset: `react-jsx` (automatic JSX transform via React 17+)
- Backend: No `pyproject.toml` or build config; simple pip-based deployment

## Platform Requirements

**Development:**
- Node.js 16+ (Vite 8 requirement)
- Python 3.12.7 (or 3.11 for Phase 2 PySpark sandbox)
- Git (for version control)
- `.env` file with Azure credentials for Purview/Fabric integration

**Production:**
- Deployment targets specified:
  - Backend: Render (Python ASGI runtime)
  - Frontend: Vercel (Node.js/static hosting)
  - Both: CORS bridge via configurable `allowed_origins` (Render backend holds credentials)

**Phase 2 (Future):**
- Separate Python 3.11/3.12 virtual environment for PySpark sandbox
- PySpark 3.5.4
- OpenLineage integration packages (for execution lineage capture)

---

*Stack analysis: 2026-07-20*
