// /purview/data-products — honest placeholder (D-03). See push.tsx.
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/purview/data-products')({
  component: DataProductsPlaceholder,
})

function DataProductsPlaceholder() {
  return (
    <div className="purview-page">
      <h1 className="page-title">Data product cataloguing isn't built yet</h1>
      <p className="page-lead">
        This toolkit page ships alongside Purview Push in Phase 5, using the same preview → confirm → results
        pattern.
      </p>
    </div>
  )
}
