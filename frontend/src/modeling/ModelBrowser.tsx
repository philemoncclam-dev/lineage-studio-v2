// The Model Browser — the app's landing screen, and the only place a model is
// created, found, or deleted.
//
// It reads ModelSummary rows from the store's index, never whole models. That
// is the reason the index exists (see store.ts): opening the browser with fifty
// models must not deserialize fifty entity trees. Full models are loaded lazily
// and only for the two operations that genuinely need them — SOL export and
// duplicate — both of which go through the store.
//
// What is deliberately NOT here: sharing, groups, owners/viewers, trending, and
// "recently shared with me". Every one is a multi-user concept, and Lineage
// Studio has no auth and no server. See the scope note in model/browser.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  EMPTY_FILTER,
  filterModels,
  isFilterActive,
  SORT_LABELS,
  sortModels,
  tagCounts,
  toSolBundle,
  type BrowserFilter,
  type SortKey,
} from '../model/browser'
import { download } from '../model/exportTabular'
import { fabricSampleModel } from '../model/fabricSample'
import { localStore } from '../model/store'
import { BarsSpinner } from '../shell/BarsSpinner'
import { LogoMark } from '../shell/Logo'
import { registerSearchHandler } from '../shell/searchBridge'
import { ConfirmDialog, DetailsDialog, TagDialog } from './ModelDialogs'
import type { LineageModel, ModelSummary } from '../model/types'
import './modelBrowser.css'

type Layout = 'list' | 'grid'

/** Which modal is open, plus whatever it needs. `null` means none. */
type Modal =
  | { kind: 'create' }
  | { kind: 'rename'; model: ModelSummary }
  | { kind: 'tags'; models: ModelSummary[] }
  | { kind: 'delete'; models: ModelSummary[] }
  | null

// ===== Icons =====

const Icon = {
  star: (filled: boolean) => (
    <svg viewBox="0 0 24 24" className={filled ? 'mb-star on' : 'mb-star'}>
      <path d="m12 3.5 2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 17.3 6.7 20.2l1.1-6.1L3.4 9.9l6-.8z" />
    </svg>
  ),
  dots: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  ),
}

// ===== Dates =====

const RELATIVE = [
  [60_000, 1000, 'second'],
  [3_600_000, 60_000, 'minute'],
  [86_400_000, 3_600_000, 'hour'],
  [2_592_000_000, 86_400_000, 'day'],
  [31_536_000_000, 2_592_000_000, 'month'],
] as const

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "3 days ago" — the browser's lists are all about recency, not exact stamps. */
function ago(ms: number): string {
  const delta = Date.now() - ms
  if (delta < 45_000) return 'just now'
  for (const [ceiling, unit, name] of RELATIVE) {
    if (delta < ceiling) return rtf.format(-Math.round(delta / unit), name)
  }
  return rtf.format(-Math.round(delta / 31_536_000_000), 'year')
}

const exact = (ms: number) => new Date(ms).toLocaleString()

// ===== Page =====

