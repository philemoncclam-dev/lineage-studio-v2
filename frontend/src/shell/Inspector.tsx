// Non-modal overlay Inspector (D-10/D-11/D-12/D-13) — real implementation
// replacing the 02-04 stub. Renders iff useSelection().sel is set (D-11);
// resolves the selected id against the loaded AppModel (tables, then
// notebooks) and shows the D-12 metadata card: name, kind, workspace/
// lakehouse location (`table.layer`, the same field the retired hand-rolled
// SVG lineage canvas's old `.insp-crumb` already used for this), column list
// for tables, and connected-edge counts derived from `model.context`. A
// missing field omits its row entirely; a table with zero columns omits the
// column section (partial consideration, UI-SPEC). Esc and the close button
// both resolve to the same useSelection().clear() call — this is the single
// shell-level Esc-to-clear listener (Pattern 3); canvas views (LineageDagView/
// GraphView) additionally clear on an empty-canvas click, but do not
// duplicate Esc handling of their own.
import { useEffect } from 'react'
import type { Col, Table } from '../data'
import { useModel, type AppModel, type TableContext } from '../model'
import { useSelection, type UseSelectionResult } from '../selection/useSelection'

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
interface ResolvedColumn {
  kind: 'column'
  name: string
  table: Table
  column: Col
}
type Resolved = ResolvedTable | ResolvedNotebook | ResolvedColumn

function resolveSelected(model: AppModel, sel: string, col?: string): Resolved | null {
  const table = model.tables.find((t) => t.id === sel)
  if (table) {
    if (col) {
      const column = table.columns.find((c) => c.key === col)
      if (column) return { kind: 'column', name: column.name, table, column }
    }
    return { kind: 'table', name: table.name, table, context: model.context[table.id] }
  }
  const notebook = model.notebooks.find((n) => n.id === sel)
  if (notebook) return { kind: 'notebook', name: notebook.name }
  return null
}

export default function Inspector() {
  const { sel, col, select, clear } = useSelection()
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

  const resolved = resolveSelected(model, sel, col)

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
        {resolved?.kind === 'column' && (
          <ColumnCard model={model} table={resolved.table} column={resolved.column} select={select} />
        )}
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

// Inline stroke-based direction arrow reusing the `.flow-item .dir` treatment
// already declared in components.css (stroke: var(--color-text-tertiary)).
function DirArrow({ up }: { up: boolean }) {
  return (
    <svg className="dir" viewBox="0 0 24 24" aria-hidden="true">
      {up ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}
    </svg>
  )
}

// New this plan (DAG-05, TRUST-02): renders when a column is selected. Order
// mirrors 03-UI-SPEC.md's "Inspector Column-Detail Layout" exactly —
// provenance line, Transform (.xform, existing but previously unused),
// Source → Target (.flow/.flow-item, existing but previously unused),
// Evidence (new), Connections (TableCard's .sec/.sec-t pattern, repurposed).
// Every text value below is a JSX text node (React auto-escapes), no
// dangerouslySetInnerHTML anywhere in this file (T-03-07 mitigation).
function ColumnCard({
  model,
  table,
  column,
  select,
}: {
  model: AppModel
  table: Table
  column: Col
  select: UseSelectionResult['select']
}) {
  const xf = model.xform[column.key]
  const evidence = model.evidence[column.key]
  const upstream = model.colEdges.filter(([, t]) => t === column.key)
  const downstreamCount = model.colEdges.filter(([s]) => s === column.key).length
  // adapt.ts's own stable copy distinguishes a computed transform from a
  // pass-through (D-13: synthesis stays frontend-only, never re-derived
  // here) — a pass-through entry's sentence always starts with this prefix.
  const isPassThrough = xf?.[1].startsWith('Passed through')

  return (
    <>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)',
          padding: '0 var(--spacing-4) var(--spacing-3)',
          fontSize: 'var(--text-micro)', color: 'var(--color-text-tertiary)',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0" y1="5" x2="10" y2="5" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeDasharray="5 4" />
        </svg>
        <span>Inferred</span>
      </div>

      {xf && (
        <div className="sec">
          <div className="sec-t">Transform</div>
          <div className="xform">
            {!isPassThrough && <code>{xf[0]}</code>}
            <p>{xf[1]}</p>
          </div>
        </div>
      )}

      <div className="sec">
        <div className="sec-t">Source → Target</div>
        <div className="flow">
          {upstream.map(([srcKey]) => {
            const srcTable = model.tables.find((t) => t.columns.some((c) => c.key === srcKey))
            const srcCol = srcTable?.columns.find((c) => c.key === srcKey)
            return (
              <div
                className="flow-item"
                key={srcKey}
                onClick={() => srcTable && select(srcTable.id, srcKey)}
              >
                <DirArrow up />
                <span className="fcol">{srcCol?.name ?? srcKey}</span>
                <span className="ftbl">{srcTable?.name ?? ''}</span>
              </div>
            )
          })}
          <div className="flow-item" onClick={() => select(table.id, column.key)}>
            <DirArrow up={false} />
            <span className="fcol">{column.name}</span>
            <span className="ftbl">{table.name}</span>
          </div>
        </div>
      </div>

      {evidence && (
        <div className="sec">
          <div className="sec-t">Evidence</div>
          <p style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', margin: '0 0 var(--spacing-2)' }}>
            Matched in {evidence.notebook}, cell {evidence.cell_index}, line {evidence.line}:
          </p>
          <div className="xform">
            <code>{evidence.snippet}</code>
          </div>
          <p style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-tertiary)', margin: 'var(--spacing-2) 0 0' }}>
            Inferred from static pattern-matching — not executed.
          </p>
        </div>
      )}

      <div className="sec">
        <div className="sec-t">Connections</div>
        <div>{`Upstream ${upstream.length} · Downstream ${downstreamCount}`}</div>
      </div>
    </>
  )
}
