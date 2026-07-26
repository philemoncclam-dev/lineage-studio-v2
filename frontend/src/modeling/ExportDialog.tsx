// Export flow: pick a format, choose what to include, download.
//
// The CSV column set matches what the Full importer accepts, so export → edit in
// a spreadsheet → reimport is a supported round trip rather than a coincidence.

import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  DEFAULT_EXPORT_OPTIONS,
  download,
  slugify,
  toCsv,
  toRows,
  type ExportOptions,
} from '../model/exportTabular'
import type { LineageModel } from '../model/types'

type Format = 'csv' | 'xlsx' | 'json'

interface Props {
  model: LineageModel
  onClose: () => void
}

export default function ExportDialog({ model, onClose }: Props) {
  const [format, setFormat] = useState<Format>('csv')
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS)

  const rows = useMemo(() => toRows(model, options), [model, options])
  // Minus the header row.
  const dataRows = Math.max(0, rows.length - 1)

  const run = () => {
    const base = slugify(model.name)
    if (format === 'json') {
      download(`${base}.json`, JSON.stringify(model, null, 2), 'application/json')
    } else if (format === 'csv') {
      download(`${base}.csv`, toCsv(rows), 'text/csv;charset=utf-8')
    } else {
      const sheet = XLSX.utils.aoa_to_sheet(rows)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Model')
      const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
      download(
        `${base}.xlsx`,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
    }
    onClose()
  }

  const toggle = (key: keyof ExportOptions) => () =>
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="ms-backdrop" onMouseDown={onClose}>
      <div
        className="imp-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Export the model"
      >
        <header className="imp-head">
          <h2 className="imp-title">Export</h2>
          <button className="imp-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="imp-body">
          <p className="imp-lede">Format</p>
          <div className="imp-choice">
            {(
              [
                ['csv', 'CSV', 'Round-trips back through the importer.'],
                ['xlsx', 'Excel', 'One sheet, same columns as CSV.'],
                ['json', 'JSON', 'The complete model, exactly as stored.'],
              ] as const
            ).map(([key, label, hint]) => (
              <button
                key={key}
                className="imp-card"
                data-selected={format === key || undefined}
                onClick={() => setFormat(key)}
              >
                <strong>{label}</strong>
                <span>{hint}</span>
              </button>
            ))}
          </div>

          {format === 'json' ? (
            <p className="imp-hint">
              JSON always contains the whole model, so the include options below don’t apply.
            </p>
          ) : (
            <>
              <p className="imp-lede">Include</p>
              {(
                [
                  ['includeLayers', 'Layers'],
                  ['includeObjects', 'Objects'],
                  ['includeAttributes', 'Attributes'],
                  ['includeTransitions', 'Transitions'],
                  ['includeProperties', 'Properties'],
                ] as const
              ).map(([key, label]) => (
                <label className="imp-opt" key={key}>
                  <input type="checkbox" checked={options[key]} onChange={toggle(key)} />
                  <span>
                    <strong>{label}</strong>
                  </span>
                </label>
              ))}
              <p className="imp-hint">
                {dataRows} row(s) will be written. Transitions whose endpoints are excluded are
                dropped, since they could not be resolved on reimport.
              </p>
            </>
          )}
        </div>

        <footer className="imp-foot">
          <button className="imp-btn" onClick={onClose}>
            Cancel
          </button>
          <div className="imp-spacer" />
          <button className="imp-btn imp-btn--primary" onClick={run}>
            Export
          </button>
        </footer>
      </div>
    </div>
  )
}
