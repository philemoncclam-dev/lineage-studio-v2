// /fabric/explore — the live workspace explorer (M1). A lazy disclosure tree
// over the read-only /fabric/* REST surface: workspaces → folders + notebooks
// + lakehouses → lakehouse tables. Each branch fetches its children only when
// first opened, so nothing is pulled from Fabric until the user drills in.
//
// Columns stop at tables on purpose: there is no reliable REST endpoint for
// lakehouse table columns, and the accurate schema fetch is the Phase-2
// sandbox work (see .planning/FABRIC-TOOLKIT-PLAN.md).
import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  fetchFabricStatus,
  fetchFabricWorkspaces,
  fetchFabricItems,
  fetchFabricTables,
  type FabricWorkspace,
  type FabricWorkspaceItems,
  type FabricItem,
  type FabricTable,
} from '../../api'
import '../../views/fabric.css'

export const Route = createFileRoute('/fabric/explore')({
  component: ExploreRoute,
})

// Tiny async-state helper — the tree has many independent lazy fetches and
// each wants its own loading/error/data lifecycle.
type Async<T> = { status: 'loading' | 'error' | 'ok'; data?: T; error?: string }

function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): Async<T> {
  const [state, setState] = useState<Async<T>>({ status: 'loading' })
  useEffect(() => {
    if (!enabled) return
    let alive = true
    setState({ status: 'loading' })
    fn()
      .then((data) => alive && setState({ status: 'ok', data }))
      .catch((e: unknown) => alive && setState({ status: 'error', error: String(e instanceof Error ? e.message : e) }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

function Chevron({ hidden }: { hidden?: boolean }) {
  return (
    <svg className={`fx-chevron${hidden ? ' fx-hidden' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

const ICONS = {
  workspace: <path d="M3.5 7.5 12 3l8.5 4.5L12 12z M3.5 7.5V16l8.5 4.5V12M20.5 7.5V16L12 20.5" />,
  folder: <path d="M4 6h5l2 2h9v10H4z" />,
  notebook: <path d="M6 3h9l4 4v14H6z M15 3v4h4M9 12h6M9 16h6" />,
  lakehouse: <path d="M4 7c0-1.5 3.6-2.5 8-2.5S20 5.5 20 7v10c0 1.5-3.6 2.5-8 2.5S4 18.5 4 17zM4 7c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5" />,
  table: <path d="M4 5h16v14H4z M4 10h16M4 15h16M10 5v14" />,
}

function Icon({ kind }: { kind: keyof typeof ICONS }) {
  return (
    <svg className="fx-icon" data-kind={kind} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      {ICONS[kind]}
    </svg>
  )
}

interface RowProps {
  depth: number
  kind: keyof typeof ICONS
  label: string
  meta?: string
  open?: boolean
  leaf?: boolean
  onToggle?: () => void
}

function Row({ depth, kind, label, meta, open, leaf, onToggle }: RowProps) {
  return (
    <button
      className="fx-row"
      data-open={open}
      data-leaf={leaf}
      style={{ paddingLeft: 8 + depth * 18 }}
      onClick={leaf ? undefined : onToggle}
      aria-expanded={leaf ? undefined : !!open}
    >
      <Chevron hidden={leaf} />
      <Icon kind={kind} />
      <span className="fx-label">{label}</span>
      {meta && <span className="fx-meta">{meta}</span>}
    </button>
  )
}

function Note({ state }: { state: Async<unknown> }) {
  if (state.status === 'loading') return <div className="fx-note">Loading…</div>
  if (state.status === 'error') return <div className="fx-note" data-error="true">{state.error}</div>
  return null
}

function LakehouseNode({ workspaceId, lakehouse, depth }: { workspaceId: string; lakehouse: FabricItem; depth: number }) {
  const [open, setOpen] = useState(false)
  const tables = useAsync<FabricTable[]>(() => fetchFabricTables(workspaceId, lakehouse.id), [workspaceId, lakehouse.id, open], open)
  return (
    <>
      <Row depth={depth} kind="lakehouse" label={lakehouse.name} open={open} onToggle={() => setOpen((o) => !o)} />
      {open && (
        <>
          <Note state={tables} />
          {tables.status === 'ok' && tables.data!.length === 0 && (
            <div className="fx-note" style={{ paddingLeft: 8 + (depth + 1) * 18 }}>No tables.</div>
          )}
          {tables.status === 'ok' &&
            tables.data!.map((t) => (
              <Row key={t.name} depth={depth + 1} kind="table" label={t.name} meta={t.format ?? undefined} leaf />
            ))}
        </>
      )}
    </>
  )
}

function FolderBranch({
  parentId,
  items,
  workspaceId,
  depth,
}: {
  parentId: string | null
  items: FabricWorkspaceItems
  workspaceId: string
  depth: number
}) {
  const subFolders = items.folders.filter((f) => f.parent_id === parentId)
  const notebooks = items.notebooks.filter((n) => n.folder_id === parentId)
  const lakehouses = items.lakehouses.filter((l) => l.folder_id === parentId)
  return (
    <>
      {subFolders.map((f) => (
        <FolderNode key={f.id} folderId={f.id} name={f.name} items={items} workspaceId={workspaceId} depth={depth} />
      ))}
      {lakehouses.map((l) => (
        <LakehouseNode key={l.id} workspaceId={workspaceId} lakehouse={l} depth={depth} />
      ))}
      {notebooks.map((n) => (
        <Row key={n.id} depth={depth} kind="notebook" label={n.name} leaf />
      ))}
    </>
  )
}

function FolderNode({
  folderId,
  name,
  items,
  workspaceId,
  depth,
}: {
  folderId: string
  name: string
  items: FabricWorkspaceItems
  workspaceId: string
  depth: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Row depth={depth} kind="folder" label={name} open={open} onToggle={() => setOpen((o) => !o)} />
      {open && <FolderBranch parentId={folderId} items={items} workspaceId={workspaceId} depth={depth + 1} />}
    </>
  )
}

function WorkspaceNode({ workspace, depth }: { workspace: FabricWorkspace; depth: number }) {
  const [open, setOpen] = useState(false)
  const items = useAsync<FabricWorkspaceItems>(() => fetchFabricItems(workspace.id), [workspace.id, open], open)
  const empty =
    items.status === 'ok' &&
    items.data!.notebooks.length === 0 &&
    items.data!.lakehouses.length === 0 &&
    items.data!.folders.length === 0
  return (
    <>
      <Row depth={depth} kind="workspace" label={workspace.name} open={open} onToggle={() => setOpen((o) => !o)} />
      {open && (
        <>
          <Note state={items} />
          {empty && <div className="fx-note" style={{ paddingLeft: 8 + (depth + 1) * 18 }}>Empty (or no access to its items).</div>}
          {items.status === 'ok' && (
            <FolderBranch parentId={null} items={items.data!} workspaceId={workspace.id} depth={depth + 1} />
          )}
        </>
      )}
    </>
  )
}

function ExploreRoute() {
  const status = useAsync(() => fetchFabricStatus(), [])
  const workspaces = useAsync<FabricWorkspace[]>(
    () => fetchFabricWorkspaces(),
    [status.status],
    status.status === 'ok' && !!status.data?.configured,
  )

  return (
    <div className="purview-page">
      <h1 className="page-title">Explore workspace</h1>
      <p className="page-lead">
        Browse the live shape of your Fabric workspaces — folders, notebooks, lakehouses, and tables.
      </p>

      {status.status === 'ok' && !status.data?.configured && (
        <div className="fx-empty">
          Fabric isn’t connected. Set the Purview service-principal credentials in the backend
          <code> .env</code> to browse live workspaces.
        </div>
      )}

      {status.status === 'ok' && status.data?.configured && (
        <div className="fx-tree" role="tree">
          <Note state={workspaces} />
          {workspaces.status === 'ok' && workspaces.data!.length === 0 && (
            <div className="fx-empty">
              No workspaces visible. The service principal may not have been granted access to any
              (an empty list here means “no permission”, not “none exist”).
            </div>
          )}
          {workspaces.status === 'ok' &&
            workspaces.data!.map((ws) => <WorkspaceNode key={ws.id} workspace={ws} depth={0} />)}
        </div>
      )}

      <Note state={status} />
    </div>
  )
}
