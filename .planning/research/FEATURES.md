# Feature Research

**Domain:** Data lineage / data catalog visualization tool with a write-path into Microsoft Purview
**Researched:** 2026-07-20
**Confidence:** MEDIUM (websearch-tier sources cross-checked across 9 vendor products + official Microsoft Learn docs; no direct product trials conducted)

## Context Recap

This is a brownfield milestone: full frontend rebuild of an existing app that already
reads Fabric metadata via Purview, builds a `LineageGraph`, and renders it as (1) a
column-level lineage DAG and (2) a knowledge-graph drill-down (Estate → Workspace →
Lakehouse → Table). The backend already has working Purview **write** paths
(`purview/lineage_push.py`, `definitions.py`, `dataproduct.py`, `writer.py`,
`actions.py`, gated by `purview_allow_write`) that are barely exposed in the UI. The
milestone's core value is: **explore lineage visually → select what matters → push to
Purview → see it land**, presented as a product, not a bolt-on panel.

Single-tenant, single-user-first (you), then a handful of colleagues. No auth, no
multi-tenancy, no real-time collaboration. This shapes several anti-feature calls
below.

---

## Feature Landscape

### 1. Lineage Exploration — Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Upstream/downstream tracing from any node | Every tool studied (dbt Explorer, Atlan, Collibra, Alation, Select Star, DataHub, OpenMetadata, Monte Carlo) treats "follow this column/table backward or forward" as the base interaction, not a feature you toggle on | LOW–MEDIUM | Already exists structurally (`LineageGraph` edges). Frontend needs a "trace mode": click a node, highlight full upstream+downstream closure, dim everything else |
| Column-level lineage, not just table-level | dbt Cloud, Atlan, Alation, Select Star, DataHub, OpenMetadata all ship column-level as the flagship differentiator over table-level-only tools; DataHub explicitly frames it as enabling "precise impact assessment" vs "generic table-level dependencies" | MEDIUM | Backend already emits `ColumnMap`; this is a rendering/interaction problem, not a data problem |
| Hop-depth control ("show N levels up/down") | Atlan exposes an explicit depth selector ("select level of depth up to Max Depth"); DataHub filters by time range and pivots per-entity | LOW–MEDIUM | Needed once graphs exceed ~30-40 nodes — without it, first render of a busy table is unreadable |
| Table-level ↔ column-level toggle | Alation's Classic vs Compound layout and Atlan's "expand columns" both exist because column-level-always is too dense at estate scale; users need to zoom between granularities | MEDIUM | Maps directly onto the existing two-view split (GraphView = table-level-ish, LineageView = column-level); the toggle should live inside a single canvas, not force a full navigation | 
| Impact analysis ("what breaks if I change this") | Named as a first-class capability by dbt Explorer, Collibra ("proactive impact analysis for critical system changes"), DataHub ("Impact Analysis tool"), Monte Carlo | LOW (if trace mode above exists) | This is UI framing more than new capability — same graph traversal as upstream/downstream, presented with change-risk language ("3 downstream reports depend on this column") |
| Search-to-node | Universal — every tool has a search bar that jumps the canvas to a node. This app already has `SearchPalette.tsx` (Cmd+K) across tables/columns/notebook code | LOW | Already exists; extend result selection to pan/focus/highlight the found node on canvas rather than just listing it |
| Transformation display on edges | Atlan classifies propagation type; Select Star explicitly labels edges AS IS / AGGREGATED / TRANSFORMED; OpenMetadata shows column-to-column edges with the transform | LOW–MEDIUM | Backend already has `ColumnMap.transform` (SQL expression string); needs a hover/click affordance on the edge, not a permanent label (respects "no hint-text bars") |
| Filtering (by kind, by workspace, by staleness) | DataHub filters by time range; Select Star has in-lineage search; Collibra's Diagrams UI supports "advanced filters directly on the diagram" | MEDIUM | Needs a filter affordance that doesn't become a persistent chrome bar — a contextual panel triggered on demand fits the "no hint-text bars" constraint |
| Focus/isolate mode (hide everything not connected to selection) | Implicit in every tool's "trace" interaction; DataHub calls it pivoting; Cambridge Intelligence UX research calls dimming-unrelated-nodes a baseline graph-visualization pattern | LOW–MEDIUM | Complements dim-on-trace; "isolate" removes rather than dims — cheap to add once trace/dim exists |

### 1. Lineage Exploration — Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Notebook-code-aware transform tooltips | Because lineage here is *derived from your own notebook code* (regex parser), you can show the actual source line/cell that produced a column edge — something none of the SaaS catalogs can do since they don't own the transformation code | MEDIUM | Requires `parser.py` to retain source location (cell index, line) alongside the `ColumnMap` — a backend addition, but small |
| Confidence-tagged edges (see Trust section) | Distinguishes this app from every competitor surveyed, none of which foreground "this edge is a regex guess" — turns Phase-1's biggest weakness into an honest, differentiating trust signal | LOW–MEDIUM (frontend); backend already has the data shape to extend |
| Single-canvas granularity zoom (table ↔ column without a page navigation) | Alation and Atlan both make this a *mode switch*, not a continuous zoom; a smoother interaction (scroll/zoom-driven density change) would be a genuine improvement over the reference set | HIGH | Nice-to-have; don't let this gate the milestone — table-stakes toggle is enough for v1 |

---

