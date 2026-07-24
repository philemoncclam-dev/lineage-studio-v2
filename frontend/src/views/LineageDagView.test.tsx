// Smoke tests for LineageDagView (03-07's integration): toolbar toggle +
// freshness, the role=group canvas accessible name + sr-only edge list
// (DAG-08), the empty-state fallback (no xyflow canvas mounted), and the
// Table<->Column toggle's useUpdateNodeInternals re-measure wiring
// (RESEARCH.md Pitfall 2).
//
// Mounted through the REAL '../routes/__root' route object, mirroring
// src/routes/__tests__/rootPending.test.tsx's pattern — LineageDagView calls
// `RootRoute.useLoaderData()` bound to that exact module-level singleton, and
// TanStack Router's useLoaderData only resolves for a route object that is
// actually part of the rendered router's tree (confirmed empirically: a
// same-id-but-different-instance root route does NOT satisfy it, so a fresh
// standalone test router cannot be substituted here). `sampleModel`/`adapt`
// are mocked so the real RootComponent's `graph ? adapt(graph) : sampleModel()`
// resolves to this file's small controlled fixture either way, while
// `fetchGraph` resolves truthy so the loader's `fetchedAt` is a real
// timestamp (TRUST-03's "Refreshed ... ago" path).
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NB, Table } from '../data'
import type { AppModel } from '../model'
import LineageDagView from './LineageDagView'

const updateNodeInternalsSpy = vi.fn()

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')
  return { ...actual, useUpdateNodeInternals: () => updateNodeInternalsSpy }
})

// Small fixture graph mirroring 03-06's useLineageKeyboardNav.test.ts shape:
// two bronze tables (raw, cust) feeding one silver table (clean) through a
// notebook (nb) — enough structure to exercise counts/sr-only text without
// pulling in the full bundled sample model.
const rawOrders: Table = {
  id: 'raw',
  name: 'raw_orders',
  layer: 'bronze',
  c: 'bronze',
  x: 0,
  y: 0,
  columns: [{ key: 'raw.order_id', name: 'order_id', type: 'long' }],
}
const cleanOrders: Table = {
  id: 'clean',
  name: 'orders_clean',
  layer: 'silver',
  c: 'silver',
  x: 0,
  y: 0,
  columns: [{ key: 'clean.order_id', name: 'order_id', type: 'long' }],
}
const nb: NB = { id: 'nb', name: 'clean_orders', x: 0, y: 0 }

function fixtureModel(overrides: Partial<AppModel> = {}): AppModel {
  return {
    source: 'live',
    tables: [rawOrders, cleanOrders],
    notebooks: [nb],
    colEdges: [['raw.order_id', 'clean.order_id']],
    ops: [
      ['raw', 'nb', 'reads'],
      ['nb', 'clean', 'writes'],
    ],
    xform: {},
    evidence: {},
    levels: {},
    levelTable: {},
    notebookCode: {},
    context: {},
    ...overrides,
  }
}

let currentFixture: AppModel = fixtureModel()

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    // Truthy resolution -> the root loader's `graph ? Date.now() : null`
    // branch sets a real fetchedAt (adapt() below ignores the payload).
    fetchGraph: () => Promise.resolve({ nodes: [], edges: [] } as unknown as ReturnType<typeof actual.fetchGraph>),
    fetchPurviewStatus: () => Promise.resolve({ configured: false, write_enabled: false }),
  }
})

vi.mock('../model', async () => {
  const actual = await vi.importActual<typeof import('../model')>('../model')
  return { ...actual, adapt: () => currentFixture, sampleModel: () => currentFixture }
})

async function renderView(model: AppModel) {
  currentFixture = model
  const { Route: RootRoute } = await import('../routes/__root')
  const indexRoute = createRoute({
    getParentRoute: () => RootRoute,
    path: '/',
    component: LineageDagView,
  })
  const routeTree = RootRoute.addChildren([indexRoute])
  const router = createRouter({
    routeTree,
    context: { graph: null, fetchedAt: null, snapshotLabel: null },
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  })
  await router.load()
  return render(<RouterProvider router={router} />)
}

