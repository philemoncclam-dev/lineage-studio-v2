# Project Research Summary

**Project:** Lineage Studio -- frontend rebuild + first-class Purview push UI
**Domain:** Dark-first, graph-canvas-heavy data lineage/catalog tool with a governance-system write path (Datadog/Grafana idiom, React 19 + FastAPI)
**Researched:** 2026-07-20
**Confidence:** MEDIUM overall

## Executive Summary

This milestone combines a full visual/interaction rebuild of a graph-canvas app (fixing a diagnosed OS-dependent font bug plus a dark-first Datadog/Grafana redesign) with productizing a Purview write path that already works on the backend but is barely reachable in the UI. The frontend rebuild is the right scope call (the current shell cannot absorb a fourth peer destination); the Purview push is where the real design risk lives -- it looks like build a preview screen but is actually five correctness problems (qualified-name overwrite, human-authored-field overwrite, partial-batch failure, false it-landed confirmation, and provenance laundering of regex-derived lineage into a trusted system of record).

Recommended approach: build the token/design-system layer first (OKLCH palette, Tailwind v4 @theme, self-hosted Geist/Inter, single light-dark() mechanism), since it blocks everything visual and is where color-collision, halation, colorblind-safety, and font-fallback pitfalls must be caught before 20+ components are built against them. Then split model.tsx into pure layout functions, stand up a router + two Zustand stores, and build both canvases in parallel. The Purview-push destination can start in parallel with the canvases (it depends on shell/router, not canvases) but has its own backend dependency chain that must be confirmed early.

