// /graph/$workspace/$lakehouse — Lakehouse level. See -GraphRouteView.tsx.
import { createFileRoute } from '@tanstack/react-router'
import GraphRouteView from './-GraphRouteView'

export const Route = createFileRoute('/graph/$workspace/$lakehouse/')({
  component: GraphRouteView,
})
