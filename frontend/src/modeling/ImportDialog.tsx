// Import flow: pick an importer, provide content, customise, preview, commit.
//
// The preview step is not decoration. An import can silently restructure a model
// (creating layers that were only implied, matching the wrong same-named
// attribute), so the user sees exact add/update counts and every warning BEFORE
// anything is applied, and can step back at any point.

import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  DEFAULT_IMPORT_OPTIONS,
  parseCsv,
  planImport,
  type ImportOptions,
  type ImportPreview,
} from '../model/importTabular'
import { download, templateRows, toCsv } from '../model/exportTabular'
import type { LineageModel } from '../model/types'

type Step = 'importer' | 'content' | 'customise' | 'preview'
type Source = 'paste' | 'file'

interface Props {
  model: LineageModel
  onImport: (next: LineageModel) => void
  onClose: () => void
}

/** Only Tabular is wired up; the rest are declared so the roadmap is visible. */
const IMPORTERS = [
  { key: 'tabular', label: 'Excel / CSV', ready: true, glyph: <GridGlyph /> },
  { key: 'json', label: 'JSON', ready: false, glyph: <BracesGlyph /> },
  { key: 'xml', label: 'XML', ready: false, glyph: <AngleGlyph /> },
  { key: 'sql', label: 'SQL', ready: false, glyph: <DbGlyph /> },
] as const

