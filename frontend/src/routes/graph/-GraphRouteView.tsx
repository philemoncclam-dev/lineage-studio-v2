// Dash-prefixed: excluded from route generation. Shared bridge component
// rendered by every /graph/* leaf route (index, $workspace, $lakehouse,
// $table) — GraphView.tsx keeps its own internal drill/breadcrumb state in
// this phase (D-14/D-15 token-bridge-only; the Phase 3/4 canvas rebuild is
// what wires the drill state itself to the URL). This wrapper only adapts
// its one real prop, onOpenLineage, to a router navigation.
import { useNavigate } from '@tanstack/react-router'
import GraphView from '../../views/GraphView'

export default function GraphRouteView() {
  const navigate = useNavigate()

  // The retired Lineage-mode DAG was the old destination; "open lineage" now
  // resolves in-place as a graph selection (?sel/?col).
  const onOpenLineage = (tableId: string, colKey?: string) => {
    void navigate({
      to: '/graph',
      search: (prev: Record<string, unknown>) => ({ ...prev, sel: tableId, col: colKey }),
    })
  }

  return <GraphView onOpenLineage={onOpenLineage} />
}
