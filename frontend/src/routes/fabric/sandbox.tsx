// /fabric/sandbox — the notebook sandbox (M2+). A notebook selected in Explore
// arrives here via ?ws/?item/?name. The harness that actually runs it locally
// against empty temp views with the real Fabric schema — never touching real
// Fabric — lands in later milestones; for now this confirms what was queued.
import { createFileRoute } from '@tanstack/react-router'

interface SandboxSearch {
  ws?: string
  item?: string
  name?: string
}

export const Route = createFileRoute('/fabric/sandbox')({
  validateSearch: (s: Record<string, unknown>): SandboxSearch => ({
    ws: typeof s.ws === 'string' ? s.ws : undefined,
    item: typeof s.item === 'string' ? s.item : undefined,
    name: typeof s.name === 'string' ? s.name : undefined,
  }),
  component: SandboxRoute,
})

function SandboxRoute() {
  const { name, item } = Route.useSearch()
  return (
    <div className="purview-page">
      <h1 className="page-title">Notebook sandbox</h1>
      {name ? (
        <>
          <p className="page-lead">
            Queued <strong>{name}</strong> for a sandbox run.
          </p>
          <p className="page-lead" style={{ opacity: 0.7 }}>
            Running notebooks locally — executed against empty temp views with the real Fabric
            schema, never against real Fabric — is coming next. (item&nbsp;<code>{item}</code>)
          </p>
        </>
      ) : (
        <p className="page-lead">
          Pick a notebook from <strong>Explore workspace</strong> to send it here. Notebooks run in a
          safe local sandbox, never against real Fabric. Coming soon.
        </p>
      )}
    </div>
  )
}
