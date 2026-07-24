// Data Products mode layout — a pathless Outlet host, mirroring the Purview
// layout route. The section's own pages (catalog / detail / new / requests)
// render inside the shared shell chrome AppShell provides.
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/products')({
  component: () => <Outlet />,
})
