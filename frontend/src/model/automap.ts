// The Auto-Mapper: suggests Transitions between entities that look like the
// same real-world thing seen in two places.
//
// Everything here is PURE — a config plus a model in, a list of scored
// suggestions out. The wizard (modeling/AutoMapper.tsx) only collects the
// config and renders the review list; none of the matching logic lives there,
// which is what makes it testable.
//
// The shape of the problem, in the order the wizard asks about it:
//
//  1. SCOPE. Which entities may be sources, and which may be targets. Either
//     side can be "Auto", which does not mean "everything" — it means the part
//     of the model that is ALREADY connected. Auto-mapping is for densifying an
//     existing mapping, not for guessing one from nothing.
//  2. CRITERIA. What is compared: the name, the path, or a named property.
//     Several may be on at once, in which case the score is their mean.
//  3. ALGORITHM + THRESHOLD. How similar two feature values have to be.
//
// One rule is worth stating up front because it silently removes most of the
// noise: a suggestion is only made ACROSS layers. Two attributes in the same
// layer with the same name are nearly always siblings in different objects, not
// the same datum flowing; and `pathOf` deliberately excludes the layer name
// precisely so a path can be matched from one layer to the next.

import { ancestorsOf, buildIndex, pathOf, type ModelIndex } from './index'
import type { EntityId, LineageModel } from './types'

export type Criterion = 'name' | 'path' | 'property'

export type Algorithm =
  /** Case-insensitive exact match. Cheap; the right choice for large models. */
  | 'fast'
  /** Case-sensitive edit distance. Stricter, so better matches than `fast`. */
  | 'exhaustive1'
  /** Case-insensitive bigram overlap. Degrades gracefully on long strings. */
  | 'exhaustive2'

export interface AutoMapConfig {
  /** Scope root for sources; null means Auto. */
  source: EntityId | null
  /** Scope root for targets; null means Auto. */
  target: EntityId | null
  /** At least one. Several are averaged. */
  criteria: Criterion[]
  /** The property compared when `criteria` includes 'property'. */
  property: string
  /** 0–100. Suggestions below this are dropped. */
  confidence: number
  algorithm: Algorithm
  /** Also consider Attributes that have children (Groups), not just leaves. */
  includeGroups: boolean
  /** Allow a source or target to appear in more than one suggestion. */
  allowOneToMany: boolean
  /** Score two values as identical when both parse to the same instant. */
  dateAware: boolean
}

export function defaultConfig(): AutoMapConfig {
  return {
    source: null,
    target: null,
    criteria: ['name'],
    property: '',
    confidence: 80,
    algorithm: 'fast',
    includeGroups: false,
    allowOneToMany: false,
    dateAware: false,
  }
}

export interface Suggestion {
  source: EntityId
  target: EntityId
  /** 0–100, rounded. */
  confidence: number
  /** Which criteria actually contributed, for the review list. */
  via: Criterion[]
}

/** One "high-level mapping": every suggestion between the same pair of objects. */
export interface SuggestionGroup {
  key: string
  sourceLabel: string
  targetLabel: string
  suggestions: Suggestion[]
}

// --- scope resolution -------------------------------------------------------

/** `id` plus every descendant of it. */
function subtree(index: ModelIndex, id: EntityId): Set<EntityId> {
  const out = new Set<EntityId>([id])
  // One pass over the flat index rather than a tree walk: entries are in
  // document order, so a child is always visited after its parent and a single
  // sweep closes the whole subtree.
  for (const entry of index.entries.values()) {
    if (entry.parentId && out.has(entry.parentId)) out.add(entry.id)
  }
  return out
}

/** Every entity that an existing transition touches, plus its subtree. */
function connectedScope(model: LineageModel, index: ModelIndex): Set<EntityId> {
  const roots = new Set<EntityId>()
  for (const t of model.transitions) {
    roots.add(t.source)
    roots.add(t.target)
  }
  const out = new Set<EntityId>()
  for (const root of roots) for (const id of subtree(index, root)) out.add(id)
  return out
}

/**
 * Auto source against a NAMED target: the doc's second case. Scope widens from
 * "everything already connected" to "everything already connected *to the
 * target*" — the entities the target's contents (or their ancestors) already
 * exchange transitions with.
 */
function connectedTo(
  model: LineageModel,
  index: ModelIndex,
  targetScope: Set<EntityId>,
): Set<EntityId> {
  const roots = new Set<EntityId>()
  const touches = (id: EntityId) =>
    targetScope.has(id) || ancestorsOf(index, id).some((a) => targetScope.has(a.id))
  for (const t of model.transitions) {
    if (touches(t.target)) roots.add(t.source)
    if (touches(t.source)) roots.add(t.target)
  }
  const out = new Set<EntityId>()
  for (const root of roots) {
    if (targetScope.has(root)) continue
    for (const id of subtree(index, root)) out.add(id)
  }
  return out
}

