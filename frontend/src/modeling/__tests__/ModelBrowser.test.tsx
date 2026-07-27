// Wiring test for the Model Browser: it mounts the real component against the
// real (localStorage-backed) store inside a memory router, so it covers the
// parts the pure browser.ts tests cannot — that the store calls, the filter
// state, and the modal flows are actually connected to each other.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import ModelBrowser from '../ModelBrowser'
import { localStore } from '../../model/store'

function renderBrowser() {
  const rootRoute = createRootRoute({ component: Outlet })
  const modelsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/models',
    component: ModelBrowser,
  })
  // The viewer is stubbed — this test is about the browser, and mounting the
  // real ModelViewer here would pull in xyflow for no added coverage.
  const viewerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/model/$modelId',
    component: () => <div>viewer</div>,
  })

  // The header's mode toggle links here; the route has to exist or the Link
  // cannot resolve an href.
  const fabricRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/fabric/overview',
    component: () => <div>fabric</div>,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([modelsRoute, viewerRoute, fabricRoute]),
    history: createMemoryHistory({ initialEntries: ['/models'] }),
  })

  const { container } = render(<RouterProvider router={router as never} />)
  return Object.assign(router, { container })
}

async function seeded(names: string[]) {
  for (const name of names) await localStore.create(name)
}

// "Create" is both a top-bar button and a dialog submit, so queries are scoped
// to the region they mean rather than searching the whole screen.
const list = () => within(screen.getByRole('list', { name: 'Models' }))
const dialog = () => within(screen.getByRole('dialog'))

// A string `name` is matched against the WHOLE accessible name, so
// 'Mortgage lineage' does not also match 'Mortgage lineage (copy)'.
const findInList = (name: string) => waitFor(() => list().getByRole('button', { name }))

const notInList = (name: string) =>
  waitFor(() => expect(list().queryByRole('button', { name })).not.toBeInTheDocument())

beforeEach(() => {
  localStorage.clear()
})

