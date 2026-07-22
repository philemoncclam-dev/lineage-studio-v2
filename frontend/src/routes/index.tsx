// `/` has no content of its own — the app's default destination is the
// Graph (knowledge-graph) mode's Estate level.
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/graph', replace: true })
  },
})
