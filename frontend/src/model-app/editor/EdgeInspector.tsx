// Details-panel inspector for a selected lineage edge: source → target,
// transformation kind (rendered as line styles on the canvas), free-text note,
// and provenance (verified = created by a connector sync, not drawn by hand).
import { Icon } from "../ui/Icon";
import type { EdgeKind, LineageEdge, Model } from "../types";

const KINDS: { value: EdgeKind | ""; label: string; hint: string }[] = [
  { value: "", label: "—", hint: "Unspecified" },
  { value: "copy", label: "Copy", hint: "Direct passthrough" },
  { value: "derive", label: "Derive", hint: "Computed / reformatted" },
  { value: "aggregate", label: "Aggregate", hint: "Summarized (SUM, COUNT…)" },
  { value: "filter", label: "Filter", hint: "Subset of rows" },
];

interface Props {
  edge: LineageEdge;
  model: Model;
  onChange: (patch: Partial<LineageEdge>) => void;
  onDelete: () => void;
}

export default function EdgeInspector({ edge, model, onChange, onDelete }: Props) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const pathOf = (id: string): string => {
    const parts: string[] = [];
    let cur = byId.get(id);
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  };

  return (
    <div className="inspector-content">
      <div className="inspector-type">
        Edge
        {edge.verified && (
          <span className="edge-verified-badge" title="Created by a connector sync">
            <Icon name="checkmark" /> verified
          </span>
        )}
      </div>

      <div className="edge-endpoints">
        <div className="edge-endpoint">{pathOf(edge.sourceNodeId)}</div>
        <div className="edge-endpoint-arrow"><Icon name="arrowDown" /></div>
        <div className="edge-endpoint">{pathOf(edge.targetNodeId)}</div>
      </div>

      <label className="field">
        <span>Transformation</span>
        <select
          value={edge.kind ?? ""}
          onChange={(e) =>
            onChange({ kind: (e.target.value || undefined) as EdgeKind | undefined })
          }
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value} title={k.hint}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <p className="edge-kind-hint">{KINDS.find((k) => (edge.kind ?? "") === k.value)?.hint}</p>

      <label className="field">
        <span>Note</span>
        <textarea
          rows={3}
          value={edge.note ?? ""}
          placeholder="Why this mapping exists, caveats, ticket links…"
          onChange={(e) => onChange({ note: e.target.value || undefined })}
        />
      </label>

      <button className="inspector-delete" onClick={onDelete}>
        Delete edge
      </button>
    </div>
  );
}
