// Direction of an authored transition, driven through the real ports.
//
// The rule under test: the FIRST port clicked is the source and the second is
// the target, whichever edge of the card each port sits on. This exists because
// the previous rule — left port means "into me" — made a right-to-left edge
// effectively unauthorable: the port facing the entity you are drawing towards
// is the left one, so reaching for it silently produced a left-to-right edge.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import ModelViewer from '../ModelViewer'
import { curveFor } from '../edgeGeometry'
import { layoutModel } from '../../model/layout'
import { buildIndex } from '../../model/index'
import type { LineageModel } from '../../model/types'

/** L1 sits left of L2, so an O2 -> O1 transition is the right-to-left case. */
function twoLayerModel(): LineageModel {
  return {
    id: 'm1',
    name: 'two layers',
    createdAt: 0,
    updatedAt: 0,
    layers: [
      { id: 'L1', name: 'Raw', objects: [{ id: 'O1', name: 'raw_customers', children: [] }] },
      { id: 'L2', name: 'Tables', objects: [{ id: 'O2', name: 'raw customers', children: [] }] },
    ],
    transitions: [],
    properties: {},
  }
}

function Harness({ onModel }: { onModel: (m: LineageModel) => void }) {
  const [model, setModel] = useState(twoLayerModel())
  return (
    <ModelViewer
      model={model}
      onChange={(m) => {
        setModel(m)
        onModel(m)
      }}
      onUndo={() => {}}
      onRedo={() => {}}
      canUndo={false}
      canRedo={false}
    />
  )
}

// The viewer mounts only the cards its measured viewport covers; jsdom measures
// zero, so without this nothing renders and no port exists to click.
class BigResizeObserver {
  cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe() {
    this.cb(
      [{ contentRect: { width: 2000, height: 2000 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = BigResizeObserver as unknown as typeof ResizeObserver

function renderViewer(onModel: (m: LineageModel) => void) {
  const rootRoute = createRootRoute({ component: Outlet })
  const viewerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Harness onModel={onModel} />,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([viewerRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router as never} />)
}

/** The tangent entering the target; negative means the arrowhead points left. */
function incomingTangent(model: LineageModel) {
  const layout = layoutModel(model, new Set())
  const index = buildIndex(model)
  const c = curveFor(layout, (id) => index.entries.get(id)?.parentId ?? null, model.transitions[0])!
  return c.x1 - c.cx1
}

describe('authoring a transition', () => {
  it('draws right-to-left when the layer-2 entity is clicked first', async () => {
    const user = userEvent.setup()
    let latest: LineageModel | null = null
    renderViewer((m) => (latest = m))

    // Start on the layer-2 card's LEFT port — the one facing layer 1, which is
    // what you reach for when you mean to draw leftwards.
    await user.click(
      await screen.findByRole('button', {
        name: 'Draw a transition from raw customers (left edge)',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Land the transition on raw_customers (right edge)' }),
    )

    const t = latest!.transitions[0]
    expect({ source: t.source, target: t.target }).toEqual({ source: 'O2', target: 'O1' })
    expect(incomingTangent(latest!)).toBeLessThan(0)
  })

  it('draws left-to-right when the layer-1 entity is clicked first', async () => {
    const user = userEvent.setup()
    let latest: LineageModel | null = null
    renderViewer((m) => (latest = m))

    await user.click(
      await screen.findByRole('button', {
        name: 'Draw a transition from raw_customers (right edge)',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Land the transition on raw customers (left edge)' }),
    )

    const t = latest!.transitions[0]
    expect({ source: t.source, target: t.target }).toEqual({ source: 'O1', target: 'O2' })
    expect(incomingTangent(latest!)).toBeGreaterThan(0)
  })

  it('lands on either port of the target, and the side does not flip direction', async () => {
    const user = userEvent.setup()
    let latest: LineageModel | null = null
    renderViewer((m) => (latest = m))

    await user.click(
      await screen.findByRole('button', {
        name: 'Draw a transition from raw customers (right edge)',
      }),
    )
    // Landing on the target's LEFT port used to mean "this is the source".
    await user.click(
      screen.getByRole('button', { name: 'Land the transition on raw_customers (left edge)' }),
    )

    const t = latest!.transitions[0]
    expect({ source: t.source, target: t.target }).toEqual({ source: 'O2', target: 'O1' })
  })
})

describe('access badges', () => {
  it('badges a row carrying Access as R or W, the way the sandbox canvas does', async () => {
    function Tagged() {
      const [model, setModel] = useState<LineageModel>(() => {
        const base = twoLayerModel()
        const read = { id: 'A1', name: 'raw_orders', children: [] }
        const write = { id: 'A2', name: 'silver_orders', children: [] }
        base.layers[1].objects[0].children = [read, write]
        base.properties = { A1: { Access: 'Read' }, A2: { Access: 'Write' } }
        return base
      })
      return (
        <ModelViewer
          model={model}
          onChange={setModel}
          onUndo={() => {}}
          onRedo={() => {}}
          canUndo={false}
          canRedo={false}
        />
      )
    }
    const rootRoute = createRootRoute({ component: Outlet })
    const viewerRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: Tagged,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([viewerRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    render(<RouterProvider router={router as never} />)

    const r = await screen.findByLabelText('Read')
    const w = await screen.findByLabelText('Write')
    expect(r).toHaveTextContent('R')
    expect(w).toHaveTextContent('W')
    // data-kind is what carries the colour, shared with .sbx-flow-tag.
    expect(r).toHaveAttribute('data-kind', 'read')
    expect(w).toHaveAttribute('data-kind', 'write')
  })
})
