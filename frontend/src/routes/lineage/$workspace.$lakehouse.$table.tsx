// /lineage/$workspace/$lakehouse/$table — the Solidatus-like column-lineage
// DAG for one table. LineageDagView (03-07, replacing the retired
// hand-rolled SVG lineage view) accepts focusTable/focusColumn as props, so
// this route genuinely drives the view from the URL (path -> focusTable,
// ?col search -> focusColumn).
//
// `table` is a readable name when reached from a live graph (D-06/D-07) but
// may already be a raw AppModel table id when reached from the bundled
// sample model (see routes/graph/-lineageLink.ts — the sample model has no
// workspace/lakehouse hierarchy to mirror). Resolve defensively: AppModel id
// match first (covers sample mode + any direct id paste), then AppModel name
// match, then the raw root-loaded graph's table nodes by name.
import { createFileRoute } from '@tanstack/react-router'
import { Route as RootRoute } from '../__root'
import LineageDagView from '../../views/LineageDagView'
import { useModel } from '../../model'

export const Route = createFileRoute('/lineage/$workspace/$lakehouse/$table')({
  component: LineageRouteComponent,
})

function LineageRouteComponent() {
  const { table } = Route.useParams()
  const search = Route.useSearch() as { sel?: string; col?: string }
  const { graph } = RootRoute.useLoaderData()
  const model = useModel()

  const byId = model.tables.find((t) => t.id === table)
  const byName = !byId ? model.tables.find((t) => t.name === table) : undefined
  const byGraphName =
    !byId && !byName && graph ? graph.nodes.find((n) => n.kind === 'table' && n.name === table) : undefined
  const focusTable = byId?.id ?? byName?.id ?? byGraphName?.id ?? table

  return <LineageDagView focusTable={focusTable} focusColumn={search.col} />
}
