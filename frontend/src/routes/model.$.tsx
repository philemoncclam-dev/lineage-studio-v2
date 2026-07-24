// Modeling mode: the vendored lineage-studio app, mounted whole. It owns all
// URLs under /model with its own react-router; this splat route just keeps the
// host TanStack router matching (and the shell chrome rendered) for any depth.
import { createFileRoute } from '@tanstack/react-router'
import ModelAppMount from '../model-app/mount'

export const Route = createFileRoute('/model/$')({
  component: ModelAppMount,
})
