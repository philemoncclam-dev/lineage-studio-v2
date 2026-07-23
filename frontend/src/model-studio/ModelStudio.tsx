// Modeling-mode canvas: a horizontal board of Layers, each holding a nested
// tree of Groups and Objects, each Object owning Attributes. Solidatus's core
// authoring shape (Layers → Objects → Attributes, with nesting) rendered as an
// editable board. Inline text inputs are the edit affordance (natively
// keyboard-operable); every structural add/remove is an explicit button.
import { useModelStudio } from './store'
import type { Group, Layer, ModelNode, ModelObject } from './types'
import './model-studio.css'

// Inline stroke SVGs, currentColor, stroke-width 1.8 — matches the rail/icon
// convention established in Rail.tsx / components.css.
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" className="ms-icon"><path d="M12 5v14M5 12h14" /></svg>
)
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" className="ms-icon"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" /></svg>
)
const ChevronIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg viewBox="0 0 24 24" className="ms-icon" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
)

function AttributeRow({ layerId, objectId, attr }: { layerId: string; objectId: string; attr: ModelObject['attributes'][number] }) {
  const { dispatch } = useModelStudio()
  return (
    <div className="ms-attr">
      <span className="ms-attr-dot" aria-hidden />
      <input
        className="ms-attr-name"
        value={attr.name}
        aria-label="Attribute name"
        onChange={(e) => dispatch({ type: 'renameAttribute', layerId, objectId, attrId: attr.id, name: e.target.value })}
      />
      <input
        className="ms-attr-type"
        value={attr.dataType ?? ''}
        placeholder="type"
        aria-label="Attribute data type"
        onChange={(e) => dispatch({ type: 'setAttributeType', layerId, objectId, attrId: attr.id, dataType: e.target.value })}
      />
      <button
        className="ms-x"
        aria-label="Delete attribute"
        onClick={() => dispatch({ type: 'deleteAttribute', layerId, objectId, attrId: attr.id })}
      >
        <TrashIcon />
      </button>
    </div>
  )
}

function ObjectCard({ layerId, node }: { layerId: string; node: ModelObject }) {
  const { dispatch } = useModelStudio()
  return (
    <div className="ms-node ms-object">
      <div className="ms-node-head">
        <span className="ms-kind-badge" data-kind="object">obj</span>
        <input
          className="ms-node-name"
          value={node.name}
          aria-label="Object name"
          onChange={(e) => dispatch({ type: 'renameNode', layerId, nodeId: node.id, name: e.target.value })}
        />
        <button className="ms-x" aria-label="Delete object" onClick={() => dispatch({ type: 'deleteNode', layerId, nodeId: node.id })}>
          <TrashIcon />
        </button>
      </div>
      <div className="ms-attrs">
        {node.attributes.map((a) => (
          <AttributeRow key={a.id} layerId={layerId} objectId={node.id} attr={a} />
        ))}
        <button className="ms-add ms-add-attr" onClick={() => dispatch({ type: 'addAttribute', layerId, objectId: node.id })}>
          <PlusIcon /> Attribute
        </button>
      </div>
    </div>
  )
}

