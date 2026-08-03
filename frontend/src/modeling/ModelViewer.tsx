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
import { Link } from '@tanstack/react-router'
import { ancestorsOf, buildIndex } from '../model/index'
import { pruneModel, traceFrom, type TraceDirection } from '../model/trace'
import { registerSearchHandler } from '../shell/searchBridge'
import { registerRailAction } from '../shell/railActions'
import ModelSearch from './ModelSearch'
import ImportDialog from './ImportDialog'
import ExportDialog from './ExportDialog'
import ShareDialog from './ShareDialog'
import AutoMapper, { type PickSlot } from './AutoMapper'
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
import { EntityTagDialog, TagManager } from './TagPanel'
import { applyProposals } from './applyProposals'
import { AssistantPanel } from './AssistantPanel'
import { ExplainPanel } from './ExplainPanel'
import { ViewsPanel } from './ViewsPanel'
import { VersionsPanel } from './VersionsPanel'
import { PropertiesPanel } from './PropertiesPanel'
import {
  activeFilterCount,
  applyFilter,
  EMPTY_FILTER,
  visibleTransitions,
  type ViewFilter,
} from '../model/filter'
import { TAGS_KEY, parseTags, setTags } from '../model/tags'
import { activeView, deleteView, saveView, toggleView } from '../model/views'
import { hitTestTransitions } from './edgeGeometry'
import {
  CARD_HEADER_HEIGHT,
  CARD_WIDTH,
  INDENT,
  LAYER_ADD_WIDTH,
  LAYER_HEADER_HEIGHT,
  ROW_HEIGHT,
  layoutModel,
  type LayoutCard,
} from '../model/layout'
import type { EntityId, LineageModel } from '../model/types'
import { foldTargets } from '../model/fold'
import { LogoMark } from '../shell/Logo'
import TransitionLayer from './TransitionLayer'
import './modeling.css'

/** Rows rendered above and below the visible slice, to hide scroll tearing. */
const ROW_OVERSCAN = 6

/** Shared empty set, so "no trace running" does not remount every card. */
const EMPTY_IDS: ReadonlySet<EntityId> = new Set()

