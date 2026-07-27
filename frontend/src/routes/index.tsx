// `/` has no content of its own — it lands on the Model Browser, which is the
// first screen after sign-in and the place a model is found or created.
// (It used to land on the Fabric toolkit's Explore level.)
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/models', replace: true })
  },
})
