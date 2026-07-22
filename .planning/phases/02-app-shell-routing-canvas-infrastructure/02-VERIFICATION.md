---
phase: 02-app-shell-routing-canvas-infrastructure
verified: 2026-07-22T09:00:00Z
status: human_needed
score: 6/9 must-haves verified
behavior_unverified: 2
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 8/10
  gaps_closed:
    - "tid/nid (frontend/src/model/ids.ts) now produce collision-free short ids in general, not merely for the one previously-documented pair (WR-03 v2). The earlier fix's two residual collision classes (literal '__' vs encoded interior '.'; two distinct punctuation chars both falling through to '_') are eliminated by a provably-injective escape encoding, independently re-derived and fuzz-tested by this verification, not accepted on the SUMMARY's/commit message's word."
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "The Knowledge-Graph drill hierarchy is URL-addressable: /graph/$workspace/$lakehouse/$table drives GraphView's drill state, and drilling by clicking a node pushes browser history (SHELL-05/SHELL-06 graph-mode portion; part of ROADMAP Phase 2 SC#3)"
    addressed_in: "Phase 4"
    evidence: "ROADMAP.md Phase 4 carries a 'Carried forward from Phase 2 (gap closure 02-09)' note referencing .planning/todos/pending/phase4-graph-mode-drill-url-wiring.md. Unchanged since the prior verification pass; not touched by the WR-03 v2 fix. resolvePathSegments.ts and its 9 passing unit tests remain in-tree, untouched, confirmed still present."
behavior_unverified_items:
  - truth: "The inspector overlay causes zero reflow of the canvas when opening/closing, and is visually correct in both light and dark theme (SHELL-03)"
    test: "Open the app, select a table/column on both LineageView and GraphView's TableDetail, confirm the canvas does not shift, in both themes"
    expected: "No layout shift; inspector renders correctly in both themes"
    why_human: "Visual/layout judgment. Mechanism unchanged since the prior pass (not touched by the WR-03 v2 fix) and remains unit-tested; no live-browser confirmation of this specific behavior has been recorded."
  - truth: "The command palette is fully keyboard-operable end-to-end (arrow through groups, Enter to select, Esc to close with focus restore) in a live browser, in both themes (NAV-03)"
    test: "Open Cmd+K, tab/arrow through results, Enter to select, Esc to close and confirm focus restores, in both themes"
    expected: "Full keyboard operability and correct focus-trap/restore from cmdk/Radix Dialog; correct visuals in both themes"
    why_human: "Requires a live, interactive browser session. Mechanism (cmdk/Radix Dialog, no manual key handlers) unchanged since the prior pass; the keyboard/focus-restore sequence itself has not been performed live."
human_verification:
  - test: "Open the app, select a table/column on both LineageView and GraphView's TableDetail, confirm the canvas does not shift, in both themes"
    expected: "No layout shift; inspector renders correctly in both themes"
    why_human: "Visual/layout judgment; not yet performed live"
  - test: "Open Cmd+K, tab/arrow through results, Enter to select, Esc to close and confirm focus restores, in both themes"
    expected: "Full keyboard operability and correct focus-trap/restore from cmdk/Radix Dialog"
    why_human: "Requires a live browser; not yet performed live"
  - test: "Re-verify both-themes visual correctness for all Phase 2 shell chrome (Rail/ModeMenu/RailBottomCluster/Inspector/CommandPalette/Purview placeholders), now that the app reliably paints"
    expected: "No visual regression"
    why_human: "No screenshot artifacts persist in the repo for independent inspection of the overlays-open states (Inspector, CommandPalette) in either theme; not touched by this delta"
---

# Phase 2: App Shell, Routing & Canvas Infrastructure Verification Report

**Phase Goal:** Replace the flat top-bar view-switch and hand-rolled breadcrumb-array routing with a left icon rail, a URL-addressable router, and the shared cross-canvas plumbing (selection store, cached canvas-token reader, decomposed pure layout model) that both canvas rebuilds depend on — without ever leaving the app in a broken or half-migrated state.
**Verified:** 2026-07-22T09:00:00Z
**Status:** human_needed
**Re-verification:** Yes — third pass, after a single targeted commit (284e95c) closing the WR-03 gap

