# Requirements: Lineage Studio — Frontend Rebuild + Purview Push UI

**Defined:** 2026-07-21
**Core Value:** Purview gets populated from this app — explore lineage visually → select what matters → push to Purview → see it land, in a UI you'd demo without apologising.

## Locked Decisions

Resolved before requirements, recorded so they aren't relitigated:

| Decision | Choice | Note |
|----------|--------|------|
| Knowledge-graph renderer | **sigma.js + graphology (MIT)** | Cosmograph rejected — CC-BY-NC-4.0 is a real risk for an employer-deployed tool. sigma.js is WebGL and comfortable well past 5k nodes. |
| Token/styling layer | **Tailwind CSS v4 `@theme`** | Tokens compile to real CSS custom properties, readable from canvas code. Parity relies on review discipline — see THEME-07, which exists precisely because of this. |
| Push audit/history | **Deferred to v1.x** | Preserves the no-database-persistence boundary. Per-push results shown live, not persisted. |
| Router | **TanStack Router** | Typed search params matter here — drill path and selection live in the URL. |
| Hop-depth control | **v1, not v1.x** | Research conflict resolved in favour of PITFALLS.md: hairball illegibility onsets in the low hundreds of nodes, so this is load-bearing, not polish. |

## v1 Requirements

### Design System (`DS`)

- [x] **DS-01**: UI and mono fonts are self-hosted and render identically on Windows 11 — no OS-dependent font stack appears anywhere in the codebase
- [x] **DS-02**: A single token layer is the sole source of truth for colour, type, spacing, radius, and elevation; the competing `index.css` / `App.css` bases are gone
- [x] **DS-03**: Type scale is systematic — the scattered 10.5/11.5/12.5/13/14/17px sizes are replaced by a defined ramp
- [x] **DS-04**: Spacing follows a consistent grid rather than ad-hoc pixel values
- [x] **DS-05**: Elevation is expressed as tiered surface lightness, not shadow — shadows do not read on a dark canvas
- [x] **DS-06**: Font loading produces no layout shift and no flash of invisible text

### Theming (`THEME`)

- [x] **THEME-01**: Palette is defined in a perceptual colour space (OKLCH) so lightness steps are visually even across hues
- [x] **THEME-02**: A single mechanism switches themes — the current triple definition (media query + two attribute selectors) is eliminated
- [x] **THEME-03**: Canvas and SVG rendering read colour from the same tokens as the DOM, via a snapshot cached and re-read only on theme change — never per frame
- [x] **THEME-04**: The dark canvas is a dark grey, not pure black, to avoid halation
- [x] **THEME-05**: Domain colours and edge-type colours are drawn from visually distinct ranges — the present-tense `--writes` == `--notebook` collision (`#8b5cf6` / `#a78bfa`) is fixed
- [x] **THEME-06**: Domain colours remain distinguishable under deuteranopia and protanopia simulation; where colour alone is insufficient, a second channel (shape, stroke, position) carries the distinction
- [ ] **THEME-07**: Light theme is reviewed on its own terms in its own dedicated pass — not as a comparison against dark, and not at the end of a phase
- [x] **THEME-08**: All text and meaningful non-text contrast meets WCAG AA in both themes

### App Shell (`SHELL`)

- [x] **SHELL-01**: A persistent left icon rail lists top-level destinations; adding a fifth destination requires no structural change
- [x] **SHELL-02**: The canvas fills the remaining viewport; chrome recedes visually
- [ ] **SHELL-03**: A contextual right-hand inspector opens on selection and closes without disturbing canvas layout
- [x] **SHELL-04**: The existing top-bar button and segmented-control treatment is carried forward — it is explicitly liked
- [x] **SHELL-05**: Routes are URL-addressable and shareable: destination, drill path, and selected node/column all survive a refresh and a paste into someone else's browser
- [x] **SHELL-06**: Browser back/forward moves through drill-down levels correctly
- [x] **SHELL-07**: The app remains usable and demoable at every commit — no window in which the rebuild leaves it broken or half-migrated

### Lineage DAG (`DAG`)

- [ ] **DAG-01**: Column-level lineage renders left-to-right with expandable table cards and column rows
- [ ] **DAG-02**: Column-to-column edges connect to the correct column rows, not merely to node boundaries
- [ ] **DAG-03**: Hovering a column traces its full upstream and downstream path; unrelated nodes and edges dim
- [ ] **DAG-04**: Clicking a column selects it persistently; selection survives hovering elsewhere
- [ ] **DAG-05**: The inspector shows a selected column's transformation expression, plain-English explanation, inputs, and outputs
- [ ] **DAG-06**: The view toggles between table-level and column-level detail
- [ ] **DAG-07**: Layout is deterministic — the same graph produces the same positions across renders
- [ ] **DAG-08**: Nodes and edges carry semantic labelling for assistive technology

### Knowledge Graph (`GRAPH`)

