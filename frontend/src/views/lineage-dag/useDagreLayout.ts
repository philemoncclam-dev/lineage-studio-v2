// Deterministic LR dagre layout over the (tables, notebooks, ops) topology
// already produced by frontend/src/model/lineageLayout.ts / adapt.ts.
// Supersedes lineageLayout.ts's `place()` cursor-based {x, y} placement for
// the DAG view specifically (RESEARCH.md Open Question #1 resolution) —
// this module consumes the same topology shape but hands real dagre.layout()
// the ranking/positioning work.
//
// Pure function of (tables, notebooks, ops, mode): no random seed, no
// incremental/warm-start state, so the same inputs always produce
// byte-identical {x, y} output (DAG-07).

import dagre from '@dagrejs/dagre'
import type { NB, Table } from '../../data'
import type { LineageMode } from './types'

const NODE_WIDTH = 240
const HEADER_HEIGHT = 40
const ROW_HEIGHT = 28
const MAX_ROWS = 10

// mode==='table' -> header-only (40px), uniform for every table/notebook.
// mode==='column' -> header + up to 10 visible rows (wider tables scroll
// inside the card past that, D-04) -> naturally capped at 320px.
export function nodeHeight(mode: LineageMode, columnCount: number): number {
  return mode === 'table' ? HEADER_HEIGHT : HEADER_HEIGHT + Math.min(columnCount, MAX_ROWS) * ROW_HEIGHT
}

export function buildDagreLayout(
  tables: Table[],
  notebooks: NB[],
  ops: [string, string, 'reads' | 'writes'][],
  mode: LineageMode,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  // Config lives on setGraph({...}), NOT as a second argument to layout()
  // (RESEARCH.md Pitfall/Assumption A1).
  g.setGraph({ rankdir: 'LR', ranksep: 64, nodesep: 32, edgesep: 16, marginx: 32, marginy: 32 })

  for (const t of tables) {
    g.setNode(t.id, { width: NODE_WIDTH, height: nodeHeight(mode, t.columns.length) })
  }
  for (const n of notebooks) {
    g.setNode(n.id, { width: NODE_WIDTH, height: HEADER_HEIGHT })
  }
  for (const [s, t] of ops) {
    g.setEdge(s, t)
  }

  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  g.nodes().forEach((id) => {
    const n = g.node(id)
    // dagre reports each node's CENTER point; xyflow's Node.position expects
    // the TOP-LEFT corner (RESEARCH.md Pitfall 3) — convert explicitly.
    positions.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2 })
  })
  return positions
}
