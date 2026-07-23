---
phase: 03-lineage-dag-canvas-rebuild
plan: 02
subsystem: infra
tags: [xyflow, dagre, vitest, jsdom, css-tokens, npm]

# Dependency graph
requires:
  - phase: 03-lineage-dag-canvas-rebuild
    provides: "03-01's ColumnMapEvidence backend/api contract (independent, same wave)"
provides:
  - "@xyflow/react@12.11.2 + @dagrejs/dagre@3.0.0 installed at exact pins, reactflow@11 removed"
  - "ResizeObserver/DOMMatrixReadOnly/SVGGraphicsElement.getBBox jsdom polyfills in test/setup.ts"
  - "Tier-3 --dag-*/--lineage-toolbar-* component tokens in components.css"
affects: [03-03, 03-04, 03-05, 03-06, 03-07]

# Tech tracking
tech-stack:
  added: ["@xyflow/react@12.11.2", "@dagrejs/dagre@3.0.0"]
  patterns:
    - "jsdom polyfills guarded with existence checks before assignment, so a future real jsdom implementation is never clobbered"
    - "Tier-3 CSS tokens resolve only to tier-2 semantics or sanctioned component-geometry literals, never raw hex"

key-files:
  created: []
  modified:
    - frontend/package.json
    - frontend/package-lock.json
    - frontend/src/test/setup.ts
    - frontend/src/styles/components.css

key-decisions:
  - "getBBox polyfill assigned to SVGGraphicsElement.prototype (not SVGElement.prototype as the plan's action text loosely described) — SVGElement has no getBBox member in the TS DOM lib; SVGGraphicsElement is the actual owner and covers every real SVG element xyflow renders (<svg>, <g>, <path>)"

patterns-established:
  - "jsdom API polyfills for canvas libraries live in test/setup.ts as guarded globalThis/class assignments"

requirements-completed: [DAG-01, TRUST-01]

coverage:
  - id: D1
    description: "reactflow@11 removed; @xyflow/react@12.11.2 and @dagrejs/dagre@3.0.0 installed at exact pins, no stale reactflow imports remain"
    requirement: "DAG-01"
    verification:
      - kind: unit
        ref: "node -e package.json pin assertion (task 1 verify command)"
        status: pass
      - kind: unit
        ref: "grep -RIn \"from 'reactflow'\" frontend/src (no matches)"
        status: pass
    human_judgment: false
  - id: D2
    description: "ResizeObserver, DOMMatrixReadOnly, and SVGGraphicsElement.getBBox mocks present in test/setup.ts, guarded against clobbering real implementations; full Vitest suite still green"
    verification:
      - kind: unit
        ref: "npx vitest run src/test/setup.ts --passWithNoTests (exit 0)"
        status: pass
      - kind: unit
        ref: "npm run test:run — 12 files / 58 tests passed"
        status: pass
    human_judgment: false
  - id: D3
    description: "Tier-3 --dag-*/--lineage-toolbar-* tokens declared in components.css, all resolving to tier-2 semantics or component-geometry literals, no raw hex, audit:tokens green"
    requirement: "TRUST-01"
    verification:
      - kind: unit
        ref: "npm run audit:tokens (exit 0, all checks passed)"
        status: pass
      - kind: unit
        ref: "node -e token-presence assertion (task 3 verify command)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-23
status: complete
---

# Phase 3 Plan 2: Toolchain + Token Foundation Summary

**Swapped reactflow@11 for pinned @xyflow/react@12.11.2 + @dagrejs/dagre@3.0.0, added the three jsdom polyfills xyflow needs under Vitest, and declared the tier-3 --dag-*/--lineage-toolbar-* component tokens.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-23
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- `reactflow` removed and `@xyflow/react@12.11.2` + `@dagrejs/dagre@3.0.0` installed at exact (no-caret) pins; confirmed no remaining `from 'reactflow'` imports anywhere in `frontend/src`
- `test/setup.ts` extended with guarded `ResizeObserver`, `DOMMatrixReadOnly`, and `SVGGraphicsElement.prototype.getBBox` polyfills so `<ReactFlow>` can mount under jsdom in future test waves
- `components.css` gained the twelve tier-3 `--dag-*`/`--lineage-toolbar-*` tokens (node geometry, provenance dasharray, trace/dim), all resolving to existing tier-2 semantics or sanctioned component-geometry literals — `npm run audit:tokens` stays green

## Task Commits

Each task was committed atomically:

1. **Task 1: Swap reactflow → @xyflow/react + @dagrejs/dagre (exact pins)** - `1161a79` (feat)
2. **Task 2: Add the xyflow-under-jsdom polyfills to test/setup.ts** - `fec445e` (feat)
3. **Task 3: Declare the tier-3 lineage-DAG component tokens** - `77d7851` (feat)

**Plan metadata:** (this commit, follows)

## Files Created/Modified
- `frontend/package.json` - reactflow removed; @xyflow/react@12.11.2, @dagrejs/dagre@3.0.0 added at exact pins
- `frontend/package-lock.json` - lockfile updated for the dependency swap
- `frontend/src/test/setup.ts` - ResizeObserver/DOMMatrixReadOnly/getBBox jsdom polyfills, guarded
- `frontend/src/styles/components.css` - tier-3 `--dag-*`/`--lineage-toolbar-*` token block appended to the existing tier-3 `:root` block

## Decisions Made
- getBBox polyfill targets `SVGGraphicsElement.prototype` rather than `SVGElement.prototype` (plan's action text said the latter loosely) — `tsc -b --noEmit` fails against `SVGElement` since that class has no `getBBox` member in the TS DOM lib; `SVGGraphicsElement` is the real owner and every concrete SVG element xyflow renders extends it, so behavior is identical at runtime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] getBBox polyfill moved from SVGElement to SVGGraphicsElement**
- **Found during:** Task 2 (jsdom polyfills)
- **Issue:** Assigning to `SVGElement.prototype.getBBox` fails `tsc -b --noEmit` with `TS2339: Property 'getBBox' does not exist on type 'SVGElement'` — the plan's action text named the wrong prototype.
- **Fix:** Assigned the stub to `SVGGraphicsElement.prototype.getBBox` instead, which is the type that actually declares `getBBox` in the DOM lib and which every rendered SVG shape (`<svg>`, `<g>`, `<path>`) extends at runtime.
- **Files modified:** frontend/src/test/setup.ts
- **Verification:** `npx tsc -b --noEmit` clean; `npm run test:run` — 58/58 tests pass.
- **Committed in:** fec445e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for the plan's own `npx tsc -b --noEmit clean` verification requirement to pass. No scope creep — same three polyfills, correct prototype target.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Packages, jsdom mocks, and tier-3 tokens are all in place for waves 1-3 (pure layout, node/edge components, view integration) to build on directly.
- `npm run test:run` (12 files / 58 tests), `npx tsc -b --noEmit`, and `npm run audit:tokens` are all green at this checkpoint.
- No blockers carried forward.

---
*Phase: 03-lineage-dag-canvas-rebuild*
*Completed: 2026-07-23*

## Self-Check: PASSED

- FOUND: frontend/src/test/setup.ts
- FOUND: frontend/src/styles/components.css
- FOUND: frontend/package.json
- FOUND: 1161a79 (Task 1 commit)
- FOUND: fec445e (Task 2 commit)
- FOUND: 77d7851 (Task 3 commit)
