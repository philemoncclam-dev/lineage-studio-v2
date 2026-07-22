// Dash-prefixed: excluded from route generation. Shared bridge component
// rendered by every /graph/* leaf route (index, $workspace, $lakehouse,
// $table) — GraphView.tsx keeps its own internal drill/breadcrumb state in
// this phase (D-14/D-15 token-bridge-only; the Phase 3/4 canvas rebuild is
// what wires the drill state itself to the URL). This wrapper only adapts
// its one real prop, onOpenLineage, to a router navigation.
import { useNavigate } from '@tanstack/react-router'
import { Route as RootRoute } from '../__root'
import GraphView from '../../views/GraphView'
import { lineageTarget } from './-lineageLink'

export default function GraphRouteView() {
  const { graph } = RootRoute.useLoaderData()
  const navigate = useNavigate()

  const onOpenLineage = (tableId: string, colKey?: string) => {
    const target = lineageTarget(graph, tableId)
    void navigate({
      to: '/lineage/$workspace/$lakehouse/$table',
      params: { workspace: target.workspace, lakehouse: target.lakehouse, table: target.table },
      search: (prev: Record<string, unknown>) => ({ ...prev, sel: tableId, col: colKey }),
    })
  }

  return <GraphView onOpenLineage={onOpenLineage} />
}
