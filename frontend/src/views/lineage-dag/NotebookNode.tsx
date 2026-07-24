// NotebookNode — xyflow custom node porting the header-only .ls-node card
// from the retired hand-rolled SVG lineage view (notebook block, lines
// 114-121). Never expandable — notebooks have no column rows, so only the
// always-present __node__* fallback handle pair is rendered (03-UI-SPEC.md
// "Column-row edge anchoring" — "Object-level edges ... always use the
// __node__* fallback pair on both ends — notebooks never have column rows
// to anchor to").

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { useSelection } from '../../selection/useSelection'
import { NODE_SOURCE_HANDLE, NODE_TARGET_HANDLE, type NotebookNodeData } from './types'

// Mirrors --dag-node-header-height (lineage-dag.css) — every notebook node
// is header-only, uniform 40px height (03-UI-SPEC.md Node geometry table).
const HEADER_HEIGHT = 40

// See TableNode.tsx for why `& Record<string, unknown>` is needed here (TS
// generic-constraint quirk with interface-declared data shapes).
export default function NotebookNode({ data }: NodeProps<Node<NotebookNodeData & Record<string, unknown>, 'notebookNode'>>) {
  const { select } = useSelection()

  return (
    <div className={`ls-node${data.dim ? ' dim' : ''}`}>
      <div
        className="head"
        role="button"
        tabIndex={-1}
        data-lineage-focus={data.id}
        data-node={data.id}
        aria-label={`${data.name}, notebook`}
        onClick={(e) => {
          e.stopPropagation()
          select(data.id)
        }}
      >
        <span className="tick notebook" />
        <div>
          <div className="title">{data.name}</div>
          <div className="sub">notebook · PySpark</div>
        </div>
      </div>

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
