// /purview/data-products — superseded by the dedicated Data Products mode,
// which owns the browse/detail/request experience. This Purview-toolkit slot
// now just points there rather than duplicating it.
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/purview/data-products')({
  component: DataProductsRedirectNote,
})

function DataProductsRedirectNote() {
  return (
    <div className="purview-page">
      <h1 className="page-title">Data products have their own section</h1>
      <p className="page-lead">
        Browsing products by domain, the product pages, and the access-request workflow now live in the
        Data Products mode. <Link to="/products">Open Data Products →</Link>
      </p>
    </div>
  )
}
