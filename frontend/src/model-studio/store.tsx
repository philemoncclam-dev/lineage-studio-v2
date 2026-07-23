// Modeling-mode store: a React context + reducer over ModelDoc, persisted to
// localStorage so an authored model survives refresh. Self-contained — it does
// NOT touch the shared LineageGraph/AppModel the other three modes read.
//
// All tree mutations are immutable and recursive so Groups nest to any depth.
import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import {
  emptyDoc,
  type Attribute,
  type Group,
  type Layer,
  type ModelDoc,
  type ModelNode,
  type ModelObject,
} from './types'

const STORAGE_KEY = 'lineage-studio:model-doc:v1'

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`

// ---- recursive tree helpers -------------------------------------------------

function mapNodes(nodes: ModelNode[], id: string, fn: (n: ModelNode) => ModelNode): ModelNode[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n)
    if (n.kind === 'group') return { ...n, children: mapNodes(n.children, id, fn) }
    return n
  })
}

function removeNode(nodes: ModelNode[], id: string): ModelNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.kind === 'group' ? { ...n, children: removeNode(n.children, id) } : n))
}

/** Append `child` into the group with `groupId`, searching recursively. */
function appendToGroup(nodes: ModelNode[], groupId: string, child: ModelNode): ModelNode[] {
  return nodes.map((n) => {
    if (n.kind !== 'group') return n
    if (n.id === groupId) return { ...n, children: [...n.children, child] }
    return { ...n, children: appendToGroup(n.children, groupId, child) }
  })
}

// ---- actions ----------------------------------------------------------------

type Action =
  | { type: 'reset'; doc: ModelDoc }
  | { type: 'clear' }
  | { type: 'addLayer' }
  | { type: 'renameLayer'; layerId: string; name: string }
  | { type: 'deleteLayer'; layerId: string }
  // parentGroupId omitted → add at the layer's top level.
  | { type: 'addObject'; layerId: string; parentGroupId?: string }
  | { type: 'addGroup'; layerId: string; parentGroupId?: string }
  | { type: 'renameNode'; layerId: string; nodeId: string; name: string }
  | { type: 'toggleGroup'; layerId: string; nodeId: string }
  | { type: 'deleteNode'; layerId: string; nodeId: string }
  | { type: 'addAttribute'; layerId: string; objectId: string }
  | { type: 'renameAttribute'; layerId: string; objectId: string; attrId: string; name: string }
  | { type: 'setAttributeType'; layerId: string; objectId: string; attrId: string; dataType: string }
  | { type: 'deleteAttribute'; layerId: string; objectId: string; attrId: string }

function newObject(): ModelObject {
  return { id: uid(), kind: 'object', name: 'New object', attributes: [] }
}
function newGroup(): Group {
  return { id: uid(), kind: 'group', name: 'New group', children: [] }
}
function newLayer(index: number): Layer {
  return { id: uid(), name: `Layer ${index + 1}`, nodes: [] }
}

function updateLayer(doc: ModelDoc, layerId: string, fn: (l: Layer) => Layer): ModelDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === layerId ? fn(l) : l)) }
}

function reducer(doc: ModelDoc, action: Action): ModelDoc {
  switch (action.type) {
    case 'reset':
      return action.doc
    case 'clear':
      return emptyDoc()
    case 'addLayer':
      return { ...doc, layers: [...doc.layers, newLayer(doc.layers.length)] }
    case 'renameLayer':
      return updateLayer(doc, action.layerId, (l) => ({ ...l, name: action.name }))
    case 'deleteLayer':
      return { ...doc, layers: doc.layers.filter((l) => l.id !== action.layerId) }
    case 'addObject': {
      const child = newObject()
      return updateLayer(doc, action.layerId, (l) => ({
        ...l,
        nodes: action.parentGroupId ? appendToGroup(l.nodes, action.parentGroupId, child) : [...l.nodes, child],
      }))
    }
    case 'addGroup': {
      const child = newGroup()
      return updateLayer(doc, action.layerId, (l) => ({
        ...l,
        nodes: action.parentGroupId ? appendToGroup(l.nodes, action.parentGroupId, child) : [...l.nodes, child],
      }))
    }
    case 'renameNode':
      return updateLayer(doc, action.layerId, (l) => ({
        ...l,
        nodes: mapNodes(l.nodes, action.nodeId, (n) => ({ ...n, name: action.name })),
      }))
    case 'toggleGroup':
      return updateLayer(doc, action.layerId, (l) => ({
        ...l,
        nodes: mapNodes(l.nodes, action.nodeId, (n) =>
          n.kind === 'group' ? { ...n, collapsed: !n.collapsed } : n,
        ),
      }))
    case 'deleteNode':
      return updateLayer(doc, action.layerId, (l) => ({ ...l, nodes: removeNode(l.nodes, action.nodeId) }))
    case 'addAttribute':
      return updateLayer(doc, action.layerId, (l) => ({
        ...l,
        nodes: mapNodes(l.nodes, action.objectId, (n) =>
          n.kind === 'object'
            ? { ...n, attributes: [...n.attributes, { id: uid(), name: 'attribute' } as Attribute] }
            : n,
        ),
      }))
    case 'renameAttribute':
      return updateLayer(doc, action.layerId, (l) => ({
        ...l,
        nodes: mapNodes(l.nodes, action.objectId, (n) =>
          n.kind === 'object'
            ? { ...n, attributes: n.attributes.map((a) => (a.id === action.attrId ? { ...a, name: action.name } : a)) }
            : n,
        ),
      }))
    case 'setAttributeType':
      return updateLayer(doc, action.layerId, (l) => ({
        ...l,
        nodes: mapNodes(l.nodes, action.objectId, (n) =>
          n.kind === 'object'
            ? {
                ...n,
                attributes: n.attributes.map((a) =>
                  a.id === action.attrId ? { ...a, dataType: action.dataType || undefined } : a,
                ),
              }
            : n,
        ),
      }))
    case 'deleteAttribute':
      return updateLayer(doc, action.layerId, (l) => ({
        ...l,
        nodes: mapNodes(l.nodes, action.objectId, (n) =>
          n.kind === 'object' ? { ...n, attributes: n.attributes.filter((a) => a.id !== action.attrId) } : n,
        ),
      }))
    default:
      return doc
  }
}

// ---- persistence + context --------------------------------------------------

function loadDoc(): ModelDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyDoc()
    const parsed = JSON.parse(raw) as ModelDoc
    if (!parsed || !Array.isArray(parsed.layers)) return emptyDoc()
    return parsed
  } catch {
    return emptyDoc()
  }
}

interface StoreValue {
  doc: ModelDoc
  dispatch: React.Dispatch<Action>
}

const ModelStudioContext = createContext<StoreValue | null>(null)

export function ModelStudioProvider({ children }: { children: ReactNode }) {
  const [doc, dispatch] = useReducer(reducer, undefined, loadDoc)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
    } catch {
      // storage full / disabled — the in-memory doc still works this session.
    }
  }, [doc])

  const value = useMemo(() => ({ doc, dispatch }), [doc])
  return <ModelStudioContext.Provider value={value}>{children}</ModelStudioContext.Provider>
}

export function useModelStudio(): StoreValue {
  const ctx = useContext(ModelStudioContext)
  if (!ctx) throw new Error('useModelStudio must be used within a ModelStudioProvider')
  return ctx
}
