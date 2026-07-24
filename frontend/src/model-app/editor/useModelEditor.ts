import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Model, LineageNode, LineageEdge, NodeType, ModelRole, TagDef } from "../types";
import { tidyNodes } from "./tidy";
import { reorderNodes } from "./reorderNodes";

const newId = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "");

const DEFAULT_NAME: Record<NodeType, string> = {
  Layer: "New Layer",
  Group: "New Group",
  Object: "New Object",
  Attribute: "New Attribute",
};

// Which child type each node type can contain.
// Hierarchy: Layer > Object > Group > Attribute (Solidatus Type order).
export const CHILD_TYPE: Partial<Record<NodeType, NodeType>> = {
  Layer: "Object",
  Object: "Group",
  Group: "Attribute",
  Attribute: "Attribute", // attributes can nest under attributes
};

// Which child node types each container type can accept on paste (a Layer can
// hold Objects or bare Groups, so this is broader than CHILD_TYPE). Shared by
// the context menu and the keyboard-paste shortcut so they agree.
export const PASTE_ACCEPTS: Record<NodeType, NodeType[]> = {
  Layer: ["Object", "Group"],
  Object: ["Group"],
  Group: ["Attribute"],
  Attribute: ["Attribute"],
};

const UNDO_LIMIT = 50;

// ── Structural-sharing helpers ──────────────────────────────────────────────
// The model is logically a tree (Layer > Object/Group > Attribute) stored as a
// flat `nodes` array plus a flat `edges` array. To make an edit "structurally
// shared" we only need new array identity for `nodes`/`edges` themselves, and a
// new object identity for whichever node/edge actually changed — every other
// node/edge object keeps its original reference. That's enough for memoized
// consumers (e.g. ObjectContainer's signature memo, or any `useMemo` keyed off
// a specific node) to skip re-deriving work for untouched parts of the model.
//
// The hard rule everywhere below: never write a property onto a node/edge (or
// its `.properties` bag) that came from the *previous* committed model — always
// produce a new object first. The previous model is still sitting on the undo
// stack, so mutating into it would silently corrupt history.

// Replace the single node matching `id` with `updater(node)`, leaving every
// other node's reference untouched. No-op (returns the same array) if `id`
// isn't found or the updater declines to change anything.
function replaceNode(
  nodes: LineageNode[],
  id: string,
  updater: (n: LineageNode) => LineageNode | null | undefined
): LineageNode[] {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx === -1) return nodes;
  const next = updater(nodes[idx]);
  if (!next || next === nodes[idx]) return nodes;
  const out = nodes.slice();
  out[idx] = next;
  return out;
}

// Same as replaceNode, for edges.
function replaceEdge(
  edges: LineageEdge[],
  id: string,
  updater: (e: LineageEdge) => LineageEdge | null | undefined
): LineageEdge[] {
  const idx = edges.findIndex((e) => e.id === id);
  if (idx === -1) return edges;
  const next = updater(edges[idx]);
  if (!next || next === edges[idx]) return edges;
  const out = edges.slice();
  out[idx] = next;
  return out;
}

// Apply `updater` to every node for which `pred` is true, copying only the
// nodes that actually change (and only the array once, up front). Nodes for
// which `updater` returns the same reference (or the pred is false) keep their
// original identity.
function mapNodesWhere(
  nodes: LineageNode[],
  pred: (n: LineageNode) => boolean,
  updater: (n: LineageNode) => LineageNode
): LineageNode[] {
  let changed = false;
  const out = nodes.map((n) => {
    if (!pred(n)) return n;
    const next = updater(n);
    if (next !== n) changed = true;
    return next;
  });
  return changed ? out : nodes;
}

// Where a model is loaded from and saved to. The default (api-backed) adapter
// drives the normal signed-in/local editor; the shared-link editor supplies its
// own adapter that reads/writes the public `shared_models` row instead, so all
// the mutation/undo/history logic below is reused verbatim for both.
export interface ModelPersistence {
  load: () => Promise<{ model: Model; role: ModelRole }>;
  save: (model: Model) => Promise<Model>;
}

function defaultPersistence(modelId: string): ModelPersistence {
  return {
    load: () => api.openModel(modelId),
    save: (m) =>
      api.updateModel(m.id, { name: m.name, nodes: m.nodes, edges: m.edges, tags: m.tags ?? [] }),
  };
}

