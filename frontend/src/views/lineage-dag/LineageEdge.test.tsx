import { render } from '@testing-library/react'
import { Position, ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import LineageEdge, { lineageEdgeClass } from './LineageEdge'

describe('lineageEdgeClass (TRUST-01)', () => {
  it('reads/inferred/untraced: contains reads + inferred, neither declared nor on/dim', () => {
    const cls = lineageEdgeClass({ kind: 'reads', provenance: 'inferred', traced: null }).split(' ')
    expect(cls).toContain('reads')
    expect(cls).toContain('inferred')
    expect(cls).not.toContain('declared')
    expect(cls).not.toContain('on')
    expect(cls).not.toContain('dim')
  })

  it('writes/declared/on: contains writes + declared + on', () => {
    const cls = lineageEdgeClass({ kind: 'writes', provenance: 'declared', traced: 'on' }).split(' ')
    expect(cls).toContain('writes')
    expect(cls).toContain('declared')
    expect(cls).toContain('on')
  })

  it('provenance is independent of edge-type hue: every (kind, provenance) pair carries both classes', () => {
    const kinds = ['reads', 'writes', 'derives'] as const
    const provenances = ['declared', 'inferred'] as const
    for (const kind of kinds) {
      for (const provenance of provenances) {
        const cls = lineageEdgeClass({ kind, provenance, traced: null }).split(' ')
        expect(cls).toContain(kind)
        expect(cls).toContain(provenance)
      }
    }
  })

  it('traced "dim" yields a dim class; traced null yields neither on nor dim', () => {
    const dimCls = lineageEdgeClass({ kind: 'derives', provenance: 'inferred', traced: 'dim' }).split(' ')
    expect(dimCls).toContain('dim')
    expect(dimCls).not.toContain('on')

    const untracedCls = lineageEdgeClass({ kind: 'derives', provenance: 'inferred', traced: null }).split(' ')
    expect(untracedCls).not.toContain('on')
    expect(untracedCls).not.toContain('dim')
  })

  it('omitting traced entirely behaves the same as traced: null', () => {
    const cls = lineageEdgeClass({ kind: 'reads', provenance: 'inferred' }).split(' ')
    expect(cls).not.toContain('on')
    expect(cls).not.toContain('dim')
  })
})

describe('LineageEdge (render smoke test)', () => {
  it('renders a bezier path carrying the composed lineage-edge class', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <LineageEdge
            id="e1"
            source="raw"
            target="clean"
            sourceX={0}
            sourceY={0}
            targetX={200}
            targetY={100}
            sourcePosition={Position.Right}
            targetPosition={Position.Left}
            data={{ kind: 'writes', provenance: 'inferred', traced: 'on' }}
          />
        </svg>
      </ReactFlowProvider>,
    )

    const path = container.querySelector('path.react-flow__edge-path')
    expect(path).toBeInTheDocument()
    expect(path?.getAttribute('class')).toContain('lineage-edge')
    expect(path?.getAttribute('class')).toContain('writes')
    expect(path?.getAttribute('class')).toContain('inferred')
    expect(path?.getAttribute('class')).toContain('on')
    expect(path?.getAttribute('aria-label')).toBe('writes edge (inferred)')
    expect(path?.getAttribute('d')).toBeTruthy()
  })
})
