// The two route predicates decide shell chrome, and both hinge on the fact that
// '/models' and '/model/<id>' share a prefix — an easy thing to break with a
// careless startsWith.
import { describe, expect, it } from 'vitest'
import { isChromeless, isFullBleedPath, modeFromPathname } from '../railConfig'

describe('modeFromPathname', () => {
  it('puts both the browser and the viewer in Modeling', () => {
    expect(modeFromPathname('/models')).toBe('model')
    expect(modeFromPathname('/model/abc-123')).toBe('model')
  })

  it('still routes the other modes', () => {
    expect(modeFromPathname('/products')).toBe('products')
    expect(modeFromPathname('/fabric/explore')).toBe('fabric')
  })
})

describe('isFullBleedPath', () => {
  it('is only the viewer — the browser is an ordinary in-flow page', () => {
    expect(isFullBleedPath('/model/abc-123')).toBe(true)
    expect(isFullBleedPath('/models')).toBe(false)
    expect(isFullBleedPath('/fabric/explore')).toBe(false)
  })
})

describe('isChromeless', () => {
  it('drops the rail on the browser only', () => {
    expect(isChromeless('/models')).toBe(true)
    expect(isChromeless('/model/abc-123')).toBe(false)
    expect(isChromeless('/fabric/overview')).toBe(false)
  })
})