export default function ModelBrowser() {
  const navigate = useNavigate()

  const [models, setModels] = useState<ModelSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [filter, setFilter] = useState<BrowserFilter>(EMPTY_FILTER)
  const [sort, setSort] = useState<SortKey>('viewed')
  const [layout, setLayout] = useState<Layout>('list')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)

  const searchRef = useRef<HTMLInputElement | null>(null)

  const reload = useCallback(async () => {
    try {
      const list = await localStore.list()
      setModels(list)
      // Drop selections for models that no longer exist, or the bulk bar keeps
      // counting ghosts after a delete.
      setSelected((prev) => {
        const alive = new Set(list.map((m) => m.id))
        const next = new Set([...prev].filter((id) => alive.has(id)))
        return next.size === prev.size ? prev : next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Claim Cmd+K for the browser's own search box — the shell's catalog palette
  // searches Fabric assets, which is not what you want while looking at models.
  useEffect(
    () =>
      registerSearchHandler(() => {
        searchRef.current?.focus()
        searchRef.current?.select()
      }),
    [],
  )

  /** Runs a store mutation, then refreshes the list and reports any failure. */
  const run = useCallback(
    async (label: string, work: () => Promise<void>) => {
      try {
        await work()
        await reload()
        setNotice(label)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [reload],
  )

  // Notices are transient; an error stays until the next successful action.
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(t)
  }, [notice])

  // Memoized, not `models ?? []` inline: a fresh array every render would give
  // the three memos below a changing dependency and defeat all of them.
  const all = useMemo(() => models ?? [], [models])
  const visible = useMemo(() => sortModels(filterModels(all, filter), sort), [all, filter, sort])
  const tags = useMemo(() => tagCounts(all), [all])
  const filtering = isFilterActive(filter)

  const selectedRows = useMemo(
    () => all.filter((m) => selected.has(m.id)),
    [all, selected],
  )

  const open = useCallback(
    async (id: string) => {
      await localStore.touch(id)
      void navigate({ to: '/model/$modelId', params: { modelId: id } })
    },
    [navigate],
  )

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const allVisibleSelected = visible.length > 0 && visible.every((m) => selected.has(m.id))

  const toggleTag = (tag: string) =>
    setFilter((prev) => ({
      ...prev,
      tags: prev.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? prev.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...prev.tags, tag],
    }))

  // ===== File actions =====
  //
  // The Actions menu that held "export the model list to CSV" and "import a SOL
  // file" is gone for now. Their engines (modelsToCsv, parseSolBundle,
  // prepareImport in model/browser.ts) are kept and still tested — the menu is
  // what was removed, not the capability.

  const exportSol = async (rows: ModelSummary[]) => {
    const loaded: LineageModel[] = []
    for (const row of rows) {
      const model = await localStore.get(row.id)
      if (model) loaded.push(model)
    }
    const name = loaded.length === 1 ? `${loaded[0].name}.sol.json` : 'models.sol.json'
    download(name, JSON.stringify(toSolBundle(loaded), null, 2), 'application/json')
  }


  /**
   * Seed the worked example and open it.
   *
   * A fresh id per press, rather than the constant the sample declares: the
   * store is keyed by id, so a second press would silently overwrite the first
   * copy along with any edits made to it.
   */
  const addSample = () =>
    run('Sample model added.', async () => {
      const sample = { ...fabricSampleModel(), id: crypto.randomUUID() }
      await localStore.save(sample)
      void navigate({ to: '/model/$modelId', params: { modelId: sample.id } })
    })

  // ===== Modal submission =====

  const closeModal = () => setModal(null)

  const onDetailsSubmit = (name: string, description: string) => {
    if (modal?.kind === 'create') {
      closeModal()
      void run('Model created.', async () => {
        const created = await localStore.create(name)
        if (description) await localStore.patchMeta(created.id, { description })
        void navigate({ to: '/model/$modelId', params: { modelId: created.id } })
      })
    } else if (modal?.kind === 'rename') {
      const { id } = modal.model
      closeModal()
      void run('Renamed.', () => localStore.patchMeta(id, { name, description }))
    }
  }

  const onTagsSubmit = (next: string[]) => {
    if (modal?.kind !== 'tags') return
    const ids = modal.models.map((m) => m.id)
    closeModal()
    void run(`Tags updated on ${ids.length} model${ids.length === 1 ? '' : 's'}.`, async () => {
      for (const id of ids) await localStore.patchMeta(id, { tags: next })
    })
  }

  const onDeleteConfirm = () => {
    if (modal?.kind !== 'delete') return
    const ids = modal.models.map((m) => m.id)
    closeModal()
    void run(`Deleted ${ids.length} model${ids.length === 1 ? '' : 's'}.`, () =>
      localStore.removeMany(ids),
    )
  }

  // ===== Render =====

  if (error && !models) {
    return <div className="mv-fallback">Couldn’t open the model browser: {error}</div>
  }
  if (!models) {
    return (
      <div className="mv-fallback">
        <BarsSpinner size={16} /> Loading models…
      </div>
    )
  }

  return (
    <div className="mb" data-layout={layout}>
      <header className="mb-top">
        <span className="mb-brand" aria-hidden>
          <LogoMark />
        </span>
        <h1 className="mb-title">Models</h1>

        <div className="mb-top-spacer" />

        {/* This screen hides the shell's icon rail (see railConfig.isChromeless),
            so it carries the mode switch itself — otherwise the landing screen
            is a dead end. Models is the current side and is inert. */}
        <div className="mb-segmented" role="group" aria-label="Mode">
          <span className="mb-seg on" aria-current="page">
            Models
          </span>
          <Link className="mb-seg" to="/fabric/overview">
            Fabric Toolkit
          </Link>
        </div>

        <button className="mb-btn primary" onClick={() => setModal({ kind: 'create' })}>
          Create
        </button>

        <button
          className="mb-btn"
          title="Add a worked example: sources, pipelines, a medallion workspace and a catalogued product"
          onClick={() => void addSample()}
        >
          Add sample
        </button>

        <button
          className="mb-icon-btn"
          onClick={() => setLayout(layout === 'list' ? 'grid' : 'list')}
          aria-label={layout === 'list' ? 'Switch to grid layout' : 'Switch to list layout'}
          title="Switch layout"
        >
          {layout === 'list' ? Icon.grid : Icon.list}
        </button>
      </header>

      <div className="mb-body">
        <main className="mb-main">
          <div className="mb-toolbar">
            <label className="mb-search">
              {Icon.search}
              <input
                ref={searchRef}
                value={filter.search}
                placeholder="Search models"
                onChange={(e) => setFilter((p) => ({ ...p, search: e.target.value }))}
                aria-label="Search models"
              />
            </label>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="mb-btn">{SORT_LABELS[sort]} ▾</button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="mb-menu" align="end" sideOffset={6}>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <DropdownMenu.Item
                      key={key}
                      className={`mb-menu-item${key === sort ? ' on' : ''}`}
                      onSelect={() => setSort(key)}
                    >
                      {SORT_LABELS[key]}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          {filter.tags.length > 0 && (
            <div className="mb-active-filters">
              {filter.tags.map((tag) => (
                <button className="mb-chip" key={tag} onClick={() => toggleTag(tag)}>
                  {tag}
                  <span className="mb-chip-x" aria-hidden>
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mb-count">
            {filtering ? (
              <>
                Showing {visible.length} of {all.length}
                <button className="mb-link" onClick={() => setFilter(EMPTY_FILTER)}>
                  Show all {all.length}
                </button>
              </>
            ) : (
              <>
                {all.length} model{all.length === 1 ? '' : 's'}
              </>
            )}
            {notice && <span className="mb-notice">{notice}</span>}
            {error && <span className="mb-error">{error}</span>}
          </div>

          {selected.size > 0 && (
            <div className="mb-bulk" role="region" aria-label="Actions on selected models">
              <strong>{selected.size} selected</strong>
              <button className="mb-btn" onClick={() => setModal({ kind: 'tags', models: selectedRows })}>
                Edit tags
              </button>
              <button className="mb-btn" onClick={() => void exportSol(selectedRows)}>
                Export
              </button>
              <button
                className="mb-btn danger"
                onClick={() => setModal({ kind: 'delete', models: selectedRows })}
              >
                Delete
              </button>
              <button className="mb-link" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="mb-empty">
              {all.length === 0 ? (
                <>
                  <p>No models yet.</p>
                  <button className="mb-btn primary" onClick={() => setModal({ kind: 'create' })}>
                    Create your first model
                  </button>
                </>
              ) : (
                <>
                  <p>No models match these filters.</p>
                  <button className="mb-link" onClick={() => setFilter(EMPTY_FILTER)}>
                    Clear the filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {layout === 'list' && (
                <div className="mb-head-row">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected(allVisibleSelected ? new Set() : new Set(visible.map((m) => m.id)))
                    }
                    aria-label="Select every listed model"
                  />
                  <span className="mb-col-name">Name</span>
                  <span className="mb-col-stats">Contents</span>
                  <span className="mb-col-date">Updated</span>
                  <span className="mb-col-menu" />
                </div>
              )}

              <ul className="mb-list" aria-label="Models">
                {visible.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    layout={layout}
                    selected={selected.has(model.id)}
                    expanded={expanded === model.id}
                    onToggleSelected={() => toggleSelected(model.id)}
                    onToggleExpanded={() =>
                      setExpanded((prev) => (prev === model.id ? null : model.id))
                    }
                    onOpen={() => void open(model.id)}
                    onStar={() =>
                      void run(model.starred ? 'Unstarred.' : 'Starred.', () =>
                        localStore.patchMeta(model.id, { starred: !model.starred }),
                      )
                    }
                    onRename={() => setModal({ kind: 'rename', model })}
                    onTags={() => setModal({ kind: 'tags', models: [model] })}
                    onDuplicate={() =>
                      void run('Duplicated.', async () => {
                        await localStore.duplicate(model.id)
                      })
                    }
                    onExport={() => void exportSol([model])}
                    onDelete={() => setModal({ kind: 'delete', models: [model] })}
                    onTagClick={toggleTag}
                  />
                ))}
              </ul>
            </>
          )}
        </main>
      </div>

      {modal?.kind === 'create' && (
        <DetailsDialog
          title="Create a model"
          submitLabel="Create"
          onSubmit={onDetailsSubmit}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'rename' && (
        <DetailsDialog
          title="Model details"
          submitLabel="Save"
          initialName={modal.model.name}
          initialDescription={modal.model.description}
          onSubmit={onDetailsSubmit}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'tags' && (
        <TagDialog
          bulk={modal.models.length > 1}
          initialTags={modal.models.length === 1 ? modal.models[0].tags : []}
          subject={
            modal.models.length === 1
              ? modal.models[0].name
              : `${modal.models.length} selected models`
          }
          suggestions={tags.map((t) => t.tag)}
          onSubmit={onTagsSubmit}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmDialog
          title={modal.models.length === 1 ? 'Delete this model?' : 'Delete these models?'}
          confirmLabel={`Delete ${modal.models.length === 1 ? 'model' : `${modal.models.length} models`}`}
          body={
            <>
              <p className="mb-lede">
                {modal.models.length === 1
                  ? modal.models[0].name
                  : modal.models.map((m) => m.name).join(', ')}
              </p>
              <p className="mb-warn">
                This also deletes the version history. A deleted model cannot be restored.
              </p>
            </>
          }
          onConfirm={onDeleteConfirm}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

// ===== One row =====

interface RowProps {
  model: ModelSummary
  layout: Layout
  selected: boolean
  expanded: boolean
  onToggleSelected: () => void
  onToggleExpanded: () => void
  onOpen: () => void
  onStar: () => void
  onRename: () => void
  onTags: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void
  onTagClick: (tag: string) => void
}

function ModelRow({
  model,
  layout,
  selected,
  expanded,
  onToggleSelected,
  onToggleExpanded,
  onOpen,
  onStar,
  onRename,
  onTags,
  onDuplicate,
  onExport,
  onDelete,
  onTagClick,
}: RowProps) {
  return (
    <li className="mb-row-wrap" data-selected={selected || undefined}>
      {/* The row body expands; the name is a separate button that opens the
          model. The reference browser warns users not to "accidentally click a
          link" — here the two targets simply don't overlap. */}
      <div className="mb-row" onClick={onToggleExpanded}>
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggleSelected}
          aria-label={`Select ${model.name}`}
        />

        <button
          className="mb-star-btn"
          onClick={(e) => {
            e.stopPropagation()
            onStar()
          }}
          aria-label={model.starred ? `Unstar ${model.name}` : `Star ${model.name}`}
          aria-pressed={model.starred}
        >
          {Icon.star(model.starred)}
        </button>

        <div className="mb-col-name">
          <button
            className="mb-name"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
          >
            {model.name}
          </button>
          {model.description && <p className="mb-desc">{model.description}</p>}
          {model.tags.length > 0 && (
            <div className="mb-row-tags">
              {model.tags.map((tag) => (
                <button
                  className="mb-chip small"
                  key={tag}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTagClick(tag)
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="mb-col-stats">
          {model.layerCount} layers · {model.entityCount} entities · {model.transitionCount} lines
        </span>

        <span className="mb-col-date" title={exact(model.updatedAt)}>
          {ago(model.updatedAt)}
        </span>

        <span className="mb-col-menu">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="mb-icon-btn small"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Actions for ${model.name}`}
              >
                {Icon.dots}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="mb-menu" align="end" sideOffset={6}>
                <DropdownMenu.Item className="mb-menu-item" onSelect={onOpen}>
                  Open in the Model Viewer
                </DropdownMenu.Item>
                <DropdownMenu.Item className="mb-menu-item" onSelect={onRename}>
                  Name and description…
                </DropdownMenu.Item>
                <DropdownMenu.Item className="mb-menu-item" onSelect={onTags}>
                  Edit tags…
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="mb-menu-sep" />
                <DropdownMenu.Item className="mb-menu-item" onSelect={onDuplicate}>
                  Duplicate
                </DropdownMenu.Item>
                <DropdownMenu.Item className="mb-menu-item" onSelect={onExport}>
                  Export to SOL
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="mb-menu-sep" />
                <DropdownMenu.Item className="mb-menu-item danger" onSelect={onDelete}>
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </span>
      </div>

      {expanded && layout === 'list' && (
        <dl className="mb-detail">
          <div>
            <dt>Created</dt>
            <dd title={exact(model.createdAt)}>{ago(model.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd title={exact(model.updatedAt)}>{ago(model.updatedAt)}</dd>
          </div>
          <div>
            <dt>Last viewed</dt>
            <dd title={exact(model.lastViewedAt)}>{ago(model.lastViewedAt)}</dd>
          </div>
          <div>
            <dt>Layers</dt>
            <dd>{model.layerCount}</dd>
          </div>
          <div>
            <dt>Entities</dt>
            <dd>{model.entityCount}</dd>
          </div>
          <div>
            <dt>Transitions</dt>
            <dd>{model.transitionCount}</dd>
          </div>
          <div className="mb-detail-wide">
            <dt>Model ID</dt>
            <dd>
              <code>{model.id}</code>
            </dd>
          </div>
        </dl>
      )}
    </li>
  )
}
