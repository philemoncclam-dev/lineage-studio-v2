import { useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import type { LineageNode, Model } from "../types";
import { META_DROPDOWNS, META_DESCRIPTION, readMeta } from "./attributeMeta";
import { lineageNarrative } from "./lineageNarrative";
import LogicEditor from "./LogicEditor";

interface Props {
  node: LineageNode | null;
  model: Model;
  onChange: (patch: Partial<LineageNode>) => void;
  onDelete: () => void;
}

export default function Inspector({ node, model, onChange, onDelete }: Props) {
  if (!node) {
    return <p className="inspector-empty">Select a node to edit its details</p>;
  }

  const props = node.properties as Record<string, unknown>;
  const setProp = (key: string, value: string) =>
    onChange({ properties: { ...props, [key]: value } });

  return (
    <div className="inspector-content">
      <div className="inspector-type">{node.type}</div>

      <label className="field">
        <span>Name</span>
        <input
          value={node.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>

      {node.type === "Attribute" && (
        <>
          <label className="field">
            <span>Transformation logic</span>
            <UpstreamLogicEditor node={node} model={model} onChange={onChange} />
          </label>

          {META_DROPDOWNS.map((f) => (
            <label className="field" key={f.key}>
              <span>{f.label}</span>
              <select
                value={readMeta(props, f.key)}
                onChange={(e) => setProp(f.key, e.target.value)}
              >
                {f.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt || "—"}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <label className="field">
            <span>{META_DESCRIPTION.label}</span>
            <textarea
              rows={3}
              value={readMeta(props, META_DESCRIPTION.key)}
              placeholder="Business description of this attribute"
              onChange={(e) => setProp(META_DESCRIPTION.key, e.target.value)}
            />
          </label>

          <LineageExplain node={node} model={model} />
        </>
      )}

      <button className="inspector-delete" onClick={onDelete}>
        Delete {node.type}
      </button>
    </div>
  );
}

// The logic editor with autocomplete scoped to what actually feeds this
// attribute: direct upstream sources first, then everything transitively
// upstream, de-duplicated by name.
function UpstreamLogicEditor({
  node,
  model,
  onChange,
}: {
  node: LineageNode;
  model: Model;
  onChange: (patch: Partial<LineageNode>) => void;
}) {
  const suggestions = useMemo(() => {
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    const into = new Map<string, string[]>();
    for (const e of model.edges) {
      const arr = into.get(e.targetNodeId);
      if (arr) arr.push(e.sourceNodeId);
      else into.set(e.targetNodeId, [e.sourceNodeId]);
    }
    const out: string[] = [];
    const seen = new Set<string>();
    // BFS upstream so direct sources rank before transitive ones.
    const queue = [...(into.get(node.id) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = byId.get(id);
      if (n?.type === "Attribute" && !out.includes(n.name)) out.push(n.name);
      queue.push(...(into.get(id) ?? []));
    }
    return out;
  }, [model, node.id]);

  return (
    <LogicEditor
      value={node.transformation_logic}
      placeholder="e.g. SUM(order_total) grouped by customer_id"
      suggestions={suggestions}
      onChange={(v) => onChange({ transformation_logic: v })}
    />
  );
}

// A read-only, plain-English narration of the attribute's lineage, generated
// deterministically from the graph (no model / API call). Collapsed by default.
function LineageExplain({ node, model }: { node: LineageNode; model: Model }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const narrative = useMemo(() => lineageNarrative(model, node.id), [model, node.id]);
  if (!narrative) return null;

  const copy = () => {
    navigator.clipboard?.writeText(narrative.text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  };

  return (
    <div className="lineage-explain">
      <button className="lineage-explain-toggle" onClick={() => setOpen((o) => !o)}>
        <span><Icon name={open ? "chevronDown" : "chevronRight"} /> Explain lineage</span>
        <span className="lineage-explain-count">{narrative.transformations} ƒ</span>
      </button>
      {open && (
        <>
          <pre className="lineage-explain-text">{narrative.text}</pre>
          <button className="lineage-explain-copy" onClick={copy}>
            {copied ? <>Copied <Icon name="checkmark" /></> : "Copy"}
          </button>
        </>
      )}
    </div>
  );
}
