// Thin banner shown across the top of the canvas when the graph/lineage views
// are rendering an authored-model snapshot ("Open in graph view") rather than
// the live backend graph. Clearing it removes the stash and reloads, so the
// backend graph (or sample) comes back.
import { clearGraphStash } from '../graphStash'

export default function GraphSnapshotBanner({ label }: { label: string }) {
  return (
    <div className="graph-snapshot-banner" role="status">
      <span className="graph-snapshot-dot" aria-hidden />
      <span>
        Showing model snapshot: <strong>{label}</strong>
      </span>
      <button
        type="button"
        className="graph-snapshot-clear"
        onClick={() => {
          clearGraphStash()
          window.location.reload()
        }}
      >
        Back to live graph
      </button>
    </div>
  )
}
