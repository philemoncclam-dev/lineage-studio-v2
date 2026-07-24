// Schema import dialog: paste or upload a Table|Column|Ordinal|DataType sheet
// (CSV/TSV), preview the detected tables, assign each to a layer, and scaffold
// Group/Attribute nodes. Parsing/building logic lives in schemaImport.ts
// (ported from lineage-studio); this dialog is a leaner two-step UI.
import { useMemo, useState } from 'react'
import { buildImportNodes, groupByTable, guessColumn, parseSchema } from './schemaImport'
import { useModelStudio } from './store'

export default function ImportSchemaDialog({ onClose }: { onClose: () => void }) {
  const { model, dispatch } = useModelStudio()
  const [text, setText] = useState('')
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [defaultLayer, setDefaultLayer] = useState('')

  const parsed = useMemo(() => parseSchema(text), [text])
  const groups = useMemo(() => {
    if (parsed.rows.length === 0) return []
    const tableIdx = guessColumn(parsed.headers, [/table/i]) >= 0 ? guessColumn(parsed.headers, [/table/i]) : 0
    const columnIdx = guessColumn(parsed.headers, [/column|attribute|field/i]) >= 0 ? guessColumn(parsed.headers, [/column|attribute|field/i]) : 1
    const ordinalIdx = guessColumn(parsed.headers, [/ordinal|position|order/i])
    const typeIdx = guessColumn(parsed.headers, [/type/i])
    return groupByTable(parsed, tableIdx, columnIdx, ordinalIdx, typeIdx)
  }, [parsed])

  const layerNames = model.nodes.filter((n) => n.type === 'Layer').map((n) => n.name)

  const doImport = () => {
    const finalAssignments: Record<string, string> = {}
    for (const g of groups) finalAssignments[g.table] = (assignments[g.table] ?? defaultLayer).trim()
    const result = buildImportNodes(model, groups, finalAssignments)
    if (result.nodes.length > 0) dispatch({ type: 'importNodes', nodes: result.nodes })
    onClose()
  }

  const onFile = (file: File) => {
    void file.text().then(setText)
  }

  const importable = groups.length > 0 && groups.some((g) => (assignments[g.table] ?? defaultLayer).trim())

  return (
    <div className="ms-modal-backdrop" role="dialog" aria-modal="true" aria-label="Import schema">
      <div className="ms-modal">
        <header className="ms-modal-head">
          <h2>Import schema</h2>
          <button className="ms-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <p className="ms-modal-hint">
          Paste (or upload) a <code>Table, Column, Ordinal, DataType</code> sheet — CSV or tab-separated, header
          optional. Each table becomes a card with its columns; re-importing skips what already exists.
        </p>
        <textarea
          className="ms-modal-paste"
          rows={8}
          value={text}
          placeholder={'Table,Column,Ordinal,DataType\nraw_orders,order_id,1,bigint\nraw_orders,order_date,2,date'}
          onChange={(e) => setText(e.target.value)}
        />
        <label className="ms-file">
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
            }}
          />
        </label>

        {groups.length > 0 && (
          <div className="ms-import-preview">
            <label className="ms-field ms-field-inline">
              <span>Default layer</span>
              <input
                list="ms-layer-names"
                value={defaultLayer}
                placeholder={layerNames[0] ?? 'e.g. Bronze'}
                onChange={(e) => setDefaultLayer(e.target.value)}
              />
            </label>
            <datalist id="ms-layer-names">
              {layerNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <ul className="ms-import-tables">
              {groups.map((g) => (
                <li key={g.table}>
                  <span className="ms-import-table-name">{g.table}</span>
                  <span className="ms-count">{g.columns.length} cols</span>
                  <input
                    list="ms-layer-names"
                    value={assignments[g.table] ?? ''}
                    placeholder={defaultLayer || 'layer…'}
                    aria-label={`Layer for ${g.table}`}
                    onChange={(e) => setAssignments((a) => ({ ...a, [g.table]: e.target.value }))}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="ms-modal-foot">
          <button className="tbtn" onClick={onClose}>Cancel</button>
          <button className="tbtn ms-primary" disabled={!importable} onClick={doImport}>
            Import {groups.length > 0 ? `${groups.length} table${groups.length === 1 ? '' : 's'}` : ''}
          </button>
        </footer>
      </div>
    </div>
  )
}
