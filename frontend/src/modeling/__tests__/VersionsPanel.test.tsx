// The history dock. The diff itself is covered in versionDiff.test.ts; this
// covers the part that makes restoring safe — that you cannot reach the button
// without first being shown what it will change.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VersionsPanel } from '../VersionsPanel'
import { localStore } from '../../model/store'
import type { LineageModel } from '../../model/types'

const model = (over: Partial<LineageModel> = {}): LineageModel => ({
  id: 'm1',
  name: 'Sales',
  createdAt: 0,
  updatedAt: 0,
  layers: [{ id: 'L1', name: 'Raw', objects: [{ id: 'o1', name: 'orders', children: [] }] }],
  transitions: [],
  properties: {},
  ...over,
})

beforeEach(() => {
  localStorage.clear()
})

async function seed(snapshot: LineageModel, label = 'before the big change') {
  await localStore.save(snapshot)
  await localStore.saveVersion(snapshot.id, label)
}

describe('VersionsPanel', () => {
  it('explains itself when there is no history yet', async () => {
    render(<VersionsPanel model={model()} onRestore={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText(/No versions yet/)).toBeInTheDocument()
  })

  it('saves a snapshot under a name', async () => {
    const user = userEvent.setup()
    await localStore.save(model())
    render(<VersionsPanel model={model()} onRestore={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('Version name'), 'v1')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () =>
      expect(await localStore.listVersions('m1')).toHaveLength(1),
    )
    expect(await screen.findByText('v1')).toBeInTheDocument()
  })

  it('does not offer to restore until the diff has been shown', async () => {
    const user = userEvent.setup()
    await seed(model())
    // The open model has an object the snapshot does not.
    const current = model({
      layers: [
        {
          id: 'L1',
          name: 'Raw',
          objects: [
            { id: 'o1', name: 'orders', children: [] },
            { id: 'o2', name: 'items', children: [] },
          ],
        },
      ],
    })
    render(<VersionsPanel model={current} onRestore={vi.fn()} onClose={vi.fn()} />)

    // Nothing to restore with until a version is examined.
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument()

    await user.click(await screen.findByText('before the big change'))

    // The diff is phrased as what restoring COSTS.
    expect(await screen.findByText(/1 added since/)).toBeInTheDocument()
    expect(screen.getByText(/restoring removes it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Restore this version/ })).toBeEnabled()
  })

  it('hands back the snapshot graph but keeps the model identity', async () => {
    const user = userEvent.setup()
    await seed(model())
    const current = model({
      name: 'Sales renamed',
      layers: [{ id: 'L1', name: 'Raw', objects: [] }],
    })
    const onRestore = vi.fn()
    render(<VersionsPanel model={current} onRestore={onRestore} onClose={vi.fn()} />)

    await user.click(await screen.findByText('before the big change'))
    await user.click(screen.getByRole('button', { name: /Restore this version/ }))

    await waitFor(() => expect(onRestore).toHaveBeenCalled())
    const restored = onRestore.mock.calls[0][0] as LineageModel
    // The graph comes from the snapshot...
    expect(restored.layers[0].objects.map((o) => o.id)).toEqual(['o1'])
    // ...but the id and the current name are untouched: restoring must not move
    // the route or resurrect an old title.
    expect(restored.id).toBe('m1')
    expect(restored.name).toBe('Sales renamed')
  })

  it('refuses to restore a version identical to what is open', async () => {
    const user = userEvent.setup()
    await seed(model())
    render(<VersionsPanel model={model()} onRestore={vi.fn()} onClose={vi.fn()} />)
    await user.click(await screen.findByText('before the big change'))
    expect(await screen.findByText(/Identical to the model you have open/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nothing to restore/ })).toBeDisabled()
  })

  it('offers no save or restore on a read-only model', async () => {
    const user = userEvent.setup()
    await seed(model())
    render(<VersionsPanel model={model()} onRestore={vi.fn()} onClose={vi.fn()} readOnly />)
    expect(screen.queryByLabelText('Version name')).not.toBeInTheDocument()
    await user.click(await screen.findByText('before the big change'))
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument()
  })
})
