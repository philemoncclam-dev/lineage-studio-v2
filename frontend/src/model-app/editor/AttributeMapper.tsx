import { useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import type { Model, LineageNode } from "../types";
import Modal from "./Modal";

interface Props {
  model: Model;
  addEdge: (sourceId: string, targetId: string) => void;
  deleteEdge: (edgeId: string) => void;
  updateNode: (id: string, patch: Partial<LineageNode>) => void;
  onClose: () => void;
  // "Pick from canvas": close the modal so the user can click an object on the
  // canvas. When they've picked a source + target the modal reopens with these
  // node ids preset as the auto-map scopes.
  onStartPick?: () => void;
  initialSrc?: string | null;
  initialTgt?: string | null;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Walk parentId chain upwards and return all ancestor ids (including self). */
function getAncestors(nodeId: string, byId: Map<string, LineageNode>): string[] {
  const ids: string[] = [];
  let cur = byId.get(nodeId);
  while (cur) {
    ids.push(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return ids;
}

/** True when scopeId is "" (All) or is in the ancestor chain of attrId. */
function isInScope(
  attrId: string,
  scopeId: string,
  byId: Map<string, LineageNode>
): boolean {
  if (!scopeId) return true;
  return getAncestors(attrId, byId).includes(scopeId);
}

/** Jaccard similarity on character bigrams. Returns 0–1. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(a.toLowerCase());
  const bb = bigrams(b.toLowerCase());
  if (ba.size === 0 && bb.size === 0) return 1;
  if (ba.size === 0 || bb.size === 0) return 0;
  let intersection = 0;
  for (const g of ba) if (bb.has(g)) intersection++;
  return intersection / (ba.size + bb.size - intersection);
}

const FUZZY_THRESHOLD = 0.7;

interface Proposal {
  srcId: string;
  tgtId: string;
  srcName: string;
  tgtName: string;
  kind: "exact" | "fuzzy";
  score: number;
}

// Resolve the Layer / Object / Table ids in a node's ancestry (including the
// node itself), so a picked object/table can preset the cascading selects.
function levelsFor(id: string, nodes: LineageNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let layer = "";
  let object = "";
  let table = "";
  let cur: LineageNode | undefined = byId.get(id);
  while (cur) {
    if (cur.type === "Layer") layer = cur.id;
    else if (cur.type === "Object") object = cur.id;
    else if (cur.type === "Group") table = cur.id;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return { layer, object, table };
}

// ──────────────────────────────────────────────
// Cascading scope picker (Layer ▸ Object ▸ Table)
// ──────────────────────────────────────────────

// Three dependent selects, stacked vertically so each gets the full column
// width (long table names would overflow side-by-side selects). Each level
// filters the next; `onChange` reports the *deepest* chosen id (table, else
// object, else layer, else "" for All) — which is what isInScope() expects.
// Tables (Groups) may hang off an Object or directly off a Layer, so the
// table list falls back to the layer's direct groups when no object is chosen.
function CascadingScope({
  label,
  nodes,
  onChange,
  presetId,
}: {
  label: string;
  nodes: LineageNode[];
  onChange: (scopeId: string) => void;
  presetId?: string | null;
}) {
  const [layerId, setLayerId] = useState("");
  const [objectId, setObjectId] = useState("");
  const [tableId, setTableId] = useState("");

  // Seed the three levels from a canvas-picked node (runs on mount / when the
  // pick changes).
  useEffect(() => {
    if (!presetId) return;
    const { layer, object, table } = levelsFor(presetId, nodes);
    setLayerId(layer);
    setObjectId(object);
    setTableId(table);
    onChange(table || object || layer || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  const layers = nodes.filter((n) => n.type === "Layer");
  const objects = layerId
    ? nodes.filter((n) => n.type === "Object" && n.parentId === layerId)
    : [];
  const tables = objectId
    ? nodes.filter((n) => n.type === "Group" && n.parentId === objectId)
    : layerId
      ? nodes.filter((n) => n.type === "Group" && n.parentId === layerId)
      : [];

  const emit = (l: string, o: string, t: string) => onChange(t || o || l || "");

  return (
    <div className="mapper-cascade">
      <span className="mapper-cascade-label">{label}</span>
      <div className="mapper-cascade-selects">
        <select
          value={layerId}
          onChange={(e) => {
            const l = e.target.value;
            setLayerId(l);
            setObjectId("");
            setTableId("");
            emit(l, "", "");
          }}
        >
          <option value="">Layer…</option>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>

        {layerId && objects.length > 0 && (
          <select
            value={objectId}
            onChange={(e) => {
              const o = e.target.value;
              setObjectId(o);
              setTableId("");
              emit(layerId, o, "");
            }}
          >
            <option value="">Whole layer</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}

        {layerId && tables.length > 0 && (
          <select
            value={tableId}
            onChange={(e) => {
              const t = e.target.value;
              setTableId(t);
              emit(layerId, objectId, t);
            }}
          >
            <option value="">{objectId ? "Whole object" : "Whole layer"}</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function AttributeMapper({
  model,
  addEdge,
  deleteEdge,
  updateNode,
  onClose,
  onStartPick,
  initialSrc = null,
  initialTgt = null,
}: Props) {
  const byId = useMemo(
    () => new Map(model.nodes.map((n) => [n.id, n])),
    [model.nodes]
  );

  // Two clear modes: Auto-match (scopes + live name proposals) and Manual
  // (explicit column-to-column clicking). One thing on screen at a time.
  const [tab, setTab] = useState<"auto" | "manual">("auto");

  // Every Group (table) with a readable "Layer / Object / Table" label.
  const tables = useMemo(() => {
    const path = (n: LineageNode): string => {
      const parts = [n.name];
      let cur = n.parentId ? byId.get(n.parentId) : undefined;
      while (cur) {
        parts.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return parts.join(" / ");
    };
    return model.nodes
      .filter((n) => n.type === "Group")
      .map((g) => ({ id: g.id, label: path(g) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [model.nodes, byId]);

  // Manual mapper state. When opened from a canvas gesture (connect/pick) the
  // preset endpoints seed the table selects too, so the manual columns show
  // the same pair the user just pointed at.
  const tableFromPreset = (id: string | null) =>
    id ? levelsFor(id, model.nodes).table : "";
  const [sourceId, setSourceId] = useState(
    () => tableFromPreset(initialSrc) || (tables[0]?.id ?? "")
  );
  const [targetId, setTargetId] = useState(
    () => tableFromPreset(initialTgt) || tables[1]?.id || tables[0]?.id || ""
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Scope selector state — "" means "not chosen yet". Seeded from
  // canvas-picked nodes.
  const scopeFromNode = (id: string | null) => {
    if (!id) return "";
    const { layer, object, table } = levelsFor(id, model.nodes);
    return table || object || layer || "";
  };
  const [srcScope, setSrcScope] = useState(() => scopeFromNode(initialSrc));
  const [tgtScope, setTgtScope] = useState(() => scopeFromNode(initialTgt));

  // ── Derived attribute lists ──────────────────────────────────────────
  const allAttrs = useMemo(
    () => model.nodes.filter((n) => n.type === "Attribute"),
    [model.nodes]
  );

  const childrenOf = (pid: string) =>
    model.nodes.filter((n) => n.parentId === pid && n.type === "Attribute");
  const sourceAttrs = sourceId ? childrenOf(sourceId) : [];
  const targetAttrs = targetId ? childrenOf(targetId) : [];

  // Incoming edges per target attribute.
  const incoming = useMemo(() => {
    const m = new Map<
      string,
      { edgeId: string; src: LineageNode | undefined }[]
    >();
    for (const e of model.edges) {
      const arr = m.get(e.targetNodeId) ?? [];
      arr.push({ edgeId: e.id, src: byId.get(e.sourceNodeId) });
      m.set(e.targetNodeId, arr);
    }
    return m;
  }, [model.edges, byId]);

  // Set of existing edge pairs for quick de-dup.
  const existingEdges = useMemo(
    () =>
      new Set(model.edges.map((e) => `${e.sourceNodeId}|${e.targetNodeId}`)),
    [model.edges]
  );

  // ── Manual mapper actions ────────────────────────────────────────────
  function toggleSource(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function mapTo(targetAttrId: string) {
    if (selected.size === 0) return;
    selected.forEach((srcId) => addEdge(srcId, targetAttrId));
    setSelected(new Set());
  }

  // ── Auto-match: proposals compute live from the chosen scopes ────────
  // No "run" button — as soon as both scopes are set (or preset by the
  // connect/pick gesture) matching names appear below. Recomputes after Apply
  // because model.edges changes, so applied pairs drop out on their own.
  const proposals = useMemo<Proposal[] | null>(() => {
    if (!srcScope || !tgtScope || srcScope === tgtScope) return null;
    const srcAttrs = allAttrs.filter((a) => isInScope(a.id, srcScope, byId));
    const tgtAttrs = allAttrs.filter((a) => isInScope(a.id, tgtScope, byId));
    const props: Proposal[] = [];
    for (const src of srcAttrs) {
      const srcLow = src.name.toLowerCase();
      // Exact matches first.
      const exactTargets = tgtAttrs.filter(
        (t) => t.name.toLowerCase() === srcLow && t.id !== src.id
      );
      if (exactTargets.length > 0) {
        for (const tgt of exactTargets) {
          if (!existingEdges.has(`${src.id}|${tgt.id}`)) {
            props.push({
              srcId: src.id,
              tgtId: tgt.id,
              srcName: src.name,
              tgtName: tgt.name,
              kind: "exact",
              score: 1,
            });
          }
        }
      } else {
        // Fuzzy: find best target above threshold.
        let best: { tgt: LineageNode; score: number } | null = null;
        for (const tgt of tgtAttrs) {
          if (tgt.id === src.id) continue;
          const s = similarity(src.name, tgt.name);
          if (s >= FUZZY_THRESHOLD && (!best || s > best.score)) {
            best = { tgt, score: s };
          }
        }
        if (best && !existingEdges.has(`${src.id}|${best.tgt.id}`)) {
          props.push({
            srcId: src.id,
            tgtId: best.tgt.id,
            srcName: src.name,
            tgtName: best.tgt.name,
            kind: "fuzzy",
            score: best.score,
          });
        }
      }
    }
    // Confident matches first.
    return props.sort((a, b) => b.score - a.score);
  }, [srcScope, tgtScope, allAttrs, byId, existingEdges]);

  // Everything starts checked; re-seed whenever the proposal list changes.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const proposalsKey = proposals?.map((p) => `${p.srcId}|${p.tgtId}`).join(",") ?? "";
  useEffect(() => {
    setChecked(new Set(proposalsKey ? proposalsKey.split(",") : []));
  }, [proposalsKey]);

  // Transient "Added N" confirmation after applying.
  const [addedFlash, setAddedFlash] = useState(0);
  useEffect(() => {
    if (!addedFlash) return;
    const t = setTimeout(() => setAddedFlash(0), 2500);
    return () => clearTimeout(t);
  }, [addedFlash]);

  function applySelected() {
    if (!proposals) return;
    let n = 0;
    for (const p of proposals) {
      if (checked.has(`${p.srcId}|${p.tgtId}`)) {
        addEdge(p.srcId, p.tgtId);
        n++;
      }
    }
    setAddedFlash(n);
  }

  function toggleProposal(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const checkedCount = proposals
    ? proposals.filter((p) => checked.has(`${p.srcId}|${p.tgtId}`)).length
    : 0;
  const allChecked = !!proposals && proposals.length > 0 && checkedCount === proposals.length;

  return (
    <Modal title="Map attributes" onClose={onClose} wide>
      {/* ── Mode switch ─────────────────────────────────────── */}
      <div className="mapper-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "auto"}
          className={`mapper-tab${tab === "auto" ? " is-active" : ""}`}
          onClick={() => setTab("auto")}
        >
          <Icon name="sparkles" /> Auto-match
        </button>
        <button
          role="tab"
          aria-selected={tab === "manual"}
          className={`mapper-tab${tab === "manual" ? " is-active" : ""}`}
          onClick={() => setTab("manual")}
        >
          Manual
        </button>
      </div>

      {tab === "auto" && (
        <>
          {/* ── Scopes ──────────────────────────────────────── */}
          <div className="mapper-scope-row">
            <CascadingScope
              label="Source"
              nodes={model.nodes}
              presetId={initialSrc}
              onChange={setSrcScope}
            />
            <span className="mapper-scope-arrow">
              <Icon name="arrowRight" />
            </span>
            <CascadingScope
              label="Target"
              nodes={model.nodes}
              presetId={initialTgt}
              onChange={setTgtScope}
            />
          </div>
          {onStartPick && (
            <button
              className="mapper-pick-btn"
              onClick={onStartPick}
              title="Close this dialog and click a source, then a target, on the canvas"
            >
              <Icon name="target" /> Pick on canvas
            </button>
          )}

          {/* ── Live proposals ──────────────────────────────── */}
          {proposals === null ? (
            <p className="mapper-empty">
              Choose a source and a target — matching column names appear here
            </p>
          ) : proposals.length === 0 ? (
            <p className="mapper-empty">
              {addedFlash > 0 ? (
                <span className="mapper-added">
                  <Icon name="checkmark" /> Added {addedFlash} mapping
                  {addedFlash === 1 ? "" : "s"}
                </span>
              ) : (
                "No new matches — everything with a similar name is already mapped"
              )}
            </p>
          ) : (
            <div className="mapper-proposals">
              <label className="mapper-proposals-head">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() =>
                    setChecked(
                      allChecked
                        ? new Set()
                        : new Set(proposals.map((p) => `${p.srcId}|${p.tgtId}`))
                    )
                  }
                />
                {proposals.length} match{proposals.length === 1 ? "" : "es"}
                {addedFlash > 0 && (
                  <span className="mapper-added">
                    <Icon name="checkmark" /> Added {addedFlash}
                  </span>
                )}
              </label>
              <div className="mapper-proposals-list">
                {proposals.map((p) => {
                  const key = `${p.srcId}|${p.tgtId}`;
                  return (
                    <label key={key} className="mapper-proposal-row">
                      <input
                        type="checkbox"
                        checked={checked.has(key)}
                        onChange={() => toggleProposal(key)}
                      />
                      <span className="mapper-proposal-names">
                        <strong>{p.srcName}</strong>
                        <span className="mapper-proposal-arrow">&rarr;</span>
                        <strong>{p.tgtName}</strong>
                      </span>
                      <span
                        className={`mapper-proposal-badge mapper-proposal-${p.kind}`}
                        title={
                          p.kind === "exact"
                            ? "Names match exactly"
                            : `Names are ${Math.round(p.score * 100)}% similar`
                        }
                      >
                        {p.kind === "exact" ? "exact" : `${Math.round(p.score * 100)}%`}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="mapper-proposals-actions">
                <button
                  className="save-btn"
                  onClick={applySelected}
                  disabled={checkedCount === 0}
                >
                  Add {checkedCount} mapping{checkedCount === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "manual" && (
        <>
          {/* ── Table selectors ─────────────────────────────── */}
          <div className="mapper-tables">
            <label className="field">
              <span>Source table</span>
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setSelected(new Set());
                }}
              >
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="mapper-arrow">&rarr;</span>
            <label className="field">
              <span>Target table</span>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mapper-cols">
            {/* Source attributes */}
            <div className="mapper-col">
              <div className="mapper-col-head">
                1. Pick source columns
                {selected.size > 0 && (
                  <span className="mapper-selcount">{selected.size}</span>
                )}
              </div>
              {sourceAttrs.length === 0 && <p className="muted">No columns.</p>}
              {sourceAttrs.map((a) => (
                <button
                  key={a.id}
                  className={`mapper-attr${
                    selected.has(a.id) ? " is-selected" : ""
                  }`}
                  onClick={() => toggleSource(a.id)}
                >
                  <span className="type-dot type-attr" />
                  {a.name}
                </button>
              ))}
            </div>

            {/* Target attributes */}
            <div className="mapper-col">
              <div className="mapper-col-head">2. Click a target</div>
              {targetAttrs.length === 0 && <p className="muted">No columns.</p>}
              {targetAttrs.map((a) => {
                const maps = incoming.get(a.id) ?? [];
                return (
                  <div key={a.id} className="mapper-target">
                    <button
                      className={`mapper-attr mapper-target-btn${
                        selected.size > 0 ? " is-armed" : ""
                      }`}
                      onClick={() => mapTo(a.id)}
                      title="Map selected source columns here"
                    >
                      <span className="type-dot type-attr" />
                      {a.name}
                      {maps.length > 0 && (
                        <span className="mapper-incount">{maps.length}</span>
                      )}
                    </button>
                    {maps.length > 0 && (
                      <div className="mapper-maps">
                        {maps.map((mp) => (
                          <span key={mp.edgeId} className="mapper-chip">
                            {mp.src?.name ?? "?"}
                            <button
                              className="mapper-chip-x"
                              title="Remove mapping"
                              onClick={() => deleteEdge(mp.edgeId)}
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                        <input
                          className="mapper-logic"
                          placeholder="transformation logic…"
                          defaultValue={a.transformation_logic}
                          onBlur={(e) =>
                            updateNode(a.id, {
                              transformation_logic: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
