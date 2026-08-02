import { describe, expect, it } from 'vitest'
import { foldTargets } from '../fold'
import type { Attribute, LineageModel } from '../types'

const attr = (id: string, children: Attribute[] = []): Attribute => ({ id, name: id, children })

/** One layer, one object, one group holding a nested group holding leaves. */
const model = {
  id: 'm',
  name: 'M',
  layers: [
    {
      id: 'L1',
      name: 'L1',
      objects: [
        {
          id: 'O1',
          name: 'O1',
          children: [
            attr('G1', [attr('G2', [attr('leaf1')]), attr('leaf2')]),
            attr('leaf3'),
          ],
        },
      ],
    },
  ],
  transitions: [],
  properties: {},
} as unknown as LineageModel

describe('foldTargets', () => {
  it('counts a group as an attribute with children, at any depth', () => {
    expect(foldTargets(model, 'groups')).toEqual(['G1', 'G2'])
  })

  it('leaves the leaves out — folding one would fold nothing', () => {
    expect(foldTargets(model, 'groups')).not.toContain('leaf1')
  })

  it('answers objects and layers separately', () => {
    expect(foldTargets(model, 'objects')).toEqual(['O1'])
    expect(foldTargets(model, 'layers')).toEqual(['L1'])
  })
})
