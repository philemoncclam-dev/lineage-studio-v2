// Component-level coverage for the cmdk-based CommandPalette (D-17, NAV-01,
// NAV-03). This suite exists in addition to the plan's required search.test.ts
// parity tests because a pre-existing, unrelated bug in the live app (Suspense
// pendingComponent rendering AppShell/Inspector outside router match context —
// see 02-06-SUMMARY.md "Blockers/Concerns") currently crashes the running dev
// app before it paints, blocking the plan's live-browser both-themes
// human-check. This test exercises the palette's DOM behavior directly
// (mocked router) so the feature has real regression coverage independent of
// that pre-existing, out-of-scope blocker.
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppModel } from '../../model'

// jsdom has no ResizeObserver; cmdk's Command.List uses one internally to
// size itself. Polyfilled only in this suite (the one consumer of cmdk).
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

const mockNavigate = vi.fn()
const mockSelect = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../../selection/useSelection', () => ({
  useSelection: () => ({ sel: undefined, col: undefined, select: mockSelect, clear: vi.fn() }),
}))

let mockModel: AppModel

vi.mock('../../model', async () => {
  const actual = await vi.importActual<typeof import('../../model')>('../../model')
  return { ...actual, useModel: () => mockModel }
})

import CommandPalette from '../CommandPalette'

// hl() splits a matched row label across a plain-text node + a <mark>
// element (T-02-06: real React nodes, not an HTML string), so the rendered
// ".sp-id" span has mixed children rather than one text node — RTL's default
// getByText won't match the concatenated string in that case. Matches on the
// element's full textContent instead, same content, split-children-safe.
function findRowByLabel(label: string) {
  return screen.getByText((_, element) => element?.className === 'sp-id' && element.textContent === label)
}

function baseModel(): AppModel {
  return {
    source: 'sample',
    tables: [
      { id: 't1', name: 'orders_clean', layer: 'silver', c: 'silver', x: 0, y: 0, columns: [
        { key: 't1.order_id', name: 'order_id', type: 'long', pk: true },
      ] },
    ],
    notebooks: [{ id: 'nb1', name: 'order_report', x: 0, y: 0 }],
    colEdges: [],
    ops: [],
    xform: {},
    evidence: {},
    levels: {},
    levelTable: {},
    notebookCode: { nb1: 'print("order total")' },
    context: {},
  }
}

describe('CommandPalette (NAV-01, NAV-03)', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    mockSelect.mockReset()
    mockModel = baseModel()
  })

  it('renders nothing below the input with no query (query.trim() guard)', () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    expect(screen.queryByText('Tables')).not.toBeInTheDocument()
    expect(screen.queryByText(/No matches for/)).not.toBeInTheDocument()
  })

  it('shows grouped, ranked results for a query matching multiple kinds', () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    const input = screen.getByPlaceholderText('Search tables, columns, notebooks, code…')
    fireEvent.change(input, { target: { value: 'order' } })

    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(findRowByLabel('orders_clean')).toBeInTheDocument()
  })

  it('shows the exact no-match copy when a query has no results', () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    const input = screen.getByPlaceholderText('Search tables, columns, notebooks, code…')
    fireEvent.change(input, { target: { value: 'zzzznomatch' } })

    expect(screen.getByText('No matches for "zzzznomatch".')).toBeInTheDocument()
  })

  it('selecting a table result performs a real navigation to the graph with sel set', () => {
    const onOpenChange = vi.fn()
    render(<CommandPalette open onOpenChange={onOpenChange} />)
    const input = screen.getByPlaceholderText('Search tables, columns, notebooks, code…')
    fireEvent.change(input, { target: { value: 'orders_clean' } })

    fireEvent.click(findRowByLabel('orders_clean'))

    expect(mockNavigate).toHaveBeenCalledTimes(1)
    const call = mockNavigate.mock.calls[0][0]
    expect(call.to).toBe('/graph')
    expect(call.search({})).toEqual({ sel: 't1', col: undefined })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('selecting a column result navigates with both sel and col set', () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    const input = screen.getByPlaceholderText('Search tables, columns, notebooks, code…')
    fireEvent.change(input, { target: { value: 'order_id' } })

    fireEvent.click(findRowByLabel('order_id'))

    const call = mockNavigate.mock.calls[0][0]
    expect(call.search({})).toEqual({ sel: 't1', col: 't1.order_id' })
  })
})
