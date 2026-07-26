// The Model Viewer canvas: layer columns, object cards, attribute rows.
//
// Rendering strategy — a hybrid, chosen for density:
//  - Cards and rows are DOM. Text stays crisp, hit-testing and inline editing
//    come for free, and the browser does the text layout.
//  - Only cards intersecting the viewport are mounted, and within a tall card
//    only the visible slice of rows is mounted, so live node count scales with
//    the screen rather than with the model.
//  - Transitions are one canvas layer underneath (see TransitionLayer).
//
// The canvas SCROLLS; it does not free-pan. The world sits in a normal
// overflow:auto container with real scrollbars, so position is predictable and
// you can never lose the model off-screen.
//
// The layer band is a single row pinned to the top of the viewport, OUTSIDE the
// scroller, counter-translated by scrollLeft. That keeps layer names visible
// while scrolling down a tall model while staying aligned with their columns.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ancestorsOf, buildIndex } from '../model/index'
import { registerSearchHandler } from '../shell/searchBridge'
import { registerRailAction } from '../shell/railActions'
import ModelSearch from './ModelSearch'
import ImportDialog from './ImportDialog'
import ExportDialog from './ExportDialog'
import type { SearchHit } from './searchModel'
import {
  addAttribute,
  addLayer,
  addObject,
  addTransition,
  deleteEntities,
  deletePreservingTransitions,
  removeTransitions,
  renameEntity,
  sortChildren,
  type AddResult,
} from '../model/edit'
import { copyEntities, paste, type Clipboard, type PasteTarget } from '../model/clipboard'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { hitTestTransitions } from './edgeGeometry'
import {
  CARD_HEADER_HEIGHT,
  CARD_WIDTH,
  INDENT,
  LAYER_HEADER_HEIGHT,
  ROW_HEIGHT,
  layoutModel,
  type LayoutCard,
} from '../model/layout'
import type { EntityId, LineageModel } from '../model/types'
import TransitionLayer from './TransitionLayer'
import './modeling.css'

/** Rows rendered above and below the visible slice, to hide scroll tearing. */
const ROW_OVERSCAN = 6

