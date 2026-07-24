// Model view filter: narrow what the canvas highlights by tag and by lineage
// status. The filter never deletes anything — it produces the set of attribute
// ids that FAIL the filter, which the layout dims (matching attributes stay
// bright, the rest fade). This mirrors how search dimming already works.
import type { Model } from "../types";
import { readTags } from "./tags";

export type LineageStatus =
  | "all"
  | "no-input" // source-only: nothing feeds it
  | "no-output" // sink-only: it feeds nothing
  | "isolated" // neither input nor output
  | "has-input"
  | "has-output";

export const LINEAGE_OPTIONS: { value: LineageStatus; label: string }[] = [
  { value: "all", label: "All attributes" },
  { value: "no-input", label: "No input (source-only)" },
  { value: "no-output", label: "No output (sink-only)" },
  { value: "isolated", label: "No input or output" },
  { value: "has-input", label: "Has input" },
  { value: "has-output", label: "Has output" },
];

// How failing attributes are presented: "dim" fades them (default), "hide"
// removes them from the layout entirely.
export type FilterMode = "dim" | "hide";

export interface ModelFilter {
  tags: string[]; // OR semantics; empty = no tag constraint
  lineage: LineageStatus;
  mode: FilterMode;
}

export const EMPTY_FILTER: ModelFilter = { tags: [], lineage: "all", mode: "dim" };

// Activeness depends only on the actual constraints (tags/lineage), never on
// the presentation mode.
export function isFilterActive(f: ModelFilter): boolean {
  return f.tags.length > 0 || f.lineage !== "all";
}

export interface FilterResult {
  active: boolean;
  filteredOut: Set<string>; // attribute ids that fail the filter (dimmed)
  matchCount: number; // attributes that pass
  attrCount: number; // total attributes
}

export function applyFilter(model: Model, f: ModelFilter): FilterResult {
  const attrs = model.nodes.filter((n) => n.type === "Attribute");
  if (!isFilterActive(f)) {
    return { active: false, filteredOut: new Set(), matchCount: attrs.length, attrCount: attrs.length };
  }

  // An attribute "has input" if any edge targets it, "has output" if any edge
  // leaves it.
  const hasInput = new Set<string>();
  const hasOutput = new Set<string>();
  for (const e of model.edges) {
    hasOutput.add(e.sourceNodeId);
    hasInput.add(e.targetNodeId);
  }

  const tagSet = new Set(f.tags);
  const passLineage = (id: string): boolean => {
    const i = hasInput.has(id);
    const o = hasOutput.has(id);
    switch (f.lineage) {
      case "no-input":
        return !i;
      case "no-output":
        return !o;
      case "isolated":
        return !i && !o;
      case "has-input":
        return i;
      case "has-output":
        return o;
      default:
        return true;
    }
  };
  const passTags = (props: Record<string, unknown>): boolean =>
    tagSet.size === 0 || readTags(props).some((t) => tagSet.has(t));

  const filteredOut = new Set<string>();
  let matchCount = 0;
  for (const a of attrs) {
    const ok = passLineage(a.id) && passTags(a.properties as Record<string, unknown>);
    if (ok) matchCount++;
    else filteredOut.add(a.id);
  }
  return { active: true, filteredOut, matchCount, attrCount: attrs.length };
}
