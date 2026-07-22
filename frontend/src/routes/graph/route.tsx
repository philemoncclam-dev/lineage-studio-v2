// Graph mode layout route. Declares the ?sel/?col selection schema (D-08) —
// Zod v4 implements Standard Schema, so it's passed directly to
// validateSearch, no @tanstack/zod-adapter needed.
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { selectionSchema } from '../../selection/useSelection'

export const Route = createFileRoute('/graph')({
  validateSearch: selectionSchema,
  component: () => <Outlet />,
})
