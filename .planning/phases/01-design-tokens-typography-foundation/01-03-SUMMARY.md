---
phase: 01-design-tokens-typography-foundation
plan: 03
subsystem: ui
tags: [canvas, tokens, theming, react, typescript, mutationobserver]

requires:
  - phase: 01-design-tokens-typography-foundation (plans 01-02)
    provides: frontend/src/styles/tokens.css — the full OKLCH tier-1/tier-2 token layer and the data-theme switch
provides:
  - "frontend/src/tokens/canvasTokens.ts — cached, theme-aware CanvasTokens snapshot bridging CSS custom properties into canvas draw calls"
  - "GraphView.tsx knowledge-graph draw loop reading zero styles per frame"
  - "The token-to-canvas pattern (getCanvasTokens/canvasFont) Phase 3's xyflow renderers and Phase 4's sigma.js reducers must follow"
affects: [phase-03-lineage-dag, phase-04-knowledge-graph, phase-06-light-theme-review]

tech-stack:
  added: []
  patterns:
    - "Module-scope cache populated by exactly one getComputedStyle call, invalidated only by a data-theme MutationObserver — never per frame/node/edge"
    - "Exhaustive Record<ColorKey, keyof CanvasTokens> domain mapping so an unmapped domain is a compile error, not a runtime blank fill"
    - "canvasFont(weight, size, family, scale) builds ctx.font strings from token values with the token's own px as the zoom floor, so draw calls never hardcode a raw pixel literal"

key-files:
  created:
    - frontend/src/tokens/canvasTokens.ts
  modified:
    - frontend/src/main.tsx
    - frontend/src/views/GraphView.tsx

key-decisions:
  - "Added a `surface1` field to CanvasTokens beyond task 1's enumerated field list, because task 2 explicitly requires reading the surface-1 token for the node outline stroke and no other listed field covers it"
  - "canvasFont() takes an optional `scale` (default 1) so the same helper serves both a fixed-size future consumer and GraphView's zoom-scaled draw calls, while still deriving the pixel floor from the token rather than a literal"
  - "GraphView keeps its own local data-theme MutationObserver (in addition to the bootstrap-level one in main.tsx) so its draw loop's tokensRef updates live without re-running the whole simulation-setup effect; it calls invalidateCanvasTokens() explicitly before re-reading so it never depends on cross-observer firing order"

requirements-completed: [THEME-03, DS-03, THEME-05]

coverage:
  - id: D1
    description: "Cached, theme-aware CanvasTokens snapshot module (frontend/src/tokens/canvasTokens.ts) with exactly one getComputedStyle call site, throw-on-empty guard, and an idempotent data-theme MutationObserver"
    requirement: THEME-03
    verification:
      - kind: unit
        ref: "cd frontend && npx tsc -b (exit 0)"
        status: pass
      - kind: other
        ref: "grep -c 'getComputedStyle' frontend/src/tokens/canvasTokens.ts == 1"
        status: pass
      - kind: other
        ref: "removing the `workspace` entry from DOMAIN_TOKEN and re-running npx tsc -b fails with TS2741 (exhaustiveness verified, then restored)"
        status: pass
    human_judgment: false
  - id: D2
    description: "GraphView.tsx knowledge-graph draw loop reads zero styles per frame; cssVar helper removed; every colour/font read comes from the hoisted token snapshot"
    requirement: THEME-03
    verification:
      - kind: unit
        ref: "grep -rn 'getComputedStyle' frontend/src --include=*.ts --include=*.tsx | grep -v canvasTokens.ts | wc -l == 0"
        status: pass
      - kind: unit
        ref: "grep -c 'cssVar' frontend/src/views/GraphView.tsx == 0"
        status: pass
      - kind: unit
        ref: "cd frontend && npm run build && npm run lint (both exit 0)"
        status: pass
    human_judgment: true
    rationale: "The theme-toggle repaint behaviour (setting document.documentElement.dataset.theme in devtools and confirming the graph canvas repaints without reload/flicker) is a visual/runtime check the plan itself marks <human-check> — automation confirmed the code path (observer wiring, tokensRef refresh) but not the rendered pixels."
  - id: D3
    description: "Domain fallback resolves: every ColorKey (bronze/silver/gold/notebook/workspace/accent) maps through DOMAIN_TOKEN to a defined CanvasTokens field, so the workspace fallback key never paints an empty fill"
    requirement: THEME-05
    verification:
      - kind: unit
        ref: "TypeScript exhaustiveness check on Record<ColorKey, keyof CanvasTokens> (see D1's third verification)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Canvas text uses only the two sanctioned weights (400/600) and the four-size type ramp via canvasFont(), never a raw pixel/weight literal in the draw call"
    requirement: DS-03
    verification:
      - kind: unit
        ref: "grep -n 'ctx.font' frontend/src/views/GraphView.tsx — both call sites are canvasFont(600, 'base', 'sans', zoom) and canvasFont(400, 'micro', 'mono', zoom)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-21