interface Props {
  model: LineageModel
  onChange: (next: LineageModel) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

export default function ModelViewer({
  model,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const [collapsed, setCollapsed] = useState<ReadonlySet<EntityId>>(new Set())
  const [selection, setSelection] = useState<ReadonlySet<EntityId>>(new Set())
  /** Picked transitions, by transition id — kept separate from entity selection. */
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<EntityId>>(new Set())
  /** Non-null while picking a transition target. */
  const [connectFrom, setConnectFrom] = useState<EntityId | null>(null)
  /** Entity whose name is being edited in place. */
  const [editing, setEditing] = useState<EntityId | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  // Local, not the system clipboard: the payload is a model subtree with
  // transition bookkeeping, which has no sensible text/plain representation.
  const clipboard = useRef<Clipboard | null>(null)
  /** Entity to scroll into view once the layout reflects any expansion. */
  const [reveal, setReveal] = useState<EntityId | null>(null)

  const index = useMemo(() => buildIndex(model), [model])
  const layout = useMemo(() => layoutModel(model, collapsed), [model, collapsed])
  const parentOf = useCallback(
    (id: EntityId) => index.entries.get(id)?.parentId ?? null,
    [index],
  )

  // The trace: everything one hop from any selected entity. Highlighting both
  // endpoints is what makes a selected row's lineage legible inside a bundle.
  const highlighted = useMemo(() => {
    const out = new Set<EntityId>(selection)
    for (const id of selection) {
      for (const to of index.outgoing.get(id) ?? []) out.add(to)
      for (const from of index.incoming.get(id) ?? []) out.add(from)
    }
    return out
  }, [selection, index])

  useEffect(() => {
    const host = scrollRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const onScroll = () => {
    const host = scrollRef.current
    if (host) setScroll({ x: host.scrollLeft, y: host.scrollTop })
  }

  // Claim the shell's search triggers (rail button and Cmd+K) while mounted.
  useEffect(() => registerSearchHandler(() => setSearchOpen(true)), [])

  // Same for the rail's Import/Export buttons, which are commands rather than
  // destinations and act on the model this component holds.
  useEffect(() => registerRailAction('import', () => setImportOpen(true)), [])
  useEffect(() => registerRailAction('export', () => setExportOpen(true)), [])

  /**
   * Selects every entity carrying the picked name and brings the first into
   * view, expanding whatever was collapsed over it.
   */
  const onPickSearchHit = (hit: SearchHit) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      // A match can be buried under collapsed ancestors, and a collapsed layer
      // renders no cards at all. Selecting something invisible would look like
      // the search silently failed, so open the path to every match.
      for (const id of hit.ids) {
        next.delete(id)
        for (const ancestor of ancestorsOf(index, id)) next.delete(ancestor.id)
      }
      return next
    })
    setSelection(new Set(hit.ids))
    setSelectedEdges(new Set())
    setReveal(hit.ids[0])
    setSearchOpen(false)
  }

  // Runs after the layout has been recomputed for any expansion above, so the
  // anchor we scroll to is the final one rather than a pre-expansion position.
  useEffect(() => {
    if (!reveal) return
    const anchor = layout.anchors.get(reveal)
    const host = scrollRef.current
    if (anchor && host) {
      host.scrollTo({
        left: Math.max(0, anchor.left - host.clientWidth / 2 + CARD_WIDTH / 2),
        top: Math.max(0, anchor.cy - host.clientHeight / 2),
        behavior: 'smooth',
      })
    }
    setReveal(null)
  }, [reveal, layout])

  const toggle = (id: EntityId) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Click semantics: plain replaces, ctrl/cmd toggles, so multi-select is additive. */
  const select = (id: EntityId, additive: boolean) => {
    if (connectFrom) {
      onChange(addTransition(model, connectFrom, id))
      setConnectFrom(null)
      return
    }
    if (!additive) setSelectedEdges(new Set())
    setSelection((prev) => {
      if (!additive) return new Set([id])
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Clicking the empty canvas picks the nearest transition, or clears.
   *
   * The edge canvas is pointer-events:none (it must be, or it would swallow
   * every click meant for a card), so picking is done geometrically here rather
   * than by hit-testing the canvas itself.
   */
  const onWorldClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.mv-card')) return

    const rect = e.currentTarget.getBoundingClientRect()
    const worldX = e.clientX - rect.left
    const worldY = e.clientY - rect.top
    const hit = hitTestTransitions(layout, parentOf, model.transitions, worldX, worldY)
    const additive = e.ctrlKey || e.metaKey

    if (!hit) {
      if (!additive) {
        setSelectedEdges(new Set())
        setSelection(new Set())
      }
      return
    }
    if (!additive) setSelection(new Set())
    setSelectedEdges((prev) => {
      if (!additive) return new Set([hit])
      const next = new Set(prev)
      if (next.has(hit)) next.delete(hit)
      else next.add(hit)
      return next
    })
  }

  const commitRename = (id: EntityId, name: string) => {
    const trimmed = name.trim()
    const current = index.entries.get(id)?.name
    // Empty names would make an entity unclickable and unfindable; treat a
    // cleared field as a cancel rather than silently naming something ''.
    if (trimmed && trimmed !== current) onChange(renameEntity(model, id, trimmed))
    setEditing(null)
  }

  /** Applies an add, then selects the new entity and opens it for renaming. */
  const applyAdd = (result: AddResult) => {
    onChange(result.model)
    setSelection(new Set([result.id]))
    setEditing(result.id)
  }

  const doCopy = (ids: ReadonlySet<EntityId>) => {
    const clip = copyEntities(model, ids)
    if (clip) clipboard.current = clip
  }

  const doPaste = (target: PasteTarget) => {
    if (clipboard.current) onChange(paste(model, clipboard.current, target))
  }

  const deleteSelected = useCallback(() => {
    if (selection.size === 0 && selectedEdges.size === 0) return
    // Entities first, then edges: deleting an entity already removes the
    // transitions touching it, so any still-selected edge is one the user picked
    // independently of the entities going away.
    let next = model
    if (selection.size > 0) next = deleteEntities(next, selection)
    if (selectedEdges.size > 0) next = removeTransitions(next, selectedEdges)
    onChange(next)
    setSelection(new Set())
    setSelectedEdges(new Set())
  }, [model, onChange, selection, selectedEdges])

  const descendantsOf = (id: EntityId): EntityId[] => {
    const out: EntityId[] = []
    const walk = (parent: EntityId) => {
      for (const entry of index.entries.values()) {
        if (entry.parentId === parent) {
          out.push(entry.id)
          walk(entry.id)
        }
      }
    }
    walk(id)
    return out
  }

  /**
   * Builds the menu for whatever was right-clicked. Item sets differ by kind
   * because the vocabulary genuinely differs — a layer holds objects, an object
   * holds attributes, and an attribute nests further attributes (becoming a
   * Group in the process).
   */
  const openMenu = (e: React.MouseEvent, targetId: EntityId | null) => {
    e.preventDefault()
    e.stopPropagation()

    const canPaste = clipboard.current !== null
    // Right-clicking inside an existing multi-selection acts on all of it;
    // right-clicking outside one re-selects just that entity.
    const multi = targetId !== null && selection.has(targetId) && selection.size > 1
    const acting: ReadonlySet<EntityId> = multi
      ? selection
      : new Set(targetId ? [targetId] : [])
    if (targetId && !multi) setSelection(new Set([targetId]))

    const items: MenuItem[] = []

    if (!targetId) {
      items.push({ key: 'add-layer', label: 'Add layer', onSelect: () => applyAdd(addLayer(model)) })
      items.push({
        key: 'paste',
        label: 'Paste as layer',
        disabled: !canPaste,
        onSelect: () => doPaste({ mode: 'canvas' }),
      })
      setMenu({ x: e.clientX, y: e.clientY, items })
      return
    }

    const entry = index.entries.get(targetId)
    if (!entry) return

    if (multi) {
      items.push(
        { key: 'copy', label: `Copy ${selection.size} entities`, onSelect: () => doCopy(acting) },
        {
          key: 'cut',
          label: `Cut ${selection.size} entities`,
          onSelect: () => {
            doCopy(acting)
            onChange(deleteEntities(model, acting))
            setSelection(new Set())
          },
        },
        {
          key: 'delete',
          label: `Delete ${selection.size} entities`,
          separated: true,
          danger: true,
          onSelect: deleteSelected,
        },
        {
          key: 'delete-preserve',
          label: 'Delete (preserve transitions)',
          danger: true,
          onSelect: () => {
            onChange(deletePreservingTransitions(model, acting))
            setSelection(new Set())
          },
        },
      )
      setMenu({ x: e.clientX, y: e.clientY, items })
      return
    }

    if (entry.kind === 'layer') {
      items.push(
        { key: 'add-object', label: 'Add object', onSelect: () => applyAdd(addObject(model, targetId)) },
        {
          key: 'add-layer-before',
          label: 'Add layer before',
          separated: true,
          onSelect: () => applyAdd(addLayer(model, { relativeTo: targetId, side: 'before' })),
        },
        {
          key: 'add-layer-after',
          label: 'Add layer after',
          onSelect: () => applyAdd(addLayer(model, { relativeTo: targetId, side: 'after' })),
        },
      )
    } else if (entry.kind === 'object') {
      items.push(
        {
          key: 'add-attribute',
          label: 'Add attribute',
          onSelect: () => applyAdd(addAttribute(model, targetId)),
        },
        {
          key: 'add-object-before',
          label: 'Add object before',
          separated: true,
          onSelect: () =>
            applyAdd(addObject(model, entry.layerId, { relativeTo: targetId, side: 'before' })),
        },
        {
          key: 'add-object-after',
          label: 'Add object after',
          onSelect: () =>
            applyAdd(addObject(model, entry.layerId, { relativeTo: targetId, side: 'after' })),
        },
      )
    } else {
      items.push(
        {
          key: 'add-nested',
          label: 'Add nested attribute',
          onSelect: () => applyAdd(addAttribute(model, targetId)),
        },
        {
          key: 'add-before',
          label: 'Add attribute before',
          separated: true,
          onSelect: () =>
            applyAdd(
              addAttribute(model, entry.parentId ?? '', { relativeTo: targetId, side: 'before' }),
            ),
        },
        {
          key: 'add-after',
          label: 'Add attribute after',
          onSelect: () =>
            applyAdd(
              addAttribute(model, entry.parentId ?? '', { relativeTo: targetId, side: 'after' }),
            ),
        },
      )
    }

    items.push(
      { key: 'copy', label: 'Copy', separated: true, onSelect: () => doCopy(acting) },
      {
        key: 'cut',
        label: 'Cut',
        onSelect: () => {
          doCopy(acting)
          onChange(deleteEntities(model, acting))
          setSelection(new Set())
        },
      },
      {
        key: 'paste-into',
        label: entry.kind === 'layer' ? 'Paste as object' : 'Paste inside',
        disabled: !canPaste,
        onSelect: () => doPaste({ mode: 'into', id: targetId }),
      },
      {
        key: 'paste-before',
        label: 'Paste before',
        disabled: !canPaste,
        onSelect: () => doPaste({ mode: 'before', id: targetId }),
      },
      {
        key: 'paste-after',
        label: 'Paste after',
        disabled: !canPaste,
        onSelect: () => doPaste({ mode: 'after', id: targetId }),
      },
    )

    if (entry.hasChildren) {
      items.push(
        {
          key: 'sort-asc',
          label: 'Sort A–Z',
          separated: true,
          onSelect: () => onChange(sortChildren(model, targetId, 'asc')),
        },
        {
          key: 'sort-desc',
          label: 'Sort Z–A',
          onSelect: () => onChange(sortChildren(model, targetId, 'desc')),
        },
        {
          key: 'select-descendants',
          label: 'Select all descendants',
          onSelect: () => setSelection(new Set(descendantsOf(targetId))),
        },
      )
    }

    items.push(
      { key: 'rename', label: 'Rename', separated: true, onSelect: () => setEditing(targetId) },
      {
        key: 'delete',
        label: 'Delete',
        danger: true,
        onSelect: () => {
          onChange(deleteEntities(model, [targetId]))
          setSelection(new Set())
        },
      },
      {
        key: 'delete-preserve',
        label: 'Delete (preserve transitions)',
        danger: true,
        onSelect: () => {
          onChange(deletePreservingTransitions(model, [targetId]))
          setSelection(new Set())
        },
      },
    )

    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Never hijack typing in an input — this listener is on window, and the
      // rename field is an <input> inside the canvas.
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) onRedo()
        else onUndo()
        return
      }
      // Ctrl+Y is the Windows redo idiom, alongside Ctrl+Shift+Z.
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        onRedo()
        return
      }
      if (mod && e.key.toLowerCase() === 'c' && selection.size > 0) {
        e.preventDefault()
        doCopy(selection)
        return
      }
      if (mod && e.key.toLowerCase() === 'x' && selection.size > 0) {
        e.preventDefault()
        doCopy(selection)
        onChange(deleteEntities(model, selection))
        setSelection(new Set())
        return
      }
      if (mod && e.key.toLowerCase() === 'v' && clipboard.current) {
        e.preventDefault()
        // Paste inside the selection when there is one, otherwise onto the
        // canvas as new layers.
        const [first] = selection
        doPaste(first ? { mode: 'into', id: first } : { mode: 'canvas' })
        return
      }
      if (e.key === 'Escape') {
        setConnectFrom(null)
        setEditing(null)
        setSelection(new Set())
        setSelectedEdges(new Set())
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doCopy/doPaste are
    // recreated every render; the values they close over are listed instead.
  }, [deleteSelected, onUndo, onRedo, model, onChange, selection])

