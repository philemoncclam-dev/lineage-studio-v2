// /graph/$workspace — Workspace level. See -GraphRouteView.tsx: GraphView
// still drives its own drill state internally in this bridge phase, this
// route only makes the URL a valid, refresh-safe destination.
import { createFileRoute } from '@tanstack/react-router'
import GraphRouteView from './-GraphRouteView'

export const Route = createFileRoute('/graph/$workspace/')({
  component: GraphRouteView,
})
