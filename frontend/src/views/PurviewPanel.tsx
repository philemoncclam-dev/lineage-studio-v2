// The two Purview write paths that are not table-scoped: pushing derived
// lineage back into the catalog, and cataloguing assets into a data product.
// (Column definitions live in DefinitionsImport, on the table detail panel.)
//
// Both follow the same shape as the definitions import — preview first, then
// confirm — because the backend's WriteSession builds an identical payload
// either way, so the preview is the real operation with the send withheld.

import { useEffect, useState } from 'react'
import {
  catalogDataProduct,
  fetchDataProducts,
  fetchDomains,
  pushLineage,
  type DataProduct,
  type GovernanceDomain,
  type LineagePushResult,
  type WriteResult,
} from '../api'
import { useModel } from '../model'
import './purview.css'

type Tab = 'lineage' | 'catalog'

interface Props {
  writeEnabled: boolean
  onClose: () => void
}

/** A table's id is its Purview GUID in the live model; sample ids are names. */
const isGuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id)

function Ops({ result }: { result: WriteResult }) {
  return (
    <div className="pv-ops">
      {result.operations.map((op, i) => (
        <div className="pv-op" key={`${op.path}-${i}`}>
          <span className="pv-verb">{op.verb}</span>
          <span className="pv-desc">{op.describes || op.path}</span>
        </div>
      ))}
      {result.operations.length === 0 && (
        <div className="pv-empty">Nothing to write — the catalog is already up to date.</div>
      )}
      {result.errors.map((e) => <div className="di-error" key={e}>{e}</div>)}
    </div>
  )
}

function LineageTab({ writeEnabled }: { writeEnabled: boolean }) {
  const [preview, setPreview] = useState<LineagePushResult | null>(null)
  const [done, setDone] = useState<LineagePushResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (apply: boolean) => {
    setBusy(true); setError(null)
    try {
      const r = await pushLineage(apply)
      if (apply) setDone(r); else setPreview(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const shown = done ?? preview

  return (
    <div className="pv-body">
      <p className="pv-lead">
        Reads each notebook's source from Fabric, derives its table reads and writes,
        and records them on the notebook's Purview entity.
      </p>
      {error && <div className="di-error">{error}</div>}

      {shown && (
        <>
          <div className="pv-note">
            Source read from {shown.notebooks_read.length} notebook
            {shown.notebooks_read.length === 1 ? '' : 's'}: {shown.notebooks_read.join(', ') || '—'}
          </div>
          <Ops result={shown} />
        </>
      )}

      <div className="pv-foot">
        {done ? (
          <span className="pv-ok">
            {done.dry_run
              ? 'Previewed only — writes are disabled.'
              : `Wrote ${done.operations.length - done.errors.length} of ${done.operations.length}.`}
          </span>
        ) : (
          <>
            <button className="openbtn ghost" disabled={busy} onClick={() => void run(false)}>
              {busy ? 'Working…' : preview ? 'Refresh preview' : 'Preview'}
            </button>
            {preview && preview.operations.length > 0 && (
              <button
                className="openbtn"
                disabled={busy || !writeEnabled}
                title={writeEnabled ? undefined : 'PURVIEW_ALLOW_WRITE is not set'}
                onClick={() => void run(true)}
              >
                Push to Purview →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CatalogTab({ writeEnabled }: { writeEnabled: boolean }) {
  const model = useModel()
  const [domains, setDomains] = useState<GovernanceDomain[]>([])
  const [products, setProducts] = useState<DataProduct[]>([])
  const [domainId, setDomainId] = useState('')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [result, setResult] = useState<WriteResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only catalog-backed tables can be catalogued: a parsed-but-unscanned table
  // has no GUID to reference, so it is left out rather than offered and failing.
  const candidates = model.tables.filter((t) => isGuid(t.id))

  useEffect(() => {
    let alive = true
    Promise.all([fetchDomains(), fetchDataProducts()])
      .then(([d, p]) => {
        if (!alive) return
        setDomains(d)
        setProducts(p)
        if (d.length === 1) setDomainId(d[0].id)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  const chosen = candidates.filter((t) => picked[t.id])

  const submit = async (apply: boolean) => {
    setBusy(true); setError(null)
    try {
      setResult(
        await catalogDataProduct({
          name,
          domain_id: domainId,
          asset_guids: chosen.map((t) => t.id),
          apply,
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pv-body">
      <p className="pv-lead">
        Group catalog assets into a data product so they can be discovered as one thing.
      </p>
      {error && <div className="di-error">{error}</div>}

      <div className="pv-field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer analytics" />
      </div>
      <div className="pv-field">
        <label>Domain</label>
        <select value={domainId} onChange={(e) => setDomainId(e.target.value)}>
          <option value="">Select a governance domain…</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div className="pv-assets">
        {candidates.length === 0 && (
          <div className="pv-empty">
            No catalog-backed tables in the current graph — load the graph from Purview first.
          </div>
        )}
        {candidates.map((t) => (
          <label className="pv-asset" key={t.id}>
            <input
              type="checkbox"
              checked={!!picked[t.id]}
              onChange={(e) => setPicked((s) => ({ ...s, [t.id]: e.target.checked }))}
            />
            <span className="pv-aname">{t.name}</span>
            <span className="pv-alayer">{t.layer}</span>
          </label>
        ))}
      </div>

      {result && <Ops result={result} />}
      {products.length > 0 && (
        <div className="pv-note">
          Existing: {products.map((p) => p.name).join(', ')}
        </div>
      )}

      <div className="pv-foot">
        <span className="di-count">{chosen.length} asset{chosen.length === 1 ? '' : 's'} selected</span>
        <button
          className="openbtn ghost"
          disabled={busy || !name || !domainId}
          onClick={() => void submit(false)}
        >
          Preview
        </button>
        <button
          className="openbtn"
          disabled={busy || !name || !domainId || !writeEnabled}
          title={writeEnabled ? undefined : 'PURVIEW_ALLOW_WRITE is not set'}
          onClick={() => void submit(true)}
        >
          Create →
        </button>
      </div>
    </div>
  )
}

export default function PurviewPanel({ writeEnabled, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('lineage')

  return (
    <div className="di-overlay" onClick={onClose}>
      <div className="di-panel pv-panel" onClick={(e) => e.stopPropagation()}>
        <div className="di-head">
          <div>
            <div className="di-title">Purview</div>
            <div className="di-sub">{writeEnabled ? 'writes enabled' : 'read-only'}</div>
          </div>
          <button className="di-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="pv-tabs">
          <button className={tab === 'lineage' ? 'on' : ''} onClick={() => setTab('lineage')}>
            Push lineage
          </button>
          <button className={tab === 'catalog' ? 'on' : ''} onClick={() => setTab('catalog')}>
            Data product
          </button>
        </div>

        {tab === 'lineage' ? <LineageTab writeEnabled={writeEnabled} /> : <CatalogTab writeEnabled={writeEnabled} />}
      </div>
    </div>
  )
}