  // World-space rect currently on screen, used to cull cards and rows.
  const view = useMemo(
    () => ({
      top: scroll.y,
      bottom: scroll.y + size.height,
      left: scroll.x,
      right: scroll.x + size.width,
    }),
    [scroll, size],
  )

  const visibleCards = useMemo(
    () =>
      layout.cards.filter(
        (c) =>
          c.x + c.width > view.left &&
          c.x < view.right &&
          c.y + c.height > view.top &&
          c.y < view.bottom,
      ),
    [layout, view],
  )

  return (
    <div className="mv-host" data-connecting={connectFrom ? true : undefined}>
      {searchOpen && (
        <ModelSearch
          index={index}
          onPick={onPickSearchHit}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {importOpen && (
        <ImportDialog
          model={model}
          onImport={onChange}
          onClose={() => setImportOpen(false)}
        />
      )}
      {exportOpen && <ExportDialog model={model} onClose={() => setExportOpen(false)} />}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {/* Pinned layer band — one continuous row, counter-scrolled horizontally. */}
      <div className="mv-band" style={{ height: LAYER_HEADER_HEIGHT }}>
        <div className="mv-band-inner" style={{ transform: `translateX(${-scroll.x}px)` }}>
          {layout.layers.map((layer) => (
            <div
              key={layer.id}
              className="mv-layer"
              style={{
                left: layer.bandLeft,
                width: layer.bandWidth,
                height: LAYER_HEADER_HEIGHT,
              }}
              data-collapsed={layer.collapsed || undefined}
              data-selected={selection.has(layer.id) || undefined}
              onClick={(e) => {
                if (layer.collapsed) toggle(layer.id)
                else select(layer.id, e.ctrlKey || e.metaKey)
              }}
              onDoubleClick={() => !layer.collapsed && setEditing(layer.id)}
              onContextMenu={(e) => openMenu(e, layer.id)}
              title={layer.collapsed ? `Expand ${layer.name}` : layer.name}
            >
              {/* Anchored to the column centre, not the segment centre — the two
                  differ wherever a segment is widened to meet its neighbours. */}
              <span
                className="mv-layer-center"
                style={{ left: layer.centerX - layer.bandLeft }}
              >
                {layer.collapsed ? (
                  // Collapsed: just the expand affordance. Rotated text in a
                  // 28px strip is unreadable anyway — the name lives in the
                  // tooltip instead.
                  <ExpandIcon />
                ) : editing === layer.id ? (
                  <NameInput initial={layer.name} onCommit={(v) => commitRename(layer.id, v)} />
                ) : (
                  <span className="mv-layer-name">{layer.name}</span>
                )}
              </span>
              {!layer.collapsed && (
                <button
                  className="mv-layer-fold"
                  style={{ left: layer.centerX - layer.bandLeft + layer.width / 2 - 21 }}
                  title={`Collapse ${layer.name}`}
                  aria-label={`Collapse layer ${layer.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(layer.id)
                  }}
                >
                  <FoldIcon />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mv-scroll" ref={scrollRef} onScroll={onScroll}>
        <div
          className="mv-world"
          style={{ width: layout.width, height: layout.height }}
          onClick={onWorldClick}
          onContextMenu={(e) => {
            // Only the bare canvas — cards and rows handle their own.
            if ((e.target as HTMLElement).closest('.mv-card')) return
            openMenu(e, null)
          }}
        >
          <TransitionLayer
            layout={layout}
            transitions={model.transitions}
            parentOf={parentOf}
            offset={scroll}
            width={size.width}
            height={size.height}
            highlighted={highlighted}
            selected={selectedEdges}
          />

          {visibleCards.map((card) => (
            <Card
              key={card.id}
              card={card}
              view={view}
              selection={selection}
              highlighted={highlighted}
              connectFrom={connectFrom}
              editing={editing}
              properties={model.properties}
              onToggle={toggle}
              onSelect={select}
              onConnectFrom={setConnectFrom}
              onEdit={setEditing}
              onCommitRename={commitRename}
              onContextMenu={openMenu}
            />
          ))}
        </div>
      </div>

      <div className="mv-status">
        {connectFrom ? (
          <>Pick a target — Esc to cancel</>
        ) : (
          <>
            {layout.layers.length} layers · {layout.cards.length} objects ·{' '}
            {model.transitions.length} transitions
            {selection.size > 0 && <> · {selection.size} selected</>}
            {selectedEdges.size > 0 && <> · {selectedEdges.size} line(s) selected</>}
            {(canUndo || canRedo) && <> · ⌃Z undo</>}
          </>
        )}
      </div>
    </div>
  )
}

/** The mirror of FoldIcon: ⊢⊣ pushing outward, for "unfold this strip". */
function ExpandIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M1 1v10M11 1v10" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.4 6h5.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 4.4 3.4 6 5 7.6M7 4.4 8.6 6 7 7.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  )
}

/** The ⊣⊢ glyph Solidatus uses for "fold this layer down to a strip". */
function FoldIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M1 1v10M11 1v10" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 6h2.2M8.5 6H6.3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.2 4.4 6.6 6 5.2 7.6M6.8 4.4 5.4 6l1.4 1.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  )
}

/** Inline name editor. Selects the whole name on mount so typing replaces it. */
function NameInput({
  initial,
  onCommit,
}: {
  initial: string
  onCommit: (value: string) => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="mv-name-input"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onCommit(e.currentTarget.value)
        // Escape must not commit — restore by committing the original value.
        if (e.key === 'Escape') onCommit(initial)
      }}
    />
  )
}

interface CardProps {
  card: LayoutCard
  view: { top: number; bottom: number; left: number; right: number }
  selection: ReadonlySet<EntityId>
  highlighted: ReadonlySet<EntityId>
  connectFrom: EntityId | null
  editing: EntityId | null
  properties: LineageModel['properties']
  onToggle: (id: EntityId) => void
  onSelect: (id: EntityId, additive: boolean) => void
  onConnectFrom: (id: EntityId) => void
  onEdit: (id: EntityId) => void
  onCommitRename: (id: EntityId, name: string) => void
  onContextMenu: (e: React.MouseEvent, id: EntityId) => void
}

function Card({
  card,
  view,
  selection,
  highlighted,
  connectFrom,
  editing,
  properties,
  onToggle,
  onSelect,
  onConnectFrom,
  onEdit,
  onCommitRename,
  onContextMenu,
}: CardProps) {
  // Row-level virtualization. A card can be thousands of rows tall, so mount
  // only the slice the viewport covers and spacer-pad the rest.
  const rowsTop = card.y + CARD_HEADER_HEIGHT
  const firstVisible = Math.max(0, Math.floor((view.top - rowsTop) / ROW_HEIGHT) - ROW_OVERSCAN)
  const lastVisible = Math.min(
    card.rows.length,
    Math.ceil((view.bottom - rowsTop) / ROW_HEIGHT) + ROW_OVERSCAN,
  )
  const slice = card.rows.slice(firstVisible, Math.max(firstVisible, lastVisible))

  return (
    <div
      className="mv-card"
      style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
      data-selected={selection.has(card.id) || undefined}
      data-traced={highlighted.has(card.id) || undefined}
    >
      <div
        className="mv-card-header"
        style={{ height: CARD_HEADER_HEIGHT }}
        onClick={(e) => onSelect(card.id, e.ctrlKey || e.metaKey)}
        onDoubleClick={() => onEdit(card.id)}
        onContextMenu={(e) => onContextMenu(e, card.id)}
      >
        <button
          className="mv-twisty"
          data-collapsed={card.collapsed || undefined}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(card.id)
          }}
          aria-label={card.collapsed ? `Expand ${card.name}` : `Collapse ${card.name}`}
        />
        {editing === card.id ? (
          <NameInput initial={card.name} onCommit={(v) => onCommitRename(card.id, v)} />
        ) : (
          <span className="mv-card-name" title={card.name}>
            {card.name}
          </span>
        )}
        <span className="mv-count">
          {card.direct}
          <span className="mv-count-total">({card.total})</span>
        </span>
        <Port
          id={card.id}
          active={connectFrom === card.id}
          onConnectFrom={onConnectFrom}
          label={card.name}
        />
      </div>

      {slice.length > 0 && (
        <div style={{ paddingTop: firstVisible * ROW_HEIGHT }}>
          {slice.map((row) => (
            <div
              key={row.id}
              className="mv-row"
              style={{ height: ROW_HEIGHT, paddingLeft: 6 + row.depth * INDENT }}
              data-selected={selection.has(row.id) || undefined}
              data-traced={highlighted.has(row.id) || undefined}
              onClick={(e) => onSelect(row.id, e.ctrlKey || e.metaKey)}
              onDoubleClick={() => onEdit(row.id)}
              onContextMenu={(e) => onContextMenu(e, row.id)}
            >
              {row.hasChildren ? (
                <button
                  className="mv-twisty"
                  data-collapsed={row.collapsed || undefined}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(row.id)
                  }}
                  aria-label={row.collapsed ? `Expand ${row.name}` : `Collapse ${row.name}`}
                />
              ) : (
                <span className="mv-twisty-spacer" />
              )}
              {editing === row.id ? (
                <NameInput initial={row.name} onCommit={(v) => onCommitRename(row.id, v)} />
              ) : (
                <span className="mv-row-name" title={row.name}>
                  {row.name}
                </span>
              )}
              <Badges bag={properties[row.id]} />
              <Port
                id={row.id}
                active={connectFrom === row.id}
                onConnectFrom={onConnectFrom}
                label={row.name}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The connect handle on an entity's right edge — click to start a transition. */
function Port({
  id,
  active,
  label,
  onConnectFrom,
}: {
  id: EntityId
  active: boolean
  label: string
  onConnectFrom: (id: EntityId) => void
}) {
  return (
    <button
      className="mv-port"
      data-active={active || undefined}
      title={`Draw a transition from ${label}`}
      aria-label={`Draw a transition from ${label}`}
      onClick={(e) => {
        e.stopPropagation()
        onConnectFrom(id)
      }}
    />
  )
}

/**
 * Property-driven badges. These are display rules, not intrinsic fields — the
 * classification lives in the property table and the viewer decorates rows from
 * it, so a new rule never becomes a schema change.
 */
function Badges({ bag }: { bag: Record<string, string> | undefined }) {
  if (!bag) return null
  const out: React.ReactNode[] = []
  if (bag.CDE === 'true') out.push(<span key="cde" className="mv-badge" data-kind="cde">CDE</span>)
  const cls = bag.Classification
  if (cls) out.push(<span key="cls" className="mv-badge" data-kind={cls.toLowerCase()}>{cls}</span>)
  return out.length ? <span className="mv-badges">{out}</span> : null
}
