---
phase: 3
slug: lineage-dag-canvas-rebuild
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-23
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `03-RESEARCH.md` § Validation Architecture. Per-task rows are
> filled once plans assign task IDs (validate-phase §6).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Frontend: Vitest 4.1.10 + `@testing-library/react` 16.3.2 (jsdom). Backend: pytest (`backend/tests/`) |
| **Config file** | `frontend/vitest.config.ts`; backend uses pytest default discovery from `backend/tests/` (no pytest.ini) |
| **Quick run command** | Frontend: `cd frontend && npx vitest run src/views/lineage-dag --reporter=dot` · Backend: `cd backend && .venv/Scripts/python -m pytest tests/test_parser.py -x` |
| **Full suite command** | Frontend: `cd frontend && npm run test:run` · Backend: `cd backend && .venv/Scripts/python -m pytest` |
| **Estimated runtime** | ~15–30 s (frontend lineage-dag subset); full suites ~1–2 min |

---

## Sampling Rate

- **After every task commit:** Run the relevant quick command above (frontend or backend, whichever the task touched)
- **After every plan wave:** Run `npm run test:run` (frontend) + `pytest` (backend)
- **Before `/gsd-verify-work`:** Both full suites green, plus a manual/Playwright light-mode visual check (standing pitfall #12 discipline)
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; validate-phase §6 fills the rows. The
> requirement→test mapping below is lifted from `03-RESEARCH.md` and is the
> binding coverage target — every row must land on a task.

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| DAG-01 | LR dagre layout produces expected node count/order for a fixture graph | unit | `npx vitest run src/views/lineage-dag/useDagreLayout.test.ts` | ❌ W0 |
| DAG-02 | Column edge `sourceHandle`/`targetHandle` resolves to exact `${col.key}__source/__target` in Column mode, `__node__*` in Table mode | unit | `npx vitest run src/views/lineage-dag/toXyflowEdges.test.ts` | ❌ W0 |
| DAG-03 / DAG-04 | `trace()` returns correct upstream+downstream Set; hover sets transient state, click persists via `useSelection` | unit + component | `npx vitest run src/views/lineage-dag` | ❌ W0 |
| DAG-05 / TRUST-02 | `ColumnCard`/Inspector renders Transform / Source→Target / Evidence; omits Evidence when absent | component | `npx vitest run src/shell/__tests__/Inspector.test.tsx` | ✅ extend |
| DAG-06 | Toggling table↔column recomputes node heights + handle ids deterministically | unit | `npx vitest run src/views/lineage-dag/useDagreLayout.test.ts` | ❌ W0 |
| DAG-07 | Same fixture + same toggle state → byte-identical `{x,y}` positions across two calls | unit | `npx vitest run src/views/lineage-dag/useDagreLayout.test.ts` | ❌ W0 |
| DAG-08 | Roving-tabindex handler moves focus for ↓/↑/→/←/Home/End on a fixture DOM | component | `npx vitest run src/views/lineage-dag/useLineageKeyboardNav.test.ts` | ❌ W0 |
| TRUST-01 | Edge applies correct `stroke-dasharray` for declared vs inferred, independent of edge-type class | component | `npx vitest run src/views/lineage-dag/LineageEdge.test.tsx` | ❌ W0 |
| TRUST-02 | `ColumnMapEvidence` round-trips `ColumnMap` → `LineageGraph` → `api.ts` without breaking existing manual-JSON fixtures | unit (backend) | `.venv/Scripts/python -m pytest tests/test_parser.py -k evidence` | ❌ W0 extend |
| TRUST-03 | Freshness indicator shows relative time for live source, "bundled sample data" for sample | component | `npx vitest run src/views/lineage-dag/FreshnessIndicator.test.tsx` | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `frontend/src/test/setup.ts` — add `ResizeObserver`, `DOMMatrixReadOnly`, and `SVGElement.prototype.getBBox` mocks (required before any test mounts `<ReactFlow>`; xyflow-under-jsdom requirement)
- [ ] `frontend/src/views/lineage-dag/useDagreLayout.test.ts` — DAG-01, DAG-06, DAG-07
- [ ] `frontend/src/views/lineage-dag/toXyflowEdges.test.ts` — DAG-02
- [ ] `frontend/src/views/lineage-dag/useLineageKeyboardNav.test.ts` — DAG-08
- [ ] `frontend/src/views/lineage-dag/LineageEdge.test.tsx` — TRUST-01
- [ ] `frontend/src/views/lineage-dag/FreshnessIndicator.test.tsx` — TRUST-03
- [ ] `backend/tests/test_parser.py` extension — TRUST-02 evidence threading + backward-compat (old fixtures with no `evidence` field must still parse)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Light-mode visual review of the rebuilt canvas | pitfall #12 | Visual regression not covered by unit tests; standing discipline | Load lineage view in light theme; confirm edges, cards, dim-others, and inspector read correctly (no raw hex leaks, contrast holds) |
| Provenance survives colourblind simulation | TRUST-01 / pitfall #19 | Requires perceptual check the token layer can't assert | Solid vs dashed distinguishable under deuteranopia/protanopia sim independent of edge-type colour |
| Full keyboard/AT walk of nodes + edges | DAG-08 / pitfall #19 | Screen-reader semantics need human/AT confirmation | Tab into canvas; walk cards/columns/edges by keyboard alone; verify focus-visible + AT labels announce node/edge identity and provenance |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
