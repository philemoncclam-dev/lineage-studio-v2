// /model — the model library (create/open/duplicate/delete authored models).
import { createFileRoute } from '@tanstack/react-router'
import ModelsHome from '../../model-studio/ModelsHome'

export const Route = createFileRoute('/model/')({
  component: ModelsHome,
})
