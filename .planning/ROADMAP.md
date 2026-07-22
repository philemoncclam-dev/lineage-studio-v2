# Roadmap: Lineage Studio — Frontend Rebuild + Purview Push UI

## Overview

The current frontend is a light-mode, Apple-styled prototype whose font stack
silently fails on Windows and whose token system already collides
(`--writes` == `--notebook`). This milestone replaces it end to end: a real
OKLCH token system and self-hosted fonts first, then a left-rail shell that
can hold Purview as a peer destination, then the two canvases (structured
lineage DAG, force-directed knowledge graph) rebuilt in parallel against that
shared foundation, then a first-class UI over the Purview write path that
already exists and is safe server-side today. A dedicated, standalone pass
reviews the light theme on its own terms — protecting the one requirement
research flagged as most likely to quietly degrade under schedule pressure —
and a final integration pass wires search-to-canvas and motion across the
finished product. At every commit along the way the app stays demoable:
no phase leaves the product in a half-migrated, worse-than-before state.

**Core value being delivered:** explore lineage visually → select what
matters → push to Purview → see it land, in a UI worth demoing.

## Locked Decisions (carried from requirements — do not relitigate)

- Knowledge-graph renderer: **sigma.js + graphology (MIT)**. No licensing gate
  task is scheduled anywhere in this roadmap — that decision is closed.

- Token/styling layer: **Tailwind CSS v4 `@theme`**.
- Router: **TanStack Router**.
- Hop-depth control (GRAPH-04): **in v1** (Phase 4), not deferred.
- Push audit/history: **deferred to v1.x** — not in this roadmap.
- Fonts: self-hosted Geist + Geist Mono via `@fontsource-variable/*`.
- Lineage DAG: `@xyflow/react` 12.11.2 + `@dagrejs/dagre`.
- **Purview push phase is UI-only.** `backend/app/purview/writer.py`'s
  `WriteSession` already implements dry-run-by-default on a single
  non-drifting code path, per-op error reporting, and a double gate (`apply`

  + `PURVIEW_ALLOW_WRITE`). No backend research or backend rework is
  scheduled for Phase 5 — the design work left is provenance display,
  create/update/overwrite classification in the preview, and the
  see-it-land re-fetch, all frontend.

## Sequencing Rationale

Three constraints shape this roadmap's order more than requirement category
alone:

