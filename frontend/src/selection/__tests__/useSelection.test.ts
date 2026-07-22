import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNavigate = vi.fn()
let mockSearch: { sel?: string; col?: string } = {}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch,
}))

import { useSelection } from '../useSelection'

describe('useSelection', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    mockSearch = {}
  })

  it('reads sel/col from search state', () => {
    mockSearch = { sel: 'table:orders', col: 'orders.amount' }
    const { result } = renderHook(() => useSelection())
    expect(result.current.sel).toBe('table:orders')
    expect(result.current.col).toBe('orders.amount')
  })

  it('select() navigates with replace: true (SHELL-06 / D-08)', () => {
    const { result } = renderHook(() => useSelection())
    act(() => result.current.select('table:orders', 'orders.amount'))

    expect(mockNavigate).toHaveBeenCalledTimes(1)
    const call = mockNavigate.mock.calls[0][0]
    expect(call.replace).toBe(true)
  })

  it('select() merges into prev search rather than replacing the whole object (Pitfall 1)', () => {
    const { result } = renderHook(() => useSelection())
    act(() => result.current.select('table:orders', 'orders.amount'))

    const call = mockNavigate.mock.calls[0][0]
    const next = call.search({ someOtherParam: 'kept' })
    expect(next).toEqual({ someOtherParam: 'kept', sel: 'table:orders', col: 'orders.amount' })
  })

  it('clear() sets both sel and col to undefined, still with replace: true', () => {
    const { result } = renderHook(() => useSelection())
    act(() => result.current.clear())

    const call = mockNavigate.mock.calls[0][0]
    expect(call.replace).toBe(true)
    expect(call.search({ sel: 'x', col: 'y' })).toEqual({ sel: undefined, col: undefined })
  })
})
