import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { fetchSample, ingest, type LineageGraph, type LineageNode } from './api'
import { toFlow } from './lineageLayout'
import './App.css'

export default function App() {
  const [graph, setGraph] = useState<LineageGraph | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selected, setSelected] = useState<LineageNode | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyGraph = useCallback(
    (g: LineageGraph) => {
      setGraph(g)
      const flow = toFlow(g)
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setSelected(null)
      setError(null)
    },
    [setNodes, setEdges],
  )

  useEffect(() => {
    fetchSample().then(applyGraph).catch((e) => setError(String(e)))
  }, [applyGraph])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelected(node.data.node as LineageNode)
  }, [])

  const onUpload = useCallback(
    async (file: File) => {
      try {
        const payload = JSON.parse(await file.text())
        applyGraph(await ingest(payload))
      } catch (e) {
        setError(`Upload failed: ${e}`)
      }
    },
    [applyGraph],
  )

  const stats = useMemo(() => {
    if (!graph) return null
    const byKind: Record<string, number> = {}
    graph.nodes.forEach((n) => (byKind[n.kind] = (byKind[n.kind] ?? 0) + 1))
    return byKind
  }, [graph])

  return (
    <div className="app">
      <header className="topbar">
        <strong>Lineage Studio</strong>
        <span className="muted">Fabric data lineage · Phase 1</span>
        <div className="spacer" />
        <button onClick={() => fetchSample().then(applyGraph).catch((e) => setError(String(e)))}>
          Load sample
        </button>
        <label className="upload">
          Upload JSON
          <input
            type="file"
            accept="application/json"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="body">
        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <aside className="panel">
          {selected ? (
            <NodeDetails node={selected} graph={graph!} />
          ) : (
            <div className="muted">
              <p>Click a node to inspect its lineage.</p>
              {stats && (
                <ul className="stats">
                  {Object.entries(stats).map(([k, v]) => (
                    <li key={k}>
                      <span>{k}</span>
                      <b>{v}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function NodeDetails({ node, graph }: { node: LineageNode; graph: LineageGraph }) {
  const inputs = graph.edges.filter((e) => e.target === node.id)
  const outputs = graph.edges.filter((e) => e.source === node.id)

  return (
    <div>
      <h3>{node.name}</h3>
      <div className="kind">{node.kind}</div>

      {node.columns.length > 0 && (
        <>
          <h4>Columns</h4>
          <ul className="cols">
            {node.columns.map((c) => (
              <li key={c.name}>
                {c.name} <span className="muted">{c.data_type}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>Inputs ({inputs.length})</h4>
      <ul className="edges">
        {inputs.map((e, i) => (
          <li key={i}>
            <code>{e.source}</code> <span className="muted">— {e.kind}</span>
          </li>
        ))}
      </ul>

      <h4>Outputs ({outputs.length})</h4>
      <ul className="edges">
        {outputs.map((e, i) => (
          <li key={i}>
            <code>{e.target}</code> <span className="muted">— {e.kind}</span>
            {e.columns.length > 0 && (
              <ul className="colmap">
                {e.columns.map((cm, j) => (
                  <li key={j}>
                    {cm.from_column} → <b>{cm.to_column}</b>
                    {cm.transform && <span className="muted"> ({cm.transform})</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
