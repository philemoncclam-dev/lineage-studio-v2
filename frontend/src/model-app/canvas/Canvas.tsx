import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Panel,
  useNodesState,
  useEdgesState,
  type NodeTypes,
  type Connection,
  type Node as RFNode,
  type Edge as RFEdge,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import type { Model, NodeType } from "../types";
import { TypeGlyph } from "../ui/TypeGlyph";
import { modelToFlow } from "./layout";
import { traceLineage } from "./traceLineage";
import ObjectContainer from "./ObjectContainer";
import LayerNode from "./LayerNode";
import LayerHeaders from "./LayerHeaders";
import { CollapseContext } from "./collapse";
import { MenuContext, type MenuTarget } from "./menu";
import { RenameContext } from "./rename";
import { ReorderContext } from "./reorder";
import { PickContext } from "./pick";
import { ContestedContext } from "./contested";
import type { ContestedMap } from "../realtime/conflictDetection";
import { nextFocusTarget, visibleFocusOrder, type ArrowDirection } from "./focusNav";
import { attributeLiveNarration, containerFocusNarration } from "./liveNarration";
import { useSettings } from "../settings";

const nodeTypes: NodeTypes = {
  container: ObjectContainer,
  layerNode: LayerNode,
};

const LEGEND: { type: NodeType; color: string; label: string }[] = [
  { type: "Layer", color: "var(--t-layer)", label: "Layer" },
  { type: "Object", color: "var(--t-object)", label: "Object" },
  { type: "Group", color: "var(--t-group)", label: "Group / table" },
  { type: "Attribute", color: "var(--t-attr)", label: "Attribute" },
];

interface Props {
  model: Model;
  selectedId: string | null;
  selectedIds: Set<string>;
  onSelect: (id: string | null, additive?: boolean) => void;
  onConnectAttrs: (sourceAttrId: string, targetAttrId: string) => void;
  onOpenMenu: (x: number, y: number, target: MenuTarget) => void;
  onDeleteEdges: (edgeIds: string[]) => void;
  // Notified whenever the set of selected edges changes (e.g. to drive an
  // edge inspector in the details panel).
  onEdgeSelection?: (edgeIds: string[]) => void;
  onReorderLayer: (draggedId: string, targetIndex: number) => void;
  onRenameLayer: (id: string, name: string) => void;
  onRenameNode: (id: string, name: string) => void;
  // Drag-reorder of attribute rows; omitted on read-only views.
  onReorderNode?: (id: string, targetId: string, pos: "before" | "after") => void;
  onAddLayer?: () => void;
  searchQuery?: string;
  filteredOut?: Set<string>;
  filterActive?: boolean;
  filterMode?: "dim" | "hide";
  // "Pick from canvas" mode for the mapper.
  pickMode?: boolean;
  pickSourceId?: string | null;
  pickTargetId?: string | null;
  onPickNode?: (nodeId: string) => void;
  // Multiplayer (src/realtime/): reports raw pointer position + the scroll
  // container's bounding rect/scroll offsets on every mouse move over the
  // canvas, so the caller can convert to scroll-space and broadcast it.
  // Omitted entirely for local/non-collaborative sessions (no listener, no
  // overhead).
  onCursorMove?: (
    clientX: number,
    clientY: number,
    rect: { left: number; top: number; scrollLeft: number; scrollTop: number }
  ) => void;
  // Peers' live cursors, already converted to *this* client's screen space by
  // the caller (see realtime/cursorMapping.ts) — Canvas just renders dots.
  liveCursors?: { userId: string; name: string; color: string; x: number; y: number }[];
  // Advisory-only "contested objects" map (see realtime/conflictDetection.ts):
  // object id -> remote collaborator(s) also currently focused on it. Drives
  // a subtle colored ring/pill on the affected node(s). Omitted entirely for
  // local/non-collaborative sessions.
  contested?: ContestedMap;
}