/**
 * The entities in a scope that may actually carry a mapping.
 *
 * Layers and Objects are containers here, never endpoints — a suggestion
 * between two whole objects is not a mapping, it is a guess. Groups (Attributes
 * with children) are excluded unless the user asks for them, because a Group's
 * name usually repeats across every layer and would match everywhere.
 */
function mappable(index: ModelIndex, scope: Set<EntityId>, includeGroups: boolean): EntityId[] {
  const out: EntityId[] = []
  for (const id of scope) {
    const entry = index.entries.get(id)
    if (!entry || entry.kind !== 'attribute') continue
    if (entry.hasChildren && !includeGroups) continue
    out.push(id)
  }
  return out
}

/** Resolves both sides of the scope question into concrete candidate lists. */
export function resolveScopes(
  model: LineageModel,
  index: ModelIndex,
  config: AutoMapConfig,
): { sources: EntityId[]; targets: EntityId[] } {
  const targetScope = config.target ? subtree(index, config.target) : null
  const sourceScope = config.source
    ? subtree(index, config.source)
    : targetScope
      ? connectedTo(model, index, targetScope)
      : connectedScope(model, index)

  const resolvedTargets = targetScope ?? connectedScope(model, index)

  return {
    sources: mappable(index, sourceScope, config.includeGroups),
    targets: mappable(index, resolvedTargets, config.includeGroups),
  }
}

// --- string similarity ------------------------------------------------------

const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s_\-.]+/g, '')

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = row
  }
  return previous[b.length]
}

/** Sørensen–Dice over character bigrams — kinder to long strings than edit distance. */
function diceBigrams(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const counts = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i += 1) {
    const g = a.slice(i, i + 2)
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  let shared = 0
  for (let i = 0; i < b.length - 1; i += 1) {
    const g = b.slice(i, i + 2)
    const n = counts.get(g) ?? 0
    if (n > 0) {
      counts.set(g, n - 1)
      shared += 1
    }
  }
  return (2 * shared) / (a.length - 1 + (b.length - 1))
}

/** Both sides parse to the same instant — "2024-01-05" vs "5 Jan 2024". */
function sameDate(a: string, b: string): boolean {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb
}

/** Similarity of two feature values, 0–100, under the chosen algorithm. */
export function similarity(
  a: string,
  b: string,
  algorithm: Algorithm,
  dateAware: boolean,
): number {
  if (!a || !b) return 0
  if (dateAware && sameDate(a, b)) return 100
  switch (algorithm) {
    case 'fast':
      return normalize(a) === normalize(b) ? 100 : 0
    case 'exhaustive1': {
      const distance = levenshtein(a, b)
      return Math.round((1 - distance / Math.max(a.length, b.length)) * 100)
    }
    case 'exhaustive2':
      return Math.round(diceBigrams(a.toLowerCase(), b.toLowerCase()) * 100)
  }
}

// --- the mapper -------------------------------------------------------------

function featureValue(
  model: LineageModel,
  index: ModelIndex,
  id: EntityId,
  criterion: Criterion,
  property: string,
): string {
  if (criterion === 'name') return index.entries.get(id)?.name ?? ''
  if (criterion === 'path') return pathOf(index, id)
  return model.properties[id]?.[property] ?? ''
}

/**
 * Whether the pair can be considered at all, before any scoring.
 *
 * Same entity, an existing transition, and a same-layer pair are all rejected —
 * see the layer note at the top of this file.
 *
 * `directed` says whether the user actually chose which side is the source. If
 * they did, their direction is honoured. If BOTH sides are Auto the two scopes
 * are the same set, so every pair would otherwise be produced twice, once each
 * way; left-to-right layer order settles it, which is also the direction
 * lineage reads on the canvas.
 */
function eligible(
  index: ModelIndex,
  layerOrder: Map<EntityId, number>,
  existing: Set<string>,
  directed: boolean,
  source: EntityId,
  target: EntityId,
): boolean {
  if (source === target) return false
  if (existing.has(`${source}>${target}`)) return false
  const s = index.entries.get(source)
  const t = index.entries.get(target)
  if (!s || !t) return false
  if (s.layerId === t.layerId) return false
  if (directed) return true
  return (layerOrder.get(s.layerId) ?? 0) < (layerOrder.get(t.layerId) ?? 0)
}