describe('LineageDagView', () => {
  beforeEach(() => {
    updateNodeInternalsSpy.mockClear()
  })

  it('renders the lineage-toolbar with a Table/Column toggle defaulting to Column, and a FreshnessIndicator', async () => {
    await renderView(fixtureModel())

    const columnBtn = await screen.findByRole('button', { name: 'Show column-level detail' })
    const tableBtn = screen.getByRole('button', { name: 'Show table-level detail' })
    expect(columnBtn.className).toContain('on')
    expect(tableBtn.className).not.toContain('on')

    // "Refreshed {relative}" — relative may render as "now" for a
    // sub-second-old timestamp (Intl.RelativeTimeFormat's numeric:'auto'
    // special-cases zero), so only the stable "Refreshed" prefix is
    // asserted here; FreshnessIndicator.test.tsx already covers the exact
    // relative-time wording at the unit level.
    expect(screen.getByText(/^Refreshed /)).toBeInTheDocument()
  })

  it('renders a role=group canvas with an accessible name reporting counts, and an sr-only entry per edge (DAG-08)', async () => {
    const model = fixtureModel()
    await renderView(model)

    const canvas = await screen.findByRole('group', { name: /Lineage graph: 2 tables, 1 notebooks, 3 connections/ })
    expect(canvas).toBeInTheDocument()

    const items = canvas.querySelectorAll('ul.sr-only li')
    expect(items).toHaveLength(model.colEdges.length)
    expect(items[0].textContent).toBe('raw_orders.order_id → orders_clean.order_id, derives, inferred via clean_orders')
  })

  it('hovering a column previews the trace: sel on the anchor, hot on the traced peer, dim on unrelated cards/edges (DAG-03/DAG-04/D-05/D-06)', async () => {
    await renderView(fixtureModel())
    await screen.findByRole('group', { name: /Lineage graph:/ })

    const rawRow = document.querySelector('[data-col="raw.order_id"]') as HTMLElement
    const cleanRow = document.querySelector('[data-col="clean.order_id"]') as HTMLElement
    expect(rawRow).toBeTruthy()
    expect(cleanRow).toBeTruthy()

    fireEvent.mouseEnter(rawRow)

    // Anchor (hovered) column: 'sel', never 'dim'/'hot'.
    expect(rawRow.className).toContain('sel')
    expect(rawRow.className).not.toContain('dim')
    // Traced peer (the other end of the derives edge), not the anchor: 'hot'.
    expect(cleanRow.className).toContain('hot')
    expect(cleanRow.className).not.toContain('sel')
    // The notebook owns no columns, so it is never part of a column trace —
    // its whole card dims as an unrelated unit while the trace is active.
    const nbCard = document.querySelector('[data-node="nb"]')?.closest('.ls-node') as HTMLElement
    expect(nbCard.className).toContain('dim')
    // Note: xyflow only renders <path> elements for edges whose endpoint
    // nodes have been measured (via ResizeObserver), which jsdom's no-op
    // mock (test/setup.ts) never fires — so .react-flow__edges stays empty
    // under this harness (same constraint LineageEdge.test.tsx works around
    // by testing the edge component in isolation, not through a full
    // <ReactFlow> mount). The edges[].data.traced 'on'/'dim' wiring itself
    // is exercised directly in LineageDagView's edges useMemo and rendered
    // by LineageEdge.test.tsx's lineageEdgeClass cases.

    fireEvent.mouseLeave(rawRow)
    // Hover ends -> no persisted selection in this fixture -> trace clears.
    expect(rawRow.className).not.toContain('sel')
    expect(cleanRow.className).not.toContain('hot')
  })

  it('renders the empty state and mounts no xyflow canvas when tables and notebooks are both empty', async () => {
    await renderView(fixtureModel({ tables: [], notebooks: [], colEdges: [], ops: [] }))

    expect(await screen.findByText('No lineage to show yet')).toBeInTheDocument()
    expect(
      screen.getByText('Upload notebook code or connect a workspace to see column-level lineage here.'),
    ).toBeInTheDocument()
    expect(document.querySelector('.react-flow')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Lineage graph:/ })).not.toBeInTheDocument()
  })

  it('toggling to Table calls useUpdateNodeInternals for every table node (handle re-measure, RESEARCH Pitfall 2)', async () => {
    await renderView(fixtureModel())
    await screen.findByRole('button', { name: 'Show table-level detail' })

    updateNodeInternalsSpy.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Show table-level detail' }))

    expect(updateNodeInternalsSpy).toHaveBeenCalledWith('raw')
    expect(updateNodeInternalsSpy).toHaveBeenCalledWith('clean')
  })
})
