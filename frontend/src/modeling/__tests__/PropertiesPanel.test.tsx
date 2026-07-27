// The Properties dock, driven directly — it needs no router and no canvas.
//
// What is worth testing here is the editing PROTOCOL rather than the markup:
// values are drafted locally and committed on blur/Enter (one undo step per
// edit, not per keystroke), and a mixed row must not be flattened by being
// blurred through.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildIndex } from '../../model/index'
import { PropertiesPanel } from '../PropertiesPanel'
import type { LineageModel } from '../../model/types'

function model(properties: LineageModel['properties'] = {}): LineageModel {
  return {
    id: 'm',
    name: 'm',
    createdAt: 0,
    updatedAt: 0,
    layers: [
      {
        id: 'L1',
        name: 'Raw',
        objects: [
          {
            id: 'O1',
            name: 'orders',
            children: [
              { id: 'A1', name: 'order_id', children: [] },
              { id: 'A2', name: 'total', children: [] },
            ],
          },
        ],
      },
    ],
    transitions: [{ id: 'T1', source: 'A1', target: 'A2' }],
    properties,
  }
}

function panel(
  m: LineageModel,
  over: Partial<Parameters<typeof PropertiesPanel>[0]> = {},
) {
  const onChange = vi.fn()
  render(
    <PropertiesPanel
      model={m}
      index={buildIndex(m)}
      entityIds={[]}
      transitionIds={[]}
      onChange={onChange}
      onEditTags={vi.fn()}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  )
  return onChange
}

describe('PropertiesPanel', () => {
  it('says what to do when nothing is selected', () => {
    panel(model())
    expect(screen.getByText(/Select an entity or a transition/)).toBeTruthy()
  })

  it('shows an entity, its kind and its address', () => {
    panel(model({ A1: { 'Data type': 'string' } }), { entityIds: ['A1'] })
    expect(screen.getByText('order_id')).toBeTruthy()
    expect(screen.getByText('Attribute')).toBeTruthy()
    // Ancestors, outermost first.
    expect(screen.getByRole('button', { name: 'Raw' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'orders' })).toBeTruthy()
    expect((screen.getByLabelText('Data type value') as HTMLInputElement).value).toBe('string')
  })

  it('commits an edited value once, on blur — not per keystroke', async () => {
    const user = userEvent.setup()
    const onChange = panel(model({ A1: { Owner: 'phil' } }), { entityIds: ['A1'] })

    const field = screen.getByLabelText('Owner value')
    await user.clear(field)
    await user.type(field, 'sam')
    expect(onChange).not.toHaveBeenCalled()

    await user.tab()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].properties.A1).toEqual({ Owner: 'sam' })
  })

  it('reads a transition, which is where Auto-Mapper confidence has always lived', () => {
    panel(model({ T1: { Confidence: '92' } }), { transitionIds: ['T1'] })
    expect(screen.getByText('Transition')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'order_id' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'total' })).toBeTruthy()
    expect((screen.getByLabelText('Confidence value') as HTMLInputElement).value).toBe('92')
  })

  it('shows a disagreeing key as mixed, and blurring through it changes nothing', async () => {
    const user = userEvent.setup()
    const onChange = panel(model({ A1: { Access: 'Read' }, A2: { Access: 'Write' } }), {
      entityIds: ['A1', 'A2'],
    })

    const field = screen.getByLabelText('Access value') as HTMLInputElement
    expect(field.value).toBe('')
    expect(field.placeholder).toBe('Mixed — 2/2')

    await user.click(field)
    await user.tab()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('writes a new property to the whole selection', async () => {
    const user = userEvent.setup()
    const onChange = panel(model(), { entityIds: ['A1', 'A2'] })

    await user.type(screen.getByLabelText('New property key'), 'Owner')
    await user.type(screen.getByLabelText('New property value'), 'phil')
    await user.click(screen.getByRole('button', { name: /Add to all 2/ }))

    const next = onChange.mock.calls[0][0]
    expect(next.properties.A1).toEqual({ Owner: 'phil' })
    expect(next.properties.A2).toEqual({ Owner: 'phil' })
  })

  it('sends Tags to its own editor rather than offering a text field', async () => {
    const user = userEvent.setup()
    const onEditTags = vi.fn()
    panel(model({ A1: { Tags: 'notebook, table' } }), { entityIds: ['A1'], onEditTags })

    expect(screen.queryByLabelText('Tags value')).toBeNull()
    expect(screen.getByText('notebook')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Edit…' }))
    expect(onEditTags).toHaveBeenCalledWith(['A1'])
  })
})
