import type { Model } from "../types";
import { lineageNarrative } from "../editor/lineageNarrative";

// Builds the short, single-line string announced in the canvas's aria-live
// region when an attribute gains focus/selection. Reuses lineageNarrative
// (the same deterministic lineage walk that backs the full narration export in
// exportNarration.ts) so the wording stays consistent with that export, but
// condenses it to something a screen reader can read quickly rather than the
// full multi-paragraph narration.
//
// Example: "Orders.customer_id — 2 inputs, 3 outputs. Inputs: users.id,
// accounts.customer_id. Outputs: shipments.customer_id, invoices.customer_id."
export function attributeLiveNarration(model: Model, attrId: string): string {
  const narrative = lineageNarrative(model, attrId);
  if (!narrative) return "";

  const { focus, upstream, downstream } = narrative;
  const path = focus.path ? `${focus.path} ▸ ${focus.name}` : focus.name;

  if (upstream.length === 0 && downstream.length === 0) {
    return `${path} — no lineage connections.`;
  }

  const summary = `${path} — ${upstream.length} input${upstream.length === 1 ? "" : "s"}, ${downstream.length} output${downstream.length === 1 ? "" : "s"}.`;

  const parts = [summary];
  if (upstream.length > 0) {
    parts.push(`Inputs: ${upstream.map((s) => s.name).join(", ")}.`);
  }
  if (downstream.length > 0) {
    parts.push(`Outputs: ${downstream.map((s) => s.name).join(", ")}.`);
  }
  return parts.join(" ");
}

// For non-Attribute nodes (Layer/Object/Group), a simpler focus announcement
// so the live region still reads something useful while tabbing through the
// tree (no lineage to narrate at that level).
export function containerFocusNarration(model: Model, nodeId: string): string {
  const node = model.nodes.find((n) => n.id === nodeId);
  if (!node) return "";
  const kind =
    node.type === "Layer" ? "layer" : node.type === "Object" ? "object" : node.type === "Group" ? "table" : "";
  return kind ? `${node.name}, ${kind}.` : node.name;
}
