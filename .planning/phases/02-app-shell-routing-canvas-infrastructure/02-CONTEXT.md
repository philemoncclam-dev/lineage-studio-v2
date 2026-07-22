# Phase 2: App Shell, Routing & Canvas Infrastructure - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the flat top-bar view-switch and hand-rolled breadcrumb-array routing with a new mode-based shell (app-logo mode switcher + per-mode contextual left icon rail), TanStack Router with Fabric-style URL-addressable paths, and the shared cross-canvas plumbing (selection store, cached canvas-token reader, decomposed pure layout model) that both canvas rebuilds depend on — while the app stays usable and demoable at every commit. The canvas rebuilds themselves are Phases 3–4; the real Purview push UI is Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Information architecture (supersedes the flat "fourth peer destination" framing)
- **D-01:** Three top-level **modes**, not a flat destination list: **Knowledge Graph** view, **Lineage** view (Solidatus-like DAG), and **Purview** mode — the latter framed as an admin *toolkit* for enhancing/administering Purview.
- **D-02:** Mode switching happens via an **app-logo mode menu** — clicking the app mark opens a Datadog-style mode/product switcher. No segmented control or rail icons for mode switching.
- **D-03:** Each mode has its **own contextual left icon rail**. Rail contents are mode-specific:
  - Graph mode: drill scope levels (Estate/Workspace/Lakehouse/Table), filters, layout controls.
  - Lineage mode: dataset/scope picker, filters, trace/selection tools.
  - Purview mode: **full toolkit skeleton** — Push, Definitions Import, Data Products as rail items. Definitions hosts the existing working view; Push and Data Products are honest placeholder pages until Phase 5.
  - Rails may be thin in this phase; Phases 3–4 flesh out the canvas modes' tools. Claude has latitude on exact rail contents per mode.
- **D-04:** Rail presentation is **icon-only + tooltips**, slim (~48px). Chrome recedes (SHELL-02).
- **D-05:** Global utilities (Cmd+K search trigger, theme toggle, connection/backend status) live in a **rail-bottom cluster**, identical in every mode.

### URL scheme
- **D-06:** The URL path mirrors the **real Fabric/Purview hierarchy** — the absolute path Fabric/Purview would give the asset, not an app-invented scheme.
- **D-07:** Path segments use **readable display names** (e.g., `/graph/{workspace}/{lakehouse}/{table}`), resolved to Purview-GUID node IDs on load. Disambiguation only needed if duplicate names occur.
- **D-08:** Selected node/column lives in **typed search params** (`?sel={node}&col={column}`) — survives refresh/paste (SHELL-05) without pushing history entries, so browser back/forward walks drill levels, not selection clicks (SHELL-06).
- **D-09:** Unresolvable pasted URLs resolve to the **nearest existing ancestor** with a small non-blocking notice naming the segment that didn't resolve.

### Inspector
- **D-10:** The right-hand inspector is an **overlay panel** floating over the canvas's right edge with subtle elevation — the canvas never reflows (SHELL-03).
- **D-11:** Opens on any node/column selection; **Esc, close button, or empty-canvas click** clears selection and closes. Inspector visibility and selection state are one thing, mirroring the `?sel` URL param.
- **D-12:** In this phase the inspector shows a **real metadata card** (name, kind, workspace/lakehouse location, column list for tables, connected-edge counts) derived from the existing `LineageGraph`. Phases 3–4 deepen it with transforms/evidence.
- **D-13:** **Fixed width** (~360–400px from the token/spacing system). Revisit only if Phase 3 evidence needs more room.

### Migration sequencing
- **D-14:** User explicitly dislikes the old app's chrome ("I don't like the old apps stuff") and delegated build order. Locked order: **new shell first** (logo mode menu, rail, top bar) with old canvases embedded purely as interim content; the old top bar and view-switch are removed immediately → TanStack Router underneath → selection store + inspector → `model.tsx` decomposition (`adapt`/`lineageLayout`/`graphLayout`/`domainColor`) may run as a parallel plan per ROADMAP.md.
- **D-15:** Bridged old canvases (LineageView/GraphView) get a **token bridge only** — they already read Phase-1 tokens; make them fill the viewport and wire into selection, but write no throwaway styling code that Phases 3–4 will delete.
- **D-16:** SHELL-04 stands: the liked top-bar **button + segmented-control visual treatment carries forward as component styling** for new controls in the new shell — the old shell itself still dies.
- **D-17:** The Cmd+K palette is **rebuilt on the new token/component primitives** (fully keyboard-operable, launched from rail-bottom search + Cmd+K). `SearchPalette.tsx` retires with the old shell.

### Claude's Discretion
- Exact per-mode rail item sets and icons (within D-03's sketch).
- Exact route tree shape and TanStack Router file conventions, provided D-06–D-09 hold.
- Build-order detail within D-14, including what constitutes each demoable commit.
- Mode-menu design (contents, keyboard access) and placeholder-page treatment for Purview Push / Data Products.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 2 section: goal, SHELL-01..07 / NAV-01 / NAV-03 mapping, pitfalls #13/#14 guards, parallel-workstream allowance.
- `.planning/REQUIREMENTS.md` — SHELL and NAV requirement definitions.
- `.planning/PROJECT.md` — design direction (dark-first Datadog/Grafana), standing dislikes (no minimap, no persistent legends, no hint bars), locked stack decisions (TanStack Router, Tailwind v4 `@theme`).

### Design system (Phase 1 outputs)
- `.planning/phases/01-design-tokens-typography-foundation/01-UI-SPEC.md` — the token vocabulary and design contract all new shell chrome must use.
- `frontend/src/styles/tokens.css` and `frontend/src/styles/components.css` — the live token/component layer.
- `frontend/src/tokens/canvasTokens.ts` — cached canvas-token reader the shared plumbing builds on.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/tokens/canvasTokens.ts` — cached `CanvasTokens` snapshot with `data-theme` MutationObserver invalidation; the "cached canvas-token reader" named in the phase goal already exists and should be consumed, not rebuilt.
- `frontend/src/styles/components.css` — tier-3 component vocabulary (buttons, segmented control treatment) to build the new shell chrome from.
- `frontend/src/data.ts` / `frontend/src/api.ts` — graph loading; the name→GUID URL resolution (D-07) layers on top of the loaded `LineageGraph`.

### Established Patterns
- All styling flows through the Phase-1 token layer — no raw hex/px in new shell code (DS/THEME requirements; 01-REVIEW.md enforced this).
- `model.tsx` (228 lines) is the monolith the phase goal decomposes into `adapt`/`lineageLayout`/`graphLayout`/`domainColor` pure modules.

### Integration Points
- `App.tsx` (108 lines) holds the current top-bar view-switch and breadcrumb array — the seam the new shell + router replaces.
- `views/LineageView.tsx`, `views/GraphView.tsx`, `views/DefinitionsImport.tsx`, `views/PurviewPanel.tsx` — existing views to bridge into the new shell (token bridge only, D-15); `views/SearchPalette.tsx` retires (D-17).

</code_context>

<specifics>
## Specific Ideas

- "Lineage (Solidatus-like view)" — the user's mental model for the Lineage mode is Solidatus's structured left-to-right lineage presentation.
- Purview mode is "more like a toolkit for the user to make changes and enhance their administration of Purview" — frame its rail and pages as admin tooling, not a passive viewer.
- Mode switcher on the app logo, in the spirit of Datadog's product switcher.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 2-App Shell, Routing & Canvas Infrastructure*
*Context gathered: 2026-07-21*
