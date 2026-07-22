// Lineage mode layout route. Declares the ?sel/?col selection schema (D-08),
// mirroring routes/graph/route.tsx.
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { selectionSchema } from '../../selection/useSelection'

export const Route = createFileRoute('/lineage')({
  validateSearch: selectionSchema,
  component: () => <Outlet />,
})
