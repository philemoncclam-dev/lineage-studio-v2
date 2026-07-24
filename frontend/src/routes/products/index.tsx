// /products — the catalogue browse. A domain tree (built from each domain's
// parent_id, so sub-domains nest) on the left; product cards on the right,
// filtered to the selected domain and its descendants.
import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  fetchProductDomains,
  fetchProducts,
  type ProductDomain,
  type ProductRecord,
} from '../../api'
import '../../views/products.css'

export const Route = createFileRoute('/products/')({
  // Deep-linkable domain filter, so the Domains page can jump straight into a
  // pre-scoped catalogue (?domain=<id>).
  validateSearch: (s: Record<string, unknown>): { domain?: string } =>
    typeof s.domain === 'string' ? { domain: s.domain } : {},
  component: ProductsBrowse,
})

/** domain id -> its own id plus every descendant id, so selecting "Sales"
 *  shows products filed under "Sales / Orders" too. */
function descendantsOf(id: string, byParent: Map<string | null, ProductDomain[]>): Set<string> {
  const out = new Set<string>([id])
  const walk = (pid: string) => {
    for (const child of byParent.get(pid) ?? []) {
      out.add(child.id)
      walk(child.id)
    }
  }
  walk(id)
  return out
}

function ProductsBrowse() {
  const { domain } = Route.useSearch()
  const [domains, setDomains] = useState<ProductDomain[]>([])
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [selected, setSelected] = useState<string | null>(domain ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetchProductDomains(), fetchProducts()])
      .then(([d, p]) => { if (alive) { setDomains(d); setProducts(p) } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  const byParent = useMemo(() => {
    const m = new Map<string | null, ProductDomain[]>()
    for (const d of domains) {
      const k = d.parent_id ?? null
      m.set(k, [...(m.get(k) ?? []), d])
    }
    return m
  }, [domains])

  const countFor = (id: string) => {
    const ids = descendantsOf(id, byParent)
    return products.filter((p) => ids.has(p.domain_id)).length
  }

  const visible = useMemo(() => {
    if (!selected) return products
    const ids = descendantsOf(selected, byParent)
    return products.filter((p) => ids.has(p.domain_id))
  }, [selected, products, byParent])

  const domainName = (id: string) => domains.find((d) => d.id === id)?.name ?? id

  const renderTree = (parent: string | null, depth: number): React.ReactNode =>
    (byParent.get(parent) ?? []).map((d) => (
      <div key={d.id}>
        <button
          className={`dp-tree-item${depth > 0 ? ' dp-tree-child' : ''}`}
          data-active={selected === d.id}
          onClick={() => setSelected(selected === d.id ? null : d.id)}
        >
          <span>{d.name}</span>
          <span className="dp-tree-count">{countFor(d.id)}</span>
        </button>
        {renderTree(d.id, depth + 1)}
      </div>
    ))

  return (
    <div className="dp-page">
      <div className="dp-page-head">
        <h1 className="dp-title">Data Products</h1>
        <Link to="/products/new" className="dp-btn primary">New product</Link>
      </div>

      {error && <div className="dp-error">{error}</div>}

      <div className="dp-browse">
        <nav className="dp-tree" aria-label="Domains">
          <div className="dp-tree-title">Domains</div>
          <button
            className="dp-tree-item"
            data-active={selected === null}
            onClick={() => setSelected(null)}
          >
            <span>All domains</span>
            <span className="dp-tree-count">{products.length}</span>
          </button>
          {renderTree(null, 0)}
        </nav>

        <div>
          {visible.length === 0 ? (
            <div className="dp-empty">No data products in this domain yet.</div>
          ) : (
            <div className="dp-grid">
              {visible.map((p) => (
                <Link key={p.id} to="/products/$productId" params={{ productId: p.id }} className="dp-card">
                  <h3 className="dp-card-name">{p.name}</h3>
                  <p className="dp-card-desc">{p.description || 'No description yet.'}</p>
                  <div className="dp-card-foot">
                    <span className="dp-pill" data-status={p.status}>{p.status}</span>
                    <span className="dp-domain">{domainName(p.domain_id)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
