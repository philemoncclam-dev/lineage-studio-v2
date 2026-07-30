// The C shortcut: arm a connection from the selected entity, then click the
// entity it should reach.
//
// It is a keyboard door onto the same `pending` gesture the ports drive by
// pointer, so what is really under test is that the two share one mechanism —
// C only sets the source, and the existing "a click while pending lands the
// line" rule does the rest. The marked-source assertion matters as much as the
// transition: without a mark on screen, an armed canvas is indistinguishable
// from an idle one, and the next click does something the user did not expect.
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
import type { LineageModel } from '../../model/types'

/** Two layers, one object each, and an attribute under the second. */
function model(): LineageModel {
  return {
    id: 'm1',
    name: 'two layers',
    createdAt: 0,
    updatedAt: 0,
    layers: [
      { id: 'L1', name: 'Raw', objects: [{ id: 'O1', name: 'raw_customers', children: [] }] },
      {
        id: 'L2',
        name: 'Tables',
        objects: [
          { id: 'O2', name: 'customers', children: [{ id: 'A1', name: 'customer_id', children: [] }] },
        ],
      },
    ],
    transitions: [],
    properties: {},
  }
}

// The viewer mounts only the cards its measured viewport covers; jsdom measures
// zero, so without this nothing renders and there is nothing to click.
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

function renderViewer(onModel: (m: LineageModel) => void, readOnly = false) {
  function Harness() {
    const [m, setM] = useState(model())
    return (
      <ModelViewer
        model={m}
        onChange={(next) => {
          setM(next)
          onModel(next)
        }}
        onUndo={() => {}}
        onRedo={() => {}}
        canUndo={false}
        canRedo={false}
        readOnly={readOnly}
      />
    )
  }
  const rootRoute = createRootRoute({ component: Outlet })
  const viewerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: Harness,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([viewerRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(<RouterProvider router={router as never} />)
}

describe('C — connect from the selection', () => {
  it('arms the selected object, marks it, and the next click lands the line', async () => {
    const user = userEvent.setup()
    let latest: LineageModel | null = null
    const { container } = renderViewer((m) => (latest = m))

    await user.click(await screen.findByText('raw_customers'))
    expect(container.querySelector('[data-connect-source]')).toBeNull()

    await user.keyboard('c')

    // The red mark — the same attribute the CSS hangs the trace-origin outline
    // on — is on the source, and the status line has switched to the prompt.
    const armed = container.querySelector('[data-connect-source]')
    expect(armed).not.toBeNull()
    expect(armed).toHaveTextContent('raw_customers')
    expect(screen.getByText(/Pick where the transition goes/)).toBeInTheDocument()

    await user.click(screen.getByText('customers'))

    expect(latest!.transitions).toHaveLength(1)
    const t = latest!.transitions[0]
    expect({ source: t.source, target: t.target }).toEqual({ source: 'O1', target: 'O2' })
    // Landing clears the mode, so the click after this one selects normally.
    expect(container.querySelector('[data-connect-source]')).toBeNull()
  })

  it('works from an attribute row, not just a card', async () => {
    const user = userEvent.setup()
    let latest: LineageModel | null = null
    renderViewer((m) => (latest = m))

    await user.click(await screen.findByText('customer_id'))
    await user.keyboard('c')
    await user.click(screen.getByText('raw_customers'))

    const t = latest!.transitions[0]
    expect({ source: t.source, target: t.target }).toEqual({ source: 'A1', target: 'O1' })
  })

  it('is a toggle: a second C disarms, and the next click only selects', async () => {
    const user = userEvent.setup()
    let latest: LineageModel | null = null
    const { container } = renderViewer((m) => (latest = m))

    await user.click(await screen.findByText('raw_customers'))
    await user.keyboard('c')
    expect(container.querySelector('[data-connect-source]')).not.toBeNull()

    await user.keyboard('c')
    expect(container.querySelector('[data-connect-source]')).toBeNull()

    await user.click(screen.getByText('customers'))
    expect(latest).toBeNull()
  })

  it('does nothing from a layer — layers have no ports and cannot start one', async () => {
    const user = userEvent.setup()
    let latest: LineageModel | null = null
    const { container } = renderViewer((m) => (latest = m))

    await user.click(await screen.findByText('Raw'))
    await user.keyboard('c')

    expect(container.querySelector('[data-connect-source]')).toBeNull()
    await user.click(screen.getByText('customers'))
    expect(latest).toBeNull()
  })

  it('does not arm on a read-only canvas, where the line could never land', async () => {
    const user = userEvent.setup()
    let latest: LineageModel | null = null
    const { container } = renderViewer((m) => (latest = m), true)

    await user.click(await screen.findByText('raw_customers'))
    await user.keyboard('c')

    expect(container.querySelector('[data-connect-source]')).toBeNull()
    await user.click(screen.getByText('customers'))
    expect(latest).toBeNull()
  })

  it('leaves Ctrl+C alone — that is still copy, and must not arm a connection', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(() => {})

    await user.click(await screen.findByText('raw_customers'))
    await user.keyboard('{Control>}c{/Control}')

    expect(container.querySelector('[data-connect-source]')).toBeNull()
  })
})
