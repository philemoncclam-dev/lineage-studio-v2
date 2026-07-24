// Multi-model persistence over localStorage (ported idea from lineage-studio's
// localdb.ts). Each model is its own key so saving one model never rewrites the
// others; an index key lists the ids. Also migrates the old single-doc
// `model-doc:v1` format (nested layer tree) into a first model, once.
import {
  countByType,
  uid,
  type Model,
  type ModelNode,
  type ModelSummary,
} from './types'

const INDEX_KEY = 'lineage-studio:models:index:v1'
const MODEL_PREFIX = 'lineage-studio:models:v1:'
const LEGACY_DOC_KEY = 'lineage-studio:model-doc:v1'

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeIndex(ids: string[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids))
  } catch {
    // storage full/disabled — in-memory state still works this session.
  }
}

export function getModel(id: string): Model | null {
  try {
    const raw = localStorage.getItem(MODEL_PREFIX + id)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Model
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveModel(model: Model): Model {
  const stamped = { ...model, updatedAt: new Date().toISOString() }
  try {
    localStorage.setItem(MODEL_PREFIX + model.id, JSON.stringify(stamped))
  } catch {
    // ignore — see writeIndex
  }
  const ids = readIndex()
  if (!ids.includes(model.id)) writeIndex([...ids, model.id])
  return stamped
}

export function deleteModel(id: string): void {
  try {
    localStorage.removeItem(MODEL_PREFIX + id)
  } catch {
    // ignore
  }
  writeIndex(readIndex().filter((x) => x !== id))
}

export function duplicateModel(id: string): Model | null {
  const src = getModel(id)
  if (!src) return null
  return saveModel({ ...src, id: uid(), name: `${src.name} (copy)`, createdAt: new Date().toISOString() })
}

export function listModels(): ModelSummary[] {
  migrateLegacyDoc()
  return readIndex()
    .map(getModel)
    .filter((m): m is Model => m !== null)
    .map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      nodeCount: m.nodes.length,
      edgeCount: m.edges.length,
      typeCounts: countByType(m.nodes),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

// ---- legacy single-doc migration -------------------------------------------

interface LegacyAttr {
  id: string
  name: string
  dataType?: string
}
interface LegacyNode {
  id: string
  kind: 'object' | 'group'
  name: string
  attributes?: LegacyAttr[]
  children?: LegacyNode[]
}
interface LegacyDoc {
  layers: { id: string; name: string; nodes: LegacyNode[] }[]
}

/** One-shot: convert the pre-port nested ModelDoc into a first model. */
function migrateLegacyDoc(): void {
  let doc: LegacyDoc | null = null
  try {
    const raw = localStorage.getItem(LEGACY_DOC_KEY)
    if (!raw) return
    doc = JSON.parse(raw) as LegacyDoc
  } catch {
    doc = null
  }
  try {
    localStorage.removeItem(LEGACY_DOC_KEY)
  } catch {
    // ignore
  }
  if (!doc || !Array.isArray(doc.layers) || doc.layers.length === 0) return

  const nodes: ModelNode[] = []
  const add = (type: ModelNode['type'], name: string, parentId: string | null, properties: Record<string, unknown> = {}) => {
    const n: ModelNode = { id: uid(), type, name, parentId, properties, transformation_logic: '' }
    nodes.push(n)
    return n
  }
  // Old "object with attributes" maps to a Group (table) since attributes hung
  // directly off it; old "group" containers map to Objects (system bands).
  const walk = (children: LegacyNode[], parentId: string | null) => {
    for (const c of children) {
      if (c.kind === 'group') {
        const obj = add('Object', c.name, parentId)
        walk(c.children ?? [], obj.id)
      } else {
        const grp = add('Group', c.name, parentId)
        for (const a of c.attributes ?? []) {
          add('Attribute', a.name, grp.id, a.dataType ? { dataType: a.dataType } : {})
        }
      }
    }
  }
  for (const layer of doc.layers) {
    const l = add('Layer', layer.name, null)
    walk(layer.nodes, l.id)
  }

  const now = new Date().toISOString()
  saveModel({ id: uid(), name: 'Migrated model', createdAt: now, updatedAt: now, nodes, edges: [] })
}
