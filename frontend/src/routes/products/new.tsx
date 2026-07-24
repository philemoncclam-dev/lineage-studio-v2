// /products/new — author a new data product: name, domain (incl. sub-domains),
// description, use cases, an owner, and the Fabric workspace an approved request
// grants access to. Assets/model can be attached from the detail page later.
import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  createProduct,
  fetchProductDomains,
  type ProductDomain,
} from '../../api'
import '../../views/products.css'

export const Route = createFileRoute('/products/new')({
  component: NewProduct,
})

/** Flatten the domain tree into indented options so a sub-domain reads as
 *  "Sales / Orders" in the picker. */
function domainOptions(domains: ProductDomain[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, ProductDomain[]>()
  for (const d of domains) {
    const k = d.parent_id ?? null
    byParent.set(k, [...(byParent.get(k) ?? []), d])
  }
  const out: { id: string; label: string }[] = []
  const walk = (parent: string | null, prefix: string) => {
    for (const d of byParent.get(parent) ?? []) {
      out.push({ id: d.id, label: prefix + d.name })
      walk(d.id, prefix + d.name + ' / ')
    }
  }
  walk(null, '')
  return out
}

function NewProduct() {
  const navigate = useNavigate()
  const [domains, setDomains] = useState<ProductDomain[]>([])
  const [name, setName] = useState('')
  const [domainId, setDomainId] = useState('')
  const [description, setDescription] = useState('')
  const [useCases, setUseCases] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchProductDomains()
      .then((d) => { if (alive) setDomains(d) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  const options = useMemo(() => domainOptions(domains), [domains])

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const product = await createProduct({
        name,
        domain_id: domainId,
        description,
        use_cases: useCases.split('\n').map((s) => s.trim()).filter(Boolean),
        owners: ownerEmail ? [{ name: ownerName || ownerEmail, email: ownerEmail }] : [],
        workspace_id: workspaceId || undefined,
        workspace_name: workspaceName || undefined,
      })
      void navigate({ to: '/products/$productId', params: { productId: product.id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="dp-page">
      <h1 className="dp-title">New data product</h1>

      <div className="dp-form" style={{ marginTop: '1.25rem' }}>
        {error && <div className="dp-error">{error}</div>}
        <div className="dp-field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer Analytics" />
        </div>
        <div className="dp-field">
          <label>Domain</label>
          <select value={domainId} onChange={(e) => setDomainId(e.target.value)}>
            <option value="">Select a domain…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div className="dp-field">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="dp-field">
          <label>Use cases (one per line)</label>
          <textarea value={useCases} onChange={(e) => setUseCases(e.target.value)} placeholder={'Power the revenue dashboard\nFeed the churn model'} />
        </div>
        <div className="dp-field">
          <label>Owner name</label>
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Ava Chen" />
        </div>
        <div className="dp-field">
          <label>Owner email</label>
          <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="ava@example.com" />
        </div>
        <div className="dp-field">
          <label>Fabric workspace name</label>
          <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="SalesLakehouse-P-S" />
        </div>
        <div className="dp-field">
          <label>Fabric workspace id (granted on approval)</label>
          <input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        <div className="dp-btn-row">
          <button className="dp-btn primary" disabled={busy || !name || !domainId} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create data product'}
          </button>
        </div>
      </div>
    </div>
  )
}
