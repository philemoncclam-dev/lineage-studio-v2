// Import column definitions from a spreadsheet onto a table's Purview columns.
// Three steps in one overlay: pick a file, review the fuzzy matches, confirm.
// The review step is the point of the feature — the backend never writes what
// the user has not ticked, and uncertain matches arrive unticked.

import { useState } from 'react'
import {
  applyDefinitions,
  matchDefinitions,
  type DefinitionMatch,
  type DefinitionProposal,
  type WriteResult,
} from '../api'
import './definitions.css'

interface Props {
  tableGuid: string
  tableName: string
  onClose: () => void
}

const STATUS_LABEL: Record<DefinitionProposal['status'], string> = {
  exact: 'exact',
  fuzzy: 'fuzzy',
  ambiguous: 'ambiguous',
  unmatched: 'no match',
}

export default function DefinitionsImport({ tableGuid, tableName, onClose }: Props) {
  const [match, setMatch] = useState<DefinitionMatch | null>(null)
  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WriteResult | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const m = await matchDefinitions(tableGuid, file)
      setMatch(m)
      // Seed from the backend's own confidence, then let the user adjust.
      setPicked(Object.fromEntries(m.proposals.map((p, i) => [i, p.selected])))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const accepted = (match?.proposals ?? []).filter((p, i) => picked[i] && p.column_guid)

  const confirm = async () => {
    setBusy(true); setError(null)
    try {
      setResult(
        await applyDefinitions(
          accepted.map((p) => ({
            column_guid: p.column_guid as string,
            column_name: p.column_name,
            description: p.description,
          })),
          true,
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="di-overlay" onClick={onClose}>
      <div className="di-panel" onClick={(e) => e.stopPropagation()}>
        <div className="di-head">
          <div>
            <div className="di-title">Import definitions</div>
            <div className="di-sub">{tableName}</div>
          </div>
          <button className="di-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {error && <div className="di-error">{error}</div>}

        {!match && !result && (
          <div className="di-drop">
            <p>Column A holds the column name, column B its description.</p>
            <label className="di-pick">
              {busy ? 'Matching…' : 'Choose .xlsx or .csv'}
              <input
                type="file"
                accept=".xlsx,.xlsm,.csv"
                disabled={busy}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
          </div>
        )}

        {match && !result && (
          <>
            <div className="di-rows">
              {match.proposals.map((p, i) => (
                <label
                  key={`${p.source_name}-${i}`}
                  className={`di-row ${p.status}${p.column_guid ? '' : ' off'}`}
                >
                  <input
                    type="checkbox"
                    checked={!!picked[i]}
                    disabled={!p.column_guid}
                    onChange={(e) => setPicked((s) => ({ ...s, [i]: e.target.checked }))}
                  />
                  <span className="di-src">{p.source_name}</span>
                  <span className="di-arrow">→</span>
                  <span className="di-tgt">{p.column_name ?? '—'}</span>
                  <span className="di-conf">
                    {STATUS_LABEL[p.status]}
                    {p.column_guid ? ` ${Math.round(p.confidence * 100)}%` : ''}
                  </span>
                  <span className="di-desc" title={p.description}>{p.description}</span>
                  {p.alternatives.length > 0 && (
                    <span className="di-alt">or {p.alternatives.join(', ')}</span>
                  )}
                </label>
              ))}
            </div>
            <div className="di-foot">
              <span className="di-count">
                {accepted.length} of {match.proposals.length} rows will be written
              </span>
              <button className="openbtn" disabled={busy || !accepted.length} onClick={() => void confirm()}>
                {busy ? 'Writing…' : 'Push to Purview →'}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="di-done">
            <p>
              {result.dry_run
                ? `Previewed ${result.operations.length} updates — writes are disabled (PURVIEW_ALLOW_WRITE).`
                : `Wrote ${result.operations.length - result.errors.length} of ${result.operations.length} descriptions.`}
            </p>
            {result.errors.map((e) => <div className="di-error" key={e}>{e}</div>)}
            <div className="di-foot">
              <button className="openbtn" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
