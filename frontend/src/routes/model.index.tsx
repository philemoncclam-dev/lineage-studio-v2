// /model exactly (no sub-path) — same vendored app; its own router shows the
// model library at its root route.
import { createFileRoute } from '@tanstack/react-router'
import ModelAppMount from '../model-app/mount'

export const Route = createFileRoute('/model/')({
  component: ModelAppMount,
})
