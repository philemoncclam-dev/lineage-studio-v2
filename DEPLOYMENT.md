# Deployment — where things run, and what is still unfinished

Verified live on 2026-07-30. `handoff.md` has an older "Prod topology" section
that predates the Azure container; where the two disagree, this file is newer.

## Topology

| Piece | Host | Engine | Notes |
|---|---|---|---|
| Frontend | Vercel | — | `VITE_API_BASE` points at Render |
| Backend (prod) | Render — `lineage-studio-api.onrender.com` | **stub** | free tier, sleeps, ~20s first request |
| Sandbox w/ JVM | Azure Container Apps — `lineage-api.yellowbeach-2d7260c3.eastus.azurecontainerapps.io` | **spark** | scales to zero, ~21s cold / ~7s warm |

Both backends are live and both are running current `master`. The Azure
container is **built and working but nothing points at it yet** — that is what
the two open items below are for.

Measured difference on the same request (a `withColumn` inside a `for` loop,
written through `saveAsTable`):

- Render / stub → `engine: stub`, **0 column edges**
- Azure / spark → `engine: spark`, **3 column edges**, with the transform text
  (`(orders.amount * CAST(2 AS DOUBLE)) AS doubled`)

The stub abstains on control flow by design (`_dflineage.py:570-597`). Spark
resolves it because the child actually executes the driver code and reads
Catalyst's analyzed plan.

---

## TODO 1 — let the browser call the container (CORS)

**Symptom if skipped:** the browser blocks the sandbox call before it reaches
the app. Preflight currently returns `400` with no `access-control-allow-origin`.

`CORS_ORIGINS` is not set on the Container App. The deploy workflow only passes
`--image`, so env vars come from whatever was configured at creation time.

```bash
az containerapp update -g lineage-studio -n lineage-api \
  --set-env-vars CORS_ORIGINS="https://<your-vercel-origin>"
```

Confirm the origin first — see the note under TODO 2. `main.py:38-39` reads it
via `Settings.allowed_origins`, which always allows `http://localhost:5173` on
top of whatever is configured.

**Verify:**

```bash
curl -s -i -X OPTIONS \
  https://lineage-api.yellowbeach-2d7260c3.eastus.azurecontainerapps.io/fabric/sandbox/run \
  -H "Origin: https://<your-vercel-origin>" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
```

A line comes back → fixed. Nothing → still refused.

## TODO 2 — point the sandbox call at the container

**Symptom if skipped:** everything works, but on the stub engine — models come
back with objects and edges and no attributes.

`VITE_SANDBOX_API_BASE` is read at `frontend/src/api.ts:63` and routes **only**
`runSandbox`; every other call stays on `VITE_API_BASE` so it is not made to
wait behind a host that scales to zero. Unset, it falls back to `VITE_API_BASE`.

In the Vercel project settings:

```
VITE_SANDBOX_API_BASE=https://lineage-api.yellowbeach-2d7260c3.eastus.azurecontainerapps.io
```

Then **redeploy the frontend**. Vite inlines `import.meta.env.*` at build time,
so setting the variable without a rebuild changes nothing.

**Check which project/branch actually serves prod before doing this.** The only
Vercel project visible from the API (`datalineage-2nd9`) had a production
deployment from 2026-07-07 whose bundle contains no `fabric/sandbox/run` string
at all and points at `http://localhost` — which cannot be what is serving the
app. Either there is another project, or that one is building from the wrong
branch: its git alias is `…-git-main-…` while this repo's default branch is
`master`, and a project watching `main` will never build.

**Verify:** grep the deployed bundle.

```bash
curl -s https://<your-vercel-origin>/ | grep -oE '/assets/[^"]+\.js' | head -1
# then fetch that asset and:
grep -c azurecontainerapps <bundle>
```

Non-zero → the routing is live. Then run a notebook and check the engine chip
in the run report says `spark`.

---

## Verifying a backend has a given commit

FastAPI publishes its header params, so a route's dependencies are visible
without a valid Fabric token:

```bash
curl -s <host>/openapi.json | python -c "
import json,sys
p=json.load(sys.stdin)['paths']['/fabric/sandbox/run']['post']['parameters']
print([x['name'] for x in p])"
```

`['authorization', 'x-onelake-authorization']` means the caller-token fix
(`0c5ab95`) is deployed. Only `['authorization']` means it is not.

## Smaller things, not blocking

- `render.yaml` is **live infrastructure**, not a leftover — it describes the
  production backend. Do not delete it.
- `VITE_SANDBOX_API_BASE` is undocumented in `.env.example` (that file only
  covers backend settings; the frontend has no `.env.example` at all).
- Cheap stub gaps worth closing so the fallback degrades less: `df.agg(...)`
  called directly, `df.na.*` chains, `spark.sql(...)` handing a frame to
  `_dflineage`, and `selectExpr` routed through `_sqllineage`. See
  `_dflineage.py:329-380` and `474-481`.
- `tests/test_sandbox.py::test_the_credential_probe_notices_a_reachable_token_cache`
  fails in a Linux container (the probe finds a real token cache under the
  runner's home). It passes on Windows; not caused by any recent change.
