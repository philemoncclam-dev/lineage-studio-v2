// Lineage mode layout route. validateSearch (?sel/?col, D-08) is added in
// Task 2.
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/lineage')({
  component: () => <Outlet />,
})
