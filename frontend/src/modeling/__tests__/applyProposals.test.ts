// Turning an approved proposal into a model edit.
//
// The property that matters is that an applied proposal is INDISTINGUISHABLE
// from a hand edit — same editor function, same undo history, same persistence.
// So these assert against the model the ordinary editors produce, and against
// the safety of applying a proposal that has gone stale since it was made.
import { describe, expect, it } from 'vitest'
import { applyProposal, applyProposals } from '../applyProposals'
import { addTransition } from '../../model/edit'
import { tagsOf } from '../../model/tags'
import { propertiesOf } from '../../model/properties'
import type { ProposedEdit } from '../../api'
import type { LineageModel } from '../../model/types'

function model(): LineageModel {
  return {
    id: 'm',
    name: 'm',
    createdAt: 0,
    updatedAt: 0,
    layers: [
      {
        id: 'L1',
        name: 'Bronze',
        objects: [
          {
            id: 'O1',
            name: 'orders',
            children: [
              { id: 'A1', name: 'amount', children: [] },
              { id: 'A2', name: 'note', children: [] },
            ],
          },
        ],
      },
    ],
    transitions: [],
    properties: {},
  }
}

const edit = (over: Partial<ProposedEdit>): ProposedEdit =>
  ({ kind: 'rename', describes: 'x', ...over }) as ProposedEdit

describe('applyProposals', () => {
  it('draws a transition exactly as the editor would', () => {
    const applied = applyProposal(
      model(),
      edit({ kind: 'add_transition', source_id: 'A1', target_id: 'A2' }),
    )
    const byHand = addTransition(model(), 'A1', 'A2')
    expect(applied.transitions).toHaveLength(1)
    expect(applied.transitions[0].source).toBe(byHand.transitions[0].source)
    expect(applied.transitions[0].target).toBe(byHand.transitions[0].target)
  })

  it('sets a property', () => {
    const next = applyProposal(
      model(),
      edit({ kind: 'set_property', entity_id: 'A1', key: 'Transform', value: 'amount * 1.1' }),
    )
    expect(propertiesOf(next, 'A1').Transform).toBe('amount * 1.1')
  })

  it('adds a tag through the tag editor, not as a raw property write', () => {
    // A raw write would bypass normalisation and produce a tag the tag panel
    // cannot see — which is why the backend rejects set_property on Tags.
    const next = applyProposal(model(), edit({ kind: 'add_tag', entity_id: 'A1', value: 'PII' }))
    expect(tagsOf(next, 'A1')).toContain('PII')
  })

  it('renames an entity', () => {
    const next = applyProposal(model(), edit({ kind: 'rename', entity_id: 'A2', value: 'comment' }))
    expect(next.layers[0].objects[0].children[1].name).toBe('comment')
  })

  it('folds a batch into a single resulting model', () => {
    const next = applyProposals(model(), [
      edit({ kind: 'add_transition', source_id: 'A1', target_id: 'A2' }),
      edit({ kind: 'add_tag', entity_id: 'A1', value: 'PII' }),
    ])
    expect(next.transitions).toHaveLength(1)
    expect(tagsOf(next, 'A1')).toContain('PII')
  })

  it('is a no-op on a proposal that has gone stale', () => {
    // The backend validated against the model as it was. If the user edited in
    // between, applying must do nothing rather than something wrong.
    const before = model()
    const after = applyProposal(
      before,
      edit({ kind: 'add_transition', source_id: 'A1', target_id: 'DELETED' }),
    )
    expect(after).toBe(before)
  })

  it('ignores an unknown kind from a newer backend', () => {
    // Losing one proposal is recoverable; throwing mid-batch would leave the
    // model half-edited with no record of where it stopped.
    const before = model()
    expect(applyProposal(before, { kind: 'teleport', describes: 'x' } as never)).toBe(before)
  })

  it('does not mutate the model it was given', () => {
    const before = model()
    const snapshot = JSON.stringify(before)
    applyProposals(before, [edit({ kind: 'add_transition', source_id: 'A1', target_id: 'A2' })])
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
