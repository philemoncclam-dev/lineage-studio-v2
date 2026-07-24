// Fabric mode layout route — hosts the toolkit pages (Explore / Sandbox /
// Definitions). Pathless layout, mirroring the old purview/route.tsx: the
// toolkit pages don't participate in the graph selection store.
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/fabric')({
  component: () => <Outlet />,
})