export function useModelEditor(modelId: string, persistence?: ModelPersistence) {
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Multi-selection: an ordered list whose last entry is the "primary" (drives
  // the inspector / trace / swimlane). Shift-click toggles ids in/out.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [role, setRole] = useState<ModelRole>("owner");

  // Viewers can't mutate. Kept in a ref so the memoized helpers can read it
  // without being re-created on every role change.
  const canEdit = role !== "viewer";
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const undoStack = useRef<Model[]>([]);
  const redoStack = useRef<Model[]>([]);

  // Mirror of the current model so the mutating helpers can read it and update
  // history synchronously. Doing the undo/redo bookkeeping inside a setModel
  // updater would be an impure side effect that StrictMode double-fires (and
  // would race updateCanFlags), so we keep it out here instead.
  const modelRef = useRef<Model | null>(null);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  // Clipboard: a copied node + its descendant subtree and the lineage edges
  // wholly inside that subtree. clipboardType drives the menu's Paste label.
  const clipboard = useRef<{ roots: string[]; nodes: LineageNode[]; edges: LineageEdge[] } | null>(
    null
  );
  const [clipboardType, setClipboardType] = useState<NodeType | null>(null);

  // The persistence adapter is kept in a ref (updated each render) so the load
  // effect can stay keyed only on `modelId` — a caller passing an inline adapter
  // object doesn't need to memoize it to avoid re-loading.
  const persistRef = useRef<ModelPersistence>(persistence ?? defaultPersistence(modelId));
  persistRef.current = persistence ?? defaultPersistence(modelId);

  useEffect(() => {
    persistRef.current
      .load()
      .then(({ model, role }) => {
        setModel(model);
        setRole(role);
      })
      .catch((e) => setError(String(e)));
  }, [modelId]);

  const updateCanFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  // Select a node. `additive` (shift-click) toggles the id in/out of the set;
  // otherwise it replaces the selection. `null` clears it.
  const select = useCallback((id: string | null, additive = false) => {
    setSelectedIds((prev) => {
      if (id === null) return [];
      if (!additive) return [id];
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  }, []);
  // Back-compat single-select setter for callers that always replace.
  const setSelectedId = useCallback((id: string | null) => select(id, false), [select]);

  // Commit a new model: update the ref + state and refresh dirty/history flags.
  const commit = useCallback(
    (next: Model) => {
      modelRef.current = next;
      setModel(next);
      setDirty(true);
      updateCanFlags();
    },
    [updateCanFlags]
  );

  // History invariant: committed models are treated as immutable — every
  // mutation runs `fn` against the previous model *by reference* (no deep
  // clone) and must produce a new `Model` via structural sharing: new objects
  // only along the path from the root to whatever node/edge actually changed,
  // reusing every other reference as-is. `fn` must never write a property onto
  // `prev` or anything reachable from it (nodes, edges, their `.properties`
  // bags, `.tags`, etc.) — that data is still sitting on the undo stack, so an
  // in-place write would silently corrupt history. This is why the mutators
  // below all go through replaceNode/replaceEdge/mapNodesWhere or explicit
  // spreads instead of `Object.assign`/array `.push` on `m` directly.
  const mutate = useCallback(
    (fn: (m: Model) => Model) => {
      if (!canEditRef.current) return; // viewers are read-only
      const prev = modelRef.current;
      if (!prev) return;
      undoStack.current.push(prev);
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      redoStack.current = []; // a new edit invalidates the redo history
      commit(fn(prev));
    },
    [commit]
  );

  const undo = useCallback(() => {
    if (!canEditRef.current) return;
    const prev = undoStack.current.pop();
    if (!prev) return;
    if (modelRef.current) redoStack.current.push(modelRef.current);
    commit(prev);
  }, [commit]);

  const redo = useCallback(() => {
    if (!canEditRef.current) return;
    const next = redoStack.current.pop();
    if (!next) return;
    if (modelRef.current) undoStack.current.push(modelRef.current);
    commit(next);
  }, [commit]);

  const addNode = useCallback(
    (type: NodeType, parentId: string | null) => {
      const node: LineageNode = {
        id: newId(),
        type,
        name: DEFAULT_NAME[type],
        parentId,
        properties: {},
        transformation_logic: "",
        x: 0,
        y: 0,
      };
      mutate((m) => ({ ...m, nodes: [...m.nodes, node] }));
      setSelectedId(node.id);
      return node.id;
    },
    [mutate]
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<LineageNode>) => {
      mutate((m) => ({ ...m, nodes: replaceNode(m.nodes, id, (n) => ({ ...n, ...patch })) }));
    },
    [mutate]
  );

  // Delete one or more nodes (each with its whole subtree) in a single edit, so
  // multi-select delete is one undo step. Any deleted id is dropped from the
  // selection.
  const deleteNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const removed = new Set<string>();
      mutate((m) => {
        const toRemove = new Set<string>(ids);
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of m.nodes) {
            if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
              toRemove.add(n.id);
              grew = true;
            }
          }
        }
        toRemove.forEach((x) => removed.add(x));
        return {
          ...m,
          nodes: m.nodes.filter((n) => !toRemove.has(n.id)),
          edges: m.edges.filter(
            (e) => !toRemove.has(e.sourceNodeId) && !toRemove.has(e.targetNodeId)
          ),
        };
      });
      setSelectedIds((prev) => prev.filter((x) => !removed.has(x)));
    },
    [mutate]
  );
  const deleteNode = useCallback((id: string) => deleteNodes([id]), [deleteNodes]);

  const addEdge = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      if (sourceNodeId === targetNodeId) return;
      mutate((m) => {
        const exists = m.edges.some(
          (e) => e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId
        );
        if (exists) return m;
        const edge: LineageEdge = { id: newId(), sourceNodeId, targetNodeId };
        return { ...m, edges: [...m.edges, edge] };
      });
    },
    [mutate]
  );

  // Auto-layout: reorder siblings to minimize edge crossings (one undo step).
  const applyTidy = useCallback(() => {
    mutate((m) => ({ ...m, nodes: tidyNodes(m) }));
  }, [mutate]);

  // Annotate an edge (kind / note). Deleting a key: pass undefined in the patch.
  const updateEdge = useCallback(
    (id: string, patch: Partial<LineageEdge>) => {
      mutate((m) => ({ ...m, edges: replaceEdge(m.edges, id, (e) => ({ ...e, ...patch })) }));
    },
    [mutate]
  );

  const deleteEdges = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const set = new Set(ids);
      mutate((m) => ({ ...m, edges: m.edges.filter((e) => !set.has(e.id)) }));
    },
    [mutate]
  );
  const deleteEdge = useCallback((id: string) => deleteEdges([id]), [deleteEdges]);

  // Reorder layer columns. Layers render in their array order within
  // model.nodes (layout filters by type), so we re-sequence just the Layer
  // nodes and keep every other node where it is.
  const reorderLayer = useCallback(
    (draggedId: string, targetIndex: number) => {
      mutate((m) => {
        const layers = m.nodes.filter((n) => n.type === "Layer");
        const from = layers.findIndex((l) => l.id === draggedId);
        if (from === -1) return m;
        const [moved] = layers.splice(from, 1);
        const clamped = Math.max(0, Math.min(targetIndex, layers.length));
        layers.splice(clamped, 0, moved);
        // Rebuild node list: emit reordered layers in their original slots.
        // (Layer node references are unchanged — only their array positions move.)
        const order = layers[Symbol.iterator]();
        const nodes = m.nodes.map((n) => (n.type === "Layer" ? order.next().value! : n));
        return { ...m, nodes };
      });
    },
    [mutate]
  );

  // Move a node up/down among its same-type siblings (same parent). Layout
  // renders siblings in array order, so we swap the two nodes' array slots.
  const moveNode = useCallback(
    (id: string, dir: "up" | "down") => {
      mutate((m) => {
        const node = m.nodes.find((n) => n.id === id);
        if (!node) return m;
        const siblings = m.nodes.filter(
          (n) => n.parentId === node.parentId && n.type === node.type
        );
        const pos = siblings.findIndex((s) => s.id === id);
        const swapWith = dir === "up" ? pos - 1 : pos + 1;
        if (swapWith < 0 || swapWith >= siblings.length) return m;
        const aIdx = m.nodes.indexOf(siblings[pos]);
        const bIdx = m.nodes.indexOf(siblings[swapWith]);
        // Copy the array before swapping slots — m.nodes is the same reference
        // held by the previous history entry, so swapping in place would
        // corrupt it (the node objects themselves are untouched, only their
        // array positions change).
        const nodes = m.nodes.slice();
        [nodes[aIdx], nodes[bIdx]] = [nodes[bIdx], nodes[aIdx]];
        return { ...m, nodes };
      });
    },
    [mutate]
  );

  // Drag-reorder: move a node directly before/after a same-parent same-type
  // sibling (render order follows array order). Validity is pre-checked so an
  // invalid drop doesn't push a no-op entry onto the undo history.
  const reorderNode = useCallback(
    (id: string, targetId: string, pos: "before" | "after") => {
      const m = modelRef.current;
      if (!m || id === targetId) return;
      const node = m.nodes.find((n) => n.id === id);
      const target = m.nodes.find((n) => n.id === targetId);
      if (!node || !target) return;
      if (node.parentId !== target.parentId || node.type !== target.type) return;
      mutate((mm) => {
        // reorderNodes splices its array argument in place, so hand it a copy
        // rather than mm.nodes (which is shared with the previous history
        // entry until this mutation completes).
        const nodes = mm.nodes.slice();
        reorderNodes(nodes, id, targetId, pos);
        return { ...mm, nodes };
      });
    },
    [mutate]
  );

  // Copy one or more nodes (each with its whole subtree, plus any lineage edges
  // fully inside the combined set) onto the clipboard. Supports multi-select so
  // several attributes can be copied and pasted together.
  const copyNodes = useCallback((rootIds: string[]) => {
    const m = modelRef.current;
    if (!m || rootIds.length === 0) return;
    const roots = rootIds.filter((r) => m.nodes.some((n) => n.id === r));
    if (roots.length === 0) return;
    const ids = new Set<string>(roots);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of m.nodes) {
        if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
          ids.add(n.id);
          grew = true;
        }
      }
    }
    const nodes = m.nodes.filter((n) => ids.has(n.id)).map((n) => structuredClone(n));
    const edges = m.edges
      .filter((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId))
      .map((e) => structuredClone(e));
    clipboard.current = { roots, nodes, edges };
    setClipboardType(m.nodes.find((n) => n.id === roots[0])?.type ?? null);
  }, []);
  const copyNode = useCallback((id: string) => copyNodes([id]), [copyNodes]);

  // Cut = copy onto the clipboard, then delete. copyNodes only fills the
  // clipboard ref (no mutation), so the single deleteNodes mutation is the lone
  // undo step — one Ctrl+Z restores everything that was cut.
  const cutNodes = useCallback(
    (ids: string[]) => {
      copyNodes(ids);
      deleteNodes(ids);
    },
    [copyNodes, deleteNodes]
  );
  const cutNode = useCallback((id: string) => cutNodes([id]), [cutNodes]);

  // Paste the clipboard subtree(s) as children of targetId (fresh ids
  // throughout). Each copied root becomes a child of the target.
  const pasteInto = useCallback(
    (targetId: string) => {
      const clip = clipboard.current;
      if (!clip) return;
      // Pre-compute fresh ids so we can select the new roots after mutating.
      const idMap = new Map<string, string>();
      for (const n of clip.nodes) idMap.set(n.id, newId());
      const rootSet = new Set(clip.roots);
      const newRootIds = clip.roots.map((r) => idMap.get(r)!);

      mutate((m) => {
        // Fresh top-level node/edge objects (new id, remapped parent/endpoints)
        // — the clipboard entries themselves are never mutated in place, so
        // reusing their nested `properties` object here is safe structural
        // sharing, not a hazard: clipboard.current is a private detached copy
        // (see copyNodes), not part of any model in the undo/redo history.
        const newNodes = clip.nodes.map((n) => ({
          ...n,
          id: idMap.get(n.id)!,
          parentId: rootSet.has(n.id) ? targetId : idMap.get(n.parentId!)!,
        }));
        const newEdges = clip.edges.map((e) => ({
          id: newId(),
          sourceNodeId: idMap.get(e.sourceNodeId)!,
          targetNodeId: idMap.get(e.targetNodeId)!,
        }));
        return { ...m, nodes: [...m.nodes, ...newNodes], edges: [...m.edges, ...newEdges] };
      });
      setSelectedIds(newRootIds);
    },
    [mutate]
  );

  // Duplicate node(s) as siblings (same parent), with fresh ids throughout and
  // any lineage edges wholly inside the subtree copied too. Self-contained (does
  // not touch the copy/paste clipboard) so Cmd+D never clobbers what the user
  // has copied. New clones become the selection.
  const duplicateNodes = useCallback(
    (rootIds: string[]) => {
      const m = modelRef.current;
      if (!m || rootIds.length === 0) return;
      const roots = rootIds.filter((r) => m.nodes.some((n) => n.id === r));
      if (roots.length === 0) return;
      const ids = new Set<string>(roots);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of m.nodes) {
          if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
            ids.add(n.id);
            grew = true;
          }
        }
      }
      const subtree = m.nodes.filter((n) => ids.has(n.id));
      const innerEdges = m.edges.filter(
        (e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId)
      );
      const idMap = new Map<string, string>();
      for (const n of subtree) idMap.set(n.id, newId());
      const rootSet = new Set(roots);
      const newRootIds = roots.map((r) => idMap.get(r)!);

      mutate((mm) => {
        const newNodes = subtree.map((n) => ({
          ...n,
          id: idMap.get(n.id)!,
          // Roots keep their original parent (sibling duplicate); descendants
          // re-point at their cloned parent.
          parentId: rootSet.has(n.id) ? n.parentId : idMap.get(n.parentId!)!,
        }));
        const newEdges = innerEdges.map((e) => ({
          id: newId(),
          sourceNodeId: idMap.get(e.sourceNodeId)!,
          targetNodeId: idMap.get(e.targetNodeId)!,
        }));
        return { ...mm, nodes: [...mm.nodes, ...newNodes], edges: [...mm.edges, ...newEdges] };
      });
      setSelectedIds(newRootIds);
    },
    [mutate]
  );
  const duplicateNode = useCallback((id: string) => duplicateNodes([id]), [duplicateNodes]);

  // Whether the current clipboard contents can legally be pasted into targetId
  // (drives the Cmd+V shortcut, mirroring the context menu's paste gating).
  const canPasteInto = useCallback(
    (targetId: string): boolean => {
      const m = modelRef.current;
      if (!m || !clipboardType) return false;
      const target = m.nodes.find((n) => n.id === targetId);
      if (!target) return false;
      return PASTE_ACCEPTS[target.type].includes(clipboardType);
    },
    [clipboardType]
  );

  // ── Tags ────────────────────────────────────────────────────────────────
  // Create or update a tag definition (color / icon), keyed by name. Upsert so
  // a legacy tag that was only referenced by attributes gets a registry entry
  // the first time it's edited.
  const setTagDef = useCallback(
    (name: string, patch: Partial<Omit<TagDef, "name">>) => {
      mutate((m) => {
        const tags = m.tags ?? [];
        const existing = tags.find((t) => t.name === name);
        const nextTags = existing
          ? tags.map((t) => (t.name === name ? { ...t, ...patch } : t))
          : [...tags, { name, color: patch.color ?? "#4a90e2" }];
        return { ...m, tags: nextTags };
      });
    },
    [mutate]
  );

  // Delete a tag from the registry and strip it off every attribute.
  const removeTag = useCallback(
    (name: string) => {
      mutate((m) => {
        const tags = (m.tags ?? []).filter((t) => t.name !== name);
        const nodes = mapNodesWhere(
          m.nodes,
          (n) => {
            const arr = (n.properties as Record<string, unknown>).tags;
            return Array.isArray(arr) && arr.includes(name);
          },
          (n) => {
            const props = n.properties as Record<string, unknown>;
            const arr = props.tags as unknown[];
            return { ...n, properties: { ...props, tags: arr.filter((x) => x !== name) } };
          }
        );
        return { ...m, tags, nodes };
      });
    },
    [mutate]
  );

  // Rename a tag: update the registry entry and every attribute that references
  // it by name. If newName already exists as a tag, merge into it (dedupe per
  // attribute, keep a single registry entry).
  const renameTag = useCallback(
    (oldName: string, newNameRaw: string) => {
      const newName = newNameRaw.trim();
      if (!newName || newName === oldName) return;
      mutate((m) => {
        const tags = m.tags ?? [];
        const targetExists = tags.some((t) => t.name === newName);
        const nextTags = targetExists
          ? tags.filter((t) => t.name !== oldName) // merge: drop the old entry
          : tags.map((t) => (t.name === oldName ? { ...t, name: newName } : t));
        const nodes = mapNodesWhere(
          m.nodes,
          (n) => {
            const arr = (n.properties as Record<string, unknown>).tags;
            return Array.isArray(arr) && arr.includes(oldName);
          },
          (n) => {
            const props = n.properties as Record<string, unknown>;
            const arr = props.tags as unknown[];
            const mapped = arr.map((x) => (x === oldName ? newName : x));
            return { ...n, properties: { ...props, tags: [...new Set(mapped)] } };
          }
        );
        return { ...m, tags: nextTags, nodes };
      });
    },
    [mutate]
  );

  // Mark (or unmark) an attribute as intentionally having no lineage, so
  // validation stops flagging it as unmapped. Stored on the node's properties.
  const setUnmappedOk = useCallback(
    (id: string, ok: boolean) => {
      mutate((m) => ({
        ...m,
        nodes: replaceNode(m.nodes, id, (n) => {
          const props = { ...(n.properties as Record<string, unknown>) };
          if (ok) props.unmappedOk = true;
          else delete props.unmappedOk;
          return { ...n, properties: props };
        }),
      }));
    },
    [mutate]
  );

  // Toggle a tag on/off for a single attribute (its properties.tags list).
  const toggleNodeTag = useCallback(
    (id: string, name: string) => {
      mutate((m) => ({
        ...m,
        nodes: replaceNode(m.nodes, id, (n) => {
          const props = n.properties as Record<string, unknown>;
          const arr = Array.isArray(props.tags)
            ? (props.tags as unknown[]).filter((x): x is string => typeof x === "string")
            : [];
          const nextArr = arr.includes(name) ? arr.filter((x) => x !== name) : [...arr, name];
          return { ...n, properties: { ...props, tags: nextArr } };
        }),
      }));
    },
    [mutate]
  );

  // Bulk-set attribute descriptions (definitions import) in one mutation, so the
  // whole import is a single undo step. Each entry writes properties.description.
  const applyDefinitions = useCallback(
    (updates: { id: string; description: string }[]) => {
      if (updates.length === 0) return;
      const map = new Map(updates.map((u) => [u.id, u.description]));
      mutate((m) => ({
        ...m,
        nodes: mapNodesWhere(
          m.nodes,
          (n) => map.has(n.id),
          (n) => ({
            ...n,
            properties: { ...(n.properties as Record<string, unknown>), description: map.get(n.id) },
          })
        ),
      }));
    },
    [mutate]
  );

  // Bulk insert (schema import): append many nodes/edges in one mutation.
  const addStructure = useCallback(
    (nodes: LineageNode[], edges: LineageEdge[] = []) => {
      mutate((m) => ({ ...m, nodes: [...m.nodes, ...nodes], edges: [...m.edges, ...edges] }));
    },
    [mutate]
  );

  // Apply a reconciled connector sync (see connectors/reconcile.ts): replace the
  // whole node list (and optionally edges) in one undo step.
  const applyConnectorSync = useCallback(
    (nextNodes: LineageNode[], nextEdges?: LineageEdge[]) => {
      mutate((m) => ({ ...m, nodes: nextNodes, edges: nextEdges ?? m.edges }));
    },
    [mutate]
  );

  // ── Realtime integration point ──────────────────────────────────────────
  // Apply a model that arrived from a collaborator (see src/realtime/) as a
  // new baseline. Design choice: this CLEARS the local undo/redo stack rather
  // than trying to preserve it. Rationale: the undo stack holds *this
  // client's* prior local snapshots; once a remote edit has landed, those
  // snapshots no longer represent a valid line of history to walk back
  // through (undoing past a remote change would silently resurrect content a
  // collaborator just changed/removed, which is far more surprising and
  // data-lossy than simply losing a few in-flight undo steps). Since this is
  // explicitly last-write-wins, clearing history keeps the mental model
  // simple: "the model just changed under you; your undo history starts
  // fresh from here." A toast/indicator at the call site can tell the user
  // their undo history was reset if desired.
  const applyRemoteModel = useCallback(
    (next: Model) => {
      undoStack.current = [];
      redoStack.current = [];
      commit(next);
      setDirty(false); // the incoming model is already the saved server state
    },
    [commit]
  );

  const save = useCallback(async () => {
    if (!model) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await persistRef.current.save(model);
      setModel(saved);
      setDirty(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [model]);

  return {
    model,
    error,
    dirty,
    saving,
    selectedId,
    selectedIds,
    setSelectedId,
    select,
    role,
    canEdit,
    addNode,
    updateNode,
    deleteNode,
    deleteNodes,
    addEdge,
    updateEdge,
    deleteEdge,
    deleteEdges,
    reorderLayer,
    applyTidy,
    moveNode,
    reorderNode,
    copyNode,
    copyNodes,
    cutNode,
    cutNodes,
    pasteInto,
    duplicateNode,
    duplicateNodes,
    canPasteInto,
    clipboardType,
    addStructure,
    applyConnectorSync,
    applyDefinitions,
    setTagDef,
    removeTag,
    renameTag,
    toggleNodeTag,
    setUnmappedOk,
    setName: (name: string) => mutate((m) => ({ ...m, name })),
    save,
    canUndo,
    canRedo,
    undo,
    redo,
    applyRemoteModel,
  };
}
