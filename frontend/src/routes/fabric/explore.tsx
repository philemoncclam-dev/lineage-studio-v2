// /fabric/explore — the live workspace explorer (M1), master-detail layout.
// Left: a lazy disclosure tree over the read-only /fabric/* REST surface
// (workspaces → folders + notebooks + lakehouses → lakehouse tables); each
// branch fetches its children only when first opened. Right: a detail panel
// that reacts to the selected node — workspace/folder metadata, a notebook's
// decoded code, or a table's columns — with actions to open the item in Fabric
// or send a notebook to the sandbox.
//
// Detail data comes from two read-only endpoints added alongside the tree:
// /notebooks/{id}/source (decoded cells) and /tables/{name}/schema (OneLake
// Delta columns) — see backend/app/fabric/router.py.
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BarsSpinner } from '../../model-app/ui'
import {
  fetchFabricStatus,
  fetchFabricWorkspaces,
  fetchFabricItems,
  fetchFabricTables,
  fetchFabricNotebookSource,
  fetchFabricTableSchema,
  type FabricWorkspace,
  type FabricWorkspaceItems,
  type FabricItem,
  type FabricTable,
  type FabricColumn,
} from '../../api'
import '../../views/fabric.css'

export const Route = createFileRoute('/fabric/explore')({
  component: ExploreRoute,
})

// Fabric portal deep links. The notebook form matches the QN the backend
// parser already relies on (fabric/notebooks.py's _NOTEBOOK_QN).
const FABRIC = 'https://app.fabric.microsoft.com'
const fabricUrl = {
  workspace: (ws: string) => `${FABRIC}/groups/${ws}/list`,
  lakehouse: (ws: string, lh: string) => `${FABRIC}/groups/${ws}/lakehouses/${lh}`,
  notebook: (ws: string, id: string) => `${FABRIC}/groups/${ws}/synapsenotebooks/${id}`,
}

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

// --- selection ------------------------------------------------------------
// A single selected node drives the detail panel. Each variant carries just
// enough to fetch and label its detail; `key` is the highlight identity.
type Selected =
  | { kind: 'workspace'; key: string; ws: FabricWorkspace }
  | { kind: 'folder'; key: string; name: string; workspaceId: string; folderId: string; items: FabricWorkspaceItems }
  | { kind: 'notebook'; key: string; workspaceId: string; notebook: FabricItem }
  | { kind: 'lakehouse'; key: string; workspaceId: string; lakehouse: FabricItem }
  | { kind: 'table'; key: string; workspaceId: string; lakehouse: FabricItem; table: FabricTable }

const SelectionCtx = createContext<{ selectedKey?: string; select: (s: Selected) => void }>({
  select: () => {},
})
const useSelection = () => useContext(SelectionCtx)

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

function OpenInFabric({ href }: { href: string }) {
  return (
    <a
      className="fx-open"
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Open in Fabric"
      aria-label="Open in Fabric"
      onClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6" />
      </svg>
    </a>
  )
}

interface RowProps {
  depth: number
  kind: keyof typeof ICONS
  label: string
  meta?: string
  open?: boolean
  leaf?: boolean
  selected?: boolean
  onPrimary?: () => void
  fabricHref?: string
  hint?: string
}

function Row({ depth, kind, label, meta, open, leaf, selected, onPrimary, fabricHref, hint }: RowProps) {
  return (
    <div className="fx-row" data-open={open} data-selected={selected || undefined}>
      <button
        className="fx-row-main"
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={onPrimary}
        disabled={!onPrimary}
        aria-expanded={leaf ? undefined : !!open}
        title={hint}
      >
        <Chevron hidden={leaf} />
        <Icon kind={kind} />
        <span className="fx-label">{label}</span>
        {meta && <span className="fx-meta">{meta}</span>}
      </button>
      {fabricHref && <OpenInFabric href={fabricHref} />}
    </div>
  )
}

function Note({ state, indent }: { state: Async<unknown>; indent?: number }) {
  if (state.status === 'loading')
    return (
      <div className="fx-note" style={indent ? { paddingLeft: indent } : undefined}>
        <span className="loading-row"><BarsSpinner size={16} />Loading…</span>
      </div>
    )
  if (state.status === 'error') return <div className="fx-note" data-error="true">{state.error}</div>
  return null
}

// --- tree nodes -----------------------------------------------------------

