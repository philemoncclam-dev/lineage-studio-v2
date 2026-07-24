// /fabric/sandbox — the notebook sandbox. A notebook selected in Explore
// arrives via ?ws/?item/?name; the Run button executes it through the isolated
// backend harness (scrubbed env, no Fabric creds, no real writes).
//
// M2a returns a stub (static-analysis) result; M2b swaps in real local-Spark
// execution behind the same shape, so this view doesn't change when it lands.
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { runSandbox, type SandboxRunResult } from '../../api'
import { adapt } from '../../model'
import { graphToModel } from '../../model/graphToModel'
import { sandboxRunToGraph } from '../../model/sandboxToGraph'
import { saveNew } from '../../model-app/localdb'
import '../../views/fabric.css'

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

type RunState = { status: 'idle' | 'running' | 'done' | 'error'; result?: SandboxRunResult; error?: string }

function SandboxRoute() {
  const { ws, item, name } = Route.useSearch()
  const [run, setRun] = useState<RunState>({ status: 'idle' })

  const canRun = !!(ws && item)

  const onRun = async () => {
    setRun({ status: 'running' })
    try {
      const result = await runSandbox({ name, workspace_id: ws, item_id: item })
      setRun({ status: 'done', result })
    } catch (e) {
      setRun({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="purview-page">
      <h1 className="page-title">Notebook sandbox</h1>

      {!name && (
        <p className="page-lead">
          Pick a notebook from <strong>Explore workspace</strong> to send it here. Notebooks run in
          an isolated local sandbox — never against real Fabric.
        </p>
      )}

      {name && (
        <>
          <p className="page-lead">
            <strong>{name}</strong> is queued. Running executes it in an isolated subprocess with no
            Fabric credentials and no writes to real Fabric.
          </p>

          <div className="sbx-actions">
            <button className="sbx-run" onClick={onRun} disabled={!canRun || run.status === 'running'}>
              {run.status === 'running' ? 'Running…' : 'Run in sandbox'}
            </button>
            {!canRun && <span className="fx-note">Missing workspace/item — reopen it from Explore.</span>}
          </div>

          {run.status === 'error' && <div className="fx-note" data-error="true">{run.error}</div>}

          {run.status === 'done' && run.result && <RunReport result={run.result} notebookName={name!} />}
        </>
      )}
    </div>
  )
}

function RunReport({ result, notebookName }: { result: SandboxRunResult; notebookName: string }) {
  // Assemble a 4-layer authored model from what the run touched, reusing the
  // exact graph → model path the graph view's "create model" button uses.
  const createModel = () => {
    const graph = sandboxRunToGraph(result, notebookName)
    const draft = graphToModel(adapt(graph))
    const saved = saveNew({ name: `${notebookName} — model`, nodes: draft.nodes, edges: draft.edges, tags: [] })
    window.location.assign(`/model/models/${saved.id}`)
  }

  const hasFlow = result.reads.length > 0 || result.writes.length > 0

  return (
    <div className="sbx-report">
      <div className="sbx-safety" data-breach={result.saw_credentials}>
        {result.saw_credentials
          ? '⚠ Isolation breach: credentials were visible to the sandbox.'
          : `✓ Ran isolated — no Fabric credentials reachable · engine: ${result.engine}`}
      </div>

      {!result.ok && <div className="fx-note" data-error="true">{result.error}</div>}

      {result.ok && hasFlow && (
        <div className="sbx-actions">
          <button className="sbx-run" onClick={createModel} title="Build a 4-layer authored model from this run">
            Create model from this run →
          </button>
          <span className="fx-note">Assembles the notebook + its read/write tables as an editable model.</span>
        </div>
      )}

      <div className="sbx-io">
        <div>
          <span className="sbx-io-label">Reads</span>
          {result.reads.length ? result.reads.map((r) => <code key={r} className="sbx-chip">{r}</code>) : <span className="fx-note">none</span>}
        </div>
        <div>
          <span className="sbx-io-label">Writes</span>
          {result.writes.length ? result.writes.map((w) => <code key={w} className="sbx-chip sbx-write">{w}</code>) : <span className="fx-note">none</span>}
        </div>
      </div>

      <div className="sbx-log">
        {result.log.map((line, i) => (
          <div key={i} className="sbx-log-line">{line}</div>
        ))}
      </div>
    </div>
  )
}
