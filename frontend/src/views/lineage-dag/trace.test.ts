import { describe, expect, it } from 'vitest'
import { trace } from './trace'

describe('trace', () => {
  it('walks both upstream and downstream from the given key', () => {
    const result = trace([['a', 'b'], ['b', 'c']], 'b')
    expect(result).toEqual(new Set(['a', 'b', 'c']))
  })

  it('terminates on a cyclic colEdges array (visited-guard)', () => {
    const result = trace([['a', 'b'], ['b', 'a']], 'a')
    expect(result).toEqual(new Set(['a', 'b']))
  })

  it('returns just the key when it has no edges', () => {
    const result = trace([['a', 'b'], ['b', 'c']], 'z')
    expect(result).toEqual(new Set(['z']))
  })
})