### 2. Graph/Canvas Interaction — Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Zoom / pan / fit-to-view | Universal baseline (React Flow ships `Controls` + `fitView` out of the box; Alation, Collibra, DataHub all have it) | LOW | Already present via React Flow (assumed current stack); carries forward |
| Node collapse/expand | OpenMetadata (table columns), DataHub ("expand or collapse pipeline internals"), general graph-UX literature (mini-view/expand-collapse patents, `ngx-graph` issue threads) all treat this as baseline for managing density | MEDIUM | Column-level table cards already expand/collapse in `LineageView.tsx`; extend the same pattern to workspace/lakehouse grouping on the knowledge graph |
| Path highlighting on selection | Cambridge Intelligence's graph-UX guidance and DataHub's pivot/expand both rely on this; it's how "trace" reads visually | LOW–MEDIUM | Directly implements the upstream/downstream trace feature above — same underlying mechanism |
| Dimming non-relevant nodes on focus | Same source base as path highlighting — treated as inseparable from it in the UX literature ("highlight nodes in dependency closure... hide/dim others") | LOW | Pairs with path highlighting; do both together, not path-highlight-only |
| Selection persistence across interactions | Baseline expectation — clicking elsewhere shouldn't silently lose your trace/selection until you explicitly clear it | LOW | State-management concern in the rebuilt shell, not a canvas-library concern |
| Breadcrumb drill-down | Already implemented in `GraphView.tsx` (Estate → Workspace → Lakehouse → Table) and explicitly named in PROJECT.md as something to preserve | LOW | Carry forward into the new shell; breadcrumbs replace the minimap's "where am I" job for the hierarchical knowledge-graph view |
| Keyboard navigation (arrow keys between nodes, Esc to clear focus, Cmd+K already exists) | Table stakes for a "canvas is the product" tool aimed at power users doing long sessions — explicitly named in PROJECT.md's Datadog/Grafana framing | MEDIUM | Not universally implemented even by the SaaS competitors (most rely on mouse) — this is a place the app can actually feel faster than Atlan/Collibra for the primary user |
| Layout switching (structured left-to-right DAG vs force-directed constellation) | Already the app's spine — LineageView (layered/DAG) vs GraphView (force-directed knowledge graph) — not something competitors need since most only ship one layout, but this app already committed to two | MEDIUM (rebuild) | This *is* the "layout switching" feature; frame it as intentional dual-mode, not indecision |

### 2. Graph/Canvas Interaction — Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Motion-driven trace ("edge tracing" animation on hover/select) | PROJECT.md names this explicitly as where the app "earns slick" — none of the enterprise catalogs studied (Collibra, Alation, Atlan) invest meaningfully in canvas motion; it's a genuine visual differentiator against the category | MEDIUM–HIGH | Framer Motion / CSS-only pulse-along-edge on trace selection; keep it functional (signals direction of data flow) not just decorative |
| Deep-linkable URL per node/column with reconstructed view state | Table stakes in dev-tool-adjacent products (Figma, Linear) but *not* consistently present in data catalogs (Alation/Collibra links are often session-bound); doing this well differentiates for a single-tenant tool where "send a colleague a link to this column" is a real daily use case | MEDIUM | See Search & Navigation section — depends on URL-addressable state design |
| Command-palette-driven navigation for everything (not just search) | VS Code/Figma/Notion-style "type to do anything" (jump to node, switch view, open Purview push, filter) goes beyond the current Cmd+K's search-only scope | MEDIUM | Extends `SearchPalette.tsx`; genuinely differentiates from every catalog studied, none of which have a true command palette (they have search bars) |

### 2. Graph/Canvas Interaction — Explicit Anti-Feature (User Preference)

| Feature | Why Requested (in general) | Why Wrong Here | Alternative |
|---------|---------------------------|-----------------|-------------|
| Minimap | React Flow ships it by default; "bird's-eye view... makes navigation easier especially for larger flows" is the standard justification, and it is genuinely useful for graphs with hundreds+ of freely-panned nodes | User has explicitly stated a dislike. It also duplicates functionality the app already has better answers for: breadcrumbs (hierarchical position in knowledge graph), fit-to-view, and search-to-node (direct jump) all solve "where am I / how do I get elsewhere" without a second miniature canvas competing for visual attention on a dark, glow-driven UI | Breadcrumb trail (knowledge graph) + fit-to-view control + search-to-node with auto-pan/zoom (lineage DAG). If orientation still proves to be a problem in testing, prefer a lightweight edge-of-viewport "N nodes off-screen in this direction" indicator over a full minimap |

---

### 3. Microsoft Purview Push UX — Table Stakes

This is the milestone's core value, so it gets the deepest treatment. Purview itself
expresses several concepts the UI must translate for users; getting the mapping wrong
is the single biggest risk to this milestone.

**Purview concepts the UI must express (researched from Microsoft Learn):**

