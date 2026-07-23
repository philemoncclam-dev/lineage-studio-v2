// /model — the Modeling-mode landing view (the authoring board).
import { createFileRoute } from '@tanstack/react-router'
import ModelStudio from '../../model-studio/ModelStudio'

export const Route = createFileRoute('/model/')({
  component: ModelStudio,
})
