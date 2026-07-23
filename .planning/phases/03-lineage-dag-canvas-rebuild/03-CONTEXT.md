# Phase 3: Lineage DAG Canvas Rebuild - Context

**Gathered:** 2026-07-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Rebuild the column-level lineage view on `@xyflow/react` + dagre: expandable
table cards with correct column-**row** edge anchoring, hover-to-trace,
persistent click-selection, an inspector that explains a column's transform and
the evidence behind inferred edges, provenance-differentiated edges, and full
keyboard/assistive-technology reachability. This establishes the provenance
(TRUST) treatment that Phase 5's Purview push flow depends on.

Out of this phase: the knowledge-graph canvas (Phase 4), the real Purview push
UI (Phase 5), animated edge tracing / panel motion (Phase 7 — MOT), and the
dedicated light-theme review pass (Phase 6). Standing light-mode discipline
still applies incrementally here (pitfall #12).

</domain>

<decisions>
## Implementation Decisions

### Renderer & layout (locked upstream — restated, not re-decided)
- **D-01:** Renderer is `@xyflow/react` (v12) + dagre, per ROADMAP. The repo
  currently has the *old* `reactflow@11` package installed — planning must treat
  migrating to `@xyflow/react` (renamed package, v11→v12) as explicit work, and
  reconcile it with the existing `model-studio` Solidatus modeling mode
  (`frontend/src/model-studio/`) which may also touch a graph renderer.
- **D-02:** Layout is deterministic (DAG-07) — same graph ⇒ same positions. Left-
  to-right (DAG-01). Consume the decomposed pure layout model from Phase 2
  (`frontend/src/model/lineageLayout.ts`, `adapt.ts`), don't re-derive positions
  ad hoc.

### Card detail & the table↔column toggle (DAG-06)
- **D-03:** **Global toggle, expanded by default.** Cards start expanded showing
  all column rows. One global control flips the whole view to table-level
  (headers only). This is the simple, Solidatus-like mental model — no per-card
  expand/collapse state in v1.
- **D-04:** Wide tables (many columns) **scroll inside the card**; no
  virtualization or truncate-with-count in v1. Revisit only if a real table's
  column count makes an expanded card unusable.

### Hover-trace + persistent selection (DAG-03 / DAG-04)
- **D-05:** **One trace treatment, hover is transient.** A "trace" = the full
  upstream+downstream connected path lit while everything unrelated **dims to
  ~15% opacity and becomes non-interactive**.
- **D-06:** Hover **previews** a trace transiently. A **click freezes** it as the
  persistent selection. Hovering a different column *while something is selected*
  shows that hover trace transiently **without losing the selected column** — the
  selection returns when the hover ends. Selection is cleared by Esc, the
  inspector close button, or an empty-canvas click (mirrors Phase 2 D-11).
- **D-07:** Selection state is the existing Phase-2 selection store + `?sel`/`?col`
  URL params — not a new local state model.

### Provenance edge channel (TRUST-01)
- **D-08:** Provenance is encoded by **line style, non-colour**: **declared =
  solid, inferred = dashed.** Edge-type colour (reads/writes/derives) stays free
  and the distinction survives colourblind simulation (pitfall #19 / THEME-06
  discipline).
- **D-09:** **Reality:** every edge produced today comes from static parsing, so
  in Phase 3 **all edges render as dashed/inferred.** The *solid/declared* style
  is built and wired now but only lights up in Phase 5 when the app reads
  Purview-declared lineage back. No numeric confidence — categorical only
  (per REQUIREMENTS out-of-scope).
- **D-10:** No backend provenance enum added in this phase — "all inferred" is a
  convention Phase 5 replaces with a real read-back, not a model change here.
  (Contrast with D-12 below, which *does* accept a scoped backend change.)

### Inferred-edge evidence & transform copy (TRUST-02 / DAG-05)
- **D-11:** The inspector for a selected column shows: the **transform
  expression**, the resolved **source→target columns**, the **originating
  notebook**, a **plain-English explanation**, and — new — the **matched notebook
  cell + line/snippet** as verbatim evidence for *why this inferred edge exists*.
- **D-12:** **Accepted scope note — this phase extends the backend parser.**
  Today the `Edge`/`ColumnMap` model (`backend/app/models.py`) carries only
  `transform` (e.g. `"upper(x)"`) and `via` (notebook node id) — there is **no
  cell/line/snippet evidence**. Delivering the verbatim snippet requires
  threading evidence (notebook, cell index, line, snippet) from `parser.py`
  through `ColumnMap` and out over the `LineageGraph` contract. This is a
  deliberate, bounded backend addition inside an otherwise frontend-focused
  phase. **The `LineageGraph` shape must stay backward-compatible** (additive,
  optional field) per CLAUDE.md's stability rule and the Phase-1→2 contract.
- **D-13:** The plain-English explanation continues to be **frontend-synthesized**
  from the available fields (as `adapt.ts` already does: *"Computed as … in
  {notebook}"* / *"Passed through from … by {notebook}"*), now enriched by the
  new evidence. It must **not imply more semantic understanding than a regex
  parser actually has** (pitfall #6) — evidence is shown *as parsed*, labelled
  inferred.

### Provenance / trust freshness (TRUST-03)
- **D-14:** The UI shows **when lineage data was last refreshed.** Surface it in
  the lineage view chrome/inspector (exact placement is Claude's discretion),
  sourced from the existing load path — no new persistence.

### Claude's Discretion
- **Keyboard/AT model (DAG-08, SC#6, pitfall #19):** every mouse-reachable node
  and edge must be keyboard-reachable and operable, with semantic labelling for
  AT. Dual-purpose keyboard navigation with power-user speed rather than a
  bolted-on a11y pass. Exact traversal scheme (tab order through cards/columns,
  arrow-key path walking, focus-visible treatment) is Claude's to design in
  research/planning, consistent with `@xyflow/react`'s a11y affordances.
- Exact xyflow custom-node/edge component shapes, dagre tuning, and how the
  Phase-2 `lineageLayout` output maps onto xyflow node/edge props.
- Exact dim opacity, transition timing (kept minimal — real motion is Phase 7),
  and inspector layout within the fixed ~360–400px Phase-2 overlay.
- Placement of the "last refreshed" indicator and the global table↔column toggle
  control within the lineage-mode rail/chrome.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 3 section: goal, DAG-01..08 / TRUST-01..03
  mapping, SC#1–6, pitfall guards #6 / #19 / #12, parallel-with-Phase-4 note.
- `.planning/REQUIREMENTS.md` — DAG and TRUST requirement definitions; Locked
  Decisions table (categorical provenance, no numeric confidence); Out-of-Scope
  (no per-layer Bronze/Silver/Gold labels, no minimap, label-only nodes).
- `.planning/PROJECT.md` — dark-first Datadog/Grafana direction; standing
  dislikes (no minimap, no persistent legends, no hint bars).

### Phase 2 outputs (the shell/plumbing this canvas plugs into)
- `.planning/phases/02-app-shell-routing-canvas-infrastructure/02-CONTEXT.md` —
  inspector overlay (D-10..13), selection store + `?sel`/`?col` params (D-08,
  D-11), lineage mode rail (D-03).
- `frontend/src/model/` — `adapt.ts`, `lineageLayout.ts`, `domainColor.ts`,
  `ids.ts` (decomposed pure layout model; column edges + transforms already
  built here).
- `frontend/src/selection/` — the shared selection store.
- `frontend/src/tokens/canvasTokens.ts` — cached canvas-token reader for any
  canvas-drawn colour.
- `frontend/src/views/LineageView.tsx` — the current hand-rolled SVG lineage
  view (152 lines) this phase **replaces** with the xyflow rebuild.

### Design system (Phase 1 outputs)
- `.planning/phases/01-design-tokens-typography-foundation/01-UI-SPEC.md`
- `frontend/src/styles/tokens.css`, `frontend/src/styles/components.css`

### Backend (touched by D-12's scoped evidence addition)
- `backend/app/models.py` — `Edge` / `ColumnMap` / `LineageGraph` contract
  (must stay additively backward-compatible).
- `backend/app/parser.py` — static parser that must emit the new cell/line/snippet
  evidence.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/model/adapt.ts` — already builds column-level edges and the
  `xform` map (`[expression, plain-English]`) from write-edge column maps.
  D-11/D-13 extend this rather than rebuild it.
- `frontend/src/model/lineageLayout.ts` — deterministic layout source (D-02).
- `frontend/src/selection/` + `?sel`/`?col` params — persistent selection (D-07).
- `frontend/src/tokens/canvasTokens.ts` — cached token reader for canvas colour.

### Established Patterns
- All styling flows through the Phase-1 token layer — no raw hex/px (01-REVIEW
  enforced this).
- Plain-English transform copy is frontend-synthesized in `adapt.ts` today.

### Integration Points
- `frontend/src/views/LineageView.tsx` — the SVG view being replaced.
- `frontend/src/model-studio/` — the recently-added Solidatus modeling mode;
  reconcile renderer/library choices with it (D-01).
- Package: `reactflow@11` is installed; migration to `@xyflow/react@12` is in
  scope (D-01).
- `backend/app/parser.py` → `ColumnMap` → `LineageGraph` — the evidence thread
  for D-11/D-12.

</code_context>

<specifics>
## Specific Ideas

- Solidatus-like structured left-to-right lineage is the user's mental model
  (carried from Phase 2's "Lineage (Solidatus-like view)").
- Provenance = solid (declared) vs dashed (inferred); everything is dashed in
  Phase 3 until Phase 5 reads Purview back.
- Evidence should be honest about being regex-parsed — show the actual matched
  snippet, don't dress it up as semantic understanding.

</specifics>

<deferred>
## Deferred Ideas

- **Per-card expand/collapse state** — deferred; v1 uses a single global toggle
  (D-03). Revisit if global-only proves too coarse.
- **Column-list virtualization / truncate-with-count for very wide tables** —
  deferred to a follow-up if scroll-in-card (D-04) proves insufficient on real
  data.
- **Backend provenance enum** — not added here; Phase 5's Purview read-back
  supplies the declared/inferred distinction for real (D-10).
- **Numeric confidence scores** — permanently out of scope (REQUIREMENTS);
  provenance stays categorical.
- **Animated edge tracing / panel transitions** — Phase 7 (MOT-01/02).

</deferred>

---

*Phase: 3-Lineage DAG Canvas Rebuild*
*Context gathered: 2026-07-22*
