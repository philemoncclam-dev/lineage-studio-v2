// The authoring workspace for one model: toolbar (name, add layer, import,
// exports), the swimlane canvas, and a right-hand inspector for whatever node
// or edge is selected. Feature set ported from lineage-studio's EditorPage,
// re-composed for this app's shell and token system.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ReactFlowProvider } from '@xyflow/react'
import ModelCanvas from './ModelCanvas'
import ImportSchemaDialog from './ImportSchemaDialog'
import { exportModelCsv, exportModelXlsx } from './exportModel'
import { useModelStudio } from './store'
import { EDGE_KINDS, type EdgeKind } from './types'
import './model-studio.css'

function NodeInspector({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const { model, dispatch } = useModelStudio()
  const node = model.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const path: string[] = []
  let cur = node.parentId ? byId.get(node.parentId) : undefined
  while (cur) {
    path.unshift(cur.name)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return (
    <aside className="ms-inspector" aria-label="Selection details">
      <header className="ms-insp-head">
        <span className="ms-kind" data-kind={node.type.toLowerCase()}>{node.type}</span>
        <strong className="ms-insp-title">{node.name}</strong>
        <button className="ms-x" aria-label="Close inspector" onClick={onClose}>×</button>
      </header>
      {path.length > 0 && <p className="ms-insp-path">{path.join(' / ')}</p>}
      {node.type === 'Attribute' && (
        <>
          <label className="ms-field">
            <span>Data type</span>
            <input
              value={String(node.properties.dataType ?? '')}
              placeholder="e.g. decimal(18,2)"
              onChange={(e) => dispatch({ type: 'setNodeProperty', nodeId, key: 'dataType', value: e.target.value || undefined })}
            />
          </label>
          <label className="ms-field">
            <span>Transformation logic</span>
            <textarea
              rows={4}
              value={node.transformation_logic}
              placeholder="How this column is derived — lands in the Solidatus export."
              onChange={(e) => dispatch({ type: 'setLogic', nodeId, logic: e.target.value })}
            />
          </label>
        </>
      )}
    </aside>
  )
}

function EdgeInspector({ edgeId, onClose }: { edgeId: string; onClose: () => void }) {
  const { model, dispatch } = useModelStudio()
  const edge = model.edges.find((e) => e.id === edgeId)
  if (!edge) return null
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const name = (id: string) => byId.get(id)?.name ?? '?'
  return (
    <aside className="ms-inspector" aria-label="Edge details">
      <header className="ms-insp-head">
        <span className="ms-kind" data-kind="edge">edge</span>
        <strong className="ms-insp-title">
          {name(edge.sourceNodeId)} → {name(edge.targetNodeId)}
        </strong>
        <button className="ms-x" aria-label="Close inspector" onClick={onClose}>×</button>
      </header>
      <label className="ms-field">
        <span>Kind</span>
        <select
          value={edge.kind ?? 'copy'}
          onChange={(e) => dispatch({ type: 'setEdgeKind', edgeId, kind: e.target.value as EdgeKind })}
        >
          {EDGE_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </label>
      <label className="ms-field">
        <span>Note</span>
        <textarea
          rows={3}
          value={edge.note ?? ''}
          placeholder="Optional mapping note."
          onChange={(e) => dispatch({ type: 'setEdgeNote', edgeId, note: e.target.value })}
        />
      </label>
      <button
        className="tbtn ms-danger"
        onClick={() => {
          dispatch({ type: 'deleteEdges', edgeIds: [edgeId] })
          onClose()
        }}
      >
        Delete mapping
      </button>
    </aside>
  )
}

export default function ModelEditor() {
  const { model, dispatch } = useModelStudio()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const hasLayers = model.nodes.some((n) => n.type === 'Layer')

  return (
    <div className="ms-root">
      <header className="ms-toolbar">
        <div className="ms-toolbar-id">
          <Link to="/model" className="ms-back" aria-label="Back to models">←</Link>
          <input
            className="ms-model-name"
            value={model.name}
            aria-label="Model name"
            onChange={(e) => dispatch({ type: 'renameModel', name: e.target.value })}
          />
          <span className="ms-count">
            {model.nodes.length} nodes · {model.edges.length} mappings — saved locally
          </span>
        </div>
        <div className="ms-toolbar-actions">
          <button className="tbtn" onClick={() => dispatch({ type: 'addLayer' })}>+ Layer</button>
          <button className="tbtn" onClick={() => setImportOpen(true)}>Import schema</button>
          <button className="tbtn" onClick={() => exportModelCsv(model)} disabled={model.edges.length === 0}>
            Export CSV
          </button>
          <button className="tbtn" onClick={() => void exportModelXlsx(model)} disabled={model.nodes.length === 0}>
            Export Excel
          </button>
        </div>
      </header>

      {!hasLayers ? (
        <div className="ms-empty">
          <p className="ms-empty-title">Empty model</p>
          <p className="ms-empty-sub">
            Add layers (e.g. Data Sources, Bronze, Silver, Gold), fill them with systems and tables, then drag
            between columns to map lineage — or import a schema to scaffold the tables for you.
          </p>
          <div className="ms-add-row">
            <button className="tbtn" onClick={() => dispatch({ type: 'addLayer' })}>+ Add your first layer</button>
            <button className="tbtn" onClick={() => setImportOpen(true)}>Import schema</button>
          </div>
        </div>
      ) : (
        <div className="ms-body">
          <ReactFlowProvider>
            <ModelCanvas
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id)
                if (id) setSelectedEdgeId(null)
              }}
              onSelectEdge={(id) => {
                setSelectedEdgeId(id)
                if (id) setSelectedId(null)
              }}
            />
          </ReactFlowProvider>
          {selectedEdgeId ? (
            <EdgeInspector edgeId={selectedEdgeId} onClose={() => setSelectedEdgeId(null)} />
          ) : selectedId ? (
            <NodeInspector nodeId={selectedId} onClose={() => setSelectedId(null)} />
          ) : null}
        </div>
      )}

      {importOpen && <ImportSchemaDialog onClose={() => setImportOpen(false)} />}
    </div>
  )
}
