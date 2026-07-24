// HOST INTEGRATION bridge between the vendored editor (pages/EditorPage.tsx)
// and the host shell's shared mode rail (src/shell/ModelEditorRail.tsx).
//
// The editor's own activity-rail is hidden by CSS; instead it publishes its
// rail state here and executes actions sent back from the host rail. Plain
// module-level pub/sub — the two react trees share a bundle, so no
// window events or serialization needed.

export type ModelRailAction =
  | 'home'
  | 'overview'
  | 'history'
  | 'search'
  | 'details'
  | 'filter'
  | 'tags'
  | 'validate'
  | 'add'
  | 'map'
  | 'tidy'
  | 'import'
  | 'export'
  | 'undo'
  | 'redo'
  | 'settings'

export interface ModelRailState {
  panel: 'search' | 'details' | 'filter' | 'tags' | 'validation' | null
  filterActive: boolean
  addMenuOpen: boolean
  canUndo: boolean
  canRedo: boolean
  validationCount: number
  /** Cloud-only History entry (hidden for local models, like the original rail). */
  showHistory: boolean
}

/** null = no editor mounted (e.g. the /model home page). */
let state: ModelRailState | null = null
const stateListeners = new Set<(s: ModelRailState | null) => void>()
const actionListeners = new Set<(a: ModelRailAction) => void>()

export function publishModelRailState(next: ModelRailState | null): void {
  state = next
  for (const fn of stateListeners) fn(state)
}

export function getModelRailState(): ModelRailState | null {
  return state
}

export function subscribeModelRailState(fn: (s: ModelRailState | null) => void): () => void {
  stateListeners.add(fn)
  return () => stateListeners.delete(fn)
}

export function sendModelRailAction(action: ModelRailAction): void {
  for (const fn of actionListeners) fn(action)
}

export function subscribeModelRailActions(fn: (a: ModelRailAction) => void): () => void {
  actionListeners.add(fn)
  return () => actionListeners.delete(fn)
}
