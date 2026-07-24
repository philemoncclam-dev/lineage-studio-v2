// /model/$modelId — the authoring workspace for one model. Loads the model
// from localStorage in the loader; a missing id (deleted in another tab,
// stale link) renders a small not-found state rather than crashing.
import { createFileRoute, Link } from '@tanstack/react-router'
import { getModel } from '../../model-studio/localdb'
import ModelEditor from '../../model-studio/ModelEditor'
import { ModelStudioProvider } from '../../model-studio/store'

export const Route = createFileRoute('/model/$modelId')({
  loader: ({ params }) => ({ model: getModel(params.modelId) }),
  component: ModelEditorRoute,
})

function ModelEditorRoute() {
  const { model } = Route.useLoaderData()
  if (!model) {
    return (
      <div className="ms-root">
        <div className="ms-empty">
          <p className="ms-empty-title">Model not found</p>
          <p className="ms-empty-sub">It may have been deleted, or the link is stale.</p>
          <Link to="/model" className="tbtn">Back to models</Link>
        </div>
      </div>
    )
  }
  return (
    <ModelStudioProvider initial={model}>
      <ModelEditor />
    </ModelStudioProvider>
  )
}