export function generateSuggestions(
  model: LineageModel,
  config: AutoMapConfig,
): Suggestion[] {
  const index = buildIndex(model)
  const { sources, targets } = resolveScopes(model, index, config)
  if (sources.length === 0 || targets.length === 0) return []

  const criteria = config.criteria.length > 0 ? config.criteria : (['name'] as Criterion[])
  const existing = new Set(model.transitions.map((t) => `${t.source}>${t.target}`))
  const directed = config.source !== null || config.target !== null
  const layerOrder = new Map(model.layers.map((l, i) => [l.id, i]))

  // Mapping purely on a property is inherently one-to-many: every entity
  // sharing a value is a real match, and silently keeping one would hide the
  // others. This mirrors the documented behaviour rather than the checkbox.
  const oneToMany =
    config.allowOneToMany || (criteria.length === 1 && criteria[0] === 'property')

  const scored: Suggestion[] = []

  for (const source of sources) {
    for (const target of targets) {
      if (!eligible(index, layerOrder, existing, directed, source, target)) continue

      let sum = 0
      let counted = 0
      const via: Criterion[] = []

      for (const criterion of criteria) {
        const a = featureValue(model, index, source, criterion, config.property)
        const b = featureValue(model, index, target, criterion, config.property)
        if (!a || !b) continue
        const score = similarity(a, b, config.algorithm, config.dateAware)
        // A criterion that scores zero is a mismatch, not an abstention: it has
        // to drag the mean down, or adding a second criterion could only ever
        // raise a pair's confidence.
        sum += score
        counted += 1
        if (score > 0) via.push(criterion)
      }

      if (counted === 0 || via.length === 0) continue
      const confidence = Math.round(sum / counted)
      if (confidence < config.confidence) continue
      if (confidence <= 0) continue

      scored.push({ source, target, confidence, via })
    }
  }

  scored.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      (index.entries.get(a.source)?.name ?? '').localeCompare(index.entries.get(b.source)?.name ?? ''),
  )

  if (oneToMany) return scored

  // Greedy one-to-one over the confidence-sorted list: the best available pair
  // claims both its endpoints.
  const takenSource = new Set<EntityId>()
  const takenTarget = new Set<EntityId>()
  const out: Suggestion[] = []
  for (const s of scored) {
    if (takenSource.has(s.source) || takenTarget.has(s.target)) continue
    takenSource.add(s.source)
    takenTarget.add(s.target)
    out.push(s)
  }
  return out
}

/**
 * Rolls suggestions up to the object-pair level — the "high-level mapping with
 * a coloured badge showing the number of potential Transitions" the review step
 * shows, before you expand it into individual attribute pairs.
 */
export function groupSuggestions(
  model: LineageModel,
  suggestions: Suggestion[],
): SuggestionGroup[] {
  const index = buildIndex(model)
  const label = (id: EntityId): { key: string; text: string } => {
    const entry = index.entries.get(id)
    if (!entry) return { key: id, text: '—' }
    const owner = entry.objectId ?? entry.id
    const ownerName = index.entries.get(owner)?.name ?? '—'
    const layerName = index.entries.get(entry.layerId)?.name ?? '—'
    return { key: owner, text: `${layerName} · ${ownerName}` }
  }

  const groups = new Map<string, SuggestionGroup>()
  for (const s of suggestions) {
    const from = label(s.source)
    const to = label(s.target)
    const key = `${from.key}>${to.key}`
    const existing = groups.get(key)
    if (existing) existing.suggestions.push(s)
    else
      groups.set(key, {
        key,
        sourceLabel: from.text,
        targetLabel: to.text,
        suggestions: [s],
      })
  }

  return [...groups.values()].sort((a, b) => b.suggestions.length - a.suggestions.length)
}

/**
 * Commits accepted suggestions as Transitions.
 *
 * The confidence is written as a property ON THE TRANSITION, so a later reader
 * can tell a machine-suggested edge from a hand-drawn one and judge how much to
 * trust it. Properties are keyed by entity id and a Transition has an id, so
 * this needs no new storage.
 */
export function applySuggestions(
  model: LineageModel,
  accepted: Suggestion[],
  config: AutoMapConfig,
): LineageModel {
  if (accepted.length === 0) return model

  const existing = new Set(model.transitions.map((t) => `${t.source}>${t.target}`))
  const transitions = [...model.transitions]
  const properties = { ...model.properties }

  for (const s of accepted) {
    const key = `${s.source}>${s.target}`
    if (existing.has(key)) continue
    existing.add(key)
    const id = crypto.randomUUID()
    transitions.push({ id, source: s.source, target: s.target })
    properties[id] = {
      ...properties[id],
      Confidence: String(s.confidence),
      'Mapped by': s.via.join(', '),
      Algorithm: config.algorithm,
    }
  }

  return { ...model, transitions, properties, updatedAt: Date.now() }
}
