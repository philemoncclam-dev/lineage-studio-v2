// Purview mode layout route — hosts the Push / Definitions / Data Products
// toolkit pages (D-03). No shared validateSearch needed here; the toolkit
// pages don't participate in the graph/lineage selection store.
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/purview')({
  component: () => <Outlet />,
})
