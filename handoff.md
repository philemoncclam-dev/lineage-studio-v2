# Handoff — Lineage Studio v2

_Last updated: 2026-07-24 — as of the "Data Products section" commit (master, pushed)_

## Where things stand

Shipped a full **Data Products section** — a new top-level mode (5th in the
logo mode-switcher) alongside Graph / Lineage / Model / Purview. Backend and
frontend both green: **105 pytest passed**, `npm run build` clean. The section
is a product-catalogue surface layered on the Purview data map: browse products
by domain (with nesting sub-domains), a per-product "contract" page, and a
request → owner-approval → gated-Fabric-grant workflow.

Note: the previous handoff (the 2026-07-21 Phase-1 design-tokens one) had been
sitting **uncommitted** in the working tree and is now superseded — its CR-01
dot-colour concern predates many later commits and was not re-verified this
session. Don't trust that doc's "27 ahead / NOT pushed" line; the tree is level
with `origin/master`.

## In flight / next step

Nothing half-written. The one thing **unverified against the live tenant**: the
actual Fabric `POST /workspaces/{id}/roleAssignments` (Viewer grant) on
approval. It needs `PURVIEW_ALLOW_WRITE=true`, the product's `workspace_id`, and
the requester's Entra **object id** (an email cannot be assigned a role).
Everything up to that gated send is tested; the send itself was never exercised
live. `backend/app/products/grant.py` is the single place that call happens.

## Uncommitted work

Clean after this commit.

## New architecture (not repeated in CLAUDE.md yet)

- **`backend/app/products/`** — the section's own package, deliberately separate
  from `purview/`:
  - `store.py` — JSON persistence in `backend/data/` (gitignored): `products.json`
    + `requests.json`. Pydantic models are both the on-disk shape and the API
    contract. Seeds a domain tree + one sample product so the section renders
    offline, the way `sample.py` seeds the graph. Atomic temp-file-rename writes.
  - `grant.py` — Fabric Viewer role assignment, gated by `PURVIEW_ALLOW_WRITE`,
    dry-run by default; returns a `GrantRecord` in every branch (approval never
    fails just because the grant can't be sent).
  - `router.py` — `/products/*` endpoints. `/products/requests/all` (not
    `/products/requests`) is the inbox, named so it can't collide with a
    `/products/{id}` path.
- **Domains**: `/products/domains` prefers live Purview governance domains (now
  mapping `parentId` → `parent_id` in `dataproduct.py`, which is what makes a
  sub-domain a sub-domain), and falls back to the store's seed tree when Purview
  is absent or returns empty (empty = "no permission" here). The frontend builds
  the same tree from either source.
- **Frontend**: new `products` mode in `shell/railConfig.ts` (+ `ModeMenu`,
  `Rail` icons `plus`/`inbox`). Routes under `frontend/src/routes/products/`:
  `index` (browse), `$productId` (detail: desc/use-cases/owners/asset column
  drill-in/model link/request form), `new` (create), `requests` (owner inbox).
  Styling in `views/products.css`, token-driven. Old `/purview/data-products`
  placeholder now just links to the new section.

## Gotchas still live

- **Grant needs an Entra object id, not an email.** The request form captures it
  optionally; without it, approval still succeeds but records the grant as
  blocked pending the id rather than guessing. This is by design.
- **`backend/data/` is gitignored working state.** Deleting it just re-seeds on
  next read. Tests isolate it via monkeypatch to `tmp_path` (see
  `tests/test_products.py`) — don't let the store write into a dev's real
  `backend/data/` during tests.
- Live Purview domain ids are opaque GUIDs the seed tree doesn't contain, so
  `store.get_domain_exists` trusts any id ≥12 chars on create — otherwise every
  real domain would be rejected.

## Security posture

Unchanged and respected: the approval grant is the only new external mutation,
and it rides the existing `PURVIEW_ALLOW_WRITE` gate (default off), dry-run by
default. A reachable deployment never grants workspace access by accident.
