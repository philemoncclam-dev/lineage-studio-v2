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

// ---- ColumnCard fixtures (DAG-05, TRUST-02) ----

const rawTable: Table = {
  id: 'raw',
  name: 'raw_orders',
  layer: 'bronze',
  c: 'bronze',
  x: 0,
  y: 0,
  columns: [
    { key: 'raw.customer', name: 'customer', type: 'string' },
    { key: 'raw.order_id', name: 'order_id', type: 'long', pk: true },
  ],
}

const cleanTable: Table = {
  id: 'clean',
  name: 'orders_clean',
  layer: 'silver',
  c: 'silver',
  x: 0,
  y: 0,
  columns: [
    { key: 'clean.customer_name', name: 'customer_name', type: 'string' },
    { key: 'clean.order_id', name: 'order_id', type: 'long' },
  ],
}

function columnModel(): AppModel {
  return {
    source: 'sample',
    tables: [rawTable, cleanTable],
    notebooks: [],
    colEdges: [
      ['raw.customer', 'clean.customer_name'],
      ['raw.order_id', 'clean.order_id'],
    ],
    ops: [],
    xform: {
      'clean.customer_name': ['upper(customer)', 'Computed as upper(customer) in clean_orders.'],
      'clean.order_id': ['order_id', 'Passed through from raw · order_id by clean_orders.'],
    },
    evidence: {
      'clean.customer_name': {
        notebook: 'clean_orders',
        cell_index: 2,
        line: 12,
        snippet: 'SELECT UPPER(customer) AS customer_name FROM raw_orders',
      },
    },
    levels: {},
    levelTable: {},
    notebookCode: {},
    context: {},
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

describe('Inspector ColumnCard (DAG-05, TRUST-02)', () => {
  it('renders Transform code + sentence, Source→Target, Evidence snippet + locked caption, and Upstream/Downstream counts for a column with evidence', () => {
    mockSearch = { sel: 'clean', col: 'clean.customer_name' }
    mockModel = columnModel()
    render(<Inspector />)

    expect(screen.getByText('customer_name')).toBeInTheDocument()
    expect(screen.getByText('column')).toBeInTheDocument()
    expect(screen.getByText('Inferred')).toBeInTheDocument()

    // Transform
    expect(screen.getByText('upper(customer)')).toBeInTheDocument()
    expect(screen.getByText('Computed as upper(customer) in clean_orders.')).toBeInTheDocument()

    // Source → Target
    expect(screen.getByText('customer')).toBeInTheDocument()
    expect(screen.getByText('raw_orders')).toBeInTheDocument()

    // Evidence
    expect(screen.getByText('SELECT UPPER(customer) AS customer_name FROM raw_orders')).toBeInTheDocument()
    expect(screen.getByText(/clean_orders.*cell 2.*line 12/)).toBeInTheDocument()
    expect(screen.getByText('Inferred from static pattern-matching — not executed.')).toBeInTheDocument()

    // Connections
    expect(screen.getByText(/Upstream 1.*Downstream 0/)).toBeInTheDocument()
  })

  it('omits the .xform code block for a pass-through column, rendering only the plain-English sentence', () => {
    mockSearch = { sel: 'clean', col: 'clean.order_id' }
    mockModel = columnModel()
    const { container } = render(<Inspector />)

    expect(container.querySelector('.xform code')).not.toBeInTheDocument()
    expect(screen.getByText('Passed through from raw · order_id by clean_orders.')).toBeInTheDocument()
  })
})