/** Whether two id sets hold the same members — for "is this the same trace?". */
function sameSet(a: ReadonlySet<EntityId>, b: ReadonlySet<EntityId>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/**
 * Left padding every card header and row carries, holding the gutter the IN
 * handle sits in. Permanent rather than opened only while connecting: every
 * entity now has an in-handle as well as an out-handle, so the space is always
 * in use — and nothing reflows the moment a connection starts.
 */
const INBOUND_GUTTER = 17

interface Props {
  model: LineageModel
  onChange: (next: LineageModel) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  /**
   * A shared link, opened by someone who is not the owner.
   *
   * Enforced at the ONE place every edit passes through — `onChange` — rather
   * than by hiding each affordance, because the affordances are many (context
   * menus at four levels, drag, connect, rename, the assistant's proposals)
   * and a missed one is a stranger editing what they were shown. The menus and
   * the assistant are also suppressed below, so nothing offers an action that
   * would then be swallowed; the wrapper is what makes a miss harmless rather
   * than what makes the UI correct.
   */
  readOnly?: boolean
}

export default function ModelViewer({
  model,
  onChange: onChangeProp,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  readOnly = false,
}: Props) {
  // Shadows the prop deliberately: every existing call site below says
  // `onChange(...)`, and this is the single point they all pass through.
  const onChange = useCallback(
    (next: LineageModel) => {
      if (readOnly) return
      onChangeProp(next)
    },
    [readOnly, onChangeProp],
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const [collapsed, setCollapsed] = useState<ReadonlySet<EntityId>>(new Set())
  const [selection, setSelection] = useState<ReadonlySet<EntityId>>(new Set())
  /** Picked transitions, by transition id — kept separate from entity selection. */
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<EntityId>>(new Set())
  /**
   * The half-drawn transition, if any: the entity the FIRST click landed on.
   *
   * The first click is always the source and the second is always the target,
   * whichever side's port was used. The ports are therefore geometric — they
   * say where the line attaches, not which end of it this is.
   *
   * The previous scheme read the left port as "into me", so it flipped the
   * transition. That made a right-to-left edge unauthorable in practice: the
   * port facing the target you are drawing towards is the LEFT one, so reaching
   * for it produced a left-to-right edge instead — the user hit exactly this
   * and read it as arrows never pointing left. Direction now follows the order
   * of the clicks, which is the thing the user is actually thinking about.
   */
  const [pending, setPending] = useState<EntityId | null>(null)
  const startConnect = (id: EntityId) => setPending(id)
  /** Entity whose name is being edited in place. */
  const [editing, setEditing] = useState<EntityId | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [mapperOpen, setMapperOpen] = useState(false)
  // The Auto-Mapper's scope lives HERE, not in the panel, because it is filled
  // by clicking the canvas: the viewer owns the click, so it owns the answer.
  const [mapScope, setMapScope] = useState<{ source: EntityId | null; target: EntityId | null }>({
    source: null,
    target: null,
  })
  /** Non-null while the next entity click means "use this as the scope root". */
  const [picking, setPicking] = useState<PickSlot | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  /** Entities whose tags the dialog is editing; null when it's closed. */
  const [tagging, setTagging] = useState<EntityId[] | null>(null)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [filter, setFilter] = useState<ViewFilter>(EMPTY_FILTER)
  /**
   * Which of the two right-hand docks is showing, if either.
   *
   * One slot, not two: Views and Properties are both `.vw-panel`, both pinned
   * to the right edge, and both about 300px wide — open together they would sit
   * on top of each other. Making it a single "which dock" value also means the
   * rail buttons toggle between panels in one click instead of needing the
   * other one closed first.
   */
  const [dock, setDock] = useState<
    'views' | 'properties' | 'assistant' | 'explain' | 'versions' | null
  >(null)
  /**
   * The last entity clicked WITHOUT a modifier — where a shift-range starts.
   *
   * Held separately from the selection because a range has a direction: after
   * shift-clicking, the anchor must stay put so widening or narrowing the range
   * from the same origin keeps working. Deriving it from the selection instead
   * would move it on every shift-click and make the second one unpredictable.
   */
  const [anchor, setAnchor] = useState<EntityId | null>(null)
  // Local, not the system clipboard: the payload is a model subtree with
  // transition bookkeeping, which has no sensible text/plain representation.
  const clipboard = useRef<Clipboard | null>(null)
  /** Entity to scroll into view once the layout reflects any expansion. */
  const [reveal, setReveal] = useState<EntityId | null>(null)
  /**
   * The active lineage trace, or null.
   *
   * Both halves are kept. `reached` is what stays on the canvas, and it is held
   * as the RESULT rather than being recomputed, so the trace survives the
   * selection changing underneath it — you trace a column, then click through
   * what came back, and it stays put instead of retracing from wherever you
   * just clicked. `seeds` is what you traced FROM, which by then is the one
   * thing the canvas can no longer tell you: every card on screen is on the
   * trace, so nothing distinguishes the origin unless it is remembered.
   */
  const [trace, setTrace] = useState<{
    seeds: ReadonlySet<EntityId>
    reached: ReadonlySet<EntityId>
    dir: TraceDirection
  } | null>(null)

  const index = useMemo(() => buildIndex(model), [model])
  const parentOf = useCallback(
    (id: EntityId) => index.entries.get(id)?.parentId ?? null,
    [index],
  )

  /** Entities the Views filter matches; empty set means "no filter running". */
  const viewMatched = useMemo(() => applyFilter(model, filter), [model, filter])
  const viewFiltering = activeFilterCount(filter) > 0

  /**
   * What the canvas is narrowed to, from either narrowing mechanism.
   *
   * A trace is expressed as a match set so it rides the path the Views filter
   * already built — cards, rows, edges and the hit-tester all read `matched`,
   * and none of them needs to know which of the two produced it. Running both
   * INTERSECTS them, which is the only reading where adding a control cannot
   * widen the result, matching how the filter's own fields combine.
   *
   * A trace always hides rather than dims: its whole purpose is to take the
   * unrelated model off screen, and a dimmed trace is just the model again.
   */
  const matched = useMemo(() => {
    if (!trace) return viewMatched
    if (!viewFiltering) return trace.reached
    return new Set([...trace.reached].filter((id) => viewMatched.has(id)))
  }, [trace, viewMatched, viewFiltering])
  const filtering = viewFiltering || trace !== null
  const hideUnmatched = filter.hide || trace !== null

  /**
   * What the canvas is LAID OUT from — the model itself, or the traced subset.
   *
   * A trace prunes rather than hides. The Views filter can get away with hiding
   * because it is a lens over a model you are still working in: rows vanish,
   * their space stays, and nothing you were looking at moves. A trace is the
   * opposite request — take the unrelated model away — and hiding alone left
   * the traced entities exactly as far apart as they had been, in full-height
   * cards showing two rows each, separated by columns of nothing.
   *
   * Only the layout is swapped. Edits, selection, the index and the keyboard
   * all still run against the real model, and ids are untouched by pruning, so
   * everything on screen still refers to the entity it names.
   */
  const canvasModel = useMemo(
    () => (trace ? pruneModel(model, matched) : model),
    [trace, model, matched],
  )
  // Tracing also STRAIGHTENS: with the unrelated model gone there is one chain
  // left, and its rows are laid level across the layers so it reads as a line
  // rather than a staircase crossing every column on the way.
  const layout = useMemo(
    () => layoutModel(canvasModel, collapsed, !!trace),
    [canvasModel, collapsed, trace],
  )

  /**
   * Every selectable entity in READING order — layer, then each of its cards,
   * then that card's rows — which is what a shift-range runs along.
   *
   * Built from the LAYOUT rather than the model so it follows what is on screen:
   * a collapsed card contributes no rows, and shift-clicking across one must not
   * silently select the rows it is hiding. The layout already knows which rows
   * are rendered, so ordering off it keeps "everything between these two" and
   * "everything I can see between these two" the same statement.
   */
  const visualOrder = useMemo(() => {
    const out: EntityId[] = []
    for (const layer of layout.layers) {
      out.push(layer.id)
      for (const card of layout.cards) {
        if (card.layerId !== layer.id) continue
        out.push(card.id)
        for (const row of card.rows) out.push(row.id)
      }
    }
    return out
  }, [layout])

  /**
   * The transitions that exist as far as the canvas is concerned.
   *
   * In hide mode an unmatched card or row is not painted, so an edge into it
   * has nothing to land on and hangs in empty space pointing at a row you
   * cannot see. Dropping the edge with its endpoint is the only honest answer —
   * and it has to happen here rather than in the renderer so the hit-tester
   * agrees, or you could still click a line that isn't drawn.
   */
  const liveTransitions = useMemo(
    () => visibleTransitions(model.transitions, matched, filtering, hideUnmatched),
    [model.transitions, filtering, hideUnmatched, matched],
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
  // Not registered on a shared link: the reader has no account to publish
  // with, and re-sharing someone else's snapshot under your own name is not a
  // thing this should make easy.
  useEffect(() => {
    if (readOnly) return
    return registerRailAction('share', () => setShareOpen(true))
  }, [readOnly])
  useEffect(() => registerRailAction('mapping', () => setMapperOpen(true)), [])
  useEffect(() => registerRailAction('tags', () => setTagManagerOpen(true)), [])
  useEffect(
    () => registerRailAction('explain', () => setDock((d) => (d === 'explain' ? null : 'explain'))),
    [],
  )
  // Both docks toggle rather than open: a second click on the rail button is the
  // obvious way to put a docked panel away again.
  useEffect(
    () => registerRailAction('versions', () => setDock((d) => (d === 'versions' ? null : 'versions'))),
    [],
  )
  useEffect(
    () => registerRailAction('views', () => setDock((d) => (d === 'views' ? null : 'views'))),
    [],
  )
  useEffect(
    () =>
      registerRailAction('properties', () =>
        setDock((d) => (d === 'properties' ? null : 'properties')),
      ),
    [],
  )
  useEffect(
    () =>
      registerRailAction('assistant', () =>
        setDock((d) => (d === 'assistant' ? null : 'assistant')),
      ),
    [],
  )

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

  // Starting or clearing a trace rebuilds the whole canvas, so the viewport it
  // was scrolled to describes a picture that no longer exists — the reader ends
  // up staring at empty space where their model used to be and has to scroll
  // back up to find the chain. The layout puts the chain at the top; this puts
  // the reader there too. Horizontal position is left alone: the layers have
  // not moved sideways, and which stage you were looking at is still true.
  useEffect(() => {
    // Optional call: jsdom gives an element no `scrollTo`, and a viewport
    // convenience must not be the thing that fails a test run.
    scrollRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
  }, [trace])

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


  /**
   * Collapse/expand in bulk, as menu items — the rail button and the canvas's
   * own right-click menu both serve these, so they are built once.
   *
   * Groups and objects fold separately because they answer different questions:
   * folding the GROUPS leaves every object on screen with its top-level rows,
   * which is the shape you want for reading structure, while folding the
   * OBJECTS leaves the layers and the object names, which is the shape you want
   * for reading flow between them. A single "collapse all" would have to pick
   * one of those and would be wrong half the time.
   */
  const foldItems = (): MenuItem[] => {
    const item = (kind: 'groups' | 'objects' | 'layers', label: string): MenuItem => {
      const ids = foldTargets(model, kind)
      return {
        key: `fold-${kind}`,
        label,
        disabled: ids.length === 0,
        onSelect: () => setCollapsed(new Set(ids)),
      }
    }
    return [
      item('groups', 'Collapse all groups'),
      item('objects', 'Collapse all objects'),
      item('layers', 'Collapse all layers'),
      {
        key: 'unfold-all',
        label: 'Expand everything',
        separated: true,
        disabled: collapsed.size === 0,
        onSelect: () => setCollapsed(new Set()),
      },
    ]
  }

  // The rail button opens the same menu the canvas does, parked beside the rail
  // rather than at a pointer it has no position for.
  useEffect(
    () =>
      registerRailAction('fold', () =>
        setMenu({ x: 64, y: Math.round(window.innerHeight / 3), items: foldItems() }),
      ),
    // Rebuilt whenever the model or the fold state changes, so the items it
    // opens with are not a snapshot of the model as it was at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, collapsed],
  )

  const toggle = (id: EntityId) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Click semantics: plain replaces, ctrl/cmd toggles one, shift takes the
   * range from the anchor.
   *
   * Shift ADDS its range to what is already selected rather than replacing it,
   * so ctrl-picking a few rows and then shift-extending reads as one continuing
   * gesture. That also makes shift+ctrl unnecessary as a separate combination.
   */
  const select = (id: EntityId, mods: { additive: boolean; range: boolean }) => {
    // Scope-picking outranks everything: the user asked for the next click to
    // mean "this one", so it cannot also change the selection.
    if (picking) {
      setMapScope((prev) => ({ ...prev, [picking]: id }))
      setPicking(null)
      setSelection(new Set([id]))
      return
    }
    if (pending) {
      completeConnect(id)
      return
    }

    if (mods.range && anchor && anchor !== id) {
      const from = visualOrder.indexOf(anchor)
      const to = visualOrder.indexOf(id)
      // A stale anchor — its card collapsed, or its entity deleted — has no
      // position to run a range from. Fall back to a plain click rather than
      // selecting from the start of the model, which is what indexOf's -1 would
      // otherwise quietly mean.
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from]
        setSelectedEdges(new Set())
        setSelection((prev) => new Set([...prev, ...visualOrder.slice(lo, hi + 1)]))
        return
      }
    }

    if (!mods.additive) setSelectedEdges(new Set())
    // Both a plain and a ctrl click move the anchor: the next shift-range runs
    // from the last thing actually pointed at.
    setAnchor(id)
    setSelection((prev) => {
      if (!mods.additive) return new Set([id])
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
    const hit = hitTestTransitions(layout, parentOf, liveTransitions, worldX, worldY)
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

  /**
   * Lands a pending connection on `id`.
   *
   * Separate from `select` so a port is an unambiguous drop point: clicking one
   * can only ever mean "finish the line here", never "select this". The pending
   * entity is the source and `id` is the target — see `pending`.
   */
  const completeConnect = (id: EntityId) => {
    if (!pending) return
    // A self-loop is never what the second click meant; treat it as a cancel.
    if (id !== pending) onChange(addTransition(model, pending, id))
    setPending(null)
  }

  // While a connection is pending, BOTH ports of every entity in another layer
  // are drop points. Which side you land on is a matter of where the line looks
  // right attaching, not of direction — `curveFor` already picks each end's
  // side from the direction of travel, so a right-to-left edge draws itself
  // correctly however it was authored. Same-layer entities are left alone: the
  // source's own column is where the line starts, not where it lands.
  const pendingLayer = pending ? (index.entries.get(pending)?.layerId ?? null) : null

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
   * Start, re-aim, or clear a trace.
   *
   * One entry point for the keyboard and the menu, so a trace started either way
   * toggles the same: pressing again with the SAME seeds and the SAME direction
   * clears, while different seeds or a different direction re-trace from there —
   * which is how you walk a chain hop by hop, or turn a two-way trace into the
   * upstream half without first clearing it.
   */
  const runTrace = (dir: TraceDirection, from?: Iterable<EntityId>) => {
    const seeds = new Set(from ?? selection)
    if (seeds.size === 0) {
      setTrace(null)
      return
    }
    setTrace((prev) =>
      prev && prev.dir === dir && sameSet(prev.seeds, seeds)
        ? null
        : { seeds, dir, reached: traceFrom(index, seeds, dir) },
    )
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
    // Every item on this menu edits. On a shared link there is nothing to show
    // — and a menu of actions that silently do nothing is worse than none.
    if (readOnly) return

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
      items.push(...foldItems().map((it, i) => ({ ...it, separated: i === 0 })))
      setMenu({ x: e.clientX, y: e.clientY, items })
      return
    }

    const entry = index.entries.get(targetId)
    if (!entry) return

    if (multi) {
      items.push(
        {
          key: 'properties',
          label: `Properties of ${selection.size} entities`,
          onSelect: () => setDock('properties'),
        },
        {
          key: 'tags',
          label: `Tag ${selection.size} entities…`,
          onSelect: () => setTagging([...acting]),
        },
        { key: 'copy', label: `Copy ${selection.size} entities`, separated: true, onSelect: () => doCopy(acting) },
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
      // The panel reads the SELECTION, and openMenu has already made this entity
      // the selection above — so there is nothing to pass it.
      { key: 'properties', label: 'Properties', separated: true, onSelect: () => setDock('properties') },
      { key: 'explain', label: 'Explain this / what breaks', onSelect: () => setDock('explain') },
      // The only place the trace is discoverable — it was keyboard-only, which
      // means it did not exist for anyone who had not read the shortcut list.
      // Seeded from the clicked entity rather than the selection, matching every
      // other item on this menu.
      {
        key: 'trace',
        label: 'Trace lineage (T)',
        separated: true,
        onSelect: () => runTrace('both', [targetId]),
      },
      {
        key: 'trace-up',
        label: 'Trace upstream — where this comes from (⇧T)',
        onSelect: () => runTrace('up', [targetId]),
      },
      {
        key: 'trace-down',
        label: 'Trace downstream — what depends on this (⌥T)',
        onSelect: () => runTrace('down', [targetId]),
      },
      { key: 'tags', label: 'Tags…', onSelect: () => setTagging([targetId]) },
      { key: 'rename', label: 'Rename', onSelect: () => setEditing(targetId) },
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

  /**
   * Right-clicking bare canvas.
   *
   * Empty space is not "nowhere" — it is nearly always inside some layer's
   * column, below its objects. That is where you go to add another object, so
   * the menu is resolved from the click's x against the band segments (which
   * tile the whole canvas, leaving no dead zone). Only a click past the last
   * layer is treated as truly outside.
   */
  const onWorldContextMenu = (e: React.MouseEvent) => {
    if (readOnly) return
    if ((e.target as HTMLElement).closest('.mv-card, .mv-layer')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const worldX = e.clientX - rect.left

    const layer = layout.layers.find(
      (l) => worldX >= l.bandLeft && worldX < l.bandLeft + l.bandWidth,
    )
    if (!layer || layer.collapsed) {
      openMenu(e, null)
      return
    }

    e.preventDefault()
    e.stopPropagation()
    setSelection(new Set([layer.id]))

    const canPaste = clipboard.current !== null
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          key: 'add-object',
          label: `Add object to ${layer.name}`,
          onSelect: () => applyAdd(addObject(model, layer.id)),
        },
        {
          key: 'paste-object',
          label: 'Paste as object',
          disabled: !canPaste,
          onSelect: () => doPaste({ mode: 'into', id: layer.id }),
        },
        {
          key: 'add-layer-before',
          label: 'Add layer before',
          separated: true,
          onSelect: () => applyAdd(addLayer(model, { relativeTo: layer.id, side: 'before' })),
        },
        {
          key: 'add-layer-after',
          label: 'Add layer after',
          onSelect: () => applyAdd(addLayer(model, { relativeTo: layer.id, side: 'after' })),
        },
        {
          key: 'add-layer-end',
          label: 'Add layer at end',
          onSelect: () => applyAdd(addLayer(model)),
        },
        {
          key: 'sort-objects',
          label: 'Sort objects A–Z',
          separated: true,
          disabled: layer.objectCount < 2,
          onSelect: () => onChange(sortChildren(model, layer.id, 'asc')),
        },
        {
          key: 'select-descendants',
          label: `Select everything in ${layer.name}`,
          disabled: layer.objectCount === 0,
          onSelect: () => setSelection(new Set(descendantsOf(layer.id))),
        },
        {
          key: 'rename-layer',
          label: `Rename ${layer.name}`,
          separated: true,
          onSelect: () => setEditing(layer.id),
        },
        ...foldItems().map((it, i) => ({ ...it, separated: i === 0 })),
        {
          key: 'delete-layer',
          label: `Delete ${layer.name}`,
          danger: true,
          onSelect: () => {
            onChange(deleteEntities(model, [layer.id]))
            setSelection(new Set())
          },
        },
      ],
    })
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
      // Trace what flows through the selection, and nothing else.
      //
      // Bound to BOTH ⌃T and a bare T, because Ctrl+T is a reserved browser
      // shortcut: Chrome and Firefox open a new tab on it and the keydown never
      // reaches the page, so `preventDefault` has nothing to prevent. ⌃T is
      // what was asked for and works where the browser allows it (a PWA window,
      // a packaged build); T is the one that always arrives. Both are safe —
      // the handler has already returned for anything being typed into.
      //
      // Toggles, so the keystroke that narrows the canvas also restores it, but
      // re-pressing with a NEW selection retraces from there rather than
      // clearing — which is how you walk a chain hop by hop.
      //
      // Shift and Alt pick the half: ⇧T is upstream ("where did this come
      // from"), ⌥T downstream ("what breaks if I drop it"). Both are also on the
      // context menu, which is where anyone finds them — the modifiers are the
      // shortcut for someone who already knows, not the way in.
      if (e.key.toLowerCase() === 't') {
        e.preventDefault()
        runTrace(e.shiftKey ? 'up' : e.altKey ? 'down' : 'both')
        return
      }
      if (mod && e.key.toLowerCase() === 'c' && selection.size > 0) {
        e.preventDefault()
        doCopy(selection)
        return
      }
      // Bare C — connect from the selected entity: the keyboard's way into the
      // very gesture the ports already do by pointer. It only ARMS the
      // connection; the second entity is picked by clicking it, and `select`
      // already routes a click to `completeConnect` whenever one is pending.
      // So there is no second key to press and no second-key case to handle
      // here: selecting anything else lands the line by definition.
      //
      // Which is also why a press while one is pending can only mean cancel.
      // The source is necessarily still the selection (moving it would have
      // completed the line), so C is a toggle on one entity, the way T is.
      //
      // Layers are excluded. They are band segments with no ports, so they
      // cannot start a connection by pointer either, and `c` should not invent
      // a second way to author something the canvas otherwise cannot.
      //
      // readOnly is checked even though `onChange` already no-ops there: what
      // this sets is UI mode, not model state, and arming a connection that can
      // never land would leave a shared link stuck in crosshair with a red mark
      // on it and a status line asking for a target it will refuse.
      if (e.key.toLowerCase() === 'c' && !mod && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (readOnly) return
        if (pending) {
          setPending(null)
          return
        }
        if (selection.size !== 1) return
        const [id] = selection
        const kind = index.entries.get(id)?.kind
        if (kind !== 'object' && kind !== 'attribute') return
        setPending(id)
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
        setPicking(null)
        setPending(null)
        setEditing(null)
        setSelection(new Set())
        setSelectedEdges(new Set())
        setTrace(null)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
        return
      }
      // Enter on a selected row starts the NEXT one — which is why naming an
      // attribute and hitting Enter twice reads as "and another": the first
      // Enter commits the rename field (that keystroke never reaches here, the
      // input owns it), the second lands on the row it just named and opens a
      // fresh sibling below it. Typing a column list is then one pass of
      // name-Enter-Enter with no trip to the context menu.
      if (e.key === 'Enter' && !mod && !e.shiftKey && selection.size === 1) {
        const [id] = selection
        const entry = index.entries.get(id)
        if (!entry) return
        e.preventDefault()
        if (entry.kind === 'attribute') {
          // A sibling, not a child: nesting on Enter would make every list
          // typed this way a staircase.
          applyAdd(
            addAttribute(model, entry.parentId ?? '', { relativeTo: id, side: 'after' }),
          )
        } else if (entry.kind === 'object') {
          // An empty-ish card's first attribute — the same gesture one level up.
          applyAdd(addAttribute(model, id))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doCopy/doPaste are
    // recreated every render; the values they close over are listed instead.
    // `pending` and `readOnly` are listed because C reads both: a stale
    // `pending` would make the cancel press re-arm instead of clearing.
  }, [deleteSelected, onUndo, onRedo, model, onChange, selection, pending, readOnly])

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

  /**
   * The world is never narrower than the viewport.
   *
   * The add-layer slot runs from the band's closing line to the right edge of
   * the screen, and it can only do that if the surface it sits on actually
   * reaches that edge — a world sized purely to the layout stops wherever the
   * last column happens to end.
   */
  const worldWidth = Math.max(layout.width, size.width)

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
    <div
      className="mv-host"
      data-connecting={pending ? true : undefined}
      data-picking={picking ?? undefined}
      data-mapper={mapperOpen || undefined}
      data-scroll-y={scroll.y > 0 || undefined}
    >
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
      {shareOpen && <ShareDialog model={model} onClose={() => setShareOpen(false)} />}
      {mapperOpen && (
        <AutoMapper
          model={model}
          scope={mapScope}
          onScope={setMapScope}
          picking={picking}
          onPick={setPicking}
          onApply={onChange}
          onClose={() => {
            setPicking(null)
            setMapperOpen(false)
          }}
        />
      )}
      {tagging && (
        <EntityTagDialog
          model={model}
          ids={tagging}
          onSubmit={(tags) => {
            onChange(setTags(model, tagging, tags))
            setTagging(null)
          }}
          onClose={() => setTagging(null)}
        />
      )}
      {tagManagerOpen && (
        <TagManager
          model={model}
          selection={selection}
          onChange={onChange}
          onSelect={(ids) => {
            setSelection(new Set(ids))
            setSelectedEdges(new Set())
            // Close on Select: the point of selecting from here is to go and do
            // something with them on the canvas, which the panel is covering.
            setTagManagerOpen(false)
            if (ids.length) setReveal(ids[0])
          }}
          onClose={() => setTagManagerOpen(false)}
        />
      )}
      {dock === 'properties' && (
        <PropertiesPanel
          model={model}
          index={index}
          entityIds={[...selection]}
          transitionIds={[...selectedEdges]}
          onChange={onChange}
          // Tags keep their own editor even from here — see RESERVED_KEYS.
          onEditTags={setTagging}
          onSelect={(id) => {
            setSelection(new Set([id]))
            setSelectedEdges(new Set())
            setCollapsed((prev) => {
              // Walking to a parent or an endpoint is pointless if it is buried
              // under something collapsed — open the path, as search does.
              const next = new Set(prev)
              next.delete(id)
              for (const ancestor of ancestorsOf(index, id)) next.delete(ancestor.id)
              return next
            })
            setReveal(id)
          }}
          onClose={() => setDock(null)}
        />
      )}
      {dock === 'explain' && (
        <ExplainPanel
          model={model}
          index={index}
          selection={[...selection]}
          // Selecting from a sentence does not close the panel: the next
          // question usually follows from the answer, the same reasoning the
          // assistant dock uses.
          onSelect={(id) => {
            setSelection(new Set([id]))
            setSelectedEdges(new Set())
            setCollapsed((prev) => {
              const next = new Set(prev)
              next.delete(id)
              for (const ancestor of ancestorsOf(index, id)) next.delete(ancestor.id)
              return next
            })
            setReveal(id)
          }}
          onClose={() => setDock(null)}
        />
      )}
      {dock === 'versions' && (
        <VersionsPanel
          model={model}
          readOnly={readOnly}
          // Restore is ONE edit through the same path as every other, so ⌃Z
          // undoes it. That is the safety net; the diff shown before the button
          // is the part that stops it being needed.
          onRestore={(restored) => {
            onChange(restored)
            setDock(null)
          }}
          onClose={() => setDock(null)}
        />
      )}
      {dock === 'views' && (
        <ViewsPanel
          model={model}
          filter={filter}
          onChange={setFilter}
          matchCount={matched.size}
          // Saved views are model edits, so they go through onChange/undo like
          // any other — a view saved by mistake is undone with ⌃Z, and it
          // persists exactly when the rest of the model does.
          onSaveView={(name) => onChange(saveView(model, name, filter))}
          onDeleteView={(id) => onChange(deleteView(model, id))}
          onApplyView={(id) => setFilter(toggleView(model, filter, id))}
          onClose={() => setDock(null)}
        />
      )}
      {/* No assistant on a shared link: it proposes edits, and it would spend
          the OWNER's API key for a stranger who followed a URL. */}
      {dock === 'assistant' && !readOnly && (
        <AssistantPanel
          model={model}
          // The live canvas selection, so a question can say "this column".
          selection={[...selection]}
          // Selecting from a trace does NOT close the panel, unlike the Tag
          // manager: the answer and the entity it names are meant to be read
          // together, and the next question usually follows from the first.
          onSelect={(id) => {
            setSelection(new Set([id]))
            setSelectedEdges(new Set())
            setCollapsed((prev) => {
              // Revealing a buried entity is pointless if an ancestor is
              // collapsed over it — open the path, as search and Properties do.
              const next = new Set(prev)
              next.delete(id)
              for (const ancestor of ancestorsOf(index, id)) next.delete(ancestor.id)
              return next
            })
            setReveal(id)
          }}
          // One onChange for the whole batch, so an Apply-all is ONE undo step.
          // "Undo the assistant's suggestion" is a single intention; six ⌃Z to
          // reverse one click would be a worse promise than not offering it.
          onApplyEdits={(edits) => onChange(applyProposals(model, edits))}
          // An ordinary model edit: undoable, and persisted by the same
          // debounced save as everything else.
          onSetInstructions={(text) =>
            onChange({ ...model, assistantInstructions: text, updatedAt: Date.now() })
          }
          onClose={() => setDock(null)}
        />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      <div className="mv-topbar">
        {/* The mark links to the Model Browser, which a link recipient cannot
            open — it is behind the sign-in gate and holds someone else's
            models. On a shared link it is a logo, not a door. */}
        {readOnly ? (
          <span className="mv-home" aria-hidden="true">
            <LogoMark />
          </span>
        ) : (
          <Link to="/models" className="mv-home" aria-label="Lineage Studio — back to all models">
            <LogoMark />
          </Link>
        )}
        <span className="mv-topbar-name">{model.name}</span>
      </div>

      <div className="mv-scroll" ref={scrollRef} onScroll={onScroll}>
        <div
          className="mv-world"
          style={{ width: worldWidth, height: layout.height }}
          onClick={onWorldClick}
          onContextMenu={onWorldContextMenu}
        >
          {/*
            The layer band is sticky INSIDE the scroller rather than pinned
            outside it. A pinned band has to be counter-translated by scrollLeft
            from React state, which lags native scrolling by a frame — the band
            visibly drifted off its columns while scrolling horizontally. Sticky
            hands both axes to the browser: it moves with the content
            horizontally (always aligned) and pins vertically.
          */}
          <div className="mv-band" style={{ height: LAYER_HEADER_HEIGHT, width: worldWidth }}>
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
                else select(layer.id, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey })
              }}
              onDoubleClick={() => !readOnly && !layer.collapsed && setEditing(layer.id)}
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

            {/* The band's layer segments stop at `bandEnd`; this slot takes the
                rest of the row, all the way to the right edge of the screen, so
                "add a layer" is the open space where the next column would go
                rather than something you have to know a menu for. */}
            <button
              className="mv-layer-add"
              style={{
                left: layout.bandEnd,
                width: Math.max(LAYER_ADD_WIDTH, worldWidth - layout.bandEnd),
                height: LAYER_HEADER_HEIGHT,
              }}
              title="Add a layer"
              onClick={(e) => {
                e.stopPropagation()
                applyAdd(addLayer(model))
              }}
            >
              <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <span className="mv-layer-add-label">Add layer</span>
            </button>
          </div>

          <TransitionLayer
            layout={layout}
            transitions={liveTransitions}
            parentOf={parentOf}
            highlighted={highlighted}
            selected={selectedEdges}
            filtering={filtering}
            matched={matched}
          />

          {visibleCards
            // "Hide non-matching" drops whole cards here rather than styling
            // them away, so the layout keeps their space but nothing paints —
            // a display:none card would still cost a mount per card.
            .filter((card) => !(filtering && hideUnmatched) || matched.has(card.id))
            .map((card) => (
            <Card
              key={card.id}
              card={card}
              view={view}
              selection={selection}
              filtering={filtering}
              matched={matched}
              hideUnmatched={hideUnmatched}
              traceOrigin={trace?.seeds ?? EMPTY_IDS}
              highlighted={highlighted}
              pending={pending}
              pendingLayer={pendingLayer}
              onConnectTo={completeConnect}
              editing={editing}
              properties={model.properties}
              onToggle={toggle}
              onSelect={select}
              onConnectFrom={startConnect}
              onEdit={setEditing}
              onCommitRename={commitRename}
              onContextMenu={openMenu}
            />
          ))}
        </div>
      </div>

      <div className="mv-status">
        {pending ? (
          <>Pick where the transition goes — Esc to cancel</>
        ) : (
          <>
            {layout.layers.length} layers · {layout.cards.length} objects ·{' '}
            {model.transitions.length} transitions
            {/* The one always-visible sign that what is on screen is not the
                whole model — the rail badge is easy to miss from the canvas. */}
            {/* Named separately from a Views filter: a trace is not something
                you can find in the Views panel and turn off there, so the
                status line has to say what ends it. */}
            {trace && (
              <>
                {' '}
                ·{' '}
                <strong>
                  {trace.dir === 'up'
                    ? 'Tracing upstream'
                    : trace.dir === 'down'
                      ? 'Tracing downstream'
                      : 'Tracing'}
                </strong>
                : {matched.size} shown ·{' '}
                <span className="mv-hint">T or Esc to clear</span>
              </>
            )}
            {viewFiltering && (
              <>
                {' '}
                · <strong>{activeView(model, filter)?.name ?? 'Filtered'}</strong>:{' '}
                {viewMatched.size} shown
              </>
            )}
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
  pending: EntityId | null
  /** Layer the pending connection starts in; its own entities are not drop points. */
  pendingLayer: EntityId | null
  editing: EntityId | null
  properties: LineageModel['properties']
  onToggle: (id: EntityId) => void
  /** True while a Views filter is narrowing; without it `matched` means nothing. */
  filtering: boolean
  matched: ReadonlySet<EntityId>
  hideUnmatched: boolean
  /**
   * What the trace was taken FROM. Empty when nothing is being traced.
   *
   * Marked so the origin stays findable: once a trace has pruned the canvas,
   * every card left is on the trace, so being on it distinguishes nothing.
   */
  traceOrigin: ReadonlySet<EntityId>
  onSelect: (id: EntityId, mods: { additive: boolean; range: boolean }) => void
  onConnectFrom: (id: EntityId) => void
  onConnectTo: (id: EntityId) => void
  onEdit: (id: EntityId) => void
  onCommitRename: (id: EntityId, name: string) => void
  onContextMenu: (e: React.MouseEvent, id: EntityId) => void
}

function Card({
  card,
  view,
  selection,
  filtering,
  matched,
  hideUnmatched,
  traceOrigin,
  highlighted,
  pending,
  pendingLayer,
  editing,
  properties,
  onToggle,
  onSelect,
  onConnectFrom,
  onConnectTo,
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

  // Rows share their card's layer, so one test covers the card and every row
  // inside it. A pending connection makes BOTH ports of every entity in another
  // layer a drop point — either one lands the line here.
  const otherLayer = pending !== null && pendingLayer !== card.layerId
  const showInbound = otherLayer
  const dropRight = otherLayer

  return (
    <div
      className="mv-card"
      style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
      // Marks the card as a landing side, for styling that wants to know. The
      // gutter itself is permanent now (see INBOUND_GUTTER) — it no longer
      // opens on connect, so nothing reflows mid-gesture.
      data-inbound={showInbound || undefined}
      // Dimmed rather than removed: a filtered card keeps its place so the
      // shape of the model — which column things sit in, what is next to what —
      // survives the filter. Removal is opt-in via "Hide non-matching".
      data-dimmed={(filtering && !matched.has(card.id)) || undefined}
      data-selected={selection.has(card.id) || undefined}
      data-traced={highlighted.has(card.id) || undefined}
      data-trace-origin={traceOrigin.has(card.id) || undefined}
      data-connect-source={pending === card.id || undefined}
    >
      <div
        className="mv-card-header"
        style={{ height: CARD_HEADER_HEIGHT }}
        onClick={(e) => onSelect(card.id, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey })}
        onDoubleClick={() => onEdit(card.id)}
        onContextMenu={(e) => onContextMenu(e, card.id)}
      >
        <InPort
          id={card.id}
          label={card.name}
          drop={showInbound}
          active={pending === card.id}
          onConnectTo={onConnectTo}
          onConnectFrom={onConnectFrom}
        />
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
        <Badges bag={properties[card.id]} />
        <span className="mv-count">
          {card.direct}
          <span className="mv-count-total">({card.total})</span>
        </span>
        <Port
          id={card.id}
          active={pending === card.id}
          drop={dropRight}
          onConnectFrom={onConnectFrom}
          onConnectTo={onConnectTo}
          label={card.name}
        />
      </div>

      {slice.length > 0 && (
        <div style={{ paddingTop: firstVisible * ROW_HEIGHT }}>
          {slice
            // Still needed for a Views filter in hide mode, which lays out the
            // whole model and drops rows from it — a card's height is fixed by
            // the layout, so the row leaves a gap rather than moving anything
            // else. A TRACE never reaches this filter with work to do: it is
            // laid out from an already-pruned model, so every row here survived.
            .filter((row) => !(filtering && hideUnmatched) || matched.has(row.id))
            .map((row) => (
            <div
              key={row.id}
              className="mv-row"
              // The indent is inline, so the inbound gutter has to be added
              // here rather than in CSS — a class could never beat it.
              style={{
                height: ROW_HEIGHT,
                paddingLeft: INBOUND_GUTTER + row.depth * INDENT,
              }}
              data-dimmed={(filtering && !matched.has(row.id)) || undefined}
              data-selected={selection.has(row.id) || undefined}
              data-traced={highlighted.has(row.id) || undefined}
              data-trace-origin={traceOrigin.has(row.id) || undefined}
              data-connect-source={pending === row.id || undefined}
              onClick={(e) => onSelect(row.id, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey })}
              onDoubleClick={() => onEdit(row.id)}
              onContextMenu={(e) => onContextMenu(e, row.id)}
            >
              <InPort
                id={row.id}
                label={row.name}
                drop={showInbound}
                active={pending === row.id}
                onConnectTo={onConnectTo}
                onConnectFrom={onConnectFrom}
              />
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
                active={pending === row.id}
                drop={dropRight}
                onConnectFrom={onConnectFrom}
                onConnectTo={onConnectTo}
                label={row.name}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The handle on an entity's RIGHT edge.
 *
 * Two jobs, decided by `drop`: with nothing pending it starts a transition
 * whose source is this entity; while one is pending it lands the line here as
 * the target. The side carries no direction — see `pending`.
 */
function Port({
  id,
  active,
  drop,
  label,
  onConnectFrom,
  onConnectTo,
}: {
  id: EntityId
  active: boolean
  drop?: boolean
  label: string
  onConnectFrom: (id: EntityId) => void
  onConnectTo: (id: EntityId) => void
}) {
  const title = drop
    ? `Land the transition on ${label} (right edge)`
    : `Draw a transition from ${label} (right edge)`
  return (
    <button
      className="mv-port"
      data-active={active || undefined}
      data-drop={drop || undefined}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        if (drop) onConnectTo(id)
        else onConnectFrom(id)
      }}
    />
  )
}

/**
 * The counterpart of Port, on an entity's LEFT edge.
 *
 * It behaves identically to Port — first click starts a transition here, second
 * lands one — and exists only so a line can attach on whichever side it
 * approaches from. It does NOT mean "inbound": reading it that way is what made
 * right-to-left edges unauthorable (see `pending`).
 *
 * Positioned absolutely rather than in flow — an in-flow element would shove
 * every row's contents sideways the moment connect mode started.
 */
function InPort({
  id,
  label,
  drop,
  active,
  onConnectTo,
  onConnectFrom,
}: {
  id: EntityId
  label: string
  /** True while a pending connection is looking for its target. */
  drop?: boolean
  active?: boolean
  onConnectTo: (id: EntityId) => void
  onConnectFrom: (id: EntityId) => void
}) {
  // The side is named in the label only to keep the two ports distinguishable
  // to a screen reader (and to a test) — it carries no direction.
  const title = drop
    ? `Land the transition on ${label} (left edge)`
    : `Draw a transition from ${label} (left edge)`
  return (
    <button
      className="mv-port-in"
      data-drop={drop || undefined}
      data-active={active || undefined}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        if (drop) onConnectTo(id)
        else onConnectFrom(id)
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
  // Access first, and as a single letter: on a step's I/O rows this is the one
  // thing that distinguishes two otherwise identical row names (the table it
  // reads vs the table it writes), so it has to be readable without hovering.
  // R/W and their colours are lifted from the sandbox Sequence canvas — the
  // model opens looking like the run it was ported from.
  const access = bag.Access
  if (access === 'Read' || access === 'Write')
    out.push(
      <span
        key="access"
        className="mv-badge"
        data-kind={access.toLowerCase()}
        title={access}
        aria-label={access}
      >
        {access === 'Read' ? 'R' : 'W'}
      </span>,
    )
  if (bag.CDE === 'true') out.push(<span key="cde" className="mv-badge" data-kind="cde">CDE</span>)
  const cls = bag.Classification
  if (cls) out.push(<span key="cls" className="mv-badge" data-kind={cls.toLowerCase()}>{cls}</span>)
  // Tags last, so the fixed vocabularies above keep their position as a tag
  // list grows. `data-kind` is the lower-cased tag, which is what lets a known
  // tag like `notebook` carry its own colour without a second mechanism.
  for (const tag of parseTags(bag[TAGS_KEY]))
    out.push(
      <span key={`t:${tag}`} className="mv-badge" data-kind={tag.toLowerCase()} data-tag>
        {tag}
      </span>,
    )
  return out.length ? <span className="mv-badges">{out}</span> : null
}
