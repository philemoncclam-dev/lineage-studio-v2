// Excel export of the overview dashboard. Leading `-` keeps it out of the
// generated route tree.
//
// The export is a snapshot of what is *currently on screen*, so the active
// workspace filter has to travel with it — a spreadsheet of counts is
// misleading if the reader can't tell whether it covers the whole tenant or one
// workspace. The scope is therefore recorded three times: in the Summary
// sheet's header rows, and in the filename.
//
// SheetJS is heavy, so it is dynamically imported only when an export runs —
// same convention as model-app/exportXlsx.ts.
import type { Counts, WorkspaceRow } from './-assetTypes'

export interface OverviewSnapshot {
  counts: Counts
  rows: WorkspaceRow[]
  /** Names of the filtered-to workspaces; empty means the whole tenant. */
  scope: string[]
  /** Epoch ms of the catalog sync these numbers came from. */
  syncedAt: number | null
}

const SHEET_ROWS = [
  ['Data assets', (c: Counts) => c.data],
  ['— lakehouse tables', (c: Counts) => c.table],
  ['— lakehouses & warehouses', (c: Counts) => c.store],
  ['— reports & semantic models', (c: Counts) => c.bi],
  ['Notebooks', (c: Counts) => c.notebook],
  ['Pipelines', (c: Counts) => c.pipeline],
  ['Other items', (c: Counts) => c.other],
  ['Total items', (c: Counts) => c.total],
] as const

/** Human-readable description of the active filter, reused by the UI. */
export function scopeLabel(scope: string[]): string {
  if (scope.length === 0) return 'All workspaces'
  if (scope.length <= 3) return scope.join(', ')
  return `${scope.length} workspaces`
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function downloadOverviewXlsx(snap: OverviewSnapshot): Promise<void> {
  const XLSX = await import('xlsx')

  const filtered = snap.scope.length > 0
  const summary: (string | number)[][] = [
    ['Fabric workspace overview'],
    ['Scope', filtered ? 'Filtered' : 'All workspaces'],
    ['Workspaces', filtered ? snap.scope.join(', ') : 'All visible workspaces'],
    ['Catalog synced', snap.syncedAt ? new Date(snap.syncedAt).toLocaleString() : 'unknown'],
    ['Exported', new Date().toLocaleString()],
    [],
    ['Metric', 'Count'],
    ...SHEET_ROWS.map(([label, get]) => [label, get(snap.counts)]),
  ]
  const summaryWs = XLSX.utils.aoa_to_sheet(summary)
  summaryWs['!cols'] = [{ wch: 30 }, { wch: 40 }]

  const byWorkspace: (string | number)[][] = [
    ['Workspace', 'Data assets', 'Tables', 'Stores', 'Reports & models', 'Notebooks', 'Pipelines', 'Other', 'Total'],
    ...snap.rows.map((r) => [r.name, r.data, r.table, r.store, r.bi, r.notebook, r.pipeline, r.other, r.total]),
  ]
  const rowsWs = XLSX.utils.aoa_to_sheet(byWorkspace)
  rowsWs['!cols'] = [{ wch: 32 }, ...Array(8).fill({ wch: 14 })]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary')
  XLSX.utils.book_append_sheet(wb, rowsWs, 'By workspace')

  // Filename carries the scope so a downloaded file is self-describing even
  // once it's detached from the page that produced it.
  const scopePart = filtered
    ? snap.scope.length === 1
      ? safeName(snap.scope[0])
      : `${snap.scope.length}-workspaces`
    : 'all-workspaces'
  const day = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `fabric-overview_${scopePart || 'filtered'}_${day}.xlsx`)
}
