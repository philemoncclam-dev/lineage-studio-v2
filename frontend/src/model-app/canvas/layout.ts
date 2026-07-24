import type { Node as RFNode, Edge as RFEdge } from "reactflow";
import type { Model } from "../types";
import { readTags, tagColor, type ResolvedTag } from "../editor/tags";

export interface AttrData {
  id: string;
  name: string;
  logic: string;
  depth: number;
  tags: ResolvedTag[];
  dimmed?: boolean;
  matched?: boolean;
}

export interface TableData {
  groupId: string;
  label: string;
  collapsed: boolean;
  attrCount: number;
  attributes: AttrData[];
  selected: boolean;
}

// A single canvas container. For an Object it carries a band header plus its
// table sections; for a Group placed directly under a Layer the band is omitted
// and it holds just that one table. Rendering everything in one node makes the
// object read as one container and lets it take a single selection outline.
export interface ObjectContainerData {
  band?: { objectId: string; name: string; collapsed: boolean; tableCount: number };
  tables: TableData[];
  selected: boolean; // the container node itself is the selected node
  // Content signature. ObjectContainer's memo compares only this, so a layout
  // pass that rebuilds `data` with identical content (e.g. an edge-selection
  // change) doesn't re-render every card.
  sig: string;
}

export interface LayerNodeData {
  layerId: string;
  label: string;
  // True when the layer is collapsed/hidden: its descendant attributes' edges
  // anchor to the layer node, so it renders edge handles (see LayerNode).
  anchored?: boolean;
}

// Per-layer column geometry (in flow coordinates). Hidden layers keep a thin
// sliver column so the header stubs and the canvas stay aligned.
export interface ColumnInfo {
  id: string;
  x: number;
  w: number;
  hidden: boolean;
}

// Layout constants (px, in flow coordinates).
export const LAYER_HEADER_H = 48;

const PAD = 16;
// Gap between the (separate, sticky) layer-header bar and the first card. Kept
// at its original value so cards sit the same distance below the header even
// though the cards themselves are now more compact.
const CONTENT_TOP = 22;
const CARD_W = 210;
// These must match the rendered heights in App.css exactly, or cards overflow
// their computed slot and visually overlap the container above. Kept in sync
// with .ocontainer-band (padding 9px), .otable-header (padding 7px), and
// .attr-row (height 28px).
const BAND_H = 36; // object band header row
const TABLE_HEADER = 32; // a table's title row
const ATTR_ROW = 28;
const BORDERS = 2; // container top + bottom border
const CARD_GAP = 12; // between standalone tables under a Layer
const OBJECT_GAP = 22; // between containers
const COLLAPSED_LAYER_H = 96;
const MIN_COL_W = 300; // floor for a layer column; below this the canvas scrolls
const GUTTER = 220; // trailing blank space for the "+ Add layer" affordance
const HIDDEN_COL_W = 28; // sliver kept by a hidden layer

// Height a table section occupies inside a container (empty tables still show a
// single "no attributes" row).
const tableSectionHeight = (collapsed: boolean, attrCount: number) =>
  TABLE_HEADER + (collapsed ? 0 : Math.max(attrCount, 1) * ATTR_ROW);

// Stamp a container's data with its content signature (see ObjectContainerData).
const withSig = (d: Omit<ObjectContainerData, "sig">): ObjectContainerData => ({
  ...d,
  sig: JSON.stringify(d),
});

/**
 * Turns a Model (Layer > Object > Group > Attribute hierarchy + edges) into
 * React Flow nodes/edges. Each Layer is a fixed column; objects render as one
 * container node (band + tables), and tables placed directly under a layer
 * render as their own bandless container. All layer columns share the tallest
 * column's height so the selection swimlane fills the whole column.
 */