- [ ] **GRAPH-01**: The estate renders as a force-directed constellation with zoom, pan, and node drag
- [ ] **GRAPH-02**: Breadcrumb drill-down works through Estate → Workspace → Lakehouse → Table, handing off to the lineage DAG at table level
- [ ] **GRAPH-03**: Drill-in and drill-out transitions are animated and symmetric, preserving the user's mental map
- [ ] **GRAPH-04**: Hop-depth control limits visible neighbourhood, keeping the view legible on real estate-scale data
- [ ] **GRAPH-05**: The force layout settles to a stable state and does not re-jump when data is unchanged
- [ ] **GRAPH-06**: Nodes are clustered by domain, with a domain-colour legend (acceptable here because colour is load-bearing)
- [ ] **GRAPH-07**: Hovering a node traces its connections; unrelated nodes dim
- [ ] **GRAPH-08**: The canvas remains interactive at the node count of the real Fabric tenant, verified against a synthesized large graph rather than the bundled demo data
- [ ] **GRAPH-09**: Nodes are keyboard-reachable and expose an accessible text alternative to the visual graph

### Purview Push (`PUSH`)

Backend safety architecture already exists in `WriteSession` — dry-run by default, same non-drifting code path, per-op error reporting, double gate. These requirements are the UI over it.

- [ ] **PUSH-01**: The user selects push scope directly on the canvas, not through a separate disconnected form
- [ ] **PUSH-02**: A preview shows exactly what will be written, expressed in Purview's own vocabulary (entities, qualified names, lineage processes) — sourced from the backend dry run, never re-derived in the frontend
- [ ] **PUSH-03**: The preview distinguishes create, update-our-own, and overwrite-foreign, so the user can see when a push would clobber something they did not author
- [ ] **PUSH-04**: Human-curated Purview content is never silently overwritten — overwriting requires explicit, per-item acknowledgement
- [ ] **PUSH-05**: Execution requires an explicit confirmation step distinct from generating the preview
- [ ] **PUSH-06**: Execution shows live progress rather than an indeterminate spinner
- [ ] **PUSH-07**: Results are reported per entity, so a partial failure shows precisely what landed and what did not
- [ ] **PUSH-08**: After a push, the app re-fetches from Purview to confirm the write actually landed — accounting for eventual consistency rather than trusting the write response
- [ ] **PUSH-09**: When `PURVIEW_ALLOW_WRITE` is unset, the UI states plainly that it is in preview-only mode and why — it does not present a confirm button that silently does nothing
- [ ] **PUSH-10**: Lineage derived from regex parsing is visibly marked as inferred throughout the push flow, so approximate lineage does not acquire false authority once inside the catalog
- [ ] **PUSH-11**: Purview API throttling and batch limits are handled gracefully, with limits verified empirically against the real tenant rather than assumed

### Provenance & Trust (`TRUST`)

- [ ] **TRUST-01**: Edges are visually differentiated by provenance — declared by Purview vs inferred by regex parsing
- [ ] **TRUST-02**: The inspector explains why an inferred edge exists, showing the parsed evidence behind it
- [ ] **TRUST-03**: The UI shows when lineage data was last refreshed

### Definitions & Data Products (`CAT`)

- [ ] **CAT-01**: Column-definition import is a first-class destination in the rail, not a bolted-on panel
- [ ] **CAT-02**: Definition match proposals show confidence and allow per-row override before applying
- [ ] **CAT-03**: Data-product cataloguing is reachable as its own destination
- [ ] **CAT-04**: Both flows use the same preview → confirm → results pattern as PUSH, for one consistent write vocabulary

### Search & Navigation (`NAV`)

- [ ] **NAV-01**: Cmd+K opens a command palette searching tables, columns, and notebook code
- [ ] **NAV-02**: Selecting a search result focuses and reveals that node on the active canvas
- [ ] **NAV-03**: The palette is fully keyboard-operable

### Motion (`MOT`)

- [ ] **MOT-01**: Edge tracing is animated, making path direction readable
- [ ] **MOT-02**: Panels and the inspector transition rather than snapping
- [ ] **MOT-03**: All motion respects `prefers-reduced-motion`

## v2 Requirements

### Push Audit

- **AUDIT-01**: Persistent history of what was pushed, when, and by which run
- **AUDIT-02**: Retry a failed subset of a previous push
- **AUDIT-03**: Field-level diff against current Purview state

### Advanced Exploration

- **EXPL-01**: Saved views
- **EXPL-02**: Command palette as a universal action launcher, not only search
- **EXPL-03**: Impact-analysis mode ("what breaks if I change this")
- **EXPL-04**: Columns as first-class nodes in the knowledge graph

## Out of Scope

