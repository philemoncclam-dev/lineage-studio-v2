---
status: testing
phase: 02-app-shell-routing-canvas-infrastructure
source: [02-VERIFICATION.md]
started: 2026-07-22T15:49:10Z
updated: 2026-07-22T15:49:10Z
---

## Current Test

number: 1
name: Inspector opens on selection without shifting the canvas (SHELL-03), both themes
expected: |
  Selecting a table/column on both LineageView and GraphView's TableDetail opens the
  contextual inspector with zero reflow of the canvas; the inspector renders correctly
  in both light and dark theme.
awaiting: user response

## Tests

### 1. Inspector no-reflow on selection (SHELL-03)
expected: Open the app, select a table/column on both LineageView and GraphView's TableDetail, confirm the canvas does not shift, in both themes. No layout shift; inspector renders correctly in both themes.
result: [pending]

### 2. Command palette keyboard operability (NAV-03)
expected: Open Cmd+K, tab/arrow through grouped results, Enter to select, Esc to close and confirm focus restores, in both themes. Full keyboard operability and correct focus-trap/restore from cmdk/Radix Dialog.
result: [pending]

### 3. Both-theme shell chrome visual pass (standing discipline #12)
expected: Re-verify both-theme visual correctness across all Phase 2 shell chrome (Rail / ModeMenu / RailBottomCluster / Inspector / CommandPalette / Purview placeholders), now that the app reliably paints. No visual regression.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
