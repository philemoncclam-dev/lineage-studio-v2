// The canvas's own behaviour: what gets drawn, and what selecting an item does.
//
// jsdom has no layout engine, so nothing here asserts pixels. What it does
// assert is the part that is actually logic — which cards exist, which carry
// which type, and which are dimmed when one item is picked (Fabric's impact
// reading). dagre runs for real; only its geometry is uninspectable.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { LineageCanvas } from '../LineageCanvas'
import type { ItemGraph } from '../lineageItems'

/**
 *   Bronze ─▶ enrich ─▶ Silver        (one chain)
 *   Standalone                        (touches nothing)
 */
const graph: ItemGraph = {
  items: [
    { id: 'lh1', name: 'Bronze', kind: 'lakehouse', typeLabel: 'Lakehouse' },
    { id: 'nb1', name: 'enrich', kind: 'notebook', typeLabel: 'Notebook' },
    { id: 'lh2', name: 'Silver', kind: 'lakehouse', typeLabel: 'Lakehouse' },
    { id: 'rep', name: 'Exec', kind: 'report', typeLabel: 'Report', opaque: true },
  ],
  links: [
    { from: 'lh1', to: 'nb1', count: 3 },
    { from: 'nb1', to: 'lh2', count: 1 },
  ],
}

const card = (name: string) => screen.getByRole('button', { name: new RegExp(name) })

describe('LineageCanvas', () => {
  it('draws one card per item, with its Fabric type', () => {
    render(<LineageCanvas graph={graph} />)
    expect(card('Bronze')).toHaveAttribute('data-kind', 'lakehouse')
    expect(card('enrich')).toHaveAttribute('data-kind', 'notebook')
    expect(card('Exec')).toHaveAttribute('data-kind', 'report')
    expect(screen.getAllByText('Lakehouse')).toHaveLength(2)
  })

  it('labels an arrow with the number of tables it stands for', () => {
    render(<LineageCanvas graph={graph} />)
    // The 3-table edge is counted; the single-table one is left unlabelled
    // rather than shouting "1" on every arrow.
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('says when an item could not be crawled', () => {
    render(<LineageCanvas graph={graph} />)
    expect(screen.getByText(/not crawled/)).toBeInTheDocument()
  })

  it('dims everything the selected item does not touch', async () => {
    const user = userEvent.setup()
    render(<LineageCanvas graph={graph} />)
    await user.click(card('enrich'))
    // The whole chain stays lit — upstream and downstream both, which is what
    // makes this an impact view rather than half of one.
    expect(card('enrich')).not.toHaveAttribute('data-dim')
    expect(card('Bronze')).not.toHaveAttribute('data-dim')
    expect(card('Silver')).not.toHaveAttribute('data-dim')
    // The unrelated report is pushed back.
    expect(card('Exec')).toHaveAttribute('data-dim', 'true')
  })

  it('clicking the selected item again clears the selection', async () => {
    const user = userEvent.setup()
    render(<LineageCanvas graph={graph} />)
    await user.click(card('enrich'))
    expect(card('Exec')).toHaveAttribute('data-dim', 'true')
    await user.click(card('enrich'))
    expect(card('Exec')).not.toHaveAttribute('data-dim')
  })

  it('zooming changes the reported scale', async () => {
    const user = userEvent.setup()
    render(<LineageCanvas graph={graph} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Zoom out'))
    expect(screen.getByText('90%')).toBeInTheDocument()
  })
})
