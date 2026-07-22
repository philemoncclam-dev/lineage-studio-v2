// /graph — Estate level (GraphView's own default drill state).
import { createFileRoute } from '@tanstack/react-router'
import GraphRouteView from './-GraphRouteView'

export const Route = createFileRoute('/graph/')({
  component: GraphRouteView,
})
