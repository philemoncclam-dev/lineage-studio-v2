import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AppModel } from '../../model'
import type { Table } from '../../data'

const mockClear = vi.fn()
let mockSearch: { sel?: string; col?: string } = {}

vi.mock('../../selection/useSelection', () => ({
  useSelection: () => ({ sel: mockSearch.sel, col: mockSearch.col, select: vi.fn(), clear: mockClear }),
}))

let mockModel: AppModel

vi.mock('../../model', async () => {
  const actual = await vi.importActual<typeof import('../../model')>('../../model')
  return { ...actual, useModel: () => mockModel }
})

import Inspector from '../Inspector'

const fullTable: Table = {
  id: 'tbl-full',
  name: 'orders_clean',
  layer: 'silver',
  c: 'silver',
  x: 0,
  y: 0,
  columns: [
    { key: 'tbl-full.order_id', name: 'order_id', type: 'long', pk: true },
    { key: 'tbl-full.amount', name: 'amount', type: 'double' },
  ],
}

const emptyTable: Table = {
  id: 'tbl-empty',
  name: 'staging_temp',
  layer: 'bronze',
  c: 'bronze',
  x: 0,
  y: 0,
  columns: [],
}

function baseModel(): AppModel {
  return {
    source: 'sample',
    tables: [fullTable, emptyTable],
    notebooks: [],
    colEdges: [],
    ops: [],
    xform: {},
    evidence: {},
    levels: {},
    levelTable: {},
    notebookCode: {},
    context: {
      'tbl-full': {
        up: [['raw_orders', 'bronze', 'clean_orders']],
        down: [
          ['orders_report', 'gold', 'daily_revenue'],
          ['revenue_daily', 'gold', 'daily_revenue'],
        ],
      },
    },
  }
}

describe('Inspector (SHELL-03, D-10/D-11/D-12)', () => {
  it('renders null when sel is unset (D-11: visibility == selection)', () => {
    mockSearch = {}
    mockModel = baseModel()
    const { container } = render(<Inspector />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the metadata card for a selected table: name, kind, a column, and edge counts', () => {
    mockSearch = { sel: 'tbl-full' }
    mockModel = baseModel()
    render(<Inspector />)

    expect(screen.getByRole('complementary', { name: 'Selection details' })).toBeInTheDocument()
    expect(screen.getByText('orders_clean')).toBeInTheDocument()
    expect(screen.getByText('table')).toBeInTheDocument()
    expect(screen.getByText('silver')).toBeInTheDocument()
    expect(screen.getByText('order_id')).toBeInTheDocument()
    expect(screen.getByText('amount')).toBeInTheDocument()
    expect(screen.getByText('Connections (1 in / 2 out)')).toBeInTheDocument()
  })

  it('omits the column section and the Connections row for a table with zero columns and no context entry (partial consideration)', () => {
    mockSearch = { sel: 'tbl-empty' }
    mockModel = baseModel()
    render(<Inspector />)

    expect(screen.getByText('staging_temp')).toBeInTheDocument()
    expect(screen.getByText('bronze')).toBeInTheDocument()
    expect(screen.queryByText(/^Columns/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Connections/)).not.toBeInTheDocument()
  })

  it('close button carries the accessible name "Close inspector" and calls clear()', () => {
    mockSearch = { sel: 'tbl-full' }
    mockModel = baseModel()
    mockClear.mockClear()
    render(<Inspector />)

    const closeBtn = screen.getByRole('button', { name: 'Close inspector' })
    closeBtn.click()
    expect(mockClear).toHaveBeenCalledTimes(1)
  })
})
