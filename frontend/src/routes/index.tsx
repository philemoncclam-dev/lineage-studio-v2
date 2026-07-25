// `/` has no content of its own — the app's default destination is the Fabric
// toolkit's Explore level (Graph mode is disabled as a mode-switch target).
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/fabric/explore', replace: true })
  },
})
