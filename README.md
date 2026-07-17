# Lineage Studio

Track and visualize **data lineage across Microsoft Fabric** — workspaces,
notebooks, lakehouses, tables, and columns.

- **Phase 1 (current):** metadata + static notebook parsing → visual lineage graph.
- **Phase 2:** sandbox Spark execution for accurate column-level lineage.

See [`CLAUDE.md`](./CLAUDE.md) for architecture and commands.

## Quick start

```bash
# backend  (http://localhost:8000)
cd backend
py -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/uvicorn app.main:app --reload

# frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Open the frontend and hit **Load sample** to see a demo lineage graph with no
Fabric connection required.
