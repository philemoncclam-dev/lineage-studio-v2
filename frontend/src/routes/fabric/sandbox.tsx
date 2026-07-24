// /fabric/sandbox — the notebook sandbox (M2+). Placeholder shell this commit:
// runs a notebook's PySpark/Spark SQL locally against empty temp views with
// the real Fabric schema, never touching real Fabric, and derives lineage
// from the run. Harness + execution land in later milestones.
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/fabric/sandbox')({
  component: SandboxRoute,
})

function SandboxRoute() {
  return (
    <div className="purview-page">
      <h1 className="page-title">Notebook sandbox</h1>
      <p className="page-lead">
        Run a notebook to see what it does — executed locally in a safe
        sandbox, never against real Fabric. Coming soon.
      </p>
    </div>
  )
}
