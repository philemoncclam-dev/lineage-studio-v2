// LineageEdge — xyflow custom edge rendering the dual independent channels
// TRUST-01 requires: edge-type hue (reads/writes/derives, unchanged Phase-1
// channel) composed with provenance line-style (declared=solid /
// inferred=dashed, new this phase, D-08) plus trace state (on/dim/none).
// The path itself is a straight port of the retired hand-rolled SVG lineage view's
// cubic-bezier curve(), reimplemented via xyflow's getBezierPath so it still
// clears intervening cards the way dagre's rank spacing already accounts
// for (03-UI-SPEC.md "Edge rendering").

import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { LineageEdgeData } from './types'

// LineageEdgeData (types.ts, owned by 03-03) has no `traced` field — trace
// state is a per-render, view-level concern (computed from the active
// hover/selection) that 03-07/LineageDagView injects onto each edge's data
// when building the xyflow Edge[] array, not something toXyflow.ts's static
// mapping knows about. Extending locally here keeps types.ts untouched.
export interface TracedLineageEdgeData extends LineageEdgeData {
  traced?: 'on' | 'dim' | null
}

/**
 * Pure class-composition helper (TRUST-01): 'lineage-edge' base class plus
 * three independent channel classes — kind (hue), provenance (dash-style),
 * and trace state — exactly the port of the retired hand-rolled SVG lineage view's
 * `['edge', kind, on?'hot':'', dim].join(' ')` idiom, with `provenance`
 * added as its own independent slot per D-08 (never derived from `kind`,
 * never derived from `traced`).
 */
export function lineageEdgeClass(data: TracedLineageEdgeData): string {
  return ['lineage-edge', data.kind, data.provenance, data.traced ?? ''].join(' ').trim()
}

// `& Record<string, unknown>` works around the same TS generic-constraint
// quirk documented in TableNode.tsx — an `interface`-declared data shape
// isn't structurally assignable to xyflow's `EdgeData extends
// Record<string, unknown>` constraint without an explicit index-signature
// intersection, even though every field is otherwise fully typed.
type LineageEdgeType = Edge<TracedLineageEdgeData & Record<string, unknown>, 'lineageEdge'>

export default function LineageEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<LineageEdgeType>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })

  if (!data) return <BaseEdge path={path} className="lineage-edge" />

  // Phase-3 reality (D-09): every edge rendered this phase is
  // data.provenance === 'inferred' — the label always says so explicitly,
  // never implying a declared/verified source that doesn't exist yet.
  const label = `${data.kind} edge (${data.provenance})${
    data.from && data.to ? ` — ${data.from} → ${data.to}` : ''
  }`

  return <BaseEdge path={path} className={lineageEdgeClass(data)} aria-label={label} />
}
