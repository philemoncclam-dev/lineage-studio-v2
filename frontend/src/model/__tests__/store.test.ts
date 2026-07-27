import { beforeEach, describe, expect, it } from 'vitest'
import { emptyModel, localStore, normalize, normalizeTags, summarize } from '../store'
import type { LineageModel } from '../types'

const INDEX_KEY = 'lineage-studio:models'

beforeEach(() => {
  localStorage.clear()
})

describe('normalizeTags', () => {
  it('trims, drops blanks, and sorts', () => {
    expect(normalizeTags([' Demo ', '', '  ', 'Alpha'])).toEqual(['Alpha', 'Demo'])
  })

  it('dedupes case-insensitively but keeps the first spelling', () => {
    expect(normalizeTags(['Demo', 'demo', 'DEMO'])).toEqual(['Demo'])
  })
})

describe('normalize', () => {
  it('fills in metadata missing from a pre-browser model', () => {
    const legacy = {
      id: 'x',
      name: 'Legacy',
      createdAt: 1,
      updatedAt: 7,
      layers: [],
      transitions: [],
      properties: {},
    } as LineageModel

    const full = normalize(legacy)
    expect(full.tags).toEqual([])
    expect(full.starred).toBe(false)
    expect(full.description).toBe('')
    // Falls back to updatedAt, not 0 — see the comment on normalize().
    expect(full.lastViewedAt).toBe(7)
  })

  it('leaves present metadata alone', () => {
    const model = { ...emptyModel('m'), starred: true, tags: ['B', 'a'], lastViewedAt: 42 }
    const full = normalize(model)
    expect(full.starred).toBe(true)
    expect(full.tags).toEqual(['a', 'B'])
    expect(full.lastViewedAt).toBe(42)
  })
})

describe('summarize', () => {
  it('carries metadata onto the summary row', () => {
    const model = { ...emptyModel('Mortgage'), tags: ['Demo'], starred: true }
    const s = summarize(model)
    expect(s).toMatchObject({ name: 'Mortgage', tags: ['Demo'], starred: true, layerCount: 0 })
  })
})

describe('localStore', () => {
  it('creates, lists and gets a model', async () => {
    const created = await localStore.create('Mortgage')
    expect(await localStore.list()).toHaveLength(1)
    const loaded = await localStore.get(created.id)
    expect(loaded?.name).toBe('Mortgage')
  })

  it('returns null for an unknown id', async () => {
    expect(await localStore.get('nope')).toBeNull()
  })

  it('patches metadata without touching updatedAt', async () => {
    const created = await localStore.create('Mortgage')
    const before = (await localStore.get(created.id))!.updatedAt

    await localStore.patchMeta(created.id, { starred: true, tags: ['demo', 'Demo'] })

    const after = (await localStore.get(created.id))!
    expect(after.starred).toBe(true)
    expect(after.tags).toEqual(['demo'])
    expect(after.updatedAt).toBe(before)

    // The index row has to move in lockstep, or the list and the model disagree.
    const [row] = await localStore.list()
    expect(row).toMatchObject({ starred: true, tags: ['demo'] })
  })

  it('renames through patchMeta', async () => {
    const created = await localStore.create('Old')
    await localStore.patchMeta(created.id, { name: 'New' })
    expect((await localStore.list())[0].name).toBe('New')
  })

  it('ignores a patch for a model that is gone', async () => {
    await expect(localStore.patchMeta('nope', { starred: true })).resolves.toBeUndefined()
  })

  it('records a view without bumping updatedAt', async () => {
    const created = await localStore.create('Mortgage')
    const before = (await localStore.get(created.id))!.updatedAt

    await localStore.touch(created.id)

    const after = (await localStore.get(created.id))!
    expect(after.updatedAt).toBe(before)
    expect(after.lastViewedAt).toBeGreaterThanOrEqual(before)
    expect((await localStore.list())[0].lastViewedAt).toBe(after.lastViewedAt)
  })

  it('deep-copies on duplicate so the copy shares no entity objects', async () => {
    const source = await localStore.create('Mortgage')
    source.layers = [{ id: 'L1', name: 'Source', objects: [{ id: 'O1', name: 'app', children: [] }] }]
    await localStore.save(source)

    const copy = await localStore.duplicate(source.id)
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Mortgage (copy)')

    copy.layers[0].objects[0].name = 'edited'
    await localStore.save(copy)

    const original = await localStore.get(source.id)
    expect(original!.layers[0].objects[0].name).toBe('app')
  })

  it('takes a name override on duplicate', async () => {
    const source = await localStore.create('Mortgage')
    expect((await localStore.duplicate(source.id, 'Fork')).name).toBe('Fork')
  })

  it('refuses to duplicate a model that is gone', async () => {
    await expect(localStore.duplicate('nope')).rejects.toThrow(/No model/)
  })

  it('removes many at once, leaving the rest', async () => {
    const a = await localStore.create('A')
    const b = await localStore.create('B')
    const c = await localStore.create('C')

    await localStore.removeMany([a.id, c.id])

    const remaining = await localStore.list()
    expect(remaining.map((m) => m.id)).toEqual([b.id])
    expect(await localStore.get(a.id)).toBeNull()
  })

  it('drops the version history with the model', async () => {
    const created = await localStore.create('Mortgage')
    await localStore.saveVersion(created.id, 'v1')
    expect(await localStore.listVersions(created.id)).toHaveLength(1)

    await localStore.remove(created.id)
    expect(await localStore.listVersions(created.id)).toHaveLength(0)
  })

  it('reads an index written before the browser existed', async () => {
    // Exactly the shape the old summarize() wrote — no tags/starred/lastViewedAt.
    localStorage.setItem(
      INDEX_KEY,
      JSON.stringify([
        {
          id: 'legacy',
          name: 'Legacy',
          createdAt: 1,
          updatedAt: 7,
          layerCount: 2,
          entityCount: 9,
          transitionCount: 3,
        },
      ]),
    )

    const [row] = await localStore.list()
    expect(row.tags).toEqual([])
    expect(row.starred).toBe(false)
    expect(row.lastViewedAt).toBe(7)
  })

  it('survives a corrupt entry rather than throwing', async () => {
    localStorage.setItem(INDEX_KEY, '{not json')
    expect(await localStore.list()).toEqual([])
  })
})