| Feature | Reason |
|---------|--------|
| Phase 2 Spark sandbox executor | Separate later milestone; swaps the extraction engine behind an unchanged `LineageGraph` contract — independent of all UI work |
| kdb+ lineage | Explicitly deferred; Fabric-first |
| AI chatbot consumption mode | Deferred |
| Per-user authentication / login | Credentials stay environment-driven via a shared service principal; a deployment concern, not this milestone |
| Database-backed persistence | Single in-memory graph slot is adequate; this boundary is what forces AUDIT-01 to v1.x |
| Node ID normalisation away from Purview GUIDs | GUIDs keep the lineage-push path a trivial lookup, which PUSH depends on |
| Minimap | User explicitly dislikes it; hop-depth control (GRAPH-04) and breadcrumbs (GRAPH-02) address the orientation problem it would have solved |
| Persistent node/kind legends in the top bar | User explicitly dislikes; domain legend on the knowledge graph only (GRAPH-06) |
| Per-layer Bronze/Silver/Gold labels on the lineage canvas | User explicitly dislikes — echoes the old app |
| Glyph/node icons and hint-text bars | User explicitly dislikes; nodes stay label-only |
| RBAC / permissions model | Single shared service principal; no per-user identity to enforce against |
| Bidirectional sync with Purview | Push-only is the milestone's scope; two-way sync is a much larger correctness problem |
| Data-quality monitoring | Different product; lineage is the concern here |
| Numeric confidence scores on lineage | Implies a precision the regex parser does not have — TRUST-01/02 use categorical provenance instead |
| Cosmograph renderer | CC-BY-NC-4.0 non-commercial licence is a real risk for an employer-deployed tool |
| Mobile / small-screen layouts | Desktop tool for staring at large graphs |

## Traceability

Populated by ROADMAP.md creation. Every v1 requirement below maps to exactly
one phase; see `.planning/ROADMAP.md` for phase goals, success criteria,
dependencies, parallelization, and pitfall guards.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DS-01 | Phase 1 | Complete |
| DS-02 | Phase 1 | Complete |
| DS-03 | Phase 1 | Complete |
| DS-04 | Phase 1 | Complete |
| DS-05 | Phase 1 | Complete |
| DS-06 | Phase 1 | Complete |
| THEME-01 | Phase 1 | Complete |
| THEME-02 | Phase 1 | Complete |
| THEME-03 | Phase 1 | Complete |
| THEME-04 | Phase 1 | Complete |
| THEME-05 | Phase 1 | Complete |
| THEME-06 | Phase 1 | Complete |
| THEME-07 | Phase 6 | Pending |
| THEME-08 | Phase 1 | Complete |
| SHELL-01 | Phase 2 | Complete |
| SHELL-02 | Phase 2 | Complete |
| SHELL-03 | Phase 2 | Pending |
| SHELL-04 | Phase 2 | Complete |
| SHELL-05 | Phase 2 | Complete |
| SHELL-06 | Phase 2 | Complete |
| SHELL-07 | Phase 2 | Complete |
| DAG-01 | Phase 3 | Pending |
| DAG-02 | Phase 3 | Pending |
| DAG-03 | Phase 3 | Pending |
| DAG-04 | Phase 3 | Pending |
| DAG-05 | Phase 3 | Pending |
| DAG-06 | Phase 3 | Pending |
| DAG-07 | Phase 3 | Pending |
| DAG-08 | Phase 3 | Pending |
| TRUST-01 | Phase 3 | Pending |
| TRUST-02 | Phase 3 | Pending |
| TRUST-03 | Phase 3 | Pending |
| GRAPH-01 | Phase 4 | Pending |
| GRAPH-02 | Phase 4 | Pending |
| GRAPH-03 | Phase 4 | Pending |
| GRAPH-04 | Phase 4 | Pending |
| GRAPH-05 | Phase 4 | Pending |
| GRAPH-06 | Phase 4 | Pending |
| GRAPH-07 | Phase 4 | Pending |
| GRAPH-08 | Phase 4 | Pending |
| GRAPH-09 | Phase 4 | Pending |
| PUSH-01 | Phase 5 | Pending |
| PUSH-02 | Phase 5 | Pending |
| PUSH-03 | Phase 5 | Pending |
| PUSH-04 | Phase 5 | Pending |
| PUSH-05 | Phase 5 | Pending |
| PUSH-06 | Phase 5 | Pending |
| PUSH-07 | Phase 5 | Pending |
| PUSH-08 | Phase 5 | Pending |
| PUSH-09 | Phase 5 | Pending |
| PUSH-10 | Phase 5 | Pending |
| PUSH-11 | Phase 5 | Pending |
| CAT-01 | Phase 5 | Pending |
| CAT-02 | Phase 5 | Pending |
| CAT-03 | Phase 5 | Pending |
| CAT-04 | Phase 5 | Pending |
| NAV-01 | Phase 2 | Pending |
| NAV-02 | Phase 7 | Pending |
| NAV-03 | Phase 2 | Pending |
| MOT-01 | Phase 7 | Pending |
| MOT-02 | Phase 7 | Pending |
| MOT-03 | Phase 7 | Pending |

**Coverage:**

- v1 requirements: 62 total
- Mapped to phases: 62
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-21*
*Last updated: 2026-07-21 after roadmap creation — traceability populated, full coverage confirmed*
