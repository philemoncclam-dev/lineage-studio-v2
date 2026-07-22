// Non-modal overlay Inspector (D-10/D-11/D-12/D-13) — real implementation
// replacing the 02-04 stub. Renders iff useSelection().sel is set (D-11);
// resolves the selected id against the loaded AppModel (tables, then
// notebooks) and shows the D-12 metadata card: name, kind, workspace/
// lakehouse location (`table.layer`, the same field LineageView's old
// `.insp-crumb` already used for this), column list for tables, and
// connected-edge counts derived from `model.context`. A missing field
// omits its row entirely; a table with zero columns omits the column
// section (partial consideration, UI-SPEC). Esc and the close button both
// resolve to the same useSelection().clear() call — this is the single
// shell-level Esc-to-clear listener (Pattern 3); canvas views (LineageView/
// GraphView) additionally clear on an empty-canvas click, but do not
// duplicate Esc handling of their own.
import { useEffect } from 'react'
import type { Table } from '../data'
import { useModel, type AppModel, type TableContext } from '../model'
import { useSelection } from '../selection/useSelection'

interface ResolvedTable {
  kind: 'table'
  name: string
  table: Table
  context?: TableContext
}
interface ResolvedNotebook {
  kind: 'notebook'
  name: string
}
type Resolved = ResolvedTable | ResolvedNotebook

function resolveSelected(model: AppModel, sel: string): Resolved | null {
  const table = model.tables.find((t) => t.id === sel)
  if (table) return { kind: 'table', name: table.name, table, context: model.context[table.id] }
  const notebook = model.notebooks.find((n) => n.id === sel)
  if (notebook) return { kind: 'notebook', name: notebook.name }
  return null
}

export default function Inspector() {
  const { sel, col, clear } = useSelection()
  const model = useModel()

  // Single shell-level Esc-to-clear listener (D-11) — only attached while
  // the inspector is actually visible, and only ever lives here, so no
  // per-canvas Esc handler needs to duplicate this behavior.
  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, clear])

  if (!sel) return null

  const resolved = resolveSelected(model, sel)

  return (
    <aside className="inspector-overlay" role="complementary" aria-label="Selection details">
      <div className="inspector-head">
        <div className="inspector-head-text">
          <div className="inspector-kind">{resolved?.kind ?? 'unknown'}</div>
          <h2 className="inspector-title">{resolved?.name ?? sel}</h2>
        </div>
        <button type="button" className="inspector-close" onClick={clear} aria-label="Close inspector">
          ×
        </button>
      </div>
      <div className="inspector-body">
        {resolved?.kind === 'table' && <TableCard table={resolved.table} context={resolved.context} selectedCol={col} />}
      </div>
    </aside>
  )
}

function TableCard({ table, context, selectedCol }: { table: Table; context?: TableContext; selectedCol?: string }) {
  return (
    <>
      {table.layer && (
        <div className="sec">
          <div className="sec-t">Location</div>
          <div className="inspector-location">{table.layer}</div>
        </div>
      )}
      {table.columns.length > 0 && (
        <div className="sec">
          <div className="sec-t">
            Columns <span className="n">{table.columns.length}</span>
          </div>
          <div className="inspector-cols">
            {table.columns.map((c) => (
              <div className={`col${c.key === selectedCol ? ' sel' : ''}`} key={c.key}>
                <span className="name">{c.name}</span>
                {c.pk && <span className="pk">PK</span>}
                <span className="type">{c.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {context && (
        <div className="sec">
          <div className="sec-t">
            Connections ({context.up.length} in / {context.down.length} out)
          </div>
        </div>
      )}
    </>
  )
}
