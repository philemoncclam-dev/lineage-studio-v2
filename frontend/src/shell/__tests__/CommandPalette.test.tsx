// Component-level coverage for the cmdk-based CommandPalette (D-17, NAV-01,
// NAV-03). The palette searches the live Fabric catalog (/fabric/catalog) and
// jumps to the Explore view drilled onto the picked asset, so this suite mocks
// the catalog fetch and the router and exercises the palette's DOM directly.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FabricCatalogEntry } from '../../api'

// jsdom has no ResizeObserver; cmdk's Command.List uses one internally.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

const catalog: FabricCatalogEntry[] = [
  {
    kind: 'table',
    workspace_id: 'ws1',
    workspace_name: 'Sales',
    id: 'orders_clean',
    name: 'orders_clean',
    item_type: 'Table',
    lakehouse_id: 'lh1',
    lakehouse_name: 'LH_Sales',
  },
  { kind: 'notebook', workspace_id: 'ws1', workspace_name: 'Sales', id: 'nb1', name: 'order_report', item_type: 'Notebook' },
]

const fetchFabricCatalog = vi.fn(() => Promise.resolve(catalog))
vi.mock('../../api', () => ({ fetchFabricCatalog: () => fetchFabricCatalog() }))

import CommandPalette from '../CommandPalette'

function findRowByLabel(label: string) {
  return screen.getByText((_, element) => element?.className === 'sp-id' && element.textContent === label)
}

describe('CommandPalette (Fabric catalog search)', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
  })

  it('renders nothing below the input with no query', () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    expect(screen.queryByText('Tables')).not.toBeInTheDocument()
    expect(screen.queryByText(/No matches for/)).not.toBeInTheDocument()
  })

  it('shows grouped results from the catalog for a query', async () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    const input = screen.getByPlaceholderText('Search workspaces, notebooks, lakehouses, tables…')
    fireEvent.change(input, { target: { value: 'order' } })

    expect(await screen.findByText('Tables')).toBeInTheDocument()
    expect(findRowByLabel('orders_clean')).toBeInTheDocument()
    expect(findRowByLabel('order_report')).toBeInTheDocument()
  })

  it('shows the exact no-match copy when a query has no results', async () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    const input = screen.getByPlaceholderText('Search workspaces, notebooks, lakehouses, tables…')
    // Wait for the catalog to load first, else the "Loading…" state shows.
    fireEvent.change(input, { target: { value: 'order' } })
    await screen.findByText('Tables')

    fireEvent.change(input, { target: { value: 'zzzznomatch' } })
    expect(screen.getByText('No matches for "zzzznomatch".')).toBeInTheDocument()
  })

  it('picking a table drills into explore with the target search-params', async () => {
    const onOpenChange = vi.fn()
    render(<CommandPalette open onOpenChange={onOpenChange} />)
    const input = screen.getByPlaceholderText('Search workspaces, notebooks, lakehouses, tables…')
    fireEvent.change(input, { target: { value: 'orders_clean' } })

    fireEvent.click(await screen.findByText((_, el) => el?.className === 'sp-id' && el.textContent === 'orders_clean'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1))
    const call = mockNavigate.mock.calls[0][0]
    expect(call.to).toBe('/fabric/explore')
    expect(call.search).toEqual({
      ws: 'ws1',
      wsName: 'Sales',
      kind: 'table',
      id: 'orders_clean',
      name: 'orders_clean',
      itemType: 'Table',
      lh: 'lh1',
      lhName: 'LH_Sales',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
