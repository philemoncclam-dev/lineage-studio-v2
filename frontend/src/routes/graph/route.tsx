// Graph mode layout route. validateSearch (the ?sel/?col selection schema,
// D-08) is added in Task 2 — kept minimal here so Task 1's route tree stands
// up independently.
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/graph')({
  component: () => <Outlet />,
})