1. **SHELL-07 (the app stays demoable at every commit)** is why tokens come
   before shell, shell comes before canvases, and why Phase 2 explicitly
   bridges the *old* canvases onto the *new* tokens rather than leaving
   stale hex values on screen while the rest of the app moves on (PITFALLS.md
   #13, #14). No phase boundary in this roadmap is allowed to leave two
   visibly different visual languages coexisting on screen.

2. **THEME-07 gets its own phase (Phase 6), not a line item.** Every
   visual-design-touching phase (1, 3, 4, 5) still carries its own
   independent-light-mode-review checklist item as standing discipline
   (PITFALLS.md #12) — Phase 6 is an *additional*, deliberate, standalone
   pass over the finished surface, done without dark mode open for
   comparison. This is the one place in this roadmap where a single
   v1 requirement gets its own phase rather than folding into a neighbor,
   because folding it in is the exact failure mode it exists to prevent.

3. **Purview push is not scheduled last.** It is Phase 5, sequenced
   immediately after the Lineage DAG canvas (which it depends on for
   canvas-native scope selection) and in parallel with the Knowledge Graph
   canvas — not after both canvases, not after motion polish. It is the
   milestone's core value and is sized smaller than its pitfall count
   suggests only because the backend write-safety plumbing already exists.

## Phases

**Phase Numbering:**

- Integer phases (1-7): planned milestone work, this roadmap's full scope.
- Decimal phases (e.g. 2.1): reserved for urgent insertions, none yet.

- [ ] **Phase 1: Design Tokens & Typography Foundation** - Self-hosted fonts and a single OKLCH token layer replace the six-file CSS system and fix the Windows font bug and the `--writes`/`--notebook` collision.
- [ ] **Phase 2: App Shell, Routing & Canvas Infrastructure** - Left icon rail, contextual inspector, URL-addressable routing, and the shared selection/canvas-token infrastructure both canvases will consume.
- [ ] **Phase 3: Lineage DAG Canvas Rebuild** - Column-level DAG rebuilt on `@xyflow/react` + dagre, with provenance/trust treatment and full keyboard/ARIA reachability. *(parallel with Phase 4)*
- [ ] **Phase 4: Knowledge Graph Canvas Rebuild** - Force-directed estate constellation rebuilt on sigma.js + graphology, with hop-depth control, stable layout, and domain clustering. *(parallel with Phase 3)*
- [ ] **Phase 5: Purview Push & Catalog Destinations** - First-class scope-select → preview → confirm → execute → results → see-it-land UI over the existing write path, plus definitions and data-product destinations on the same pattern. *(parallel with Phase 4)*
- [ ] **Phase 6: Light Theme Dedicated Review** - Light theme reviewed independently, on its own terms, across the complete built surface.
- [ ] **Phase 7: Cross-Canvas Integration & Motion Polish** - Search-to-canvas wiring and motion (edge tracing, panel transitions) layered onto finished interactions, last because it depends on everything else being functionally done.

## Phase Details

### Phase 1: Design Tokens & Typography Foundation

**Goal**: Replace the current OS-dependent font stack and six-file CSS system with one self-hosted, OKLCH-based token layer that both DOM and canvas code read from, with dark-first values that are correct by construction rather than mechanically inverted.
**Depends on**: Nothing (first phase)
**Can run parallel with**: Nothing — blocks all other phases; must land first.
**Requirements**: DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, THEME-01, THEME-02, THEME-03, THEME-04, THEME-05, THEME-06, THEME-08
**Guards against (pitfalls)**: #7 (domain/edge-type color collision — `--writes`/`--notebook` fixed here, before any new token is added on top), #8 (colorblind-unsafe domain palette), #9 (pure-black halation, shadow-only elevation), #10 (mechanically-inverted colors vibrating on dark), #11 (contrast checked against composited/color-mix backgrounds, not just declared tokens), #18 (silent font-fallback recurrence). Also opens the standing per-phase light-mode-review discipline (#12) that continues through every later visual phase.
**Success Criteria** (what must be TRUE):

  1. The self-hosted Geist/Geist Mono fonts render identically on Windows 11, verified by an explicit computed-font-family check in devtools — no `-apple-system`/`SF Pro`/OS-dependent stack remains anywhere in the codebase
  2. Font loading produces no layout shift and no flash of invisible text
  3. One token layer (Tailwind v4 `@theme`) is the sole source of truth for color, type, spacing, radius, and elevation; `index.css` and `App.css`'s competing bases are gone
  4. Type scale and spacing follow defined, systematic ramps rather than the scattered ad-hoc values (10.5/11.5/12.5/13/14/17px) they replace
  5. No two tokens across different semantic channels (domain / edge-type / interaction-state) share a hue — verified by grepping the token file for duplicate values, closing the present-tense `--writes` == `--notebook` bug
  6. The dark canvas is dark grey, not pure black, with a tiered elevation system that reads correctly with shadow contribution minimized; the domain palette passes deuteranopia/protanopia simulation in both themes
  7. All text and meaningful non-text contrast meets WCAG AA in both themes, checked against actual composited/color-mix backgrounds

**Plans**: 4/4 plans executed

- [x] 01-01-PLAN.md
- [x] 01-02-PLAN.md
- [x] 01-03-PLAN.md
- [x] 01-04-PLAN.md

**UI hint**: yes

### Phase 2: App Shell, Routing & Canvas Infrastructure

**Goal**: Replace the flat top-bar view-switch and hand-rolled breadcrumb-array routing with a left icon rail, a URL-addressable router, and the shared cross-canvas plumbing (selection store, cached canvas-token reader, decomposed pure layout model) that both canvas rebuilds depend on — without ever leaving the app in a broken or half-migrated state.
**Depends on**: Phase 1
**Can run parallel with**: Nothing external — this phase's own two workstreams (router+shell vs. `model.tsx` decomposition into `adapt`/`lineageLayout`/`graphLayout`/`domainColor`) can run as parallel plans within it.
**Requirements**: SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06, SHELL-07, NAV-01, NAV-03
**Guards against (pitfalls)**: #13 (full-rebuild becomes an undemoable blob — treat this phase's own build order as load-bearing, not compressible under pressure), #14 (half-migrated design system looks worse than the old prototype — bridge the *existing* LineageView/GraphView onto the new tokens as an interim measure inside the new shell, rather than leaving old raw hex values on screen while chrome has already moved on). Continues the standing light-mode-review discipline (#12) for all new shell chrome.
**Success Criteria** (what must be TRUE):

  1. A persistent left icon rail lists top-level destinations; the canvas fills the remaining viewport and chrome recedes visually; adding a fifth destination requires no structural change
  2. A contextual right-hand inspector opens on selection and closes without disturbing canvas layout
  3. Destination, drill path, and selected node/column are all URL-addressable: they survive a refresh and a paste into another browser, and browser back/forward moves correctly through drill-down levels
  4. The existing, explicitly-liked top-bar button and segmented-control visual treatment is carried forward unchanged into the new shell
  5. Cmd+K opens a fully keyboard-operable command palette searching tables, columns, and notebook code
  6. At every commit within this phase, the running app remains usable and demoable — the old canvases, temporarily bridged onto the new tokens, keep working inside the new shell until Phases 3-4 replace them outright

**Plans**: 5/6 plans executed
**Wave 1**

- [x] 02-01-PLAN.md — Toolchain foundation: deps + Vitest/jsdom test infra (blocking package-legitimacy gate)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — model.tsx decomposition into adapt/lineageLayout/graphLayout/domainColor (pure, parallel)
- [x] 02-03-PLAN.md — TanStack Router + root loader + name→GUID resolver + selection search-param store

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-04-PLAN.md — Mode-based shell chrome: logo menu, data-driven rail, rail-bottom cluster, tier-3 tokens, canvas bridge, Purview placeholders

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-05-PLAN.md — Non-modal overlay inspector + canvas selection wiring (SHELL-03)
- [ ] 02-06-PLAN.md — cmdk command palette rebuild, retire SearchPalette (NAV-01/03)

**UI hint**: yes

### Phase 3: Lineage DAG Canvas Rebuild

**Goal**: Rebuild the column-level lineage view on `@xyflow/react` + dagre with correct column-row edge anchoring, hover-to-trace, persistent selection, an inspector that explains transforms and inferred-edge evidence, and full keyboard/assistive-technology reachability — establishing the provenance treatment the Purview-push phase depends on.
**Depends on**: Phase 2
**Can run parallel with**: Phase 4 (Knowledge Graph Canvas Rebuild) — neither depends on the other, both depend only on Phase 2's shared infrastructure.
**Requirements**: DAG-01, DAG-02, DAG-03, DAG-04, DAG-05, DAG-06, DAG-07, DAG-08, TRUST-01, TRUST-02, TRUST-03
**Guards against (pitfalls)**: #6 (regex-derived lineage must already carry visible provenance before Phase 5's push flow can rely on it — sequence this before/alongside, not after), #19 (SVG semantic labeling for screen readers; full node/edge keyboard reachability, dual-purposed with the power-user speed goal rather than deferred as a separate accessibility pass). Continues the standing light-mode-review discipline (#12).
**Success Criteria** (what must be TRUE):

  1. Column-level lineage renders left-to-right with expandable table cards; column-to-column edges connect to the exact column rows, not merely to node boundaries
  2. Hovering a column traces its full upstream and downstream path, dimming unrelated nodes and edges; clicking a column selects it persistently, surviving hovering elsewhere
  3. The inspector shows a selected column's transformation expression, plain-English explanation, inputs, and outputs
  4. The view toggles between table-level and column-level detail; layout is deterministic — the same graph produces the same positions across renders
  5. Edges are visually differentiated by provenance (declared by Purview vs. inferred by regex parsing); the inspector explains why an inferred edge exists, showing the parsed evidence behind it; the UI shows when lineage data was last refreshed
  6. Every node and edge reachable by mouse is also reachable and operable via keyboard alone, and carries semantic labelling for assistive technology

**Plans**: TBD
**UI hint**: yes

### Phase 4: Knowledge Graph Canvas Rebuild

**Goal**: Rebuild the knowledge-graph constellation on sigma.js + graphology with stable, warm-started force layout, hop-depth limiting as load-bearing hairball mitigation (not polish), domain clustering with a colorblind-safe legend, and drill-in/out transitions anchored to the clicked node.
**Depends on**: Phase 2
**Can run parallel with**: Phase 3 (Lineage DAG Canvas Rebuild) — neither depends on the other, both depend only on Phase 2's shared infrastructure.
**Requirements**: GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04, GRAPH-05, GRAPH-06, GRAPH-07, GRAPH-08, GRAPH-09
**Guards against (pitfalls)**: #15 (hairball onset well below rendering-performance limits — protect the Estate→Workspace→Lakehouse→Table drill-down and hop-depth control as load-bearing, test against a synthesized large graph, not just the bundled demo dataset), #16 (unstable/re-jumping force layout — warm-start from prior positions, deterministic cold-start seed, tuned damping so layout doesn't recompute on unrelated re-renders like hover), #17 (illegible drill-in — anchor every transition to the clicked node's screen position using sigma's own camera-easing APIs, keep drill-out symmetric with drill-in), #19 (keyboard reachability and an accessible text alternative to the visual graph). Continues the standing light-mode-review discipline (#12).
**Success Criteria** (what must be TRUE):

  1. The estate renders as a force-directed constellation with zoom, pan, and node drag
  2. Breadcrumb drill-down works through Estate → Workspace → Lakehouse → Table, handing off to the lineage DAG at table level
  3. Drill-in and drill-out transitions are animated, symmetric, and anchored to the interaction that triggered them, preserving the user's mental map
  4. Hop-depth control keeps the view legible on real estate-scale data, verified against a synthesized large graph rather than only the bundled demo dataset
  5. The force layout settles to a stable state and does not re-jump when data is unchanged — reloading the same graph produces a recognizably similar layout, and hovering a node never moves unrelated nodes
  6. Nodes are clustered by domain with a domain-colour legend that remains distinguishable under deuteranopia/protanopia simulation, varying on lightness as well as hue
  7. Nodes are keyboard-reachable and expose an accessible text alternative to the visual graph

**Plans**: TBD
**UI hint**: yes

### Phase 5: Purview Push & Catalog Destinations

**Goal**: Make the Purview write path — already safe, dry-run-by-default, and per-op-reporting on the backend — reachable and trustworthy through a first-class UI: canvas-native scope selection, a preview in Purview's own vocabulary that classifies create/update-own/overwrite-foreign, explicit per-item overwrite acknowledgement, live per-entity execution results, and a bounded-backoff re-fetch that actually confirms the write landed. Definitions import and data-product cataloguing move into the same shell as first-class destinations using the identical preview → confirm → results pattern.
**Depends on**: Phase 3 (needs the rebuilt Lineage DAG canvas as the on-canvas scope-selection surface for PUSH-01, and its provenance/TRUST treatment as the source for PUSH-10's inferred-lineage marking)
**Can run parallel with**: Phase 4 (Knowledge Graph Canvas Rebuild) — this phase does not depend on the knowledge-graph canvas.
**Requirements**: PUSH-01, PUSH-02, PUSH-03, PUSH-04, PUSH-05, PUSH-06, PUSH-07, PUSH-08, PUSH-09, PUSH-10, PUSH-11, CAT-01, CAT-02, CAT-03, CAT-04
**Guards against (pitfalls)**: #1 (write safety treated as five separable design problems, not one preview screen), #2 (qualified-name collision — classify every write target as create / update-own / overwrite-foreign against a live read, surfaced as the preview's most prominent line, never constructed from unstable regex-derived names), #3 (human-curated Purview content silently overwritten — write-only-if-empty by default, current-vs-proposed value shown per field, explicit per-field override required), #4 (partial-batch failure reported opaquely — per-entity results table, retry acts on the failed subset only), #5 (false "it landed" confirmation — bounded-backoff polling with an explicit pending-confirmation state, never a single immediate re-fetch), #6 (regex-derived lineage acquiring false authority once in Purview — inferred edges visibly flagged throughout scope selection, preview, and confirmation copy, not just on the exploration canvas). No backend research or backend rework is in scope here — `WriteSession`'s dry-run-by-default, single-code-path, per-op-reporting, double-gate behavior is already verified.
**Success Criteria** (what must be TRUE):

  1. The user selects push scope directly on the canvas, not through a separate disconnected form
  2. The preview shows exactly what will be written, expressed in Purview's own vocabulary (entities, qualified names, lineage processes), sourced from the backend dry run and never re-derived in the frontend — and it distinguishes create, update-our-own, and overwrite-foreign so the user can see when a push would clobber something they did not author
  3. Overwriting human-curated content requires explicit, per-item acknowledgement; execution requires a confirmation step distinct from generating the preview
  4. Execution shows live per-entity progress rather than an indeterminate spinner, and results are reported per entity so a partial failure shows precisely what landed and what did not
  5. After a push, the app re-fetches from Purview with bounded polling to confirm the write actually landed, rather than trusting the write response alone; when `PURVIEW_ALLOW_WRITE` is unset, the UI plainly states preview-only mode and why, with no confirm button that silently does nothing
  6. Lineage derived from regex parsing is visibly marked as inferred throughout the push flow; Purview API throttling and batch limits are handled gracefully, verified empirically against the real tenant
  7. Column-definition import and data-product cataloguing are first-class rail destinations, not bolted-on panels; definition match proposals show confidence and allow per-row override before applying; both flows use the same preview → confirm → results pattern as the lineage push

**Plans**: TBD
**UI hint**: yes

### Phase 6: Light Theme Dedicated Review

**Goal**: Review the light theme on its own terms, independently, across the complete built surface (shell, both canvases, push/catalog flows) — not as a side-by-side comparison against dark mode and not as an end-of-phase afterthought. This is the roadmap's explicit, standalone protection for the one requirement most likely to quietly degrade under schedule pressure.
**Depends on**: Phase 3, Phase 4, Phase 5 (needs the full light-mode surface built to review it meaningfully)
**Can run parallel with**: Nothing — a focused, single-purpose review pass over the preceding phases' completed output.
**Requirements**: THEME-07
**Guards against (pitfalls)**: #12, fully resolved here — the mechanical-inversion failure mode where dark mode gets real design attention and light mode is filled in fast at the end. Every earlier visual phase (1, 3, 4, 5) already carried its own incremental light-mode checklist item as standing discipline; this phase is the deliberate, additional, deep pass beyond that discipline, not the only time light mode gets attention.
**Success Criteria** (what must be TRUE):

  1. Every screen, canvas, and flow is reviewed in light mode alone, with dark mode not open for comparison, checking readability, domain-color vividness, and elevation-tier distinguishability on their own terms
  2. The domain-color legend and edge-type colors are independently confirmed distinguishable — including a fresh colorblind simulation pass — in light mode, not assumed to carry over from the dark-mode pass
  3. Elevation tiers are distinguishable from one another in light mode with their own tuning (white-on-white has less perceptual room than black-on-black, so a lightness-inverted-only tier system is explicitly rejected here if found)
  4. All WCAG AA contrast checks are independently re-verified in light mode against actual composited backgrounds, not inherited from the dark-mode checks

**Plans**: TBD
**UI hint**: yes

### Phase 7: Cross-Canvas Integration & Motion Polish

**Goal**: Wire search-result selection through to whichever canvas is active, and layer motion — animated edge tracing, transitioning (not snapping) panels — on top of interactions that already work everywhere else. Sequenced last deliberately: additive on top of finished interaction, and blocked by everything else being functionally done rather than blocking anything itself.
**Depends on**: Phase 3, Phase 4, Phase 5, Phase 6 (everything else functionally complete)
**Can run parallel with**: Nothing — final integration and polish gate.
**Requirements**: NAV-02, MOT-01, MOT-02, MOT-03
**Guards against (pitfalls)**: #17 (finishing symmetric, anchored drill motion if any residual work remains from Phase 4), plus a final `prefers-reduced-motion` check across every animation added anywhere in the app. Motion added here must not introduce any color values outside what Phase 6 already reviewed — spot-check both themes if it does.
**Success Criteria** (what must be TRUE):

  1. Selecting a search-palette result focuses and reveals that node on whichever canvas is currently active
  2. Edge tracing is animated so upstream/downstream path direction is legible, on both canvases
  3. The inspector and other panels transition open/closed rather than snapping
  4. All motion in the app respects `prefers-reduced-motion`

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases 1 → 2 are strictly sequential. At the Phase 2 → {3, 4} boundary, up to
two workstreams run concurrently (Lineage DAG canvas, Knowledge Graph
canvas). Phase 5 starts as soon as Phase 3 completes and runs alongside
Phase 4. Phase 6 waits for 3, 4, and 5 together. Phase 7 waits for
everything (3, 4, 5, 6) and closes the milestone.

```
1 → 2 → ┬─ 3 ──┬─ 5 ─┐
        └─ 4 ──┴─────┼─ 6 → 7
                      │
        (5 also feeds into 6)
```

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 1. Design Tokens & Typography Foundation | 4/4 | In Progress|  |
| 2. App Shell, Routing & Canvas Infrastructure | 5/6 | In Progress|  |
| 3. Lineage DAG Canvas Rebuild | 0/TBD | Not started | - |
| 4. Knowledge Graph Canvas Rebuild | 0/TBD | Not started | - |
| 5. Purview Push & Catalog Destinations | 0/TBD | Not started | - |
| 6. Light Theme Dedicated Review | 0/TBD | Not started | - |
| 7. Cross-Canvas Integration & Motion Polish | 0/TBD | Not started | - |