function GroupCard({ layerId, node }: { layerId: string; node: Group }) {
  const { dispatch } = useModelStudio()
  const collapsed = !!node.collapsed
  return (
    <div className="ms-node ms-group">
      <div className="ms-node-head">
        <button
          className="ms-collapse"
          aria-label={collapsed ? 'Expand group' : 'Collapse group'}
          aria-expanded={!collapsed}
          onClick={() => dispatch({ type: 'toggleGroup', layerId, nodeId: node.id })}
        >
          <ChevronIcon collapsed={collapsed} />
        </button>
        <span className="ms-kind-badge" data-kind="group">grp</span>
        <input
          className="ms-node-name"
          value={node.name}
          aria-label="Group name"
          onChange={(e) => dispatch({ type: 'renameNode', layerId, nodeId: node.id, name: e.target.value })}
        />
        <button className="ms-x" aria-label="Delete group" onClick={() => dispatch({ type: 'deleteNode', layerId, nodeId: node.id })}>
          <TrashIcon />
        </button>
      </div>
      {!collapsed && (
        <div className="ms-group-body">
          {node.children.map((child) => (
            <NodeCard key={child.id} layerId={layerId} node={child} />
          ))}
          <div className="ms-add-row">
            <button className="ms-add" onClick={() => dispatch({ type: 'addObject', layerId, parentGroupId: node.id })}>
              <PlusIcon /> Object
            </button>
            <button className="ms-add" onClick={() => dispatch({ type: 'addGroup', layerId, parentGroupId: node.id })}>
              <PlusIcon /> Group
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function NodeCard({ layerId, node }: { layerId: string; node: ModelNode }) {
  return node.kind === 'group' ? (
    <GroupCard layerId={layerId} node={node} />
  ) : (
    <ObjectCard layerId={layerId} node={node} />
  )
}

function LayerColumn({ layer }: { layer: Layer }) {
  const { dispatch } = useModelStudio()
  return (
    <section className="ms-layer" aria-label={`Layer: ${layer.name}`}>
      <header className="ms-layer-head">
        <input
          className="ms-layer-name"
          value={layer.name}
          aria-label="Layer name"
          onChange={(e) => dispatch({ type: 'renameLayer', layerId: layer.id, name: e.target.value })}
        />
        <button className="ms-x" aria-label="Delete layer" onClick={() => dispatch({ type: 'deleteLayer', layerId: layer.id })}>
          <TrashIcon />
        </button>
      </header>
      <div className="ms-layer-body">
        {layer.nodes.length === 0 && <p className="ms-empty-hint">Empty layer — add an object or a group.</p>}
        {layer.nodes.map((n) => (
          <NodeCard key={n.id} layerId={layer.id} node={n} />
        ))}
      </div>
      <div className="ms-add-row ms-layer-add">
        <button className="ms-add" onClick={() => dispatch({ type: 'addObject', layerId: layer.id })}>
          <PlusIcon /> Object
        </button>
        <button className="ms-add" onClick={() => dispatch({ type: 'addGroup', layerId: layer.id })}>
          <PlusIcon /> Group
        </button>
      </div>
    </section>
  )
}

export default function ModelStudio() {
  const { doc, dispatch } = useModelStudio()
  return (
    <div className="ms-root">
      <header className="ms-toolbar">
        <div>
          <h1 className="ms-title">Modeling</h1>
          <p className="ms-lead">
            Author a model the Solidatus way — Layers hold Objects (and nested Groups); Objects hold Attributes. Saved
            locally in your browser.
          </p>
        </div>
        <div className="ms-toolbar-actions">
          <button className="tbtn" onClick={() => dispatch({ type: 'addLayer' })}>
            + Add layer
          </button>
          {doc.layers.length > 0 && (
            <button
              className="tbtn ms-danger"
              onClick={() => {
                if (confirm('Clear the entire model? This cannot be undone.')) dispatch({ type: 'clear' })
              }}
            >
              Clear all
            </button>
          )}
        </div>
      </header>

      {doc.layers.length === 0 ? (
        <div className="ms-empty">
          <p className="ms-empty-title">No layers yet</p>
          <p className="ms-empty-sub">Start by adding a layer — for example Conceptual, Logical, or Physical.</p>
          <button className="tbtn" onClick={() => dispatch({ type: 'addLayer' })}>
            + Add your first layer
          </button>
        </div>
      ) : (
        <div className="ms-board">
          {doc.layers.map((l) => (
            <LayerColumn key={l.id} layer={l} />
          ))}
          <button className="ms-add-layer-col" onClick={() => dispatch({ type: 'addLayer' })} aria-label="Add layer">
            <PlusIcon />
            <span>Add layer</span>
          </button>
        </div>
      )}
    </div>
  )
}