export function modelToFlow(
  model: Model,
  selectedId: string | null = null,
  collapsed: Set<string> = new Set(),
  canvasWidth: number = 960,
  tracedNodeIds: Set<string> = new Set(),
  tracedEdgeIds: Set<string> = new Set(),
  searchQuery: string = "",
  viewportHeight: number = 0,
  selectedEdgeIds: Set<string> = new Set(),
  filteredOut: Set<string> = new Set(),
  filterActive: boolean = false,
  filterHide: boolean = false,
  showGutter: boolean = true,
  hiddenLayers: Set<string> = new Set()
): {
  nodes: RFNode[];
  edges: RFEdge[];
  totalHeight: number;
  colW: number;
  contentWidth: number;
  columnsWidth: number;
  columns: ColumnInfo[];
} {
  const tracingActive = tracedNodeIds.size > 0;
  // Registry lookup so each attribute's tag names resolve to color + icon once.
  const tagReg = new Map((model.tags ?? []).map((t) => [t.name, t]));
  const resolveTagName = (name: string): ResolvedTag => {
    const def = tagReg.get(name);
    return { name, color: def?.color ?? tagColor(name) };
  };
  // Index children by parent once (preserving array order) so the repeated
  // childrenOf() lookups below are O(1) instead of re-scanning every node.
  const childrenByParent = new Map<string | null, Model["nodes"]>();
  for (const n of model.nodes) {
    const arr = childrenByParent.get(n.parentId);
    if (arr) arr.push(n);
    else childrenByParent.set(n.parentId, [n]);
  }
  const childrenOf = (parentId: string | null) => childrenByParent.get(parentId) ?? [];

  const layers = model.nodes.filter((n) => n.type === "Layer");
  const visibleCount = Math.max(
    layers.filter((l) => !hiddenLayers.has(l.id)).length,
    1
  );
  const hiddenCount = layers.filter((l) => hiddenLayers.has(l.id)).length;
  // Visible columns share the available width (minus the trailing gutter and
  // the hidden-layer slivers) evenly, but never shrink below MIN_COL_W — past
  // that the canvas scrolls horizontally. The gutter is blank space on the
  // right for adding a layer; omitted (and the columns get the full width)
  // when there's no add-layer affordance to show, e.g. read-only shared views.
  const gutter = showGutter ? GUTTER : 0;
  const COL_W = Math.max(
    (canvasWidth - gutter - hiddenCount * HIDDEN_COL_W) / visibleCount,
    MIN_COL_W
  );
  let colCursor = 0;
  const columns: ColumnInfo[] = layers.map((l) => {
    const hidden = hiddenLayers.has(l.id);
    const w = hidden ? HIDDEN_COL_W : COL_W;
    const col = { id: l.id, x: colCursor, w, hidden };
    colCursor += w;
    return col;
  });
  const colX = new Map(columns.map((c) => [c.id, c.x]));
  const columnsWidth = colCursor;
  const contentWidth = columnsWidth + gutter;
  const CARD_X = (COL_W - CARD_W) / 2;

  const rfNodes: RFNode[] = [];
  const attrToCard = new Map<string, string>(); // attr id -> container node id
  const cardX = new Map<string, number>(); // container node id -> column x
  // Handle anchor for each attribute's edges. Normally the attribute's own row,
  // but when the attribute is hidden by a collapse its edges re-route to the
  // nearest still-visible ancestor: the group (table) header if the group is
  // collapsed, or the object band if the whole object is collapsed. This keeps
  // lineage curves visible (landing on the collapsed container) instead of
  // vanishing. See ObjectContainer for the matching anchor handles.
  const attrAnchor = new Map<string, string>(); // attr id -> handle base id

  const query = searchQuery.trim().toLowerCase();

  const flattenAttrs = (parentId: string, depth: number): AttrData[] => {
    const out: AttrData[] = [];
    for (const a of childrenOf(parentId).filter((n) => n.type === "Attribute")) {
      // In hide mode, filtered-out attributes are omitted from the layout
      // entirely (no node emitted, no height contributed).
      if (filterHide && filterActive && filteredOut.has(a.id)) {
        // Still recurse so visible descendants under a hidden attribute surface.
        out.push(...flattenAttrs(a.id, depth + 1));
        continue;
      }
      const traceDimmed = tracingActive && !tracedNodeIds.has(a.id);
      const matched = query ? a.name.toLowerCase().includes(query) : false;
      const searchDimmed = query ? !matched : false;
      const filterDimmed = filterActive && filteredOut.has(a.id);
      out.push({
        id: a.id,
        name: a.name,
        logic: a.transformation_logic,
        depth,
        tags: readTags(a.properties as Record<string, unknown>).map(resolveTagName),
        dimmed: (traceDimmed || searchDimmed || filterDimmed) || undefined,
        matched: matched || undefined,
      });
      out.push(...flattenAttrs(a.id, depth + 1));
    }
    return out;
  };

  // Build a table section, registering its visible attributes against the
  // container so edges route to the container node.
  const buildTable = (
    group: Model["nodes"][number],
    containerId: string,
    hidden: boolean
  ): TableData => {
    const grpCollapsed = collapsed.has(group.id);
    const all = flattenAttrs(group.id, 0);
    const rowsHidden = grpCollapsed || hidden;
    // Where each attribute's edges anchor: its own row when visible, else the
    // object band (`hidden` = object collapsed) or the group header.
    const anchor = hidden ? containerId : group.id;
    for (const a of all) {
      attrToCard.set(a.id, containerId);
      attrAnchor.set(a.id, rowsHidden ? anchor : a.id);
    }
    return {
      groupId: group.id,
      label: group.name,
      collapsed: grpCollapsed,
      attrCount: all.length,
      attributes: grpCollapsed ? [] : all,
      selected: selectedId === group.id,
    };
  };

  // Per-layer content height so all columns can share the tallest one.
  const layerContentH: number[] = [];

  layers.forEach((layer) => {
    const layerX = colX.get(layer.id)!;
    const layerHidden = hiddenLayers.has(layer.id);
    const layerCollapsed = collapsed.has(layer.id);
    let cursorY = CONTENT_TOP;

    if (!layerCollapsed && !layerHidden) {
      // Tables placed directly under the Layer (bandless containers).
      const directGroups = childrenOf(layer.id).filter((n) => n.type === "Group");
      directGroups.forEach((group, gi) => {
        cardX.set(group.id, layerX);
        const table = buildTable(group, group.id, false);
        rfNodes.push({
          id: group.id,
          type: "container",
          position: { x: layerX + CARD_X, y: cursorY },
          data: withSig({ tables: [table], selected: selectedId === group.id }),
          style: { width: CARD_W },
          draggable: false,
          selectable: true,
          zIndex: 1,
        });
        cursorY += tableSectionHeight(table.collapsed, table.attrCount) + BORDERS;
        if (gi < directGroups.length - 1) cursorY += CARD_GAP;
      });
      if (directGroups.length) cursorY += OBJECT_GAP;

      for (const object of childrenOf(layer.id).filter((n) => n.type === "Object")) {
        const groups = childrenOf(object.id).filter((n) => n.type === "Group");
        const objCollapsed = collapsed.has(object.id);
        cardX.set(object.id, layerX);

        const tables = groups.map((g) => buildTable(g, object.id, objCollapsed));
        rfNodes.push({
          id: object.id,
          type: "container",
          position: { x: layerX + CARD_X, y: cursorY },
          data: withSig({
            band: {
              objectId: object.id,
              name: object.name,
              collapsed: objCollapsed,
              tableCount: groups.length,
            },
            tables,
            selected: selectedId === object.id,
          }),
          style: { width: CARD_W },
          draggable: false,
          selectable: true,
          zIndex: 1,
        });

        let h = BAND_H;
        if (!objCollapsed)
          for (const t of tables) h += tableSectionHeight(t.collapsed, t.attrCount);
        cursorY += h + BORDERS + OBJECT_GAP;
      }
    } else {
      // Collapsed or hidden layer: no containers are emitted, so every
      // descendant attribute re-routes its edges to the layer node itself
      // (which stays on screen as a collapsed strip / hidden sliver). Without
      // this, all edges touching the layer would be filtered out and vanish.
      cardX.set(layer.id, layerX);
      const stack = [...childrenOf(layer.id)];
      while (stack.length) {
        const n = stack.pop()!;
        if (n.type === "Attribute") {
          attrToCard.set(n.id, layer.id);
          attrAnchor.set(n.id, layer.id);
        }
        stack.push(...childrenOf(n.id));
      }
    }

    layerContentH.push(
      layerHidden ? 0 : layerCollapsed ? COLLAPSED_LAYER_H : cursorY + PAD
    );
  });

  // Uniform column height = tallest expanded column, but never shorter than the
  // visible canvas viewport so the grey swimlane always fills the white space
  // top-to-bottom even when a layer holds few objects.
  const tallest = Math.max(
    220,
    viewportHeight,
    ...layers.map((l, i) => (collapsed.has(l.id) ? 0 : layerContentH[i]))
  );

  layers.forEach((layer) => {
    const layerHidden = hiddenLayers.has(layer.id);
    const layerCollapsed = collapsed.has(layer.id);
    rfNodes.push({
      id: layer.id,
      type: "layerNode",
      position: { x: colX.get(layer.id)!, y: 0 },
      data: {
        layerId: layer.id,
        label: layer.name,
        anchored: layerCollapsed || layerHidden,
      } as LayerNodeData,
      style: {
        width: layerHidden ? HIDDEN_COL_W : COL_W,
        height: !layerHidden && layerCollapsed ? COLLAPSED_LAYER_H : tallest,
      },
      className:
        [
          selectedId === layer.id ? "selected" : undefined,
          layerHidden ? "layer-hidden" : undefined,
        ]
          .filter(Boolean)
          .join(" ") || undefined,
      draggable: false,
      selectable: true,
      zIndex: 0,
    });
  });

  // An attribute is "in selection" if the selected node is the attribute itself
  // or any ancestor — used to highlight the connected lineage curves.
  const parentOf = new Map(model.nodes.map((n) => [n.id, n.parentId]));
  const inSelection = (attrId: string): boolean => {
    if (!selectedId) return false;
    let cur: string | null | undefined = attrId;
    while (cur) {
      if (cur === selectedId) return true;
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };

  const rfEdges: RFEdge[] = model.edges
    .filter((e) => attrToCard.has(e.sourceNodeId) && attrToCard.has(e.targetNodeId))
    .map((e) => {
      const active = inSelection(e.sourceNodeId) || inSelection(e.targetNodeId);
      const sourceCard = attrToCard.get(e.sourceNodeId)!;
      const targetCard = attrToCard.get(e.targetNodeId)!;
      // Pick the handle side by direction: when the target sits to the right
      // (downstream) the edge leaves the source's right and enters the target's
      // left; when it sits to the left (upstream) it uses the opposite sides.
      const downstream = (cardX.get(sourceCard) ?? 0) <= (cardX.get(targetCard) ?? 0);

      // Determine CSS class. A directly-selected edge always wins; then tracing
      // (traced/dimmed); otherwise the legacy edge-active ancestor highlight.
      let edgeClass: string | undefined;
      if (selectedEdgeIds.has(e.id)) {
        edgeClass = "edge-selected";
      } else if (tracingActive) {
        edgeClass = tracedEdgeIds.has(e.id) ? "edge-traced" : "edge-dimmed";
      } else if (active) {
        edgeClass = "edge-active";
      } else if (
        filterActive &&
        (filteredOut.has(e.sourceNodeId) || filteredOut.has(e.targetNodeId))
      ) {
        // Fade edges touching a filtered-out attribute so the matching subset
        // reads clearly.
        edgeClass = "edge-dimmed";
      }

      // Annotated transformation kind renders as a distinct line style.
      const kindClass = e.kind ? `edge-kind-${e.kind}` : undefined;
      const className = [edgeClass, kindClass].filter(Boolean).join(" ") || undefined;

      return {
        id: e.id,
        source: sourceCard,
        target: targetCard,
        sourceHandle: `${attrAnchor.get(e.sourceNodeId)}-source-${downstream ? "r" : "l"}`,
        targetHandle: `${attrAnchor.get(e.targetNodeId)}-target-${downstream ? "l" : "r"}`,
        type: "default",
        className,
      };
    });

  return {
    nodes: rfNodes,
    edges: rfEdges,
    totalHeight: tallest,
    colW: COL_W,
    contentWidth,
    columnsWidth,
    columns,
  };
}
