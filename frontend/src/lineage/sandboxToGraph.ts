// Turn a sandbox run's reads/writes into a LineageGraph — the same shape the
// backend's build_graph emits, so it flows through adapt() → graphToModel()
// unchanged and lands as an authored 4-layer model. This is the Fabric-mode
// shortcut: a notebook run already knows what it reads and writes, so the
// model's shape can be assembled for the user instead of drawn by hand.
//
// Columns are not populated yet — the sandbox derives object-level lineage
// (notebook ↔ tables). When the schema fetch lands (M2b), the same tables gain
// their columns and the model gains attribute-level detail for free.
import type { LineageGraph, LineageNode, LineageEdge, SandboxRunResult, Column, ColumnMap } from '../api'

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

  // The Spark engine resolves the real output schema of each written table;
  // carry those columns onto the table node so the authored model gets
  // attribute-level detail. Read-only tables have no schema here yet.
  const columnsFor = (name: string): Column[] =>
    (result.table_schemas[name] ?? []).map((c) => ({ name: c.name, data_type: c.type ?? null }))

  // One table node per distinct table the notebook touched, either side. The
  // node id stays the full ref — two workspaces can hold a same-named table and
  // they must not merge — while the display name is the leaf, with the
  // workspace and lakehouse carried in meta for the model to show.
  for (const t of new Set([...result.reads, ...result.writes])) {
    const ref = result.tables?.[t]
    nodes.push({
      id: tableId(t),
      kind: 'table',
      name: ref?.table || t,
      parent_id: null,
      columns: columnsFor(t),
      meta: ref?.resolved ? { workspace: ref.workspace, lakehouse: ref.lakehouse } : {},
    })
  }

  // Column maps for a write edge: the run's column flows into that target,
  // shaped as the LineageGraph's ColumnMap (adapt() resolves which read table
  // owns each from_column). This is what makes the authored model column-level.
  const columnMapsFor = (target: string): ColumnMap[] =>
    result.column_lineage
      .filter((f) => f.to_table === target)
      .map((f) => ({ from_column: f.from_column, to_column: f.to_column, transform: f.transform ?? null, evidence: null }))

  const edges: LineageEdge[] = [
    ...result.reads.map(
      (r): LineageEdge => ({ source: tableId(r), target: nbId, kind: 'reads', columns: [], via: nbId }),
    ),
    ...result.writes.map(
      (w): LineageEdge => ({ source: nbId, target: tableId(w), kind: 'writes', columns: columnMapsFor(w), via: nbId }),
    ),
  ]

  return { nodes, edges }
}
