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
