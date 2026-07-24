// A session-scoped override of the graph the host views render. The modelling
// tab writes an authored model here (as a LineageGraph); the root loader
// (routes/__root.tsx) prefers it over the backend /graph fetch, so "Open in
// graph view" shows the authored model in the graph/lineage modes. Cleared by
// the snapshot banner (shell/GraphSnapshotBanner.tsx) to fall back to the
// backend graph again.
//
// sessionStorage, not localStorage: an exported snapshot is a "look at this
// now" action, not a persistent replacement of the live estate — it should not
// silently outlive the browser session.
import type { LineageGraph } from './api'

const KEY = 'lineage-studio:graph-stash:v1'

export interface GraphStash {
  graph: LineageGraph
  /** Model name, for the "showing <name>" banner. */
  label: string
  savedAt: number
}

export function saveGraphStash(graph: LineageGraph, label: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ graph, label, savedAt: Date.now() } satisfies GraphStash))
  } catch {
    // storage full/disabled — the caller still navigates; the loader just
    // falls back to the backend graph.
  }
}

export function readGraphStash(): GraphStash | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GraphStash
    if (!parsed?.graph || !Array.isArray(parsed.graph.nodes)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearGraphStash(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
