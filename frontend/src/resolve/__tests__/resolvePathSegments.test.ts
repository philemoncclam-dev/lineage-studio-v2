import { describe, expect, it } from 'vitest'
import type { LineageGraph } from '../../api'
import { resolvePathSegments, resolveSegment } from '../resolvePathSegments'

// Synthetic graph: two workspaces each with a lakehouse of the SAME name
// (duplicate-name disambiguation, D-07), one lakehouse with two same-named
// tables (deterministic duplicate-sibling resolve).
function fixtureGraph(): LineageGraph {
  return {
    nodes: [
      { id: 'w1', kind: 'workspace', name: 'Analytics', columns: [], meta: {} },
      { id: 'w2', kind: 'workspace', name: 'Finance', columns: [], meta: {} },
      { id: 'lh1', kind: 'lakehouse', name: 'Bronze', parent_id: 'w1', columns: [], meta: {} },
      { id: 'lh2', kind: 'lakehouse', name: 'Bronze', parent_id: 'w2', columns: [], meta: {} },
      { id: 't1', kind: 'table', name: 'orders', parent_id: 'lh1', columns: [], meta: {} },
      { id: 'dupA', kind: 'table', name: 'dup', parent_id: 'lh1', columns: [], meta: {} },
      { id: 'dupB', kind: 'table', name: 'dup', parent_id: 'lh1', columns: [], meta: {} },
    ],
    edges: [],
  }
}

describe('resolveSegment', () => {
  it('resolves an exact kind+name match', () => {
    expect(resolveSegment(fixtureGraph(), 'workspace', 'Analytics')).toBe('w1')
  })

  it('disambiguates same-named siblings by parent', () => {
    const g = fixtureGraph()
    expect(resolveSegment(g, 'lakehouse', 'Bronze', 'w1')).toBe('lh1')
    expect(resolveSegment(g, 'lakehouse', 'Bronze', 'w2')).toBe('lh2')
  })

  it('resolves duplicate-named siblings deterministically (first in node order)', () => {
    expect(resolveSegment(fixtureGraph(), 'table', 'dup', 'lh1')).toBe('dupA')
  })

  it('returns null when nothing matches', () => {
    expect(resolveSegment(fixtureGraph(), 'table', 'does_not_exist')).toBeNull()
  })
})

describe('resolvePathSegments', () => {
  const rootTo = { to: '/graph' }

  it('resolves a fully-valid drill chain with no redirect', () => {
    const result = resolvePathSegments(
      fixtureGraph(),
      { workspace: 'Analytics', lakehouse: 'Bronze', table: 'orders' },
      rootTo,
    )
    expect(result).toEqual({ workspaceId: 'w1', lakehouseId: 'lh1', tableId: 't1' })
  })

  it('skips absent optional segments (index level) with no redirect', () => {
    expect(resolvePathSegments(fixtureGraph(), {}, rootTo)).toEqual({})
    expect(resolvePathSegments(fixtureGraph(), { workspace: 'Analytics' }, rootTo)).toEqual({ workspaceId: 'w1' })
  })

  it('redirects to the nearest resolvable ancestor exactly once on a broken segment, naming it', () => {
    let caught: unknown
    try {
      resolvePathSegments(fixtureGraph(), { workspace: 'Analytics', lakehouse: 'Bronze', table: 'raw_orders_typo' }, rootTo)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeDefined()
    const redirected = caught as { options: { to: string; params?: Record<string, string>; replace?: boolean; search?: (prev: Record<string, unknown>) => Record<string, unknown> } }
    // Nearest ancestor is the lakehouse level (workspace + lakehouse both
    // resolved), not the graph root — exactly one hop, never re-attempted.
    expect(redirected.options.to).toBe('/graph/$workspace/$lakehouse')
    expect(redirected.options.params).toEqual({ workspace: 'Analytics', lakehouse: 'Bronze' })
    expect(redirected.options.replace).toBe(true)
    expect(redirected.options.search?.({})).toEqual({ unresolved: 'raw_orders_typo' })
  })

  it('redirects to the graph root when the FIRST segment is broken', () => {
    let caught: unknown
    try {
      resolvePathSegments(fixtureGraph(), { workspace: 'DoesNotExist' }, rootTo)
    } catch (e) {
      caught = e
    }
    const redirected = caught as { options: { to: string; params?: Record<string, string> } }
    expect(redirected.options.to).toBe('/graph')
    expect(redirected.options.params).toBeUndefined()
  })

  it('bounds a pathologically long unresolved segment in the notice', () => {
    const longSegment = 'x'.repeat(200)
    let caught: unknown
    try {
      resolvePathSegments(fixtureGraph(), { workspace: longSegment }, rootTo)
    } catch (e) {
      caught = e
    }
    const redirected = caught as { options: { search?: (prev: Record<string, unknown>) => Record<string, unknown> } }
    const notice = redirected.options.search?.({}).unresolved as string
    expect(notice.length).toBeLessThan(longSegment.length)
  })
})