Key risks: two open decisions need a human call (Cosmograph's CC-BY-NC-4.0 license vs. sigma.js MIT; Tailwind v4 vs. vanilla-extract for enforcing theme parity); the "light theme at full parity" requirement is explicitly accepted "against recommendation" and is exactly the kind of requirement that degrades under deadline pressure; and the Purview-push safety work is large and backend-dependent enough to be mistaken for a UI feature when it is really five design problems.

## Key Findings

### Recommended Stack (STACK.md)
- Tailwind CSS v4 `@theme` -- compiles tokens into real CSS custom properties readable from both DOM and canvas `getComputedStyle()`
- `@xyflow/react` 12.11.2 + `@dagrejs/dagre` -- mandatory low-risk upgrade from EOL `reactflow@11` for the lineage DAG
- Knowledge-graph renderer: Cosmograph (best perf, GPU force, CC-BY-NC-4.0) vs. sigma.js+graphology (MIT, WebGL) -- unresolved, see below
- Motion v12 for DOM/SVG transitions only; canvas-internal motion uses each graph library's own camera APIs
- Self-hosted `@fontsource-variable/geist`+`geist-mono` -- fixes the Windows font-fallback bug; verify small-size legibility on real Windows 11
- Radix UI (hand-composed) + `cmdk`; Base UI is more modern but still RC, not GA

### Expected Features (FEATURES.md)
**Must have (v1):** upstream/downstream trace+dim, table-column toggle, search-to-node canvas focus, Purview push (scope select -> preview in Purview vocabulary -> confirm -> execute+progress -> per-entity results -> "see it land" re-fetch), confidence/provenance edge treatment, definitions/data-product flows as first-class destinations, breadcrumb drill-down, domain-colour legend (knowledge graph only).
**Differentiators:** canvas-native scope selection for Purview push, "why do we think this" inferred-edge inspector, deep-linkable URLs/saved views, motion-driven edge tracing.
**Defer to v1.x/v2:** field-level diff, retry-subset, push audit/history (tensions with "no DB persistence" out-of-scope call), command-palette-as-universal-actions.
**Excluded:** minimap, persistent legends/glyphs/hint-bars, RBAC, bidirectional sync, data-quality monitoring, numeric confidence scores.

### Architecture Approach (ARCHITECTURE.md -- HIGH confidence, read against live code)
Shell: IconRail -> routed destination -> contextual Inspector, with two small Zustand stores (`selectionStore`, `uiStore`) for cross-canvas state. `model.tsx` splits into pure `adapt.ts`/`lineageLayout.ts`/`graphLayout.ts`/`domainColor.ts` (no React/DOM). Canvas token reads move from per-frame `getComputedStyle()` to a cached snapshot re-read only on theme change. Router (TanStack Router recommended, LOW confidence) replaces the hand-rolled breadcrumb-array anti-pattern, making drill path and selection URL-addressable.

### Critical Pitfalls (PITFALLS.md)
1. Purview write safety treated as one screen instead of five design problems -- decompose explicitly
2. Qualified-name collision silently overwrites existing Purview lineage -- resolve/classify create vs. update-own vs. overwrite-foreign before writing
3. Domain color and edge-type color are already the exact same hex in the current token system (`--writes` == `--notebook`) -- present-tense bug, fix before adding new tokens
4. Pure-black canvas + shadow-based elevation breaks (halation) -- use dark gray + tiered surface-lightness elevation
5. "Light theme at full parity" quietly degrades into a mechanical inversion of dark theme -- needs its own scheduled review, not an assumed side effect

## Implications for Roadmap

### Open Decisions Requiring a Human Call
1. **Cosmograph (CC-BY-NC-4.0) vs. sigma.js (MIT)** for the knowledge-graph renderer -- whether an internal, employer-owned tool counts as "commercial" is a legal/policy call, not technical. Resolve before/at the start of the knowledge-graph canvas phase; default to sigma.js if unresolved.
2. **Tailwind v4 `@theme` vs. vanilla-extract** for theme-parity enforcement -- Tailwind is faster to adopt; vanilla-extract's theme contracts make a missing light-theme token a compile error, directly addressing the "light parity accepted against recommendation" risk. Real cost/rigor tradeoff for the user to weigh, not silently resolved here.
3. **TanStack Router vs. React Router v7** -- recommended TanStack Router but LOW confidence (single web-search pass); override freely if the team has React Router familiarity.
4. **Minimal push-audit/history persistence** -- tensions with the explicit "no database-backed persistence" out-of-scope decision; needs a deliberate scope call in requirements/roadmap, not an assumption either way.

### Suggested Build Order (dependency-numbered; same number = parallelizable)
1. Design tokens + self-hosted font -- blocks everything visual; also where Pitfalls 3, 4, 5 (plus colorblind-safety, halation) must be caught via UAT checklist
2. Directory scaffold + `shared/api` (TanStack Query) + Zustand store skeletons -- parallel with 1
3. (parallel, both depend on 1+2) Router+shell (open decision #3 made here) AND `model.tsx` decomposition -- independent of each other
4. Shared canvas infra (`useCanvasTokens`, `trace()`, selection wiring) -- depends on 2+3
5. (parallel, both depend on 4) Lineage DAG canvas rebuild AND knowledge-graph canvas rebuild -- neither depends on the other; knowledge-graph phase is where open decision #1 and Pitfalls 15-17 (hairball, unstable force layout, illegible drill-in) live
6. (parallel with 5, depends only on 2+3) Purview-push destination AND definitions/data-product destinations -- push destination carries the largest backend-dependency risk; confirm actual dry-run/per-entity-result behavior of `lineage_push.py`/`definitions.py`/`dataproduct.py` before designing its UI, per Pitfalls 1, 2, 4
7. Cross-canvas selection wiring + drill-down URL sync -- needs both 5 and 3 done
8. Motion/polish pass -- explicitly last; needs anchor-point data from canvas-rebuild phases (Pitfall 17)

**Genuine parallelism:** phases 1/2; the two halves of phase 3; both canvases in phase 5; Purview-push + definitions in phase 6 alongside the canvases. Up to four workstreams active simultaneously at the 5/6 boundary.

### Pitfalls Mapped to Phase
- Design tokens (1): Pitfalls 3, 4, 5, 9-10 (vibration/contrast), 12 (light-theme discipline, also cross-cutting), 18 (font-fallback recurrence)
- Shell/router (3): Pitfall 13 (rebuild-as-undemoable-blob)
- Knowledge-graph canvas (5): Pitfalls 15 (hairball), 16 (unstable force layout), 17 (illegible drill-in), 19 (accessibility)
- Lineage DAG canvas (5): Pitfall 19 (SVG semantic labeling)
- Purview-push (6): Pitfalls 1, 2, 3, 4, 5, 6 -- highest-consequence failure modes in the milestone
- Motion/polish (8): Pitfall 17 (legibility, symmetric forward/back)
- Cross-cutting every phase: Pitfalls 12, 14 (half-migrated system reading as broken)

### Contradictions Surfaced
- STACK.md frames the Cosmograph/sigma decision as needing resolution "before this phase is planned"; ARCHITECTURE.md's build order places it inside phase 5 as a parallel item -- the license decision is actually on phase 5's critical path, not a pre-roadmap gate. Roadmap should schedule it as an explicit first task of the knowledge-graph phase.
- FEATURES.md flags "push audit/history" as tensioning directly with PROJECT.md's no-DB-persistence out-of-scope decision, and doesn't resolve it -- elevated here as Open Decision #4 rather than left implicit.
- ARCHITECTURE.md's router recommendation is explicitly LOW confidence; PITFALLS.md doesn't revisit the choice of router product at all (only that routing itself is needed) -- the product choice remains genuinely open even though adopting a router is unanimous.
- Scale tension: FEATURES.md defers hop-depth control to v1.x, while PITFALLS.md's Pitfall 15 calls the same control "load-bearing hairball mitigation," not deferrable -- worth revisiting whether it belongs in v1 for the knowledge-graph phase specifically.

### Research Flags
- **Needs deeper research:** Purview-push phase (actual current dry-run/per-entity-result behavior of the write-path backend files, unconfirmed by this research pass -- no backend code read); knowledge-graph canvas phase (Cosmograph license resolution, realistic Fabric-tenant node-count scale).
- **Standard patterns, skip research-phase:** design tokens phase (OKLCH/`light-dark()`/Tailwind v4 are Baseline-shipped); lineage DAG canvas phase (`@xyflow/react`+dagre is a well-trodden upgrade); definitions/data-product relocation phase (mostly moving existing working logic).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | npm versions verified directly (HIGH); qualitative claims web-search only |
| Features | MEDIUM | 9 vendor products + Microsoft Learn cross-checked; Purview concept mapping HIGH (first-party docs) |
| Architecture | HIGH for codebase claims (direct file reads); LOW-MEDIUM for router/state-library ecosystem opinions |
| Pitfalls | MEDIUM-HIGH | Codebase-specific pitfalls HIGH (verified in `App.css`); Purview/Atlas behavior MEDIUM (official docs + Apache Atlas community proxy); general UI/graph/a11y pitfalls MEDIUM |

**Overall confidence:** MEDIUM -- architecture is solid ground, but the two open decisions and unconfirmed backend write-path behavior mean this is a strong starting point with explicit gates, not a fully resolved plan.

### Gaps to Address
- Backend write-path behavior (dry-run mode, per-entity results) is unverified against actual code -- resolve during Purview-push phase discussion, not assumed from FEATURES.md inference alone
- Real Fabric tenant scale is unknown -- test the knowledge-graph phase against a synthesized large graph, not just the bundled demo dataset
- Router choice is LOW-confidence -- revisit before locking in phase 3's shell work
- Base UI's GA status should be re-checked at execution time (RC as of 2026-07-15 in this research pass)

## Sources

### Primary (HIGH confidence)
- Direct codebase reads: `frontend/src/App.tsx`, `model.tsx`, `api.ts`, `App.css`, `views/GraphView.tsx`, `views/LineageView.tsx`, `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `.planning/PROJECT.md`
- npm registry direct version verification (`@xyflow/react`, `tailwindcss`, `motion`, `@dagrejs/dagre`, `@radix-ui/react-dialog`, `@base-ui-components/react`, `cmdk`, `@fontsource-variable/*`)
- Microsoft Learn: Unified Catalog overview/data products/governance domains, classic lineage user guide, REST API lineage relationships, glossary terms, Power BI lineage docs

### Secondary (MEDIUM confidence)
- Vendor/OSS docs across dbt Explorer, Atlan, Collibra, Alation, Select Star, Monte Carlo, DataHub, OpenMetadata, Marquez
- Web search on React Flow v12 migration, dagre/elkjs tradeoffs, sigma.js/Cosmograph/react-force-graph comparison, node-count rendering thresholds, Tailwind v4/vanilla-extract/Panda tradeoffs, Radix/Base UI/React Aria comparison, OKLCH/`light-dark()` browser support, TanStack Router vs. React Router v7, FSD vs. colocation, Zustand vs. Context
- Apache Atlas community-reported known issues as a proxy for undocumented Purview/Atlas qualified-name behavior

### Tertiary (LOW confidence)
- Cosmograph CC-BY-NC-4.0 commercial-use applicability -- legal/policy question, not resolvable by research
- TanStack Router vs. React Router v7 preference -- single web-search pass
- Geist Sans small-size legibility on Windows ClearType -- flagged risk, unverified

---
*Research completed: 2026-07-20*
*Ready for roadmap: yes, with the 4 open decisions above flagged for explicit resolution during roadmap/requirements work*
