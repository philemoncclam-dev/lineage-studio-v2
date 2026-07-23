// TableNode — xyflow custom node porting the .ls-node/.head/.cols/.col card
// language from the retired frontend/src/views/LineageView.tsx (table block,
// lines 123-147) onto xyflow's Handle-based positioning contract (DAG-01,
// DAG-02). Per-row <Handle> pairs replace the old SVG view's manual
// getBoundingClientRect() measurement — edges anchor to the exact row.
//
// Per D-03, the header no longer toggles per-card expand state (that's now a
// single global toolbar toggle owned by 03-07/LineageDagView) — clicking the
// header only calls useSelection().select() to open the table in the
// Inspector, matching the same selection write path column rows use.

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { useSelection } from '../../selection/useSelection'
import { colSourceHandle, colTargetHandle, NODE_SOURCE_HANDLE, NODE_TARGET_HANDLE, type TableNodeData } from './types'

// Mirrors --dag-node-header-height / --dag-node-row-height (lineage-dag.css)
// and useDagreLayout.ts's own HEADER_HEIGHT/ROW_HEIGHT constants — these are
// the literal geometry inputs 03-UI-SPEC.md's "Column-row edge anchoring"
// section locks (40px header, 28px row), duplicated here because neither
// value is exported from useDagreLayout.ts (03-05 is out of scope to change
// that file's exports).
const HEADER_HEIGHT = 40
const ROW_HEIGHT = 28

// `& Record<string, unknown>` works around a TS generic-constraint quirk:
// plain `interface`-declared data shapes (types.ts's TableNodeData) aren't
// structurally assignable to xyflow's `Node<NodeData extends
// Record<string, unknown>>` constraint without an explicit index-signature
// intersection, even though every field is otherwise fully typed. Does not
// change runtime shape or the data.* field types used below.
export default function TableNode({ data }: NodeProps<Node<TableNodeData & Record<string, unknown>, 'tableNode'>>) {
  const { select } = useSelection()

  const headerLabel = `${data.name}, ${data.layer} table, ${data.columns.length} columns`

  return (
    <div className="ls-node">
      <div
        className="head"
        role="button"
        tabIndex={-1}
        data-lineage-focus={data.id}
        data-node={data.id}
        aria-label={headerLabel}
        onClick={(e) => {
          e.stopPropagation()
          select(data.id)
        }}
      >
        <span className={`tick ${data.colorKey}`} />
        <div>
          <div className="title">{data.name}</div>
          <div className="sub">{data.layer}</div>
        </div>
      </div>

      {data.mode === 'column' && (
        <div className="cols">
          {data.columns.map((c, i) => {
            const top = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2
            const rowLabel = `${c.name}, ${c.type}${c.pk ? ', primary key' : ''}, ${data.name}`
            return (
              <div
                className="col"
                key={c.key}
                role="button"
                tabIndex={-1}
                data-lineage-focus={c.key}
                data-col={c.key}
                aria-label={rowLabel}
                onClick={(e) => {
                  e.stopPropagation()
                  select(data.id, c.key)
                }}
              >
                <Handle
                  type="target"
                  id={colTargetHandle(c.key)}
                  position={Position.Left}
                  style={{ top }}
                />
                <span className="name">{c.name}</span>
                {c.pk && <span className="pk">PK</span>}
                <span className="type">{c.type}</span>
                <Handle
                  type="source"
                  id={colSourceHandle(c.key)}
                  position={Position.Right}
                  style={{ top }}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Always-present fallback pair (both modes) — object-level reads/
          writes edges always anchor here; it is also the only pair that
          exists in Table mode, since column rows aren't rendered then. */}
      <Handle
        type="target"
        id={NODE_TARGET_HANDLE}
        position={Position.Left}
        style={{ top: HEADER_HEIGHT / 2 }}
      />
      <Handle
        type="source"
        id={NODE_SOURCE_HANDLE}
        position={Position.Right}
        style={{ top: HEADER_HEIGHT / 2 }}
      />
    </div>
  )
}