| Purview concept | What it means | How the UI must surface it |
|---|---|---|
| **Data Map vs Unified Catalog** | Data Map scans sources and holds technical metadata/collections (IT-team-oriented, technical separation). Unified Catalog is where governance domains and data products are curated (business-oriented, logical separation) | Existing read path (`purview/ingest.py`) pulls from the *Data Map* (Unified Catalog search over Fabric entities). The write UI needs to make clear which layer a given push lands in — a lineage push writes Data Map process/entity relationships; a data-product action writes into a governance domain in the Unified Catalog. These should not be presented as the same kind of "write" |
| **Atlas entities & processes** | Datasets = nodes (rectangular in Purview's own UI); Processes = edges/transformations (round-edged). Three relationship types: `dataset_process_inputs`, `process_dataset_outputs`, `direct_lineage_dataset_dataset` | The lineage-push preview should show, per edge being written, which of these relationship types it creates — this is exactly the vocabulary Purview's own lineage graph uses, so matching it avoids a "translation gap" when the user cross-checks in Purview itself afterward |
| **Qualified names** | Purview's string-based unique identifier; a **process** qualified name must be unique or an existing relationship gets silently overwritten and prior lineage is lost | This is the single most important thing to surface pre-write. The dry-run/diff view (below) must show the qualified name being targeted and flag when a write would overwrite an existing process rather than create a new one — silent overwrite is a real, documented failure mode |
| **Governance domains** | A boundary for common governance/ownership/discovery of data products and glossary terms, aligned to business areas (e.g. "Finance") | Scope selection for data-product pushes must let the user pick/confirm a governance domain, not assume one |
| **Data products** | A named business concept (owner, description) with a list of associated data assets; lives in exactly one governance domain but is discoverable across domains | Maps onto the existing `dataproduct.py` backend path. The push UI should let the user compose "this data product = these N tables/columns from the graph" visually, i.e. select nodes on the canvas and turn the selection into a data-product payload — this is the most natural bridge between "exploring lineage" and "pushing to Purview" |
| **Glossary terms** | Business vocabulary attached to assets, distinct from technical column descriptions | Maps onto the existing `definitions.py` column-definition import flow; already has a spreadsheet-based match/apply UI (`DefinitionsImport.tsx`) that needs to move into the new shell as a first-class destination, not a bolt-on panel |

**Push UX pattern (cross-referenced against general "dry-run" UX conventions —
kubectl diff, terraform plan, ansible --check — which are the closest well-established
analogue since no catalog vendor publishes public UX detail on their write flows):**

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Scope selection | Every dry-run-pattern tool starts with "what am I operating on" before showing a plan | LOW–MEDIUM | Frontend: multi-select on the canvas (nodes/columns/subgraph) feeding a scope object; backend endpoints already take some form of target set (`lineage_push.py`, `definitions.py`) — confirm/extend their input contracts to accept a scope selection from canvas state |
| Dry-run / preview of exactly what will be written | Universal pattern in every infra tool studied (terraform plan, kubectl diff, ansible --check, git --dry-run) — "show me exactly what will happen before I commit" | MEDIUM–HIGH | **This is very likely the largest net-new piece of work in the milestone.** Backend write paths (`lineage_push.py`, `definitions.py`, `dataproduct.py`) need to expose a "compute the payload without sending it" mode if they don't already — flag as a backend dependency, not pure frontend |
| Diff against what's already there | Terraform/kubectl's core value proposition; directly addresses the qualified-name-overwrite risk above | HIGH | Requires reading current Purview state for the targeted entities before the push (an extra read call per entity) and diffing against the proposed payload. This is the feature most likely to reveal that a "preview" alone (without a diff) is insufficient — recommend at minimum flagging create-vs-overwrite per entity even if a full field-level diff is v2 |
| Explicit confirmation gate before executing | PROJECT.md constraint: "no write may execute without an explicit user confirmation step in the UI" — already a hard requirement, not just a UX nicety | LOW | Straightforward modal/step gate once preview exists; must not be a single "yes" — should restate scope + counts ("push lineage for 14 tables, 3 will overwrite existing processes") |
| Execution progress (multi-entity pushes take time) | Purview's own API guidance recommends small batches with multiple calls for reliability — meaning a push is inherently a sequence of calls, not one atomic action | MEDIUM | Progress UI (N of M entities pushed) is a natural consequence of batching, not an extra feature — backend should stream/paginate results rather than block on one giant call |
| Per-entity success/failure results | Because pushes are batched, partial failure is the normal case, not the exception — Purview API discussions confirm this (timeouts on batch glossary-term assignment, 400s on multi-op batches) | MEDIUM | Backend write orchestration (`writer.py`, `actions.py`) should already return per-item results if it batches; if it currently returns a single pass/fail for the whole call, that's a backend gap to flag for this milestone |
| Retry (failed entities only, not the whole batch) | Direct consequence of partial-failure being normal — re-running the whole batch after 1-of-14 fails is wasteful and risks re-triggering the qualified-name-overwrite problem on the 13 that succeeded | MEDIUM | Depends on per-entity results existing first; backend needs to accept a "retry this subset" request shape |
| Audit / history of what was pushed | Table stakes at enterprise scale (Purview's own Data Map Audit History logs who/what/when for every asset change) — but this app is single-tenant/single-service-principal, so the bar is lower: "what did *I* push and when" rather than multi-user governance audit | LOW–MEDIUM | **Backend dependency, and in tension with PROJECT.md's "no database-backed persistence" out-of-scope call.** Recommend the lightest viable version: an append-only local log (file or the existing in-memory graph store extended with a push-history list) rather than a database — enough to answer "did I already push this" without taking on persistence infrastructure |

### 3. Microsoft Purview Push UX — Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Canvas-native scope selection (select nodes visually, not via a form) | No competitor studied lets you lasso-select a subgraph on the lineage canvas and turn it directly into a Purview write payload — Purview's own UI, Atlan, Collibra all use list/table pickers for write scope, not the graph itself | MEDIUM–HIGH | This is the single strongest "wow" moment available in the milestone — it's the literal enactment of PROJECT.md's core value loop (explore → select → push → confirm it landed) |
| "See it land" round-trip confirmation | Beyond a success toast: after a push, re-fetch the affected entities from Purview and show them rendered in the same visual language as the rest of the app, so the user sees their own graph reflected back from Purview | MEDIUM | Directly satisfies PROJECT.md's stated goal: "see confirmation that it landed." Reuses the existing Purview read path (`purview/ingest.py`) scoped to just the pushed entities |
| Purview-vocabulary-aligned preview (process/dataset/qualified-name labels matching Purview's own UI) | Reduces the "translation gap" — a user who later opens Purview's own portal to verify sees consistent terminology, building trust in the tool | LOW–MEDIUM | Mostly a copywriting/labeling discipline in the preview screen, informed by the concept table above |

### 3. Microsoft Purview Push UX — Anti-Features

| Feature | Why Requested | Why Problematic Here | Alternative |
|---------|---------------|-----------------------|-------------|
| Full bidirectional sync (Purview → app → Purview, continuous) | Feels like the "complete" version of the feature — always in sync both ways | Massive scope increase (conflict resolution, polling/webhooks, drift detection) for a single-tenant tool whose actual need is "push when I decide to push." No competitor's write-back UX (where documented) works this way either — even Purview's own custom-lineage API is push-on-demand | Manual, explicit push with a "refresh from Purview" read action (already exists) — one-directional, user-triggered both ways |
| Multi-user approval workflows for pushes | Enterprise catalogs (Collibra, Alation) build formal stewardship/approval chains because they serve large orgs with data governance teams | No per-user auth in this milestone (PROJECT.md: explicitly out of scope), single shared service principal — an approval workflow has no one to route to | The single explicit confirmation gate already required by PROJECT.md is sufficient |
| General-purpose Purview entity CRUD (edit any Purview field from this app) | Feels natural once you have write access — "why not let me edit anything" | Scope creep into rebuilding Purview's own admin UI; the backend write paths that exist are purpose-built (lineage, definitions, data products) for reasons tied to this app's actual workflows, not a generic editor | Keep the write surface exactly as wide as the three existing backend capabilities (lineage push, definitions, data products); resist adding a fourth without a concrete driving use case |

---

### 4. Trust & Verification Features — Table Stakes

Directly relevant because Phase-1 lineage is regex-derived and approximate — this is
where the app must be *more* honest than its data justifies looking, not less.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Confidence/provenance tagging on edges (declared vs inferred) | Recognized industry distinction: "declared" = explicit metadata/config; "inferred" = derived from parsing, with acknowledged lower accuracy on complex transforms. This app's regex parser output is squarely "inferred," and Purview-sourced lineage is closer to "declared" | MEDIUM | Backend: tag each edge's origin (`parser.py` regex-derived vs `purview/ingest.py` Purview-native) in the `LineageGraph`/`ColumnMap` shape — likely a small additive field, not a breaking change to the stable contract |
| Last-refreshed / staleness indicator | Explicitly called out in research: "stale lineage creates false confidence... worse than no lineage." Power BI's own lineage view shows last-refresh timestamps as a baseline trust signal | LOW–MEDIUM | Backend already has an implicit "last built" moment (`_last_graph` is swapped on each ingest/Purview load) — surface that timestamp per graph load, and ideally per-source if Purview data and regex-parsed data are refreshed at different times |
| Visual distinction for approximate vs verified edges | Direct consequence of the confidence tagging above — without a visual difference, tagging data that isn't rendered is wasted work | LOW (once tagging exists) | Respect the "no glyph icons" constraint — prefer edge stroke treatment (opacity/dash pattern) over an icon badge; this keeps it in the same visual vocabulary as domain colour (load-bearing colour, not decorative iconography) |

### 4. Trust & Verification — Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| "Why do we think this?" inspector on any inferred edge | Shows the actual regex match / source code line that produced a given transform — turns the Phase-1 approximation from a liability into a debuggable, auditable claim. No SaaS competitor can do this because they don't expose their own inference internals | MEDIUM | Depends on `parser.py` retaining source location — same backend dependency noted in Lineage Exploration differentiators; do these together |
| Confidence-aware Purview push warnings | When pushing an inferred (regex-derived) edge to Purview, the dry-run/diff preview flags it distinctly from a Purview-native (declared) edge being re-pushed — prevents low-confidence guesses from silently acquiring false authority once they land in the org's system of record | LOW–MEDIUM | Natural extension of both the confidence tagging and the push preview — a genuine safety feature unique to this app's specific risk profile |

### 4. Trust & Verification — Anti-Feature

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-------------------|-------------|
| Numeric confidence scores (e.g. "87% confidence") | Feels precise and data-science-y; some observability tools imply scoring | The regex parser has no real probabilistic basis for a percentage — a fake-precise number is worse than a category, because it invites false trust in exactly the way staleness research warns against | Use a small discrete set of states (declared / inferred / stale) rendered as edge treatment, not a manufactured score |

---

### 5. Search & Navigation — Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Command palette (Cmd+K) | Already exists (`SearchPalette.tsx`) and is a well-established pattern (originated in VS Code/Sublime, now standard in Figma/Notion/Linear) | LOW (carry forward) | Rebuild visually in the new shell; consider widening scope from search-only to command-execution (see differentiator below) |
| Search across all entity kinds (tables, columns, notebooks) | Already implemented; matches every competitor's baseline search | LOW | Carry forward |
| Deep-linkable URLs for a specific node/column | Not universally strong even among the enterprise catalogs studied, but expected in any modern web app with a canvas — and directly useful for a small-team tool ("here's the link to that column") | MEDIUM | Requires the rebuilt shell to encode view-mode + selected-node(s) + drill path in the URL (React Router or manual `history.pushState`), and for both LineageView and GraphView to be able to reconstruct their state from a URL on load |
| Faceted filtering in search results | Algolia/general search-UX convention; Select Star explicitly calls out in-lineage search for large tables | LOW–MEDIUM | Facets by kind (table/column/notebook/workspace) at minimum; avoid over-building — a single filter row, not a full faceted-nav sidebar |

### 5. Search & Navigation — Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| Saved views (a named, revisitable combination of scope + filters + focus node) | None of the studied competitors surface this as a lightweight, personal feature — Collibra/Alation treat "views" as governance artifacts with approval workflows. For a single/small-team tool, a simple "save this exact canvas state" (backed by the same URL-state mechanism as deep links) is cheap and useful | LOW–MEDIUM (once deep-linking exists) | Can be implemented as nothing more than named, stored URLs — no new backend persistence required if browser localStorage is acceptable for a single-user tool |
| Command palette as universal action surface | Extending Cmd+K beyond search to "do things" (switch view, open Purview push, filter by domain) — matches Differentiator noted in Graph/Canvas section | MEDIUM | Same feature, cross-referenced; don't double-build |

### 5. Search & Navigation — Anti-Feature

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-------------------|-------------|
| Full faceted-navigation sidebar (persistent, always-visible filter panel with counts per facet) | E-commerce/enterprise-catalog convention; feels "complete" | Persistent chrome directly conflicts with the stated design direction (canvas is the product, chrome recedes) and the explicit dislike of hint-text bars / persistent legends — also low value at this data scale (tens to low hundreds of tables, not e-commerce-catalog scale) | Command-palette-driven filtering, invoked on demand and dismissed after use |

---

### 6. Anti-Features — Cross-Cutting

Beyond the per-section anti-features above, these are things the reference tools build
that are demonstrably wrong for a single-tenant internal tool at this scale:

| Feature | Why Requested | Why Problematic Here | Alternative |
|---------|---------------|-----------------------|-------------|
| Data quality monitoring / anomaly detection (Monte Carlo's core product) | Feels like a natural extension of "trust" — Monte Carlo, and increasingly Atlan/Collibra, bundle observability | Entirely different problem domain (runtime data quality vs. static lineage structure); would require scheduled jobs, alerting infra, and threshold config that don't fit a tool with no execution layer yet (Phase 2 sandbox executor is still pending and separate) | Stay in lineage/catalog territory; if data-quality signals matter later, surface Purview's own quality scores if it exposes them, rather than building a monitoring engine |
| Multi-tenant workspace/org switcher | Every enterprise catalog supports many customer orgs or many internal business units with RBAC | This app has one tenant, one service principal, no per-user auth (explicitly out of scope) | None needed — omit entirely, don't even stub it |
| Role-based access control / permission management UI | Alation, Collibra, Atlan all have elaborate steward/consumer/admin role systems | No per-user auth exists or is planned this milestone; building permission UI with nothing behind it is pure waste | None — if auth is ever added (a later, explicit milestone per PROJECT.md), revisit then |
| AI-generated documentation / chatbot lineage Q&A (Atlan's "Enterprise Data Graph that AI agents query," dbt's AI-adjacent features) | Trendy, and this project does have a chatbot mode on its long-term roadmap | Explicitly out of scope for this milestone (PROJECT.md: "AI chatbot consumption mode — deferred") — building any part of it now is scope creep against an explicit decision | Leave the door open structurally (stable `LineageGraph` contract already supports this) but build nothing now |
| Business glossary workflow with term approval chains, term relationships (synonym/related-term graphs), stewardship review states | Collibra/Alation's glossary features are deep, multi-step governance workflows | The existing `definitions.py`/`DefinitionsImport.tsx` flow (spreadsheet → fuzzy match → apply) is already the right size for a single-tenant tool; adding approval chains has no approver to route to | Keep the existing match/apply flow, just move it into the new shell as a first-class destination |
| Real-time collaborative cursors / presence (seeing colleagues' cursors on the same graph) | Figma-style collaboration is currently fashionable in canvas tools | No concurrent multi-user editing need stated anywhere in PROJECT.md; the backend explicitly has no session isolation (single in-memory graph) | None — if this becomes real, it's a backend architecture change (session isolation) first, UI feature second |
| Exhaustive lineage-graph image/PDF export with branding | Atlan supports "download lineage as image"; enterprise buyers want this for slide decks | Marginal value for an internal tool whose primary consumption is the live app itself, not static reports for stakeholders outside the tool | Low priority; a basic PNG export of the current viewport is fine if requested, but don't invest in a polished export pipeline |
| Persistent node/kind legend in the top bar; per-layer Bronze/Silver/Gold labels on the lineage canvas; glyph icons on nodes; hint-text bars | Feels like it aids discoverability/onboarding for new users | **User has explicitly stated these are unwanted.** They also work against the "canvas is the product, chrome recedes, colour is load-bearing" design direction — permanent chrome for infrequent-use information competes with the graph for attention every session, not just the first one | Domain-colour legend on the knowledge graph only (explicitly approved, because colour there is load-bearing); everything else communicated via on-demand interaction (hover, click, command palette) rather than permanent chrome |

---

## Feature Dependencies

```
Confidence/provenance tagging on edges (backend: parser.py + purview/ingest.py tag origin)
    └──requires──> Visual distinction for approximate vs verified edges (frontend)
                       └──enables──> Confidence-aware Purview push warnings
                       └──enables──> "Why do we think this?" inspector (needs parser.py source-location too)

Upstream/downstream tracing + path highlighting + dimming
    └──shared mechanism with──> Focus/isolate mode
    └──enables──> Impact analysis framing (same traversal, different copy/labels)
    └──enables──> Motion-driven edge tracing (differentiator)

Hop-depth control ──enhances──> Upstream/downstream tracing (prevents unreadable dense graphs)

Table-level ↔ column-level toggle
    └──requires──> Existing two-view split (LineageView / GraphView) to share a canvas or transition smoothly

Search-to-node (existing SearchPalette)
    └──enhances──> Deep-linkable URLs (search result becomes a linkable state)
    └──enables──> Saved views (named URL-state snapshots)
    └──enables──> Command palette as universal action surface

Purview push: Scope selection (canvas multi-select)
    └──requires──> Dry-run/preview endpoint (BACKEND: extend lineage_push.py / definitions.py / dataproduct.py to compute-without-send)
                       └──requires──> Diff against existing Purview state (BACKEND: extra read call per targeted entity)
                       └──enables──> Explicit confirmation gate (frontend, PROJECT.md hard requirement)
                                        └──enables──> Execution progress UI
                                                          └──requires──> Per-entity success/failure results (BACKEND: writer.py/actions.py must return per-item, not batch-level, results)
                                                                            └──enables──> Retry (failed subset only)
                                                                            └──enables──> Audit/history of pushes (BACKEND: lightweight append-only log; conflicts with "no DB persistence" out-of-scope decision — needs explicit small-scope call)
Canvas-native scope selection (differentiator) ──requires──> Scope selection (table stakes) to exist first, just with a richer selection UI
"See it land" round-trip confirmation ──requires──> Existing Purview read path (purview/ingest.py), scoped to just-pushed entities

Deep-linkable URLs ──conflicts-with-if-naive──> Force-directed knowledge-graph layout (non-deterministic layout on reload defeats a link's purpose — must persist/reproduce layout or drill path, not just node IDs)
```

### Dependency Notes

- **Confidence tagging requires backend changes but is small and additive.** Both
  `parser.py` (regex-derived, always "inferred") and `purview/ingest.py`
  (Purview-native, "declared") need to stamp origin on the edges/`ColumnMap` entries
  they produce. This does not touch the stable `LineageGraph` shape's existing fields —
  it's a new optional field, safe against the Phase-1 → Phase-2 contract-stability
  constraint in PROJECT.md.
- **The Purview push dry-run/diff/per-entity-results chain is the largest backend
  dependency in this milestone.** PROJECT.md frames this milestone as "the gap is not
  backend capability," but the *existing* write paths were built to execute writes, not
  necessarily to preview them or report granular per-item outcomes. Before committing to
  a rich preview/diff/retry UI, confirm what `lineage_push.py`, `definitions.py`, and
  `dataproduct.py` currently return — if they're synchronous, all-or-nothing calls, this
  milestone needs a scoped backend task to add a preview mode and per-item result
  reporting, not just frontend work.
- **Audit/history directly tensions with an existing Out of Scope decision**
  ("Database-backed graph persistence... revisit only if multi-user concurrency becomes
  real"). Recommend resolving this explicitly in requirements: a minimal in-memory or
  flat-file push-history log (not a database) satisfies "did I already push this
  session" without violating the spirit of that decision — but it should be a deliberate
  call, not an accidental scope addition.
- **Deep-linkable URLs are a prerequisite for saved views**, and both depend on the
  rebuilt shell adopting URL-encoded state as a first-class concern from the start —
  retrofitting it later is expensive. Recommend deciding view-state URL shape early in
  the rebuild, even if saved views themselves ship later.
- **The force-directed knowledge-graph layout is non-deterministic by default** (typical
  of force simulations). If deep links are expected to reproduce the same visual layout
  on reload, either seed the simulation deterministically per node-set or encode the
  drill path (Estate → Workspace → Lakehouse) rather than raw coordinates — the drill
  path is already breadcrumb-navigable, so this is likely the simpler and more robust
  choice.

---

## MVP Definition

### Launch With (v1)

Minimum viable product for this milestone — must ship to satisfy PROJECT.md's Core
Value ("Purview gets populated from this app... must work, must look like a product").

- [ ] Upstream/downstream trace + path highlight + dim-on-focus on the lineage DAG — the exploration half of the core loop
- [ ] Table ↔ column granularity toggle carried through the rebuilt canvas
- [ ] Search-to-node that pans/focuses the canvas (upgrade from current list-only search)
- [ ] Purview push: scope selection via canvas multi-select
- [ ] Purview push: preview screen expressed in Purview's own vocabulary (dataset/process/qualified name), flagging create-vs-overwrite at minimum
- [ ] Purview push: explicit confirmation gate (hard PROJECT.md requirement)
- [ ] Purview push: execution progress + per-entity success/failure results
- [ ] Purview push: "see it land" — re-fetch and render pushed entities from Purview post-push
- [ ] Confidence/provenance visual distinction on edges (declared vs inferred) — directly addresses the Phase-1 approximation honesty requirement
- [ ] Definitions import and data-product flows relocated into the new shell as first-class destinations (already functionally exist; this milestone's job is UI placement, not new logic)
- [ ] Breadcrumb drill-down carried forward (already liked, already exists)
- [ ] Domain-colour legend on knowledge graph only (explicitly approved exception to "no persistent legends")

### Add After Validation (v1.x)

- [ ] Retry failed entities only (after confirming per-entity results actually surface partial failure in practice)
- [ ] Push audit/history (once the minimal-persistence approach is explicitly decided, not assumed)
- [ ] Full diff (field-level) against existing Purview state (start with create-vs-overwrite flagging only; add field diff if that proves insufficient)
- [ ] "Why do we think this?" inferred-edge inspector (depends on `parser.py` retaining source location — small backend addition, sequence after core push UX ships)
- [ ] Deep-linkable URLs + saved views (valuable but not required for the core "explore → push → confirm" loop to work)
- [ ] Hop-depth control (needed once real Fabric estates prove denser than the sample data)

### Future Consideration (v2+)

- [ ] Command-palette-as-universal-action-surface (beyond search)
- [ ] Motion-driven edge tracing polish
- [ ] Canvas-native lasso-select refinement for Purview scope (start with simpler multi-click/select in v1, upgrade the interaction later)
- [ ] Confidence-aware Purview push warnings (depends on confidence tagging already shipping and proving useful)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Trace + highlight + dim on lineage DAG | HIGH | MEDIUM | P1 |
| Purview push: scope select → preview → confirm → execute → land-confirmation | HIGH | HIGH | P1 |
| Purview push: per-entity results + progress | HIGH | MEDIUM | P1 |
| Confidence/provenance tagging + visual treatment | HIGH | MEDIUM | P1 |
| Definitions/data-product flows into new shell | MEDIUM | LOW | P1 |
| Table/column granularity toggle | MEDIUM | MEDIUM | P1 |
| Search-to-node canvas focus | MEDIUM | LOW | P1 |
| Purview push: retry subset | MEDIUM | MEDIUM | P2 |
| Purview push: field-level diff | MEDIUM | HIGH | P2 |
| Push audit/history | MEDIUM | MEDIUM (backend-scope-dependent) | P2 |
| Inferred-edge "why do we think this" inspector | MEDIUM | MEDIUM | P2 |
| Deep-linkable URLs | MEDIUM | MEDIUM | P2 |
| Saved views | LOW–MEDIUM | LOW (once URLs exist) | P3 |
| Command palette as universal actions | LOW–MEDIUM | MEDIUM | P3 |
| Motion-driven edge tracing | LOW (polish) | MEDIUM–HIGH | P3 |
| Data quality monitoring | N/A | N/A | Explicitly excluded |
| Minimap | N/A | N/A | Explicitly excluded (user dislike) |
| RBAC / approval workflows | N/A | N/A | Explicitly excluded (no auth this milestone) |

**Priority key:** P1: Must have for launch. P2: Should have, add when possible. P3: Nice to have, future consideration.

---

## Competitor Feature Analysis

| Feature | Reference Tools | Our Approach |
|---------|------------------|--------------|
| Column-level lineage | dbt Explorer (Enterprise only, static SQL parsing), Atlan, Alation, Select Star, DataHub, OpenMetadata all ship it as flagship | Already have the data shape (`ColumnMap`); focus effort on trace/highlight interaction, not re-deriving what already exists |
| Impact analysis framing | dbt Explorer, Collibra Diagrams, DataHub Impact Analysis tool all give upstream/downstream tracing a distinct "impact" label and framing | Reuse the same trace mechanism, apply "what breaks" copy/framing at the UI layer only — no new backend capability needed |
| Propagation-type edge labeling (AS IS/AGGREGATED/TRANSFORMED) | Select Star's explicit classification | Show the actual transform expression (already captured in `ColumnMap.transform`) on demand rather than a fixed 3-way classification — more honest given regex-derived approximation, avoids implying false precision |
| Write-to-catalog UX | No competitor studied publishes detailed write-flow UX (Purview's own portal has creation forms, not a "preview/diff/push" pattern); closest analogues are general infra dry-run tools (terraform, kubectl) | Build the dry-run/diff/confirm/progress/per-entity-result pattern from infra-tooling conventions, expressed in Purview's own entity vocabulary — this is a genuinely novel UX in the data-catalog space, which is exactly where PROJECT.md says the app should differentiate |
| Minimap for large-graph navigation | React Flow default, JointJS, Syncfusion, yFiles all offer one | Deliberately omit; rely on breadcrumbs + fit-to-view + search-to-node instead (user preference, and arguably a better fit for this app's more structured/hierarchical navigation model vs. free-form pan) |
| Confidence/staleness signaling | Power BI shows last-refresh + certified/promoted badges; no lineage-specific tool studied strongly foregrounds "this edge is inferred vs declared" as a first-class visual signal | Foreground it deliberately — this is the app's most honest answer to Phase-1's regex-derived approximation, and no competitor is forced to make the same admission |

---

## Sources

- [dbt Catalog / Explorer product page](https://www.getdbt.com/product/dbt-catalog) — column-level lineage, MEDIUM confidence (vendor site)
- [dbt Explorer developer blog](https://docs.getdbt.com/blog/dbt-explorer) — column-level lineage UX details, MEDIUM confidence
- [Atlan lineage documentation](https://docs.atlan.com/product/capabilities/lineage) and [view lineage how-to](https://docs.atlan.com/product/capabilities/lineage/how-tos/view-lineage) — MEDIUM confidence (vendor docs)
- [Collibra Data Lineage product page](https://www.collibra.com/products/data-lineage) and [Diagrams UX blog](https://www.collibra.com/blog/a-better-way-to-visualize-data-relationships-a-new-diagram-user-experience) — MEDIUM confidence
- [Alation Lineage Charts docs](https://docs.alation.com/en/latest/analyst/Lineage/LineageCharts.html), [Compound Layout docs](https://docs.alation.com/en/latest/analyst/Lineage/ExploreCompoundLayout.html) — MEDIUM confidence (vendor docs)
- [Select Star Data Lineage docs](https://docs.selectstar.com/features/lineage) — MEDIUM confidence (vendor docs)
- [Monte Carlo lineage/observability blog](https://montecarlo.ai/blog-data-lineage-and-data-observability/), [Orchestration Lineage feature post](https://montecarlo.ai/blog-now-featuring-orchestration-lineage/) — MEDIUM confidence
- [DataHub Impact Analysis docs](https://docs.datahub.com/docs/act-on-metadata/impact-analysis), [DataHub Lineage feature guide](https://docs.datahub.com/docs/features/feature-guides/lineage) — MEDIUM confidence (official OSS docs)
- [OpenMetadata Lineage Explore docs](https://docs.open-metadata.org/v1.12.x/how-to-guides/data-lineage/explore), [OpenMetadata Standards - Lineage](https://openmetadatastandards.org/lineage/lineage/) — MEDIUM confidence (official OSS docs)
- [Marquez Project](https://marquezproject.ai/), [Marquez GitHub](https://github.com/MarquezProject/marquez) — MEDIUM confidence (official OSS project)
- [Microsoft Purview Unified Catalog overview](https://learn.microsoft.com/en-us/purview/unified-catalog), [Unified Catalog Data Products](https://learn.microsoft.com/en-us/purview/unified-catalog-data-products), [Governance Domain and Data Map Domain recommendations](https://learn.microsoft.com/en-us/purview/data-gov-best-practices-domains-and-gov-domains) — HIGH confidence (official first-party docs)
- [Microsoft Purview classic lineage user guide](https://learn.microsoft.com/en-us/purview/data-gov-classic-lineage-user-guide), [create lineage relationships via REST API](https://learn.microsoft.com/en-us/purview/data-gov-api-create-lineage-relationships) — HIGH confidence (official docs); [Injecting lineage into Purview (Part 1)](https://www.microsoft.com/en-gb/industry/blog/technetuk/2022/08/12/injecting-lineage-and-attributes-into-microsoft-purview-part-1/) — MEDIUM confidence (Microsoft blog, practitioner-authored)
- [Microsoft Purview Glossary Terms in Unified Catalog](https://learn.microsoft.com/en-us/purview/unified-catalog-glossary-terms), [Governance Domains in Unified Catalog](https://learn.microsoft.com/en-us/purview/unified-catalog-governance-domains) — HIGH confidence (official docs)
- [Data Map Audit History (Olaf Wrieden)](https://medium.com/@olafwrieden/purview-data-governance-data-map-audit-history-explained-28e4686abc7c), [Microsoft Purview audit logs/diagnostics docs](https://learn.microsoft.com/en-us/purview/data-gov-classic-audit-logs-diagnostics) — HIGH confidence for the official doc, MEDIUM for the practitioner post
- ["The Dry Run Button" UX article](https://medium.com/@Praxen/the-dry-run-button-ux-that-saves-your-users-money-a0a9be0b16fe) — LOW-MEDIUM confidence (independent blog, but pattern corroborated by terraform/kubectl/ansible/git conventions which are well-established)
- [React Flow MiniMap docs](https://reactflow.dev/api-reference/components/minimap), [React Flow built-in components](https://reactflow.dev/learn/concepts/built-in-components) — HIGH confidence (official library docs)
- [Cambridge Intelligence — graph visualization UX](https://cambridge-intelligence.com/blog/designing-intuitive-data-experiences-with-graph-visualizations/) — MEDIUM confidence (specialist vendor, credible domain expertise)
- [Data Lineage Masterclass (Actian)](https://www.actian.com/data-lineage-masterclass/) — staleness/false-confidence framing, MEDIUM confidence (vendor content, but the underlying claim is a widely-echoed industry observation)
- [Power BI data lineage docs](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-data-lineage) — last-refresh/certified badge pattern, HIGH confidence (official docs)
- [Command Palette UX Patterns](https://uxpatterns.dev/patterns/advanced/command-palette), [Mobbin command palette gallery](https://mobbin.com/glossary/command-palette) — MEDIUM confidence (UX-pattern reference sites)
- [Algolia — faceted search & navigation UX](https://www.algolia.com/blog/ux/faceted-search-and-navigation) — MEDIUM confidence (search-vendor content, widely-cited pattern reference)

---
*Feature research for: data lineage / data catalog visualization tool with Microsoft Purview write-back*
*Researched: 2026-07-20*
