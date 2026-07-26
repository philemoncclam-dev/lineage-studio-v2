import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useUndoable } from '../useUndoable'

describe('useUndoable', () => {
  it('starts with nothing to undo or redo', () => {
    const { result } = renderHook(() => useUndoable('a'))
    expect(result.current.present).toBe('a')
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('undoes and redoes across several steps', () => {
    const { result } = renderHook(() => useUndoable('a'))
    act(() => result.current.set('b'))
    act(() => result.current.set('c'))
    expect(result.current.present).toBe('c')

    act(() => result.current.undo())
    expect(result.current.present).toBe('b')
    act(() => result.current.undo())
    expect(result.current.present).toBe('a')
    expect(result.current.canUndo).toBe(false)

    act(() => result.current.redo())
    expect(result.current.present).toBe('b')
    expect(result.current.canRedo).toBe(true)
  })

  it('drops the redo branch once a new edit lands', () => {
    const { result } = renderHook(() => useUndoable('a'))
    act(() => result.current.set('b'))
    act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.set('c'))
    expect(result.current.canRedo).toBe(false)
    expect(result.current.present).toBe('c')
  })

  it('ignores a set to the identical value, so undo never becomes a no-op step', () => {
    const { result } = renderHook(() => useUndoable('a'))
    act(() => result.current.set('a'))
    expect(result.current.canUndo).toBe(false)
  })

  it('undo and redo at the boundaries are safe no-ops', () => {
    const { result } = renderHook(() => useUndoable('a'))
    act(() => result.current.undo())
    act(() => result.current.redo())
    expect(result.current.present).toBe('a')
  })

  it('reset replaces the present and clears history', () => {
    const { result } = renderHook(() => useUndoable('a'))
    act(() => result.current.set('b'))
    expect(result.current.canUndo).toBe(true)

    act(() => result.current.reset('z'))
    expect(result.current.present).toBe('z')
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('bounds history growth', () => {
    const { result } = renderHook(() => useUndoable(0))
    for (let i = 1; i <= 130; i += 1) act(() => result.current.set(i))
    // Limit is 100, so the oldest reachable state is 130 - 100 = 30.
    for (let i = 0; i < 130; i += 1) act(() => result.current.undo())
    expect(result.current.present).toBe(30)
  })
})
