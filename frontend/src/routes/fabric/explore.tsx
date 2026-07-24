// /fabric/explore — the workspace explorer (M1). Placeholder shell this
// commit: the live workspace → folder → notebook/lakehouse → table → column
// tree lands next, backed by the new /fabric/* REST endpoints.
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/fabric/explore')({
  component: ExploreRoute,
})

function ExploreRoute() {
  return (
    <div className="purview-page">
      <h1 className="page-title">Explore workspace</h1>
      <p className="page-lead">
        Browse the live shape of a Fabric workspace — folders, notebooks,
        lakehouses, tables, and columns. Coming next.
      </p>
    </div>
  )
}
