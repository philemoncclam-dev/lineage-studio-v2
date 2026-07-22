import { describe, expect, it } from 'vitest'
import { nid, tid } from '../ids'

// WR-03 guard: tid/nid must never collapse two distinct raw Fabric ids onto
// the same short id, and every output must stay DOM-id/CSS-selector safe.
describe('tid/nid (collision-free short ids)', () => {
  it('tid distinguishes interior "." from literal "_" (previously both collapsed to the same id)', () => {
    expect(tid('table.raw.orders')).not.toBe(tid('table.raw_orders'))
  })

  it('nid distinguishes interior "." from literal "_" (previously both collapsed to the same id)', () => {
    expect(nid('notebook.clean.orders')).not.toBe(nid('notebook.clean_orders'))
  })

  // WR-03 v2 guards: the first fix only covered interior "." vs literal "_". These
  // pin the two residual collision classes the re-verification reproduced.
  it('does not collide an interior "." with a literal "__" (dbt-style stg__/dim__ names)', () => {
    // Previously both -> 'raw__orders' because '.' was encoded as '__'.
    expect(tid('table.raw.orders')).not.toBe(tid('table.raw__orders'))
    expect(nid('notebook.stg.orders')).not.toBe(nid('notebook.stg__orders'))
  })

  it('does not collapse two distinct punctuation characters onto the same id', () => {
    // Previously '/' and '_' both fell through the generic [^\w-] -> '_' rule.
    expect(tid('table.raw/orders')).not.toBe(tid('table.raw_orders'))
    // Two different non-word punctuation chars must also stay distinct from each other.
    expect(tid('table.a/b')).not.toBe(tid('table.a.b'))
  })

  it('every produced id is DOM-id/CSS-selector safe ([A-Za-z0-9_-] only)', () => {
    const ids = [
      tid('table.raw.orders'),
      tid('table.raw_orders'),
      nid('notebook.clean.orders'),
      nid('notebook.clean_orders'),
      tid('table.weird id/with spaces!'),
      nid('notebook.weird id/with spaces!'),
    ]
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('keeps the existing fixture-derived mappings stable (no interior dots to disambiguate)', () => {
    expect(tid('table.raw_orders')).toBe('raw_orders')
    expect(nid('notebook.clean_orders')).toBe('nb_clean_orders')
  })
})
