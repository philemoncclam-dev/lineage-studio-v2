// Modeling-mode store: React context + reducer over one authored Model,
// persisted to localStorage via localdb on every change. Self-contained — it
// does NOT touch the shared LineageGraph/AppModel the other modes read.
import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { saveModel } from './localdb'
import { uid, type EdgeKind, type Model, type ModelNode, type NodeType } from './types'

// ---- actions ----------------------------------------------------------------

export type Action =
  | { type: 'reset'; model: Model }
  | { type: 'renameModel'; name: string }
  | { type: 'addLayer'; name?: string }
  | { type: 'addNode'; nodeType: Exclude<NodeType, 'Layer'>; parentId: string; name?: string }
  | { type: 'renameNode'; nodeId: string; name: string }
  | { type: 'setNodeProperty'; nodeId: string; key: string; value: unknown }
  | { type: 'setLogic'; nodeId: string; logic: string }
  | { type: 'deleteNode'; nodeId: string }
  | { type: 'connect'; sourceNodeId: string; targetNodeId: string }
  | { type: 'deleteEdges'; edgeIds: string[] }
  | { type: 'setEdgeKind'; edgeId: string; kind: EdgeKind }
  | { type: 'setEdgeNote'; edgeId: string; note: string }
  | { type: 'importNodes'; nodes: ModelNode[] }

const DEFAULT_NAMES: Record<NodeType, string> = {
  Layer: 'New layer',
  Object: 'New system',
  Group: 'new_table',
  Attribute: 'column',
}

/** Ids of `nodeId` plus every descendant, for cascade delete. */
function subtreeIds(nodes: ModelNode[], nodeId: string): Set<string> {
  const childrenOf = new Map<string | null, ModelNode[]>()
  for (const n of nodes) {
    const arr = childrenOf.get(n.parentId) ?? []
    arr.push(n)
    childrenOf.set(n.parentId, arr)
  }
  const out = new Set<string>()
  const walk = (id: string) => {
    out.add(id)
    for (const c of childrenOf.get(id) ?? []) walk(c.id)
  }
  walk(nodeId)
  return out
}

function reducer(model: Model, action: Action): Model {
  switch (action.type) {
    case 'reset':
      return action.model
    case 'renameModel':
      return { ...model, name: action.name }
    case 'addLayer': {
      const layerCount = model.nodes.filter((n) => n.type === 'Layer').length
      const node: ModelNode = {
        id: uid(),
        type: 'Layer',
        name: action.name ?? `Layer ${layerCount + 1}`,
        parentId: null,
        properties: {},
        transformation_logic: '',
      }
      return { ...model, nodes: [...model.nodes, node] }
    }
    case 'addNode': {
      const node: ModelNode = {
        id: uid(),
        type: action.nodeType,
        name: action.name ?? DEFAULT_NAMES[action.nodeType],
        parentId: action.parentId,
        properties: {},
        transformation_logic: '',
      }
      return { ...model, nodes: [...model.nodes, node] }
    }
    case 'renameNode':
      return {
        ...model,
        nodes: model.nodes.map((n) => (n.id === action.nodeId ? { ...n, name: action.name } : n)),
      }
    case 'setNodeProperty':
      return {
        ...model,
        nodes: model.nodes.map((n) =>
          n.id === action.nodeId
            ? { ...n, properties: { ...n.properties, [action.key]: action.value } }
            : n,
        ),
      }
    case 'setLogic':
      return {
        ...model,
        nodes: model.nodes.map((n) =>
          n.id === action.nodeId ? { ...n, transformation_logic: action.logic } : n,
        ),
      }
    case 'deleteNode': {
      const gone = subtreeIds(model.nodes, action.nodeId)
      return {
        ...model,
        nodes: model.nodes.filter((n) => !gone.has(n.id)),
        edges: model.edges.filter((e) => !gone.has(e.sourceNodeId) && !gone.has(e.targetNodeId)),
      }
    }
    case 'connect': {
      if (action.sourceNodeId === action.targetNodeId) return model
      const dup = model.edges.some(
        (e) => e.sourceNodeId === action.sourceNodeId && e.targetNodeId === action.targetNodeId,
      )
      if (dup) return model
      return {
        ...model,
        edges: [
          ...model.edges,
          { id: uid(), sourceNodeId: action.sourceNodeId, targetNodeId: action.targetNodeId, kind: 'copy' },
        ],
      }
    }
    case 'deleteEdges': {
      const gone = new Set(action.edgeIds)
      return { ...model, edges: model.edges.filter((e) => !gone.has(e.id)) }
    }
    case 'setEdgeKind':
      return {
        ...model,
        edges: model.edges.map((e) => (e.id === action.edgeId ? { ...e, kind: action.kind } : e)),
      }
    case 'setEdgeNote':
      return {
        ...model,
        edges: model.edges.map((e) =>
          e.id === action.edgeId ? { ...e, note: action.note || undefined } : e,
        ),
      }
    case 'importNodes':
      return { ...model, nodes: [...model.nodes, ...action.nodes] }
    default:
      return model
  }
}

// ---- context ----------------------------------------------------------------

interface StoreValue {
  model: Model
  dispatch: React.Dispatch<Action>
}

const ModelStudioContext = createContext<StoreValue | null>(null)

export function ModelStudioProvider({ initial, children }: { initial: Model; children: ReactNode }) {
  const [model, dispatch] = useReducer(reducer, initial)

  // Re-seed when navigating between models under the same provider mount.
  useEffect(() => {
    if (model.id !== initial.id) dispatch({ type: 'reset', model: initial })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id])

  useEffect(() => {
    saveModel(model)
  }, [model])

  const value = useMemo(() => ({ model, dispatch }), [model])
  return <ModelStudioContext.Provider value={value}>{children}</ModelStudioContext.Provider>
}

export function useModelStudio(): StoreValue {
  const ctx = useContext(ModelStudioContext)
  if (!ctx) throw new Error('useModelStudio must be used within a ModelStudioProvider')
  return ctx
}
