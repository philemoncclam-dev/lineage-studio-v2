import type { Model } from "./types";
import { lineageNarrative } from "./editor/lineageNarrative";

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Render every attribute's lineage narration into one plain-text document.
export function exportModelNarration(model: Model): void {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const attrs = model.nodes.filter((n) => n.type === "Attribute");

  // The ancestor trail (Layer ▸ Object ▸ Table) above a node, top-down.
  const pathOf = (id: string): string => {
    const parts: string[] = [];
    let parentId = byId.get(id)?.parentId ?? null;
    while (parentId) {
      const n = byId.get(parentId);
      if (!n) break;
      parts.unshift(n.name);
      parentId = n.parentId;
    }
    return parts.join(" ▸ ");
  };

  const sections: string[] = [];
  let withLineage = 0;

  for (const attr of attrs) {
    const narrative = lineageNarrative(model, attr.id);
    if (!narrative) continue;
    if (narrative.upstream.length || narrative.downstream.length) withLineage++;

    const path = pathOf(attr.id);
    const header = path ? `${attr.name} — ${path}` : attr.name;
    sections.push(`${header}\n${"-".repeat(header.length)}\n${narrative.text}`);
  }

  const divider = "\n\n" + "=".repeat(72) + "\n\n";
  const title = [
    `Lineage Narration — ${model.name}`,
    `Generated on ${new Date().toISOString().slice(0, 10)}`,
    `${attrs.length} attribute${attrs.length === 1 ? "" : "s"}, ${withLineage} with lineage`,
  ].join("\n");

  const doc = `${title}${divider}${sections.join(divider)}\n`;
  const blob = new Blob([doc], { type: "text/plain" });
  downloadBlob(blob, `${model.name}.lineage-narration.txt`);
}