describe('ModelBrowser', () => {
  it('lists the models in the store', async () => {
    await seeded(['Mortgage lineage', 'Payments'])
    renderBrowser()

    await findInList('Mortgage lineage')
    expect(list().getByRole('button', { name: 'Payments' })).toBeInTheDocument()
    expect(screen.getByText('2 models')).toBeInTheDocument()
  })

  it('offers to create the first model when the library is empty', async () => {
    renderBrowser()
    expect(await screen.findByText('No models yet.')).toBeInTheDocument()
  })

  it('filters by the search box and can be cleared', async () => {
    const user = userEvent.setup()
    await seeded(['Mortgage lineage', 'Payments'])
    renderBrowser()
    await findInList('Mortgage lineage')

    await user.type(screen.getByLabelText('Search models'), 'pay')

    await notInList('Mortgage lineage')
    expect(list().getByRole('button', { name: 'Payments' })).toBeInTheDocument()
    expect(screen.getByText(/Showing 1 of 2/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all 2' }))
    await findInList('Mortgage lineage')
  })

  it('stars a model and persists it to the store', async () => {
    const user = userEvent.setup()
    await seeded(['Mortgage lineage'])
    renderBrowser()

    await user.click(await screen.findByRole('button', { name: 'Star Mortgage lineage' }))

    await waitFor(async () => {
      expect((await localStore.list())[0].starred).toBe(true)
    })
    expect(
      await screen.findByRole('button', { name: 'Unstar Mortgage lineage' }),
    ).toBeInTheDocument()
  })

  it('offers a way through to the Fabric Toolkit', async () => {
    await seeded(['Mortgage lineage'])
    renderBrowser()
    const link = await screen.findByRole('link', { name: 'Fabric Toolkit' })
    expect(link).toHaveAttribute('href', '/fabric/overview')
  })

  it('creates a model and navigates straight into it', async () => {
    const user = userEvent.setup()
    const router = renderBrowser()
    await screen.findByText('No models yet.')

    await user.click(screen.getByRole('button', { name: 'Create your first model' }))
    await user.type(await screen.findByLabelText('Name'), 'Brand new')
    await user.click(dialog().getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/model\//))
    const stored = await localStore.list()
    expect(stored.map((m) => m.name)).toEqual(['Brand new'])
  })

  it('opens a model by clicking its name, and records the view', async () => {
    const user = userEvent.setup()
    await seeded(['Mortgage lineage'])
    const [row] = await localStore.list()
    const router = renderBrowser()

    await user.click(await findInList('Mortgage lineage'))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/model/${row.id}`))
    expect((await localStore.list())[0].lastViewedAt).toBeGreaterThanOrEqual(row.lastViewedAt)
  })

  it('deletes a model only after the confirmation', async () => {
    const user = userEvent.setup()
    await seeded(['Doomed'])
    renderBrowser()

    await user.click(await screen.findByRole('button', { name: 'Actions for Doomed' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    // Still there while the dialog is open.
    expect(await localStore.list()).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Delete model' }))

    await waitFor(async () => expect(await localStore.list()).toHaveLength(0))
    expect(await screen.findByText('No models yet.')).toBeInTheDocument()
  })

  it('duplicates a model from the row menu', async () => {
    const user = userEvent.setup()
    await seeded(['Mortgage lineage'])
    renderBrowser()

    await user.click(await screen.findByRole('button', { name: 'Actions for Mortgage lineage' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))

    await waitFor(async () => expect(await localStore.list()).toHaveLength(2))
    await findInList('Mortgage lineage (copy)')
  })

  it('tags a model, then filters by clicking that tag on the row', async () => {
    const user = userEvent.setup()
    await seeded(['Mortgage lineage', 'Payments'])
    renderBrowser()

    await user.click(await screen.findByRole('button', { name: 'Actions for Mortgage lineage' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit tags…' }))
    await user.type(await screen.findByLabelText('Add a tag'), 'Logical{Enter}')
    await user.click(dialog().getByRole('button', { name: 'Save' }))

    // With the sidebar gone, the tag chip on the row is the filter affordance.
    await user.click(await findInList('Logical'))

    await notInList('Payments')
    expect(list().getByRole('button', { name: 'Mortgage lineage' })).toBeInTheDocument()
  })

  it('bulk-deletes the checked models', async () => {
    const user = userEvent.setup()
    await seeded(['A', 'B', 'C'])
    renderBrowser()

    await user.click(await screen.findByLabelText('Select A'))
    await user.click(screen.getByLabelText('Select B'))

    const bulk = screen.getByRole('region', { name: 'Actions on selected models' })
    expect(within(bulk).getByText('2 selected')).toBeInTheDocument()

    await user.click(within(bulk).getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete 2 models' }))

    await waitFor(async () => {
      expect((await localStore.list()).map((m) => m.name)).toEqual(['C'])
    })
  })

  it('expands a row to show its details', async () => {
    const user = userEvent.setup()
    await seeded(['Mortgage lineage'])
    const [row] = await localStore.list()
    renderBrowser()

    await findInList('Mortgage lineage')
    expect(screen.queryByText('Model ID')).not.toBeInTheDocument()

    // Click the row body, not the name — the name opens the model.
    await user.click(screen.getByText(/0 layers/))

    expect(await screen.findByText('Model ID')).toBeInTheDocument()
    expect(screen.getByText(row.id)).toBeInTheDocument()
  })

  it('switches the list and grid layouts', async () => {
    const user = userEvent.setup()
    await seeded(['Mortgage lineage'])
    const { container } = renderBrowser()
    await findInList('Mortgage lineage')

    expect(container.querySelector('.mb')).toHaveAttribute('data-layout', 'list')
    await user.click(screen.getByRole('button', { name: 'Switch to grid layout' }))
    expect(container.querySelector('.mb')).toHaveAttribute('data-layout', 'grid')
  })
})