export default function Canvas({
  model,
  selectedId,
  selectedIds,
  onSelect,
  onConnectAttrs,
  onOpenMenu,
  onDeleteEdges,
  onEdgeSelection,
  onReorderLayer,
  onRenameLayer,
  onRenameNode,
  onReorderNode,
  onAddLayer,
  searchQuery = "",
  filteredOut,
  filterActive = false,
  filterMode = "dim",
  pickMode = false,
  pickSourceId = null,
  pickTargetId = null,
  onPickNode,
  onCursorMove,
  liveCursors,
  contested,
}: Props) {
  const { settings } = useSettings();
  const pickValue = useMemo(
    () => ({
      active: pickMode,
      sourceId: pickSourceId,
      targetId: pickTargetId,
      onPick: onPickNode ?? (() => {}),
    }),
    [pickMode, pickSourceId, pickTargetId, onPickNode]
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Collapse/expand every object and table at once (layers stay expanded).
  const collapseAll = useCallback(() => {
    setCollapsed(
      new Set(
        model.nodes
          .filter((n) => n.type === "Object" || n.type === "Group")
          .map((n) => n.id)
      )
    );
  }, [model.nodes]);
  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  // Layers hidden from the canvas entirely (session-only, like `collapsed`).
  // A hidden layer keeps a thin sliver column; its header stub restores it.
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const toggleHiddenLayer = useCallback((id: string) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // True while the user is dragging a new connection from an attribute handle;
  // drives CSS that lights up the potential target rows/handles.
  const [connecting, setConnecting] = useState(false);

  // Currently-selected lineage edges (independent of node selection, so
  // selecting an edge does not trigger the layer swimlane highlight). Multiple
  // edges can be selected by shift-clicking.
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const selectedEdgeSet = useMemo(() => new Set(selectedEdgeIds), [selectedEdgeIds]);

  // Mirror the edge selection out to the parent.
  useEffect(() => {
    onEdgeSelection?.(selectedEdgeIds);
  }, [selectedEdgeIds, onEdgeSelection]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState(960);
  const [canvasH, setCanvasH] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setCanvasW(e.contentRect.width);
      setCanvasH(e.contentRect.height);
    });
    ro.observe(el);
    setCanvasW(el.clientWidth);
    setCanvasH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Clear any selected edges when the node selection changes (selecting a node
  // and selecting an edge are mutually exclusive).
  useEffect(() => {
    if (selectedId) setSelectedEdgeIds([]);
  }, [selectedId]);

  // Live preview line from the picked source to the pointer while "pick from
  // canvas" waits for the target, drawn with the same dashed-accent style as
  // native drag-to-connect (connectionLineStyle below). Coordinates are
  // relative to wrapRef (the scrollable canvas), so scrolling doesn't desync
  // the line.
  const [previewLine, setPreviewLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null
  );
  useEffect(() => {
    if (!pickMode || !pickSourceId) {
      setPreviewLine(null);
      return;
    }
    const onMove = (e: MouseEvent) => {
      const wrap = wrapRef.current;
      // Attribute rows carry attr-row-<id>; scope endpoints (table headers,
      // object bands, layers) carry focus-node-<id>.
      const row =
        document.getElementById(`attr-row-${pickSourceId}`) ??
        document.getElementById(`focus-node-${pickSourceId}`);
      if (!wrap || !row) return;
      const wrapRect = wrap.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      setPreviewLine({
        x1: rowRect.left + rowRect.width / 2 - wrapRect.left + wrap.scrollLeft,
        y1: rowRect.top + rowRect.height / 2 - wrapRect.top + wrap.scrollTop,
        x2: e.clientX - wrapRect.left + wrap.scrollLeft,
        y2: e.clientY - wrapRect.top + wrap.scrollTop,
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [pickMode, pickSourceId]);

  // ── Keyboard navigation of canvas objects/tables/attributes ──────────────
  // A parallel "focused" id (distinct from `selectedId`) tracks which node the
  // Tab/Arrow-key user is currently on. Arrow keys move it via the pure
  // nextFocusTarget() (see focusNav.ts); Enter/Space commits it as the actual
  // selection (same onSelect the mouse path uses), so keyboard and mouse users
  // drive one shared selection model. Escape blurs back out of the canvas.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Text announced in the aria-live region — lineage narration for an
  // attribute, or a short "name, kind" announcement for a container.
  const [liveText, setLiveText] = useState("");

  // Move actual DOM focus to match `focusedId` whenever it changes (each
  // focusable row/band/header/layer carries a matching `focus-node-<id>` id —
  // see ObjectContainer.tsx / LayerNode.tsx).
  useEffect(() => {
    if (!focusedId) return;
    const el = document.getElementById(`focus-node-${focusedId}`);
    el?.focus({ preventScroll: false });
  }, [focusedId]);

  // Announce lineage (for attributes) or a brief identity announcement (for
  // layers/objects/tables) whenever the focused node changes.
  useEffect(() => {
    if (!focusedId) {
      setLiveText("");
      return;
    }
    const n = model.nodes.find((x) => x.id === focusedId);
    if (!n) return;
    setLiveText(
      n.type === "Attribute" ? attributeLiveNarration(model, focusedId) : containerFocusNarration(model, focusedId)
    );
  }, [focusedId, model]);

  const ARROW_KEYS: Record<string, ArrowDirection> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };

  // Tab into the canvas focuses the first node (if nothing focused yet);
  // arrow keys walk the tree; Enter/Space selects the focused node (mirroring
  // a click); Escape blurs out of the canvas entirely. Ignored while typing in
  // a field, so this never fights with inline-rename inputs.
  function handleCanvasKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = document.activeElement as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;

    // Home/End jump to the first/last focusable node in the flattened order —
    // fast travel for keyboard-only users across a large model.
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const order = visibleFocusOrder(model, collapsed);
      if (order.length) setFocusedId(e.key === "Home" ? order[0] : order[order.length - 1]);
      return;
    }

    const dir = ARROW_KEYS[e.key];
    if (dir) {
      e.preventDefault();
      // Tree-view expand/collapse: on a collapsible container (Object/Group),
      // Right expands a collapsed node in place and Left collapses an expanded
      // one, instead of moving focus. Otherwise arrows walk the tree as usual.
      const node = focusedId ? model.nodes.find((n) => n.id === focusedId) : null;
      const collapsible = node && (node.type === "Object" || node.type === "Group");
      if (collapsible && node) {
        if (dir === "right" && collapsed.has(node.id)) {
          toggle(node.id);
          return;
        }
        if (dir === "left" && !collapsed.has(node.id) && model.nodes.some((n) => n.parentId === node.id)) {
          toggle(node.id);
          return;
        }
      }
      const next = nextFocusTarget(model, collapsed, focusedId, dir);
      if (next) setFocusedId(next);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (!focusedId) return;
      e.preventDefault();
      onSelect(focusedId, e.shiftKey);
      return;
    }
    if (e.key === "Escape") {
      setFocusedId(null);
      (document.activeElement as HTMLElement | null)?.blur();
      wrapRef.current?.focus();
    }
  }

  // Trace the lineage (inputs + outputs) of every selected Attribute, unioning
  // their paths so multi-selecting attributes shows all their lineage.
  const trace = useMemo(() => {
    const tracedNodeIds = new Set<string>();
    const tracedEdgeIds = new Set<string>();
    for (const id of selectedIds) {
      if (model.nodes.find((n) => n.id === id)?.type !== "Attribute") continue;
      const r = traceLineage(model, id);
      r.tracedNodeIds.forEach((x) => tracedNodeIds.add(x));
      r.tracedEdgeIds.forEach((x) => tracedEdgeIds.add(x));
    }
    return { tracedNodeIds, tracedEdgeIds };
  }, [model, selectedIds]);

  const layout = useMemo(
    () =>
      modelToFlow(
        model,
        selectedId,
        collapsed,
        canvasW,
        trace.tracedNodeIds,
        trace.tracedEdgeIds,
        searchQuery,
        canvasH,
        selectedEdgeSet,
        filteredOut,
        filterActive,
        filterMode === "hide",
        Boolean(onAddLayer),
        hiddenLayers
      ),
    [model, selectedId, collapsed, canvasW, trace, searchQuery, canvasH, selectedEdgeSet, filteredOut, filterActive, filterMode, onAddLayer, hiddenLayers]
  );
  const layers = useMemo(
    () =>
      model.nodes
        .filter((n) => n.type === "Layer")
        .map((n) => ({ id: n.id, name: n.name })),
    [model.nodes]
  );
  // Header entries carry each layer's column width/hidden flag from the layout
  // so the sticky header bar lines up with the canvas columns.
  const headerLayers = useMemo(() => {
    const nameById = new Map(layers.map((l) => [l.id, l.name]));
    return layout.columns.map((c) => ({
      id: c.id,
      name: nameById.get(c.id) ?? "",
      w: c.w,
      hidden: c.hidden,
    }));
  }, [layout.columns, layers]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  // Re-sync RF state whenever the model, selection, or collapse changes.
  useEffect(() => setNodes(layout.nodes), [layout.nodes, setNodes]);
  useEffect(() => setEdges(layout.edges), [layout.edges, setEdges]);

  // Delete all selected edges with Delete/Backspace (when not typing in a field).
  useEffect(() => {
    if (selectedEdgeIds.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      onDeleteEdges(selectedEdgeIds);
      setSelectedEdgeIds([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEdgeIds, onDeleteEdges]);

  const renameActions = useMemo(() => ({ onRename: onRenameNode }), [onRenameNode]);
  const reorderValue = useMemo(
    () => ({
      active: Boolean(onReorderNode),
      onReorder: onReorderNode ?? (() => {}),
    }),
    [onReorderNode]
  );

  function handleConnect(c: Connection) {
    const srcAttr = c.sourceHandle?.replace(/-source-[lr]$/, "");
    const tgtAttr = c.targetHandle?.replace(/-target-[lr]$/, "");
    if (srcAttr && tgtAttr) onConnectAttrs(srcAttr, tgtAttr);
  }

  // Any attribute can map to any other attribute — just not to itself.
  function isValidConnection(c: Connection) {
    const srcAttr = c.sourceHandle?.replace(/-source-[lr]$/, "");
    const tgtAttr = c.targetHandle?.replace(/-target-[lr]$/, "");
    return Boolean(srcAttr && tgtAttr && srcAttr !== tgtAttr);
  }

  function handleNodeClick(e: React.MouseEvent, node: RFNode) {
    // Container + Layer ids are the RF node ids; band/table/attribute selection
    // is handled inside ObjectContainer (with stopPropagation).
    setSelectedEdgeIds([]);
    onSelect(node.id, e.shiftKey);
  }

  function handleEdgeClick(e: React.MouseEvent, edge: RFEdge) {
    // Select the edge (blue) — clear node selection so the swimlane stays
    // hidden. Shift-click adds/removes from a multi-edge selection.
    e.stopPropagation();
    onSelect(null);
    setSelectedEdgeIds((prev) => {
      if (!e.shiftKey) return [edge.id];
      return prev.includes(edge.id) ? prev.filter((x) => x !== edge.id) : [...prev, edge.id];
    });
  }

  // Keep the sticky layer headers scrolled in lockstep with the canvas.
  function handleCanvasScroll(e: React.UIEvent<HTMLDivElement>) {
    if (headersRef.current) {
      headersRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }

  // Forward raw pointer position + container rect/scroll for multiplayer
  // cursor broadcasting; a no-op when onCursorMove isn't wired up (local /
  // non-collaborative sessions never pay for this).
  function handleCanvasMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!onCursorMove) return;
    const el = wrapRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    onCursorMove(e.clientX, e.clientY, {
      left: box.left,
      top: box.top,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    });
  }

  const rfRef = useRef<ReactFlowInstance | null>(null);

  // Right-clicking empty canvas: if the cursor falls inside a layer column,
  // offer that layer's add actions (Add Object / Add Table); otherwise just
  // Add Layer.
  function handlePaneContextMenu(e: React.MouseEvent | MouseEvent) {
    e.preventDefault();
    const inst = rfRef.current;
    if (inst) {
      const pos = inst.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      if (pos.y >= 0) {
        // Columns have per-layer widths (hidden layers are slivers), so find
        // the column by x range rather than dividing by a fixed width.
        const col = layout.columns.find(
          (c) => pos.x >= c.x && pos.x < c.x + c.w && !c.hidden
        );
        if (col) {
          onSelect(col.id); // highlight the layer's swimlane
          onOpenMenu(e.clientX, e.clientY, {
            kind: "layerArea",
            layerId: col.id,
          });
          return;
        }
      }
    }
    onOpenMenu(e.clientX, e.clientY, { kind: "pane" });
  }

  return (
    <CollapseContext.Provider value={{ collapsed, toggle }}>
      <MenuContext.Provider value={{ openMenu: onOpenMenu }}>
      <RenameContext.Provider value={renameActions}>
      <ReorderContext.Provider value={reorderValue}>
      <PickContext.Provider value={pickValue}>
      <ContestedContext.Provider value={contested ?? {}}>
      <LayerHeaders
        ref={headersRef}
        layers={headerLayers}
        collapsed={collapsed}
        onToggle={toggle}
        contentWidth={layout.contentWidth}
        onReorder={onReorderLayer}
        onRename={onRenameLayer}
        onToggleHidden={toggleHiddenLayer}
        onCollapseAll={collapseAll}
        onExpandAll={expandAll}
      />
      <div
        ref={wrapRef}
        className={`canvas-scroll${pickMode ? " is-picking" : ""}${connecting ? " is-connecting" : ""}`}
        onScroll={handleCanvasScroll}
        onMouseMove={handleCanvasMouseMove}
        role="application"
        aria-label="Lineage canvas. Use arrow keys to move between objects, tables, and attributes; Enter or Space to select; Escape to exit."
        tabIndex={0}
        onKeyDown={handleCanvasKeyDown}
      >
        {/* Screen-reader-only lineage narration, announced whenever keyboard
            focus lands on an attribute (or a brief identity announcement for
            layers/objects/tables). "polite" so it never interrupts other
            announcements (e.g. a menu opening). */}
        <div className="visually-hidden" role="status" aria-live="polite">
          {liveText}
        </div>
        {/* ReactFlow forces its root to 100% of its parent, so this sized
            wrapper is what actually creates the horizontal/vertical overflow. */}
        <div style={{ width: layout.contentWidth, minWidth: "100%", height: layout.totalHeight, position: "relative" }}>
        {/* Blank gutter on the right with an add-layer affordance — omitted
            when onAddLayer isn't provided (e.g. read-only shared views). */}
        {onAddLayer && (
          <button
            className="add-layer-gutter"
            title="Add layer (click or right-click)"
            data-keytip="L"
            onClick={onAddLayer}
            onContextMenu={(e) => {
              e.preventDefault();
              onAddLayer();
            }}
            style={{
              left: layout.columnsWidth,
              width: layout.contentWidth - layout.columnsWidth,
              height: layout.totalHeight,
            }}
          >
            <span>＋ Add layer</span>
          </button>
        )}
        {previewLine && (
          <svg className="pick-preview-line" width={layout.contentWidth} height={layout.totalHeight}>
            <line
              x1={previewLine.x1}
              y1={previewLine.y1}
              x2={previewLine.x2}
              y2={previewLine.y2}
              stroke="#e0524d"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          </svg>
        )}
        <ReactFlow
          style={{ width: "100%", height: "100%" }}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onConnect={handleConnect}
          onConnectStart={() => setConnecting(true)}
          onConnectEnd={() => setConnecting(false)}
          isValidConnection={isValidConnection}
          connectionRadius={30}
          connectionLineStyle={{
            stroke: "var(--accent)",
            strokeWidth: 1.5,
            strokeDasharray: "6 4",
          }}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={() => {
            onSelect(null);
            setSelectedEdgeIds([]);
          }}
          onInit={(inst) => {
            rfRef.current = inst;
            inst.setViewport({ x: 0, y: 0, zoom: 1 });
          }}
          onPaneContextMenu={handlePaneContextMenu}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          minZoom={1}
          maxZoom={1}
          proOptions={{ hideAttribution: true }}
        >
          {settings.showBackgroundGrid && (
            <Background gap={22} size={1.4} color="var(--edge)" />
          )}
          {settings.showLegend && (
            <Panel position="bottom-center">
              <div className="legend" data-tour="canvas-legend">
                {LEGEND.map((l) => (
                  <span className="legend-item" key={l.type}>
                    <span className="type-glyph" style={{ color: l.color }}>
                      <TypeGlyph type={l.type} />
                    </span>
                    {l.label}
                  </span>
                ))}
              </div>
            </Panel>
          )}
        </ReactFlow>
        {/* Peer live cursors — positioned in the same content coordinate
            space as the sized wrapper div itself (scroll-space), so each
            collaborator's dot lands in the right spot regardless of this
            client's own scroll position. */}
        {liveCursors && liveCursors.length > 0 && (
          <div className="live-cursors-layer">
            {liveCursors.map((c) => (
              <div
                key={c.userId}
                className="live-cursor"
                style={{ left: c.x, top: c.y, ["--cursor-color" as string]: c.color }}
              >
                <span className="live-cursor-dot" />
                <span className="live-cursor-name">{c.name}</span>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
      </ContestedContext.Provider>
      </PickContext.Provider>
      </ReorderContext.Provider>
      </RenameContext.Provider>
      </MenuContext.Provider>
    </CollapseContext.Provider>
  );
}
