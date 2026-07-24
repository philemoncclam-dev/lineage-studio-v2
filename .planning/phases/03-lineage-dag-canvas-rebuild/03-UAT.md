---
status: testing
phase: 03-lineage-dag-canvas-rebuild
source: [03-VERIFICATION.md]
started: 2026-07-23
updated: 2026-07-23
---

## Current Test

number: 1
name: Selection persistence survives hover (DAG-04)
expected: |
  The clicked column's Inspector stays open and its `sel` state is not lost. While
  hovering elsewhere, the render transiently shows the hovered column's trace (not the
  URL), but the moment the hover ends the canvas reverts to showing the originally-clicked,
  persisted selection — it must never silently clear to "nothing selected."
awaiting: user response

## Tests

### 1. Selection persistence survives hover (DAG-04)
test: In the running app, click a column to select it (Inspector opens for that column). Then hover a different, unrelated column elsewhere on the canvas. While hovering, observe the trace. Then move the mouse away (end the hover).
expected: Inspector stays open on the clicked column; hover shows a transient trace; on hover end the canvas reverts to the persisted selection and never clears to "nothing selected."
blocking: yes
result: [pending]

### 2. Full keyboard/assistive-technology walk (DAG-08)
test: Tab into the lineage canvas. Use arrow keys to walk cards/columns (↓/↑ within a card and across cards in the same rank, →/← across ranks on a header and path-walking a connected column). Use Home/End. Press Enter/Space on a focused column to select it. Run with a screen reader active.
expected: Focus-visible rings on every focused header/row; screen reader announces each element's accessible name (including provenance and type); Tab is never trapped inside the canvas (single Tab stop); dimmed (traced-out) rows stay keyboard-focusable even though they are mouse-non-interactive.
blocking: no
result: [pending]

### 3. Provenance distinguishability under CVD simulation (TRUST-01)
test: With a deuteranopia/protanopia simulator active (or light mode), compare a declared (solid) vs inferred (dashed) edge of the same edge-type hue.
expected: Dash pattern stays distinguishable regardless of simulated color vision — provenance rides a shape channel (dasharray), never hue alone. Note only the inferred/dashed style has a live data path this phase (D-09); declared/solid has no real data until Phase 5.
blocking: no
result: [pending]

### 4. Evidence block renders safely in the running app (TRUST-02)
test: Select an inferred column with evidence in the running app. Confirm the Evidence section shows the matched SELECT snippet and the locked "not executed" caption. If feasible, craft a fixture notebook cell containing a `<script>`-like string in a column expression.
expected: Evidence renders correctly; any HTML-like content in the snippet is inert escaped text, never executed or interpreted.
blocking: no
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
