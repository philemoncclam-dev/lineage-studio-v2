# External Integrations

**Analysis Date:** 2026-07-20

## APIs & External Services

**Microsoft Purview Data Map (Unified Catalog):**
- What: Live metadata catalog for Azure data assets (lakehouses, tables, columns)
- SDK/Client: Custom client in `backend/app/purview/client.py` using `requests` + `azure-identity`
- Auth: Azure AD ClientSecretCredential (v2 scope: `https://purview.azure.net/.default`)
- Endpoints:
  - `POST /datamap/api/search/query?api-version=2023-09-01` - Search entities with filtering
  - `GET /atlas/v2/entity/guid/{guid}` - Fetch entity with column relationships
  - `GET /atlas/v2/lineage/{guid}` - Read scan-populated lineage index
  - `GET /atlas/v2/lineage/{guid}/next` - Read API-pushed edges (live updates)
  - `POST /atlas/v2/entity` - Push lineage (gated by `PURVIEW_ALLOW_WRITE`)
- Implementation: `backend/app/purview/client.py` (PurviewClient class)

**Microsoft Fabric REST API:**
- What: Workspace, notebook, lakehouse, and table metadata
- SDK/Client: Custom client in `backend/app/fabric/client.py` using `requests` + `azure-identity`
- Auth: Azure AD ClientSecretCredential (v2 scope: `https://api.fabric.microsoft.com/.default`)
- Endpoints:
  - Notebook definition polling via asynchronous `getDefinition` operation
- Implementation: `backend/app/fabric/client.py` (FabricClient class)
- Note: Reuses Purview service principal; workspace access is a separate Azure grant

**Microsoft Graph API:**
- What: Service principal object ID lookup (needed for Purview data product ownership)
- SDK/Client: Direct `requests.Session` call in `backend/app/purview/client.py`
- Auth: Azure AD ClientSecretCredential (v2 scope: `https://graph.microsoft.com/.default`)
- Endpoint: `GET /v1.0/servicePrincipals?$filter=appId eq '...'&$select=id`
- Usage: Optional lookup; failures do not block writes (falls back to user-provided owner)

## Data Storage

**Databases:**
- None - Phase 1 uses in-memory store
  - Current: Last-built graph stored in module-level `_last_graph` variable in `backend/app/main.py`
  - Pattern: Intentionally trivial for Phase 1; swap for persistent DB when needed

**File Storage:**
- Local filesystem only (development)
  - Excel file uploads (`.xlsx`) parsed via openpyxl in `backend/app/purview/definitions.py`
  - No persistent file storage; definitions are processed and pushed to Purview only
- Cloud storage: Not used in Phase 1

**Caching:**
- In-memory token caching via `azure-identity` (automatic, built-in to `ClientSecretCredential`)
- No external cache service (Redis/Memcached)

## Authentication & Identity

**Auth Provider:**
- Azure AD (Entra ID) service principal authentication only
  - Implementation: `ClientSecretCredential` from `azure-identity` library
  - Configuration: Four env vars required (`PURVIEW_TENANT_ID`, `PURVIEW_CLIENT_ID`, `PURVIEW_CLIENT_SECRET`, `PURVIEW_ACCOUNT_NAME`)
  - Scopes: 
    - Purview: `https://purview.azure.net/.default`
    - Fabric: `https://api.fabric.microsoft.com/.default`
    - Graph (optional): `https://graph.microsoft.com/.default`

**Backend API:**
- No authentication of its own
  - CORS middleware limits which origins can call it
  - Guardians against credential misuse:
    - `PURVIEW_ALLOW_WRITE` defaults to false (read-only mode)
    - `allowed_origins` is a hardcoded allowlist, not a wildcard
    - Any origin permitted here can spend backend's Purview credentials on visitor's behalf

**Frontend:**
- No authentication
  - Communicates directly with backend API
  - Backend holds all Azure credentials; frontend never touches them

## Monitoring & Observability

**Error Tracking:**
- None - No Sentry, DataDog, or similar configured

**Logs:**
- Standard output via Uvicorn (FastAPI's default)
  - Backend: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - Render captures stdout automatically
- Frontend: Browser console (React dev server logs + network errors)

**Health Checks:**
- Liveness: `GET /health` endpoint returns `{"status": "ok"}`
  - Render monitors this via `healthCheckPath: /health` in `render.yaml`

## CI/CD & Deployment

**Hosting:**
- Backend: Render (Python ASGI runtime, free tier)
  - Deployment automation: `render.yaml` blueprint file in repo root
  - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - Environment: Python 3.12.7, uvicorn pre-installed from `requirements.txt`
- Frontend: Vercel (separate deployment, static hosting or Node.js runtime)
  - Build: `npm run build` (tsc + vite build)
  - Deploy: Vercel handles automatically from git

**CI Pipeline:**
- None detected in this repo
  - No GitHub Actions, GitLab CI, or similar configured
  - Manual testing via pytest `pytest` command
  - Manual builds via `npm run build` and `vite build`

## Environment Configuration

**Required env vars for Purview/Fabric reads:**
- `PURVIEW_ACCOUNT_NAME` - Purview catalog name (e.g., "my-catalog")
- `PURVIEW_TENANT_ID` - Azure AD tenant GUID
- `PURVIEW_CLIENT_ID` - Service principal app ID
- `PURVIEW_CLIENT_SECRET` - Service principal secret

**Optional env vars:**
- `PURVIEW_ALLOW_WRITE` - Boolean, default false (enables lineage pushes)
- `CORS_ORIGINS` - Comma-separated list (e.g., "https://myapp.vercel.app")
- `VITE_API_BASE` - Frontend build-time override (default: `http://localhost:8000`)

**Secrets location:**
- Development: `.env` file at repo root (loaded via `pydantic_settings.BaseSettings`)
- Production: Render stores secrets in its vault (never committed)
  - File: `render.yaml` declares vars as `sync: false` so they are prompted for once and stored

## Webhooks & Callbacks

**Incoming:**
- None - No webhook receivers configured

**Outgoing:**
- Lineage pushes to Purview (one-way writes only, no webhooks)
  - Endpoint: `POST /atlas/v2/entity` to Purview data map
  - Triggered manually via `/purview/graph` and related endpoints
  - Dry-run mode available; actual writes gated by `PURVIEW_ALLOW_WRITE` flag

---

*Integration audit: 2026-07-20*