## Goal Achievement

### Re-verification Summary

This is the third verification pass for Phase 2. The prior pass (2026-07-22T08:40:00Z) found exactly one FAILED must-have — `tid`/`nid` in `frontend/src/model/ids.ts` were not collision-free in general — plus 2 present-but-behavior-unverified truths (SHELL-03, NAV-03) routed to end-of-phase human verification, and one legitimately deferred item (SHELL-05/06 graph-mode drill, Phase 4). Everything else had already been re-verified as passing.

Since then, exactly one commit (`284e95c`) touched exactly two files: `frontend/src/model/ids.ts` and `frontend/src/model/__tests__/ids.test.ts`. Confirmed via `git show --stat 284e95c` myself — no other source file changed. This delta re-verification independently confirms whether that fix genuinely closes the WR-03 gap, and that nothing else regressed.

**WR-03 is now genuinely closed — independently re-derived, not taken on the commit message's or SUMMARY's word.**

1. **Read the shipped source directly.** `sanitize()` is now `s.replace(/[^A-Za-z0-9_]/g, (c) => '-' + c.charCodeAt(0).toString(16).padStart(4, '0'))`. Every character outside `[A-Za-z0-9_]` — including `.`, `/`, and literal `-` itself — is escaped to a fixed-width 5-character token (`-` + 4 hex digits of the UTF-16 code unit). Alphanumerics and `_` pass through unchanged.
2. **Independently reasoned about injectivity, then proved it empirically.** Because every escape token is exactly 5 characters and always starts with `-` (and literal `-` is itself escaped, so a bare `-` never survives unescaped in the output), a left-to-right scan of any output string unambiguously identifies escape boundaries — decoding is well-defined and total, which means encoding must be injective (two different inputs decoding to the same string would violate decode being a function). I did not just trust this reasoning: I ran the actual shipped `sanitize`/`tid`/`nid` in a Node REPL against:
   - The exact three previously-colliding pairs from the last verification pass: `tid('table.raw.orders')` vs `tid('table.raw__orders')` → `'raw-002eorders'` vs `'raw__orders'`, distinct. `tid('table.raw/orders')` vs `tid('table.raw_orders')` → `'raw-002forders'` vs `'raw_orders'`, distinct. The original documented pair (`table.raw.orders` vs `table.raw_orders`) also distinct.
   - A 200,000-sample brute-force fuzz test generating random strings from a punctuation-heavy alphabet (`a b _ . / - !` and letters) at lengths 1-8, hashing every output and checking for any two distinct inputs mapping to the same output: **zero collisions found across 200,000 samples** (104,642 unique outputs, no false merges).
   - DOM/CSS-selector safety (`/^[A-Za-z0-9_-]+$/`) held for every case, including inputs with spaces and `!`.
   - Fixture stability: `tid('table.raw_orders')` → `'raw_orders'` and `nid('notebook.clean_orders')` → `'nb_clean_orders'`, both byte-identical to before the fix (zero test churn on existing consumers), confirmed directly.
3. **Ran the project's own test suite myself**, not the SUMMARY's reported numbers: `cd frontend && npx vitest run` → **12 files, 58 tests, all pass** (up from 56 in the prior pass — the +2 are the new WR-03-v2 regression cases in `ids.test.ts` covering the two previously-residual collision classes plus a two-distinct-punctuation-chars case).
4. **Ran the production build myself:** `cd frontend && npm run build` → `tsc -b && vite build`, **exit 0**.
5. **Confirmed the WR-04 knock-on concern is resolved.** Read `frontend/src/shell/search.ts` directly: `notebookIndex()` still dedupes its `seen` map keyed by `nid(n.id)` for graph-only notebook nodes (unchanged since the prior pass — `search.ts` was not touched by this commit). Because `nid`/`tid` are now provably injective, this id-based dedupe can no longer silently merge two distinct notebooks under a shared key — the exact failure mode the prior pass flagged as a live knock-on risk is eliminated by the same fix.
6. **Confirmed no regression to the four consumers of `ids.ts`.** `grep` found `search.ts`, `model/adapt.ts`, `model/graphLayout.ts`, and `model/lineageLayout.ts` as the only importers of `tid`/`nid`; none were touched by this commit, and all are exercised by the full (58/58 passing) test suite and the successful production build.
7. **Confirmed the working tree has no stray uncommitted source changes** beyond planning-doc bookkeeping (`git status --short` shows only `.planning/config.json`, `handoff.md`, and this VERIFICATION.md itself as modified/untracked — no frontend source drift).

