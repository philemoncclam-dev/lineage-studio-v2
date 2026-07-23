# Phase 3 Discussion Log — Lineage DAG Canvas Rebuild

**Date:** 2026-07-22
_Human reference only — not consumed by downstream agents (see 03-CONTEXT.md for the canonical decisions)._

## Areas selected for discussion
Card detail & column toggle · Hover-trace + selection · Provenance edge channel · Evidence & transform copy (all four).

## Q1 — Card detail model (DAG-06)
- Options: global toggle + expanded default / per-card + global / context-driven auto-expand.
- **Chosen:** Global toggle, expanded by default; wide tables scroll inside the card. → D-03, D-04.

## Q2 — Hover-trace vs persistent selection (DAG-03 / DAG-04)
- Options: same treatment (hover transient) / selection locks-hover-yields / distinct channels.
- **Chosen:** Same trace treatment, hover transient — dim unrelated to ~15% & non-interactive; click freezes selection; hover-while-selected previews without losing selection. → D-05, D-06, D-07.

## Q3 — Provenance channel (TRUST-01)
- Options: solid-vs-dashed / dashed + midpoint badge / add backend provenance enum.
- **Chosen:** Solid = declared, dashed = inferred (non-colour channel). All edges dashed/inferred in Phase 3; solid style wired but lit only in Phase 5's Purview read-back. No backend enum now. → D-08, D-09, D-10.

## Q4 — Inferred-edge evidence & transform copy (TRUST-02 / DAG-05)
- Grounding surfaced: backend `Edge`/`ColumnMap` carries only `transform` + `via`; plain-English is already frontend-synthesized in `adapt.ts`.
- Options: expression + notebook (FE copy, no backend change) / add code snippet + cell/line (backend parser work) / expression only, drop prose.
- **Chosen:** Add matched code snippet + cell/line as verbatim evidence — accepts a bounded, additive backend parser extension in this phase; keep FE-synthesized plain-English; `LineageGraph` stays backward-compatible. → D-11, D-12, D-13.

## Claude's discretion (agreed, not separately asked)
- Keyboard/AT traversal model (DAG-08, pitfall #19) — designed in research/planning, dual-purposed with power-user speed.
- xyflow custom node/edge shapes, dagre tuning, dim opacity/timing, "last refreshed" (TRUST-03) placement, toggle control placement.

## Deferred
Per-card expand state · column virtualization · backend provenance enum · numeric confidence (permanent) · animated tracing (Phase 7).
