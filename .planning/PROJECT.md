# Lineage Studio

## What This Is

A web app that gives you a visual map of all the data living in Microsoft Fabric
in your tenant — workspaces, lakehouses, tables, and columns — and lets you push
that lineage and its supporting metadata **directly into Microsoft Purview** from
the same app. It's for you first, then for colleagues in your org who need to
answer lineage questions ("where does this column come from?", "what breaks if I
change this table?") without asking you.

This milestone is a **full frontend rebuild**: dark-first, modern, and
restructured around a left-rail shell — plus a first-class UI for the Purview
push capability that already exists in the backend but is effectively unreachable
today.

## Core Value

**Purview gets populated from this app.** The end-to-end loop — explore lineage
visually → select what matters → push to Purview → see it land — must work, and
must look like a product you'd demo without apologising.

## Requirements

### Validated

<!-- Shipped and confirmed valuable — inferred from the existing codebase. -->

- ✓ Lineage graph model (`LineageGraph`: workspace/lakehouse/table/notebook/column nodes, reads/writes/derives edges, `ColumnMap` transforms) as the stable frontend/backend contract — existing
- ✓ Purview read path — search the Unified Catalog for Fabric entities and build a `LineageGraph` from them (`purview/ingest.py`) — existing
- ✓ Purview write paths — lineage push, column definitions import/apply, data products (`purview/lineage_push.py`, `definitions.py`, `dataproduct.py`, `writer.py`, `actions.py`) — existing
- ✓ Fabric REST client + notebook definition fetching (`fabric/client.py`, `fabric/notebooks.py`) — existing
- ✓ Static notebook parsing — regex extraction of table reads/writes and column derivations (`parser.py`) — existing, acknowledged as a Phase-1 approximation
- ✓ Manual JSON ingest fallback (`POST /ingest`) and bundled sample dataset for offline/demo use — existing
- ✓ Column-level lineage DAG view with expandable table cards and column edges (`LineageView.tsx`) — existing, to be rebuilt visually
- ✓ Knowledge-graph drill-down: Estate → Workspace → Lakehouse → Table with breadcrumbs (`GraphView.tsx`) — existing, to be rebuilt visually
- ✓ Cmd+K search across tables, columns, and notebook code (`SearchPalette.tsx`) — existing
- ✓ Graceful degradation — app works without Purview/Fabric credentials; integration UI is conditionally shown — existing
- ✓ Deployable backend (Render blueprint, configurable API base and CORS allowlist) — existing

### Active

<!-- Current scope. Hypotheses until shipped. -->

- [ ] A real design system: self-hosted variable font (the current `-apple-system` / `SF Pro` stack does not resolve on Windows and silently falls back to Segoe UI), a consistent type scale, a spacing grid, and a single coherent token layer replacing the competing `index.css` / `App.css` bases
- [ ] Dark-first visual language in the Datadog/Grafana idiom — the canvas is the product, chrome recedes, colour is load-bearing rather than decorative
- [ ] Light theme at full parity with dark (accepted as roughly 2x the token and canvas-tuning cost)
- [ ] Re-derived accent and domain palette that survives a near-black canvas — the current `#4f5bd5` indigo is a light-mode accent, and Bronze/Notebook collapse toward each other at low luminance
- [ ] New app shell: persistent left icon rail for top-level destinations, canvas filling the remainder, contextual right-hand inspector — replacing the flat top-bar view-switch that cannot absorb a fourth peer destination
- [ ] Rebuilt lineage DAG canvas — layout, edge rendering, hover-to-trace, column selection, and motion
- [ ] Rebuilt knowledge-graph canvas — force-directed constellation, drill-in transitions, domain clustering
- [ ] First-class Purview push UI — select scope, preview what will be written, confirm, execute, and see confirmation that it landed
- [ ] Purview definitions import and data-product flows brought into the new shell as proper destinations rather than bolt-on panels
- [ ] Motion as a first-class concern — edge tracing and drill-in transitions are where the app earns "slick"
- [ ] A shared component layer with real primitives, replacing six hand-rolled CSS files with no shared vocabulary

### Out of Scope

- **Phase 2 Spark sandbox executor** — the execution-derived column lineage work is a separate, later milestone; it swaps the extraction engine behind an unchanged `LineageGraph` shape and does not block or depend on this UI work
- **kdb+ lineage** — explicitly deferred; Fabric-first
- **AI chatbot consumption mode** — deferred
- **Per-user authentication / login flow** — credentials stay environment-driven via a shared service principal; adding auth is a deployment concern, not this milestone
- **Database-backed graph persistence** — the single in-memory `_last_graph` slot is adequate for current usage; revisit only if multi-user concurrency becomes real
- **Node ID normalisation away from Purview GUIDs** — noted as a future refactor; GUIDs keep the lineage-push path a trivial lookup, which this milestone depends on

## Context

**Technical environment.** React 19 + TypeScript + Vite frontend; Python + FastAPI
backend; Azure AD service principal against the Purview Data Map REST API and the
Fabric REST API. Development is on Windows 11 — relevant, because the current
design was authored against macOS font metrics.

**The trigger for this milestone.** The current UI is a light-mode, Apple-styled
prototype. Its `--sans` token (`App.css`) lists `-apple-system` and `SF Pro
Text/Display`, none of which exist on Windows, so the entire interface renders in
Segoe UI at weights and letter-spacing (`560`, `620`, `-.01em`) tuned for a font
that never loads. `index.css` independently sets a competing `14px system-ui`
base. Font sizes across the app are scattered and unsystematic (10.5, 11.5, 12.5,
13, 14, 17px), there is one `--shadow` token doing all depth work, and almost
nothing animates. The result reads as an internal tool, not a product.

**Design direction has shifted.** An earlier direction (clean, light, minimal,
Apple/SF, data-catalog feel) was validated via HTML mockups and is now
superseded. The direction for this milestone is dark-first Datadog/Grafana:
dense, information-heavy, glowing canvas, optimised for long sessions staring at
graphs. The two consumption modes (structured left-to-right lineage DAG;
force-directed knowledge-graph constellation) and the drill-in vision (Estate →
Workspace → Lakehouse → Table → column lineage) survive the shift and remain the
product's spine.

**Standing dislikes to respect.** Persistent node/kind legends in the top bar, the
minimap, per-layer "Bronze/Silver/Gold" labels on the lineage canvas, glyph icons
on nodes, and hint-text bars. A domain-colour legend on the knowledge graph is
acceptable, because there colour is load-bearing.

**What already works and should be preserved.** The existing top-bar buttons and
segmented control read well and are explicitly liked — the visual treatment
carries forward even though the shell around it changes.

**Purview is further along than the UI suggests.** `backend/app/purview/` already
contains client, ingest, definitions, lineage_push, dataproduct, actions, and
writer modules, plus a `purview_allow_write` safety gate. The gap is not backend
capability — it is that the frontend exposes it through a single 51-line panel.
This milestone is about making existing capability reachable and trustworthy, not
about building Purview integration from scratch.

## Constraints

- **Tech stack**: React 19 + TypeScript (strict) + Vite frontend; FastAPI +
  pydantic backend — established, working, and not up for reconsideration in this
  milestone
- **Compatibility**: The `LineageGraph` pydantic contract must stay stable — it is
  the frontend/backend boundary and must survive the future Phase-1 → Phase-2
  extraction swap untouched
- **Platform**: Development and primary use is Windows 11 — fonts must be
  self-hosted, never assumed present on the OS
- **Security**: No UI login flow; credentials remain environment-driven. CORS is
  the credential boundary — any allowed origin can spend the service principal's
  credentials, so the allowlist stays explicit and opt-in
- **Safety**: Purview writes stay behind the `purview_allow_write` gate, and no
  write may execute without an explicit user confirmation step in the UI
- **Safety**: No writes to real Fabric tables, ever
- **Dependencies**: Azure AD service principal access to both Purview and Fabric
  REST APIs

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dark-first, Datadog/Grafana visual idiom | It's a graph-staring tool; the canvas should be the product and colour should carry meaning | — Pending |
| Full UI rebuild rather than a restyle | The current frontend is a prototype; its structure can't absorb Purview as a fourth peer destination | — Pending |
| Left icon rail + contextual panels for the shell | Scales to more destinations; standard in the reference tools; frees the top bar | — Pending |
| Light theme at full parity with dark | User preference, accepted knowingly against the recommendation of dark-first/light-supported | ⚠️ Revisit |
| Self-host a variable font | The current OS-dependent stack silently fails on Windows — the single largest cause of the "it looks off" problem | — Pending |
| Purview push designed alongside the UI, not deferred | It is partly a UI problem (scope selection, preview, confirm-before-push) and the milestone's success is defined by it | — Pending |
| Supersede the earlier light/minimal/Apple design direction | Superseded by the dark-first decision above; recorded so it isn't reintroduced | — Pending |
| Phase 2 Spark sandbox stays out of this milestone | It swaps the extraction engine behind an unchanged contract; independent of UI work | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-20 after initialization*