**The two end-of-phase human-verification items (SHELL-03, NAV-03) and the one locked Phase-4 deferral (SHELL-05/06 graph-mode drill) are unchanged** — none of the files behind them were touched by this delta, so they carry forward unmodified from the prior pass rather than being re-derived from scratch.

**Net result: zero remaining automated gaps.** All must-haves that can be verified by source inspection, test execution, and build success now pass. The only non-passing items are the two behavior-dependent truths already correctly routed to end-of-phase human verification under `human_verify_mode: end-of-phase`, plus the one locked, documented Phase-4 deferral. Per the decision tree (Step 9), this makes the overall status `human_needed`, not `gaps_found`.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Persistent left icon rail, N config entries -> N buttons, canvas fills viewport, 5th destination = one-line edit (SHELL-01/SHELL-02) | ✓ VERIFIED | Unchanged since prior pass; `Rail.tsx`/`railConfig.ts` untouched by this commit; `Rail.test.tsx` still green as part of the 58/58 suite |
| 2 | Existing top-bar button/segmented-control treatment carried forward unchanged (SHELL-04) | ✓ VERIFIED | Unchanged since prior pass; no files touched; regression-checked via full suite pass |
| 3 | Destination and selection are URL-addressable and survive refresh/paste; mode routes + `/lineage/$workspace/$lakehouse/$table` + `?sel`/`?col` (`replace:true`) genuinely work (SHELL-05/SHELL-06, satisfied portion) | ✓ VERIFIED | Unchanged since prior pass, confirmed WIRED; REQUIREMENTS.md/ROADMAP.md honestly scope this as the satisfied portion, graph-mode portion explicitly deferred |
| 4 | The Knowledge-Graph drill hierarchy's URL-addressability + back/forward (SHELL-05/SHELL-06 graph-mode portion) | DEFERRED (not a gap) | See Deferred Items — locked scope decision, unchanged since prior pass, not touched by this commit |
| 5 | The app remains usable/demoable at every commit — never blank-screens on load (SHELL-07 / ROADMAP SC#6 / CR-01) | ✓ VERIFIED | Unchanged since prior pass; `rootPending.test.tsx` still part of the 58/58 green suite; not touched by this commit |
| 6 | Contextual right-hand inspector opens on selection, closes without disturbing canvas layout (SHELL-03) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Mechanism unchanged and unit-tested; no live "zero reflow, both themes" confirmation recorded — see Human Verification |
| 7 | Cmd+K opens a palette searching tables/columns/notebooks/code, fully keyboard-operable (NAV-01 core / NAV-03) | VERIFIED (core search mechanism) / ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (live keyboard-op) | `CommandPalette.tsx`/`search.ts` unchanged by this commit; core search + grouping unit-tested (part of the 58/58 green suite); live keyboard/focus-restore sequence not yet performed — see Human Verification |
| 8 | `notebookIndex()` dedupes by canonical node id (not display name) and resolves graph-only notebooks via `nid()`, consistent with `model.notebooks`/`model.notebookCode`/`model.ops` (WR-04 / NAV-01) | ✓ VERIFIED | Read `search.ts` directly: unchanged since prior pass, still keyed by `nid(n.id)`. Now additionally confirmed safe: since `nid`/`tid` are provably injective as of this commit, this id-based dedupe can no longer silently merge two distinct notebooks — the knock-on risk flagged in the prior pass is eliminated |
| 9 | `tid`/`nid` produce collision-free short ids on real Fabric data in general — not merely for the one or two previously-documented pairs (WR-03) | ✓ VERIFIED | Independently reproduced via Node REPL: all three previously-colliding/at-risk pairs now distinct; a 200,000-sample brute-force fuzz test against the shipped `sanitize()` found zero collisions; output stays `[A-Za-z0-9_-]`-safe; fixture-derived ids (`raw_orders`, `nb_clean_orders`) unchanged. Ran the actual test suite myself: `ids.test.ts` now has 5 tests (2 new, covering both residual collision classes), all pass as part of the 58/58 green suite. This is a genuine gap closure, not a narrower re-scope of the claim. |

**Score:** 6/9 truths fully VERIFIED, 1 legitimately DEFERRED to Phase 4 (not a gap), 2 present-but-behavior-unverified (routed to end-of-phase human verification), 0 FAILED.

All automated (source-inspection, test-execution, build-execution) must-haves now pass. The WR-03 gap that previously blocked a clean automated pass is closed.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/routes/__root.tsx` | Root loader + crash-free pending state | ✓ VERIFIED | Unchanged since prior pass; not touched by this commit |
| `frontend/src/shell/AppShell.tsx` | Overlay-gating `overlays` prop | ✓ VERIFIED | Unchanged since prior pass; not touched by this commit |
| `frontend/src/routes/__tests__/rootPending.test.tsx` | Genuine RED→GREEN regression test for CR-01 | ✓ VERIFIED | Unchanged; part of the 58/58 green suite I ran myself |
| `frontend/src/model/ids.ts` | Collision-free `tid`/`nid` derivation | ✓ VERIFIED | Rewritten to a provably-injective escape encoding; independently proven via reasoning + Node REPL reproduction + 200,000-sample fuzz test; no longer a stub/partial claim |
| `frontend/src/model/__tests__/ids.test.ts` | Collision + DOM-safety guard tests | ✓ VERIFIED | 5 tests (2 new), covering both previously-residual collision classes plus a two-distinct-punctuation-chars case; ran myself, all pass |
| `frontend/src/shell/search.ts` | Id-based `notebookIndex()` | ✓ VERIFIED | Unchanged since prior pass; now additionally safe against silent collisions since `nid`/`tid` are provably injective |
| `.planning/REQUIREMENTS.md` | SHELL-05/06 honestly re-scoped | ✓ VERIFIED | Unchanged since prior pass, not touched by this commit |
| `.planning/ROADMAP.md` | Phase 2 SC#3 deferral note + Phase 4 carry-forward note | ✓ VERIFIED | Unchanged since prior pass |
| `.planning/todos/pending/phase4-graph-mode-drill-url-wiring.md` | Phase-4 carry-forward brief | ✓ VERIFIED | Unchanged, still present |
| `frontend/src/resolve/resolvePathSegments.ts` | Intentionally staged for Phase 4, not deleted | ✓ VERIFIED | Still present in tree, untouched |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `routes/__root.tsx` (`RootPending`) | `shell/AppShell.tsx` | `overlays={false}` prop | WIRED | Unchanged since prior pass |
| `shell/AppShell.tsx` | `Inspector.tsx` / `CommandPalette.tsx` | conditional mount on `overlays` | WIRED | Unchanged since prior pass |
| `shell/search.ts` (`notebookIndex`) | `model/ids.ts` (`nid`) | id resolution for graph-only notebook nodes | WIRED (now provably collision-safe) | `nid()` is provably injective as of this commit, closing the residual silent-merge risk flagged in the prior pass |
| `model/adapt.ts`, `model/graphLayout.ts`, `model/lineageLayout.ts` | `model/ids.ts` (`tid`/`nid`) | short-id derivation for DOM ids / map keys | WIRED (now provably collision-safe) | All three consumers unchanged by this commit; exercised by the full 58/58-passing suite and a clean build |
| `.planning/ROADMAP.md` Phase 4 | `.planning/todos/pending/phase4-graph-mode-drill-url-wiring.md` | carry-forward reference | WIRED | Unchanged |

### Data-Flow Trace (Level 4)

Not re-run in full — this delta touches only id-derivation logic (`ids.ts`) and its test file, with no new data-rendering artifacts introduced. The prior pass's data-flow findings for `Inspector.tsx`/`CommandPalette.tsx`/`Rail.tsx` (all FLOWING) are unaffected.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit-test suite | `cd frontend && npx vitest run` | 12 files, 58 tests, all pass | PASS |
| Frontend build | `cd frontend && npm run build` | `tsc -b && vite build`, exit 0 | PASS |
| WR-03 v2 tests (named) | `npx vitest run src/model/__tests__/ids.test.ts` (subsumed in the full run above; also independently reasoned about) | 5/5 pass | PASS |
| WR-03 general collision-freedom claim, re-verified | Node REPL against shipped `frontend/src/model/ids.ts`: all 3 previously-flagged colliding pairs, plus a 200,000-sample random-string fuzz test | All pairs distinct; 0 collisions in 200,000 samples (104,642 unique outputs) | PASS |
| DOM/CSS-selector safety of encoded ids | Node REPL: `/^[A-Za-z0-9_-]+$/` against 6 representative ids including spaces/punctuation | All match | PASS |
| Fixture-id stability (no test churn) | Node REPL: `tid('table.raw_orders')`, `nid('notebook.clean_orders')` | `'raw_orders'`, `'nb_clean_orders'` — unchanged from pre-fix values | PASS |
| Delta scope confirmation | `git show --stat 284e95c` | Only `frontend/src/model/ids.ts` and `frontend/src/model/__tests__/ids.test.ts` touched | PASS (confirms isolated, non-regressing change) |
| Debt-marker scan on `ids.ts` | `grep -n "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` | No matches | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention found in this project; no probes declared in the gap-closure commit. SKIPPED — not applicable.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| SHELL-01 | 02-04 | Persistent left icon rail | SATISFIED | Unchanged, regression-checked |
| SHELL-02 | 02-04 | Canvas fills viewport | SATISFIED | Unchanged, regression-checked |
| SHELL-03 | 02-05 | Contextual inspector, no reflow | NEEDS HUMAN | Mechanism present + tested; live no-reflow/both-theme check still pending |
| SHELL-04 | 02-04 | Top-bar/segmented-control carried forward | SATISFIED | Unchanged, regression-checked |
| SHELL-05 | 02-03 / 02-09 | URL-addressable routes | PARTIAL (honestly documented) | Mode routes + lineage-table route + selection satisfied; graph-mode drill hierarchy deferred to Phase 4 per locked scope decision |
| SHELL-06 | 02-03 / 02-09 | Back/forward through drill levels | PARTIAL (honestly documented) | True for selection; graph-mode deferred to Phase 4 |
| SHELL-07 | 02-01..04 / 02-07 | App remains usable/demoable, never broken | SATISFIED | Unchanged, regression-checked |
| NAV-01 | 02-06 / 02-08 | Cmd+K palette searching tables/columns/notebooks/code | SATISFIED | Core search confirmed working; the WR-03 residual id-collision risk that previously partially blocked this is now closed — `notebookIndex()`'s id-based dedupe is provably collision-safe |
| NAV-03 | 02-06 | Palette fully keyboard-operable | NEEDS HUMAN | Mechanism (cmdk/Radix Dialog, no manual key handlers) unchanged and tested; live end-to-end keyboard/focus-restore check still pending |

No orphaned requirements. All nine phase-02 requirement IDs (SHELL-01..07, NAV-01, NAV-03) are accounted for above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `frontend/src/routes/__root.tsx` | 16 | `loader` still swallows every `fetchGraph()` failure silently, no UI indicator of sample-vs-live data (WR-02/WR-06, carried over from 02-REVIEW.md, explicitly deferred via the Phase-4 todo) | ℹ️ Info | Known-deferred, tracked in `.planning/todos/pending/phase4-graph-mode-drill-url-wiring.md`; not a Phase-2 blocker; unchanged by this commit |
| `frontend/src/views/GraphView.tsx` | 18-34, 194 | `drill`/`onDrill` not memoized, re-created every render (WR-02, carried over) | ℹ️ Info | Known-deferred to Phase 3/4 canvas rebuilds; not a Phase-2 blocker; unchanged by this commit |

The prior pass's ⚠️ Warning-level anti-pattern (`ids.ts` residual-collision risk) is resolved and removed from this table — the encoding is now provably injective.

No `TBD`/`FIXME`/`XXX` markers found in `ids.ts` or `ids.test.ts` (checked directly).

### Human Verification Required

### 1. Inspector no-reflow + both-theme visual check

**Test:** Open the app, select a table/column on both canvases, confirm the canvas does not shift when the inspector opens/closes, in both light and dark theme.
**Expected:** Zero layout shift; correct visuals in both themes.
**Why human:** Visual/layout judgment; not yet performed live. Unchanged since the prior pass — not touched by this commit.

### 2. Command palette live keyboard-operability

**Test:** Open Cmd+K, arrow through grouped results, Enter to select, Esc to close and confirm focus restores to the trigger — in both themes.
**Expected:** Full keyboard operability with correct cmdk/Radix-Dialog focus-trap/restore.
**Why human:** Requires a live, interactive browser session; not yet performed. Unchanged since the prior pass — not touched by this commit.

### 3. Full both-theme re-check of all Phase-2 shell chrome

**Test:** Re-run the standing both-themes discipline against Rail, ModeMenu, RailBottomCluster, theme toggle, Inspector (open), CommandPalette (open), and the Purview placeholders now that the app reliably paints.
**Expected:** No visual regression.
**Why human:** No screenshot artifacts persist in the repo for independent re-inspection of the overlays-open states in either theme. Unchanged since the prior pass — not touched by this commit.

### Gaps Summary

No open gaps remain. The single automated gap from the prior verification pass — WR-03's incomplete collision-freedom fix — is now genuinely closed:

**WR-03 is closed, confirmed independently, not on the commit message's or SUMMARY's word.** I read the actual shipped `frontend/src/model/ids.ts` source, independently reasoned through why the new escape encoding is injective (fixed-width 5-character escapes starting with an otherwise-fully-escaped `-` character make left-to-right decoding unambiguous), then empirically validated that reasoning: reproduced all three previously-flagged/at-risk colliding pairs as now-distinct in a live Node REPL against the shipped source, and ran a 200,000-sample brute-force fuzz test that found zero collisions. I also ran the project's actual test suite myself (58/58 pass, up from 56 with 2 new WR-03-v2 regression cases) and the production build myself (exit 0), rather than trusting reported numbers. `git show --stat` confirmed the fix touched only `ids.ts` and its test file, so the rest of the phase's previously-verified must-haves (SHELL-01/02/04/05/06-satisfied-portion/07, NAV-01 core search, WR-04 notebookIndex dedupe) carry forward unregressed.

The knock-on risk to WR-04 (silent notebook-search collisions via `notebookIndex()`'s id-based dedupe) is also resolved as a direct consequence — `nid()` being provably injective means that dedupe path can no longer silently merge two distinct notebooks.

**What remains is not a gap but scoped, pre-existing human-verification and deferral items, unchanged by this commit:**

1. Two behavior-dependent truths (SHELL-03 inspector no-reflow, NAV-03 live keyboard-operability) that require a live browser session to confirm and were correctly routed to end-of-phase human verification under `human_verify_mode: end-of-phase` — never automated-failed.
2. One locked, honestly-documented deferral (SHELL-05/06 graph-mode drill hierarchy → Phase 4), tracked via `.planning/todos/pending/phase4-graph-mode-drill-url-wiring.md`.

Per the verification decision tree: no truth is FAILED, no artifact is MISSING/STUB, no key link is NOT_WIRED, and no blocker anti-pattern was found — but the human-verification section is non-empty, so the overall status is `human_needed`, not `passed`. The phase is ready for its end-of-phase human verification pass; there is no further automated gap-closure work outstanding.

---

_Verified: 2026-07-22T09:00:00Z_
_Verifier: Claude (gsd-verifier)_