status: complete
---

# Phase 1 Plan 3: Token-to-Canvas Bridge Summary

**Typed, cached `CanvasTokens` snapshot (`frontend/src/tokens/canvasTokens.ts`) bridging the OKLCH token layer into GraphView's `<canvas>` draw loop — one `getComputedStyle` call site total, invalidated only by a `data-theme` `MutationObserver`, with an exhaustive domain-key fallback and token-derived canvas fonts.**

## Performance

- **Duration:** 20 min
- **Completed:** 2026-07-21
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- Created `frontend/src/tokens/canvasTokens.ts`: a `CanvasTokens` interface, an exhaustive `DOMAIN_TOKEN: Record<ColorKey, keyof CanvasTokens>` map, `getCanvasTokens()`/`invalidateCanvasTokens()`/`initCanvasTokenCache()`, and a `canvasFont()` shorthand builder — exactly one `getComputedStyle` call site in the whole module, with a throw-on-empty guard so a renamed/undeclared token fails loudly instead of painting invisibly.
- Wired `initCanvasTokenCache()` once in `frontend/src/main.tsx`, before `createRoot(...).render(...)`.
- Removed the module-level `cssVar` helper from `frontend/src/views/GraphView.tsx` and every per-frame `getComputedStyle` call in its knowledge-graph draw loop (previously up to eight calls per node per frame). Edge strokes, node fills (via the domain mapping), the node outline, and both text tiers now read from a snapshot hoisted outside the draw function.
- Rebuilt the two canvas font strings with `canvasFont()`: node labels at base size/semibold/sans, sub-labels at micro size/regular/mono — the zoom-scaled pixel value now floors at the token's own audited size instead of a hardcoded literal (11/12 and 9/9.5 previously).
- A local `data-theme` `MutationObserver` inside `GraphCanvas`'s effect refreshes the snapshot exactly once per real theme change (never per frame); the component's always-on `requestAnimationFrame` loop picks up the new colours on its next tick with no page reload.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the cached, theme-aware canvas token snapshot module** - `00ca931` (feat)
2. **Task 2: Wire the cache at bootstrap and remove every per-frame style read from the graph canvas** - `544c719` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `frontend/src/tokens/canvasTokens.ts` - `CanvasTokens` interface, `DOMAIN_TOKEN` map, `getCanvasTokens`/`invalidateCanvasTokens`/`initCanvasTokenCache`, `canvasFont` helper
- `frontend/src/main.tsx` - calls `initCanvasTokenCache()` once, before `createRoot(...).render(...)`
- `frontend/src/views/GraphView.tsx` - `cssVar` helper deleted; draw loop reads a hoisted `tokensRef` snapshot refreshed by a local `data-theme` observer instead of calling `getComputedStyle` per frame

## Decisions Made

