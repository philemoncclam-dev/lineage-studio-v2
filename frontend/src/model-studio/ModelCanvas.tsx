// Swimlane authoring canvas. Layers render as fixed background columns;
// Object/Group cards stack inside them; every Attribute row carries an
// in-handle (left) and out-handle (right) so lineage is drawn by dragging
// between columns — the interaction idiom ported from lineage-studio.
// Structure editing stays inline (rename inputs, +/× buttons), keeping the
// keyboard-operable affordances of the previous board.
import { useCallback, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Edge as RFEdge,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useModelStudio } from './store'
import { modelToFlow, type AttrData, type ContainerData, type LayerData } from './layout'

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" className="ms-icon"><path d="M12 5v14M5 12h14" /></svg>
)
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" className="ms-icon"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" /></svg>
)

function AttrRow({ attr, selected, onSelect }: { attr: AttrData; selected: boolean; onSelect: (id: string) => void }) {
  const { dispatch } = useModelStudio()
  return (
    <div className={`ms-attr${selected ? ' is-selected' : ''}`} onClick={() => onSelect(attr.id)}>
      <Handle type="target" position={Position.Left} id={`in:${attr.id}`} className="ms-handle ms-handle-in" />
      <input
        className="ms-attr-name nodrag"
        value={attr.name}
        aria-label="Column name"
        onChange={(e) => dispatch({ type: 'renameNode', nodeId: attr.id, name: e.target.value })}
      />
      {attr.dataType && <span className="ms-attr-type">{attr.dataType}</span>}
      <button
        className="ms-x nodrag"
        aria-label="Delete column"
        onClick={(e) => {
          e.stopPropagation()
          dispatch({ type: 'deleteNode', nodeId: attr.id })
        }}
      >
        <TrashIcon />
      </button>
      <Handle type="source" position={Position.Right} id={`out:${attr.id}`} className="ms-handle ms-handle-out" />
    </div>
  )
}

export interface CanvasCallbacks {
  selectedId: string | null
  onSelect: (id: string | null) => void
}

function CardNode({ data }: NodeProps) {
  const { band, tables } = data as ContainerData
  const { dispatch } = useModelStudio()
  const { selectedId, onSelect } = useCanvasCallbacks()
  return (
    <div className={`ms-card${band ? ' has-band' : ''}`}>
      {band && (
        <div className={`ms-band${selectedId === band.objectId ? ' is-selected' : ''}`} onClick={() => onSelect(band.objectId)}>
          <span className="ms-kind" data-kind="object">sys</span>
          <input
            className="ms-band-name nodrag"
            value={band.name}
            aria-label="System name"
            onChange={(e) => dispatch({ type: 'renameNode', nodeId: band.objectId, name: e.target.value })}
          />
          <button
            className="ms-x nodrag"
            aria-label="Delete system"
            onClick={(e) => {
              e.stopPropagation()
              if (confirm(`Delete "${band.name}" and everything in it?`)) dispatch({ type: 'deleteNode', nodeId: band.objectId })
            }}
          >
            <TrashIcon />
          </button>
        </div>
      )}
      {tables.map((t) => (
        <div className="ms-table" key={t.groupId}>
          <div className={`ms-table-head${selectedId === t.groupId ? ' is-selected' : ''}`} onClick={() => onSelect(t.groupId)}>
            <span className="ms-kind" data-kind="group">tbl</span>
            <input
              className="ms-table-name nodrag"
              value={t.name}
              aria-label="Table name"
              onChange={(e) => dispatch({ type: 'renameNode', nodeId: t.groupId, name: e.target.value })}
            />
            <button
              className="ms-x nodrag"
              aria-label="Delete table"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete table "${t.name}" and its columns?`)) dispatch({ type: 'deleteNode', nodeId: t.groupId })
              }}
            >
              <TrashIcon />
            </button>
          </div>
          {t.attributes.length === 0 && <div className="ms-no-attrs">no columns</div>}
          {t.attributes.map((a) => (
            <AttrRow key={a.id} attr={a} selected={selectedId === a.id} onSelect={onSelect} />
          ))}
          <button
            className="ms-add nodrag"
            onClick={() => dispatch({ type: 'addNode', nodeType: 'Attribute', parentId: t.groupId })}
          >
            <PlusIcon /> column
          </button>
        </div>
      ))}
      {band && (
        <button
          className="ms-add ms-add-table nodrag"
          onClick={() => dispatch({ type: 'addNode', nodeType: 'Group', parentId: band.objectId })}
        >
          <PlusIcon /> table
        </button>
      )}
    </div>
  )
}

function LayerNode({ data }: NodeProps) {
  const { layerId, name, width, height } = data as LayerData
  const { dispatch } = useModelStudio()
  return (
    <div className="ms-layer" style={{ width, height }}>
      <div className="ms-layer-head">
        <input
          className="ms-layer-name nodrag"
          value={name}
          aria-label="Layer name"
          onChange={(e) => dispatch({ type: 'renameNode', nodeId: layerId, name: e.target.value })}
        />
        <button
          className="ms-x nodrag"
          aria-label="Delete layer"
          onClick={() => {
            if (confirm(`Delete layer "${name}" and everything in it?`)) dispatch({ type: 'deleteNode', nodeId: layerId })
          }}
        >
          <TrashIcon />
        </button>
      </div>
      <div className="ms-layer-foot">
        <button className="ms-add nodrag" onClick={() => dispatch({ type: 'addNode', nodeType: 'Object', parentId: layerId })}>
          <PlusIcon /> system
        </button>
        <button className="ms-add nodrag" onClick={() => dispatch({ type: 'addNode', nodeType: 'Group', parentId: layerId })}>
          <PlusIcon /> table
        </button>
      </div>
    </div>
  )
}

const nodeTypes: NodeTypes = { msCard: CardNode, msLayer: LayerNode }

// Selection callbacks reach the node renderers via a module-level slot rather
// than node data, so a selection change doesn't force a full layout rebuild.
let callbacksSlot: CanvasCallbacks = { selectedId: null, onSelect: () => {} }
function useCanvasCallbacks(): CanvasCallbacks {
  return callbacksSlot
}

export default function ModelCanvas({
  selectedId,
  onSelect,
  onSelectEdge,
}: CanvasCallbacks & { onSelectEdge: (id: string | null) => void }) {
  const { model, dispatch } = useModelStudio()
  callbacksSlot = { selectedId, onSelect }

  const { nodes, edges } = useMemo(() => modelToFlow(model), [model])
  // Re-render node internals when selection changes even though layout didn't.
  const keyedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, _sel: selectedId } })),
    [nodes, selectedId],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.sourceHandle?.startsWith('out:') || !c.targetHandle?.startsWith('in:')) return
      dispatch({ type: 'connect', sourceNodeId: c.sourceHandle.slice(4), targetNodeId: c.targetHandle.slice(3) })
    },
    [dispatch],
  )

  const onEdgesDelete = useCallback(
    (deleted: RFEdge[]) => dispatch({ type: 'deleteEdges', edgeIds: deleted.map((e) => e.id) }),
    [dispatch],
  )

  return (
    <div className="ms-canvas">
      <ReactFlow
        nodes={keyedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onEdgeClick={(_, edge) => onSelectEdge(edge.id)}
        onPaneClick={() => {
          onSelect(null)
          onSelectEdge(null)
        }}
        nodesDraggable={false}
        nodesConnectable
        elementsSelectable
        deleteKeyCode={['Delete', 'Backspace']}
        onNodesDelete={() => {}}
        fitView
        minZoom={0.2}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      </ReactFlow>
    </div>
  )
}
