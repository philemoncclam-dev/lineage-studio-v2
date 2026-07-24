// Modeling mode layout route. Unlike the other modes it does not consume the
// shared LineageGraph — models are authored, not derived. Each child route
// wires its own store (the editor needs a specific model id), so this layout
// is just a pass-through.
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/model')({
  component: () => <Outlet />,
})
