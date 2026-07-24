// /products/$productId — the data-product "contract" page: description, use
// cases, owners, the associated data assets (with a column drill-in), a link to
// the authored model in the modelling tab, and the request-access workflow.
import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  fetchProduct,
  fetchProductDomains,
  requestAccess,
  type AccessRequest,
  type ProductAsset,
  type ProductRecord,
} from '../../api'
import '../../views/products.css'

export const Route = createFileRoute('/products/$productId')({
  component: ProductDetail,
})

function AssetRow({ asset }: { asset: ProductAsset }) {
  const [open, setOpen] = useState(false)
  const hasColumns = asset.columns.length > 0
  return (
    <div className="dp-asset" data-open={open}>
      <button className="dp-asset-head" onClick={() => hasColumns && setOpen((o) => !o)}>
        <span>{asset.name}</span>
        <span className="dp-asset-kind">{asset.kind}</span>
        {hasColumns && (
          <svg className="dp-asset-chevron" viewBox="0 0 24 24" width="16" height="16"
               fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </button>
      {open && hasColumns && (
        <div className="dp-cols">
          {asset.columns.map((c) => (
            <div className="dp-col" key={c.name}>
              <span className="dp-col-name">{c.name}</span>
              <span className="dp-col-type">{c.data_type ?? ''}</span>
            </div>
          ))}
        </div>
      )}
      {open && !hasColumns && <div className="dp-col-empty">No column schema available.</div>}
    </div>
  )
}

function RequestForm({ product, onDone }: { product: ProductRecord; onDone: (r: AccessRequest) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [objectId, setObjectId] = useState('')
  const [justification, setJustification] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const r = await requestAccess(product.id, {
        requester_name: name,
        requester_email: email,
        requester_object_id: objectId || undefined,
        justification,
      })
      onDone(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dp-form" style={{ marginTop: '0.75rem' }}>
      {error && <div className="dp-error">{error}</div>}
      <div className="dp-field">
        <label>Your name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" />
      </div>
      <div className="dp-field">
        <label>Your email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@example.com" />
      </div>
      <div className="dp-field">
        <label>Entra object id (optional — required to auto-grant)</label>
        <input value={objectId} onChange={(e) => setObjectId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
      <div className="dp-field">
        <label>Why do you need access?</label>
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)} />
      </div>
      <div className="dp-btn-row">
        <button className="dp-btn primary" disabled={busy || !name || !email} onClick={() => void submit()}>
          {busy ? 'Sending…' : 'Send request to owner'}
        </button>
      </div>
    </div>
  )
}

function ProductDetail() {
  const { productId } = Route.useParams()
  const [product, setProduct] = useState<ProductRecord | null>(null)
  const [domainName, setDomainName] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [submitted, setSubmitted] = useState<AccessRequest | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetchProduct(productId), fetchProductDomains()])
      .then(([p, domains]) => {
        if (!alive) return
        setProduct(p)
        setDomainName(domains.find((d) => d.id === p.domain_id)?.name ?? p.domain_id)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [productId])

  if (error) return <div className="dp-page"><div className="dp-error">{error}</div></div>
  if (!product) return <div className="dp-page"><div className="dp-empty">Loading…</div></div>

  return (
    <div className="dp-page">
      <Link to="/products" className="dp-back">← All data products</Link>
      <div className="dp-page-head">
        <div>
          <h1 className="dp-title">{product.name}</h1>
          <p className="dp-lead">
            <span className="dp-pill" data-status={product.status}>{product.status}</span>
            <span className="dp-crumb"> · {domainName}</span>
          </p>
        </div>
      </div>

      <div className="dp-detail-grid">
        <div>
          <section className="dp-section">
            <h2 className="dp-section-title">Description</h2>
            <p className="dp-prose">{product.description || 'No description yet.'}</p>
          </section>

          {product.use_cases.length > 0 && (
            <section className="dp-section">
              <h2 className="dp-section-title">Use cases</h2>
              <ul className="dp-usecases">
                {product.use_cases.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
            </section>
          )}

          <section className="dp-section">
            <h2 className="dp-section-title">Data assets</h2>
            {product.assets.length === 0 ? (
              <p className="dp-prose">No assets linked yet.</p>
            ) : (
              product.assets.map((a) => <AssetRow key={a.id} asset={a} />)
            )}
          </section>

          {(product.model_id || product.model_name) && (
            <section className="dp-section">
              <h2 className="dp-section-title">Associated model</h2>
              <Link to="/model" className="dp-modellink">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3.5 3.5 8l8.5 4.5L20.5 8z" /><path d="M3.5 12 12 16.5 20.5 12" />
                </svg>
                {product.model_name || 'Open in modelling tab'}
              </Link>
            </section>
          )}
        </div>

        <aside className="dp-aside">
          <div className="dp-aside-label">Owners</div>
          {product.owners.length === 0 ? (
            <div className="dp-owner-email">No owners listed.</div>
          ) : (
            product.owners.map((o) => (
              <div className="dp-owner" key={o.email}>
                <span className="dp-owner-name">{o.name}</span>
                <span className="dp-owner-email">{o.email}</span>
              </div>
            ))
          )}

          {product.workspace_name && (
            <>
              <div className="dp-aside-label">Fabric workspace</div>
              <div className="dp-owner-email">{product.workspace_name}</div>
            </>
          )}

          <div className="dp-aside-label">Access</div>
          {submitted ? (
            <div className="dp-note ok">
              Request sent — <span className="dp-pill" data-status={submitted.status}>{submitted.status}</span>.
              The owner will review it. On approval, reader access to the Fabric workspace is granted automatically.
            </div>
          ) : requesting ? (
            <RequestForm product={product} onDone={setSubmitted} />
          ) : (
            <button className="dp-request-btn" onClick={() => setRequesting(true)}>
              Request access
            </button>
          )}
        </aside>
      </div>
    </div>
  )
}