export default function ImportDialog({ model, onImport, onClose }: Props) {
  const [step, setStep] = useState<Step>('importer')
  const [source, setSource] = useState<Source>('paste')
  const [pasted, setPasted] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [fileName, setFileName] = useState('')
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS)
  const [error, setError] = useState<string | null>(null)

  const preview: ImportPreview | null = useMemo(
    () => (step === 'preview' && rows.length ? planImport(model, rows, options) : null),
    [step, rows, model, options],
  )

  const readFile = async (file: File) => {
    setError(null)
    setFileName(file.name)
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
        // Every sheet, in order — the documented way to stage a large import is
        // one sheet per entity kind (layers, then objects, then transitions).
        const all: string[][] = []
        for (const sheetName of book.SheetNames) {
          const sheet = book.Sheets[sheetName]
          const asRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false })
          for (const row of asRows) all.push((row ?? []).map((c) => String(c ?? '')))
        }
        setRows(all)
      } else {
        setRows(parseCsv(await file.text()))
      }
      setStep('customise')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const commit = () => {
    if (!preview) return
    onImport(preview.model)
    onClose()
  }

  return (
    <div className="ms-backdrop" onMouseDown={onClose}>
      <div
        className="imp-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Import into the model"
      >
        <header className="imp-head">
          <h2 className="imp-title">Import</h2>
          <ol className="imp-steps">
            {(['importer', 'content', 'customise', 'preview'] as Step[]).map((s, i) => (
              <li key={s} data-current={s === step || undefined}>
                {i + 1}
              </li>
            ))}
          </ol>
          <button className="imp-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="imp-body">
          {error && <div className="imp-error">{error}</div>}

          {step === 'importer' && (
            <>
              <p className="imp-lede">Choose a format to import from.</p>
              <div className="imp-tiles">
                {IMPORTERS.map((imp) => (
                  <button
                    key={imp.key}
                    className="imp-tile"
                    disabled={!imp.ready}
                    title={imp.ready ? imp.label : `${imp.label} — not available yet`}
                    onClick={() => setStep('content')}
                  >
                    {imp.glyph}
                    <span>{imp.label}</span>
                    {!imp.ready && <span className="imp-soon">soon</span>}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'content' && (
            <>
              <p className="imp-lede">How would you like to provide the data?</p>
              <div className="imp-choice">
                <button
                  className="imp-card"
                  data-selected={source === 'paste' || undefined}
                  onClick={() => setSource('paste')}
                >
                  <strong>Copy and paste</strong>
                  <span>Paste rows straight from a spreadsheet.</span>
                </button>
                <button
                  className="imp-card"
                  data-selected={source === 'file' || undefined}
                  onClick={() => setSource('file')}
                >
                  <strong>Template file</strong>
                  <span>Upload a .csv or .xlsx, or start from our template.</span>
                </button>
              </div>

              {source === 'paste' ? (
                <>
                  <textarea
                    className="imp-paste"
                    value={pasted}
                    placeholder={'Layer,Object,Attribute\nSource System,customers,customer_id'}
                    onChange={(e) => setPasted(e.target.value)}
                  />
                  <p className="imp-hint">
                    Select the whole sheet before copying. Empty leading rows or columns
                    will produce parse errors — prefer a file if in doubt.
                  </p>
                </>
              ) : (
                <div className="imp-file">
                  <input
                    type="file"
                    accept=".csv,.txt,.xlsx,.xls"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void readFile(file)
                    }}
                  />
                  {fileName && <span className="imp-hint">Loaded {fileName}</span>}
                  <button
                    className="imp-link"
                    onClick={() =>
                      download(
                        'lineage-studio-import-template.csv',
                        toCsv(templateRows()),
                        'text/csv;charset=utf-8',
                      )
                    }
                  >
                    Download the template
                  </button>
                </div>
              )}
            </>
          )}

          {step === 'customise' && (
            <>
              <p className="imp-lede">
                {rows.length} row(s) read. Fine-tune how they are applied.
              </p>
              <label className="imp-opt">
                <input
                  type="checkbox"
                  checked={options.generateImplicitTransitions}
                  onChange={(e) =>
                    setOptions({ ...options, generateImplicitTransitions: e.target.checked })
                  }
                />
                <span>
                  <strong>Generate implicit transitions</strong>
                  <em>
                    Create transitions from SOURCE/TARGET cells on entity rows, not just on
                    dedicated transition rows.
                  </em>
                </span>
              </label>
              <label className="imp-opt">
                <span className="imp-opt-label">Path delimiter</span>
                <input
                  className="imp-text"
                  value={options.pathDelimiter}
                  maxLength={3}
                  onChange={(e) => setOptions({ ...options, pathDelimiter: e.target.value })}
                />
              </label>
            </>
          )}

          {step === 'preview' && preview && (
            <>
              <p className="imp-lede">
                Detected a <strong>{preview.format}</strong> layout. Nothing has been changed
                yet.
              </p>
              <div className="imp-counts">
                <Count label="Layers" value={preview.added.layers} />
                <Count label="Objects" value={preview.added.objects} />
                <Count label="Attributes" value={preview.added.attributes} />
                <Count label="Transitions" value={preview.added.transitions} />
                <Count label="Properties set" value={preview.updated.properties} />
              </div>
              {preview.warnings.length > 0 && (
                <div className="imp-warnings">
                  <strong>{preview.warnings.length} warning(s)</strong>
                  <ul>
                    {preview.warnings.slice(0, 12).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  {preview.warnings.length > 12 && <em>…and {preview.warnings.length - 12} more</em>}
                </div>
              )}
              <p className="imp-hint">
                Review the result after importing — Ctrl+Z undoes the whole import in one step.
              </p>
            </>
          )}
        </div>

        <footer className="imp-foot">
          <button
            className="imp-btn"
            disabled={step === 'importer'}
            onClick={() =>
              setStep(
                step === 'preview'
                  ? 'customise'
                  : step === 'customise'
                    ? 'content'
                    : 'importer',
              )
            }
          >
            Back
          </button>
          <div className="imp-spacer" />
          {step === 'content' && (
            <button
              className="imp-btn imp-btn--primary"
              disabled={source === 'paste' ? !pasted.trim() : rows.length === 0}
              onClick={() => {
                if (source === 'paste') setRows(parseCsv(pasted))
                setStep('customise')
              }}
            >
              Next
            </button>
          )}
          {step === 'customise' && (
            <button className="imp-btn imp-btn--primary" onClick={() => setStep('preview')}>
              Preview
            </button>
          )}
          {step === 'preview' && (
            <button
              className="imp-btn imp-btn--primary"
              disabled={!preview}
              onClick={commit}
            >
              Import
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="imp-count" data-zero={value === 0 || undefined}>
      <span className="imp-count-value">+{value}</span>
      <span className="imp-count-label">{label}</span>
    </div>
  )
}

function GridGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9 9.5V19.5M14.5 9.5V19.5" />
    </svg>
  )
}
function BracesGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 4c-2 0-2 3-2 4s0 4-2 4c2 0 2 3 2 4s0 4 2 4M15 4c2 0 2 3 2 4s0 4 2 4c-2 0-2 3-2 4s0 4-2 4" />
    </svg>
  )
}
function AngleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
    </svg>
  )
}
function DbGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </svg>
  )
}