function NotebookRow({ workspaceId, notebook, depth }: { workspaceId: string; notebook: FabricItem; depth: number }) {
  const { select, selectedKey } = useSelection()
  const key = `nb:${notebook.id}`
  return (
    <Row
      depth={depth}
      kind="notebook"
      label={notebook.name}
      leaf
      selected={selectedKey === key}
      hint="Show notebook code"
      onPrimary={() => select({ kind: 'notebook', key, workspaceId, notebook })}
      fabricHref={fabricUrl.notebook(workspaceId, notebook.id)}
    />
  )
}

function LakehouseNode({ workspaceId, lakehouse, depth }: { workspaceId: string; lakehouse: FabricItem; depth: number }) {
  const { select, selectedKey } = useSelection()
  const [open, setOpen] = useState(false)
  const tables = useAsync<FabricTable[]>(() => fetchFabricTables(workspaceId, lakehouse.id), [workspaceId, lakehouse.id, open], open)
  const key = `lh:${lakehouse.id}`
  const lhHref = fabricUrl.lakehouse(workspaceId, lakehouse.id)
  return (
    <>
      <Row
        depth={depth}
        kind="lakehouse"
        label={lakehouse.name}
        open={open}
        selected={selectedKey === key}
        onPrimary={() => {
          select({ kind: 'lakehouse', key, workspaceId, lakehouse })
          setOpen((o) => !o)
        }}
        fabricHref={lhHref}
      />
      {open && (
        <>
          <Note state={tables} indent={8 + (depth + 1) * 18} />
          {tables.status === 'ok' && tables.data!.length === 0 && (
            <div className="fx-note" style={{ paddingLeft: 8 + (depth + 1) * 18 }}>No tables.</div>
          )}
          {tables.status === 'ok' &&
            tables.data!.map((t) => {
              const tKey = `tb:${lakehouse.id}/${t.name}`
              return (
                <Row
                  key={t.name}
                  depth={depth + 1}
                  kind="table"
                  label={t.name}
                  meta={t.format ?? undefined}
                  leaf
                  selected={selectedKey === tKey}
                  hint="Show columns"
                  onPrimary={() => select({ kind: 'table', key: tKey, workspaceId, lakehouse, table: t })}
                  fabricHref={lhHref}
                />
              )
            })}
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
        <NotebookRow key={n.id} workspaceId={workspaceId} notebook={n} depth={depth} />
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
  const { select, selectedKey } = useSelection()
  const [open, setOpen] = useState(false)
  const key = `fd:${folderId}`
  return (
    <>
      <Row
        depth={depth}
        kind="folder"
        label={name}
        open={open}
        selected={selectedKey === key}
        onPrimary={() => {
          select({ kind: 'folder', key, name, workspaceId, folderId, items })
          setOpen((o) => !o)
        }}
      />
      {open && <FolderBranch parentId={folderId} items={items} workspaceId={workspaceId} depth={depth + 1} />}
    </>
  )
}

function WorkspaceNode({ workspace, depth }: { workspace: FabricWorkspace; depth: number }) {
  const { select, selectedKey } = useSelection()
  const [open, setOpen] = useState(false)
  const items = useAsync<FabricWorkspaceItems>(() => fetchFabricItems(workspace.id), [workspace.id, open], open)
  const key = `ws:${workspace.id}`
  const empty =
    items.status === 'ok' &&
    items.data!.notebooks.length === 0 &&
    items.data!.lakehouses.length === 0 &&
    items.data!.folders.length === 0
  return (
    <>
      <Row
        depth={depth}
        kind="workspace"
        label={workspace.name}
        open={open}
        selected={selectedKey === key}
        onPrimary={() => {
          select({ kind: 'workspace', key, ws: workspace })
          setOpen((o) => !o)
        }}
        fabricHref={fabricUrl.workspace(workspace.id)}
      />
      {open && (
        <>
          <Note state={items} indent={8 + (depth + 1) * 18} />
          {empty && <div className="fx-note" style={{ paddingLeft: 8 + (depth + 1) * 18 }}>Empty (or no access to its items).</div>}
          {items.status === 'ok' && (
            <FolderBranch parentId={null} items={items.data!} workspaceId={workspace.id} depth={depth + 1} />
          )}
        </>
      )}
    </>
  )
}

// --- detail panel ---------------------------------------------------------

function DetailAction({
  onClick,
  href,
  primary,
  children,
}: {
  onClick?: () => void
  href?: string
  primary?: boolean
  children: ReactNode
}) {
  const cls = `fx-btn${primary ? ' fx-btn--primary' : ''}`
  if (href)
    return (
      <a className={cls} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  return (
    <button className={cls} onClick={onClick} type="button">
      {children}
    </button>
  )
}

function OpenFabricIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6" />
    </svg>
  )
}

function SandboxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function DetailHeader({
  kind,
  title,
  subtitle,
  fabricHref,
  fabricLabel = 'Open in Fabric',
}: {
  kind: keyof typeof ICONS
  title: string
  subtitle?: string
  fabricHref?: string
  fabricLabel?: string
}) {
  return (
    <div className="fx-detail-head">
      <Icon kind={kind} />
      <div className="fx-detail-titles">
        <h2 className="fx-detail-title">{title}</h2>
        {subtitle && <div className="fx-detail-sub">{subtitle}</div>}
      </div>
      {fabricHref && (
        <a
          className="fx-open fx-open--detail"
          href={fabricHref}
          target="_blank"
          rel="noreferrer"
          title={fabricLabel}
          aria-label={fabricLabel}
        >
          <OpenFabricIcon />
        </a>
      )}
    </div>
  )
}

function KeyVals({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="fx-kv">
      {rows.map(([k, v]) => (
        <div className="fx-kv-row" key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function CodeBlock({ code }: { code: string }) {
  const lines = code.replace(/\n$/, '').split('\n')
  return (
    <div className="fx-code">
      <div className="fx-code-gutter" aria-hidden>
        {lines.map((_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <pre className="fx-code-body">
        <code>{lines.join('\n')}</code>
      </pre>
    </div>
  )
}

function WorkspaceDetail({ sel }: { sel: Extract<Selected, { kind: 'workspace' }> }) {
  const items = useAsync<FabricWorkspaceItems>(() => fetchFabricItems(sel.ws.id), [sel.ws.id])
  return (
    <div className="fx-detail-body">
      <DetailHeader kind="workspace" title={sel.ws.name} subtitle="Workspace" fabricHref={fabricUrl.workspace(sel.ws.id)} />
      {sel.ws.description && <p className="fx-detail-desc">{sel.ws.description}</p>}
      {items.status === 'ok' ? (
        <KeyVals
          rows={[
            ['ID', <code>{sel.ws.id}</code>],
            ['Notebooks', String(items.data!.notebooks.length)],
            ['Lakehouses', String(items.data!.lakehouses.length)],
            ['Folders', String(items.data!.folders.length)],
          ]}
        />
      ) : (
        <Note state={items} />
      )}
    </div>
  )
}

function FolderDetail({ sel }: { sel: Extract<Selected, { kind: 'folder' }> }) {
  const notebooks = sel.items.notebooks.filter((n) => n.folder_id === sel.folderId).length
  const lakehouses = sel.items.lakehouses.filter((l) => l.folder_id === sel.folderId).length
  const subFolders = sel.items.folders.filter((f) => f.parent_id === sel.folderId).length
  return (
    <div className="fx-detail-body">
      <DetailHeader kind="folder" title={sel.name} subtitle="Folder" />
      <KeyVals
        rows={[
          ['Notebooks', String(notebooks)],
          ['Lakehouses', String(lakehouses)],
          ['Subfolders', String(subFolders)],
        ]}
      />
    </div>
  )
}

function NotebookDetail({ sel }: { sel: Extract<Selected, { kind: 'notebook' }> }) {
  const navigate = useNavigate()
  const source = useAsync(
    () => fetchFabricNotebookSource(sel.workspaceId, sel.notebook.id, sel.notebook.name),
    [sel.workspaceId, sel.notebook.id],
  )
  const code = source.status === 'ok' ? source.data!.cells.join('\n\n# ── cell ──\n\n') : ''
  const [copied, setCopied] = useState(false)
  return (
    <div className="fx-detail-body">
      <DetailHeader
        kind="notebook"
        title={sel.notebook.name}
        subtitle="Notebook"
        fabricHref={fabricUrl.notebook(sel.workspaceId, sel.notebook.id)}
      />
      {sel.notebook.description && <p className="fx-detail-desc">{sel.notebook.description}</p>}
      <div className="fx-detail-actions">
        <DetailAction
          primary
          onClick={() =>
            navigate({ to: '/fabric/sandbox', search: { ws: sel.workspaceId, item: sel.notebook.id, name: sel.notebook.name } })
          }
        >
          <SandboxIcon /> Open in sandbox
        </DetailAction>
        {source.status === 'ok' && (
          <DetailAction
            onClick={() => {
              navigator.clipboard?.writeText(code)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? 'Copied' : 'Copy code'}
          </DetailAction>
        )}
      </div>
      {source.status === 'ok' ? (
        source.data!.cells.length ? (
          <CodeBlock code={code} />
        ) : (
          <div className="fx-note">This notebook has no code cells.</div>
        )
      ) : (
        <Note state={source} />
      )}
    </div>
  )
}

function LakehouseDetail({ sel }: { sel: Extract<Selected, { kind: 'lakehouse' }> }) {
  const tables = useAsync<FabricTable[]>(() => fetchFabricTables(sel.workspaceId, sel.lakehouse.id), [sel.workspaceId, sel.lakehouse.id])
  return (
    <div className="fx-detail-body">
      <DetailHeader
        kind="lakehouse"
        title={sel.lakehouse.name}
        subtitle="Lakehouse"
        fabricHref={fabricUrl.lakehouse(sel.workspaceId, sel.lakehouse.id)}
      />
      {sel.lakehouse.description && <p className="fx-detail-desc">{sel.lakehouse.description}</p>}
      {tables.status === 'ok' ? (
        <KeyVals
          rows={[
            ['ID', <code>{sel.lakehouse.id}</code>],
            ['Tables', String(tables.data!.length)],
          ]}
        />
      ) : (
        <Note state={tables} />
      )}
    </div>
  )
}

function TableDetail({ sel }: { sel: Extract<Selected, { kind: 'table' }> }) {
  const schema = useAsync<FabricColumn[]>(
    () => fetchFabricTableSchema(sel.workspaceId, sel.lakehouse.id, sel.table.name),
    [sel.workspaceId, sel.lakehouse.id, sel.table.name],
  )
  return (
    <div className="fx-detail-body">
      <DetailHeader
        kind="table"
        title={sel.table.name}
        subtitle={`Table · ${sel.lakehouse.name}`}
        fabricHref={fabricUrl.lakehouse(sel.workspaceId, sel.lakehouse.id)}
        fabricLabel="Open lakehouse in Fabric"
      />
      {schema.status === 'ok' ? (
        schema.data!.length ? (
          <table className="fx-cols">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {schema.data!.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="fx-cols-type">{c.type ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="fx-note">
            No columns resolved. The table's Delta log couldn't be read (this doesn't mean the table is empty).
          </div>
        )
      ) : (
        <Note state={schema} />
      )}
    </div>
  )
}

function Detail({ sel }: { sel?: Selected }) {
  if (!sel)
    return (
      <div className="fx-detail-empty">
        <Icon kind="workspace" />
        <p>Select a workspace, notebook, lakehouse, or table to see its details.</p>
      </div>
    )
  switch (sel.kind) {
    case 'workspace':
      return <WorkspaceDetail sel={sel} />
    case 'folder':
      return <FolderDetail sel={sel} />
    case 'notebook':
      return <NotebookDetail sel={sel} />
    case 'lakehouse':
      return <LakehouseDetail sel={sel} />
    case 'table':
      return <TableDetail sel={sel} />
  }
}

function ExploreRoute() {
  const status = useAsync(() => fetchFabricStatus(), [])
  const workspaces = useAsync<FabricWorkspace[]>(
    () => fetchFabricWorkspaces(),
    [status.status],
    status.status === 'ok' && !!status.data?.configured,
  )
  const [selected, setSelected] = useState<Selected>()

  const connected = status.status === 'ok' && status.data?.configured

  if (status.status === 'ok' && !status.data?.configured)
    return (
      <div className="fx-page">
        <div className="fx-explorer fx-explorer--single">
          <div className="fx-empty">
            Fabric isn’t connected. Set the Purview service-principal credentials in the backend
            <code> .env</code> to browse live workspaces.
          </div>
        </div>
      </div>
    )

  return (
    <div className="fx-page">
      <SelectionCtx.Provider value={{ selectedKey: selected?.key, select: setSelected }}>
        <div className="fx-explorer">
          <div className="fx-explorer-tree">
            <div className="fx-panel-head">Workspaces</div>
            <div className="fx-tree" role="tree">
              <Note state={status} />
              {connected && <Note state={workspaces} />}
              {connected && workspaces.status === 'ok' && workspaces.data!.length === 0 && (
                <div className="fx-empty">
                  No workspaces visible. The service principal may not have been granted access to any
                  (an empty list here means “no permission”, not “none exist”).
                </div>
              )}
              {connected &&
                workspaces.status === 'ok' &&
                workspaces.data!.map((ws) => <WorkspaceNode key={ws.id} workspace={ws} depth={0} />)}
            </div>
          </div>
          <div className="fx-explorer-detail">
            <Detail sel={selected} />
          </div>
        </div>
      </SelectionCtx.Provider>
    </div>
  )
}
