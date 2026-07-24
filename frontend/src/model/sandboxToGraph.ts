// Turn a sandbox run's reads/writes into a LineageGraph — the same shape the
// backend's build_graph emits, so it flows through adapt() → graphToModel()
// unchanged and lands as an authored 4-layer model. This is the Fabric-mode
// shortcut: a notebook run already knows what it reads and writes, so the
// model's shape can be assembled for the user instead of drawn by hand.
//
// Columns are not populated yet — the sandbox derives object-level lineage
// (notebook ↔ tables). When the schema fetch lands (M2b), the same tables gain
// their columns and the model gains attribute-level detail for free.
import type { LineageGraph, LineageNode, LineageEdge, SandboxRunResult } from '../api'

const tableId = (name: string) => `table.${name.toLowerCase()}`

export function sandboxRunToGraph(
  result: SandboxRunResult,
  notebookName: string,
  workspaceName = 'Fabric',
): LineageGraph {
  const wsId = `workspace.${workspaceName.toLowerCase()}`
  const nbId = `notebook.${notebookName.toLowerCase()}`

  const nodes: LineageNode[] = [
    { id: wsId, kind: 'workspace', name: workspaceName, parent_id: null, columns: [], meta: {} },
    { id: nbId, kind: 'notebook', name: notebookName, parent_id: wsId, columns: [], meta: {} },
  ]

  // One table node per distinct table the notebook touched, either side.
  for (const t of new Set([...result.reads, ...result.writes])) {
    nodes.push({ id: tableId(t), kind: 'table', name: t, parent_id: null, columns: [], meta: {} })
  }

  const edges: LineageEdge[] = [
    ...result.reads.map(
      (r): LineageEdge => ({ source: tableId(r), target: nbId, kind: 'reads', columns: [], via: nbId }),
    ),
    ...result.writes.map(
      (w): LineageEdge => ({ source: nbId, target: tableId(w), kind: 'writes', columns: [], via: nbId }),
    ),
  ]

  return { nodes, edges }
}
