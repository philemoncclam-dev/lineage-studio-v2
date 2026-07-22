import { describe, expect, it } from 'vitest'
import { colorFor, LAYER_COLOR } from '../domainColor'

describe('colorFor', () => {
  it('maps known layers to their domain colour', () => {
    expect(colorFor('bronze')).toBe('bronze')
    expect(colorFor('silver')).toBe('silver')
    expect(colorFor('gold')).toBe('gold')
  })

  it('falls back to workspace for any other layer', () => {
    expect(colorFor('x')).toBe('workspace')
    expect(colorFor('anything-else')).toBe('workspace')
  })

  it('exposes the underlying LAYER_COLOR record unchanged from model.tsx', () => {
    expect(LAYER_COLOR).toEqual({ bronze: 'bronze', silver: 'silver', gold: 'gold' })
  })
})
