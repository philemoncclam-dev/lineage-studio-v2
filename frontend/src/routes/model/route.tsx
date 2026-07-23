// Modeling mode layout route. Wraps the modeling routes in the store provider
// so an authored model persists across in-mode navigation. Unlike the other
// modes it does not consume the shared LineageGraph — the model is authored,
// not derived.
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { ModelStudioProvider } from '../../model-studio/store'

export const Route = createFileRoute('/model')({
  component: () => (
    <ModelStudioProvider>
      <Outlet />
    </ModelStudioProvider>
  ),
})
