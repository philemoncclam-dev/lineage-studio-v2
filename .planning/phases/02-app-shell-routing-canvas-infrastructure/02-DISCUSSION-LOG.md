# Phase 2: App Shell, Routing & Canvas Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-21
**Phase:** 2-App Shell, Routing & Canvas Infrastructure
**Areas discussed:** Rail destinations & IA, URL scheme, Inspector behavior, Migration sequencing

---

## Rail destinations & IA

| Option | Description | Selected |
|--------|-------------|----------|
| 4 rails: Lineage, Graph, Purview, Definitions | Four flat peer destinations | |
| 3 rails: Lineage, Graph, Purview hub | Purview hub with internal tabs | |
| 5 rails incl. Data Products | Everything as its own rail icon | |
| *Free text* | Three top-level MODES (Graph, Lineage "Solidatus-like", Purview toolkit), each with its own contextual rail | ✓ |

**User's choice:** Free text — mode-based IA: "the Lineage graph view, Lineage (Solidatus like view), and Purview mode. Behind these modes they have their own respective Left icon rail... The purview mode is more like a toolkit for the user to make changes and enhance their administration of Purview."
**Notes:** Claude authorized to assume per-mode rail contents.

Follow-ups within the area:
- Mode switch: **App-logo mode menu** chosen over "Segmented control in top bar" and "Mode icons at top of the rail".
- Purview rail this phase: **Full toolkit skeleton** (Push, Definitions Import, Data Products; placeholders until Phase 5) over "Only what works today" / "You decide".
- Global utilities: **Rail bottom cluster** over "Top bar right side" / "Search top bar, rest rail bottom".
- Graph/Lineage rails: **Scope + view tools** over "Minimal now" / "You decide".
- Rail style: **Icon-only + tooltips (~48px)** over "Expandable rail" / "Always icons + tiny labels".

---

## URL scheme

| Option | Description | Selected |
|--------|-------------|----------|
| Path=place, search=state | App-designed path segments + search params | |
| Shallow paths + rich search | Mode-only paths, everything else in search | |
| Everything in the path | Drill and selection all as path segments | |
| *Free text* | Path mirrors the real Fabric/Purview absolute path | ✓ |

**User's choice:** "Path should be the path that would be in Fabric... or whatever Purview would have given as the absolute path."
**Notes:** Follow-ups: **Readable names resolved to GUIDs** (over raw GUIDs / encoded FQN); selection in **search params** `?sel/&col` (over deepest path segment); bad links resolve to **nearest ancestor + notice** (over mode root / dedicated 404).

---

## Inspector behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Overlay panel | Floats over canvas right edge; no reflow | ✓ |
| Docked, canvas pans | Takes width; camera compensates | |
| Docked, canvas reflows | Simple flex; canvas shifts | |

**User's choice:** Overlay panel.
**Notes:** Follow-ups: opens on select, **Esc/X/empty-click closes** (over pinnable / manual toggle); shows a **real metadata card** this phase (over skeleton-only); **fixed width ~360–400px** (over resizable / two-state).

---

## Migration sequencing

| Option | Description | Selected |
|--------|-------------|----------|
| Shell around old app first | New shell wraps existing views, then router, then plumbing | (✓ via delegation) |
| Router first, then shell | URL-addressability lands earliest | |
| Parallel workstreams | Router+shell ∥ model.tsx decomposition | (partially adopted) |

**User's choice:** Free text — "I dont like the old apps stuff, go with what you think is best." Claude locked: shell-first, old top bar removed immediately, model.tsx decomposition allowed as parallel plan.
**Notes:** Follow-ups: bridged canvases get **token bridge only** (over cosmetic pass / hide-what-offends); **SHELL-04 treatment still carries forward** (over redesigning controls); Cmd+K palette **rebuilt on new primitives** (over re-housing SearchPalette.tsx).

---

## Claude's Discretion

- Exact per-mode rail item sets and icons.
- Route tree shape / TanStack Router conventions within the locked URL decisions.
- Build-order detail and demoable-commit boundaries.
- Mode-menu design and placeholder-page treatment.

## Deferred Ideas

None — discussion stayed within phase scope.