- **Added a `surface1` field to `CanvasTokens`** beyond task 1's literal field enumeration ("the canvas surface, the grid-dot colour, the three text tiers, the border and border-strong tokens, all three accent steps, all four domain colours plus the neutral fallback domain, all three edge colours, and the two font families and four type sizes"). Task 2's action text explicitly says "Replace the node's outline stroke with the surface-1 field," which is unsatisfiable without this field existing — a straightforward gap-fill (Rule 2), not an architectural change, since `--color-surface-1` was already declared in `tokens.css` by plan 01-01/01-02.
- **`canvasFont()` takes an optional `scale` parameter (default 1)** rather than only returning the token's static pixel value. This lets the same helper serve GraphView's zoom-dependent draw calls (which must grow text with zoom but never shrink below the token's audited size) while still satisfying "draw calls never concatenate a raw pixel literal" and "derive the base pixel value from the token."
- **GraphView keeps a component-local `data-theme` `MutationObserver` in addition to the bootstrap-level one in `main.tsx`.** The bootstrap observer (wired once, globally) invalidates the shared cache; GraphView's local observer explicitly calls `invalidateCanvasTokens()` then `getCanvasTokens()` to refresh its own `tokensRef.current`, so the draw loop's redraw doesn't depend on the two `MutationObserver` callbacks firing in a guaranteed order across observers. This keeps the "read happens once per theme change, never once per frame" constraint correct even under `MutationObserver` scheduling ambiguity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `surface1` field to `CanvasTokens`**
- **Found during:** Task 1 (writing the `CanvasTokens` interface from task 1's field list)
- **Issue:** Task 1's action text enumerates the fields `CanvasTokens` must cover but omits a surface-1 field; task 2's action text later requires reading "the surface-1 field" for the node's outline stroke, which would be impossible without it.
- **Fix:** Added `readonly surface1: string` mapped to `--color-surface-1` (already declared in `tokens.css`), documented inline with a comment explaining the gap.
- **Files modified:** `frontend/src/tokens/canvasTokens.ts`
- **Verification:** `npx tsc -b` passes; the token-declaration cross-check script confirms `--color-surface-1` is declared in `tokens.css`; `GraphView.tsx`'s node-outline stroke compiles against `t.surface1`.
- **Committed in:** `00ca931` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Necessary for task 2's own instructions to be satisfiable. No scope creep — the field maps to an existing, already-declared token.

## Issues Encountered

- Two of the plan's literal `grep -c`/regex-based acceptance-criteria one-liners don't quite do what their prose implies once run against real content:
  - `grep -c 'initCanvasTokenCache' frontend/src/main.tsx` outputs `2` (the `import` line and the call line both contain the identifier), not the `1` the criterion states — the ordering check (`initCanvasTokenCache(` appears on a line before `createRoot(`) still passes and is the check that actually appears in the task's `<verify><automated>` block; the `grep -c == 1` line only appears in the descriptive `acceptance_criteria` bullets.
  - `grep -oE '\b[45][0-9]{2}\b'` (intended to allow only `400`/`600`) only matches numbers starting with `4` or `5`, so it can never actually match `600` — with only `400`/`600` present on the `ctx.font` lines, this grep now returns nothing, which vacuously satisfies "outputs only 400 and/or 600" but wouldn't have caught a stray `600` if one were wrong. Confirmed by direct inspection (`grep -n 'ctx.font'`) that both call sites are `canvasFont(600, ...)`/`canvasFont(400, ...)` — no other weights are used.
  Neither is a functional gap in the delivered code; both are pre-existing imprecision in the plan's own verification one-liners, outside this executor's authority to edit (PLAN.md is not in this plan's file scope).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The `getCanvasTokens()` / `canvasFont()` pattern is the one Phase 3's xyflow custom renderers and Phase 4's sigma.js reducers must copy — no `getComputedStyle` call outside `frontend/src/tokens/canvasTokens.ts` anywhere in `frontend/src`.
- `npm run audit:tokens` still exits 0 — no token was renamed out from under the audit while wiring the bridge.
- Manual devtools confirmation (toggling `document.documentElement.dataset.theme` while the knowledge-graph view is open, per the plan's `<human-check>`) is recommended before Phase 3/4 build on top of this pattern, but was not blocking for this autonomous plan.

---
*Phase: 01-design-tokens-typography-foundation*
*Completed: 2026-07-21*

## Self-Check: PASSED

- FOUND: frontend/src/tokens/canvasTokens.ts
- FOUND: frontend/src/main.tsx
- FOUND: frontend/src/views/GraphView.tsx
- FOUND commit: 00ca931
- FOUND commit: 544c719
