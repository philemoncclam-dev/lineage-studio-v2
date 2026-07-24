// /products/domains — domain-first entry. Domains come straight from live
// Purview governance domains (the parent field gives the nesting); each card
// shows its sub-domains and how many products live in it, and opens the
// catalogue scoped to that domain.
import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  fetchProductDomains,
  fetchProducts,
  type ProductDomain,
  type ProductRecord,
} from '../../api'
import '../../views/products.css'

export const Route = createFileRoute('/products/domains')({
  component: DomainsPage,
})

function descendants(id: string, byParent: Map<string | null, ProductDomain[]>): Set<string> {
  const out = new Set<string>([id])
  const walk = (pid: string) => {
    for (const c of byParent.get(pid) ?? []) { out.add(c.id); walk(c.id) }
  }
  walk(id)
  return out
}

function DomainsPage() {
  const navigate = useNavigate()
  const [domains, setDomains] = useState<ProductDomain[]>([])
  const [products, setProducts] = useState<ProductRecord[]>([])
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

  const countIn = (id: string) => {
    const ids = descendants(id, byParent)
    return products.filter((p) => ids.has(p.domain_id)).length
  }

  const open = (id: string) => navigate({ to: '/products', search: { domain: id } })
  const roots = byParent.get(null) ?? []

  return (
    <div className="dp-page">
      <div className="dp-page-head">
        <h1 className="dp-title">Domains</h1>
        <Link to="/products" className="dp-btn">All products</Link>
      </div>

      {error && <div className="dp-error">{error}</div>}

      {roots.length === 0 ? (
        <div className="dp-empty">No domains found.</div>
      ) : (
        <div className="dp-grid">
          {roots.map((d) => {
            const subs = byParent.get(d.id) ?? []
            return (
              <button key={d.id} className="dp-card dp-domain-card" onClick={() => open(d.id)}>
                <div className="dp-card-name">{d.name}</div>
                {d.description && <p className="dp-card-desc">{d.description}</p>}
                {subs.length > 0 && (
                  <div className="dp-subs">
                    {subs.map((s) => (
                      <span
                        key={s.id}
                        className="dp-sub-chip"
                        onClick={(e) => { e.stopPropagation(); open(s.id) }}
                      >
                        {s.name} · {countIn(s.id)}
                      </span>
                    ))}
                  </div>
                )}
                <div className="dp-card-foot">
                  <span className="dp-domain">{countIn(d.id)} product{countIn(d.id) === 1 ? '' : 's'}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
