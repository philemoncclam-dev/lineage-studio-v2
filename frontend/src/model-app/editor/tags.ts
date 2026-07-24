// Tag helpers. Attributes reference tags by name in their `properties.tags`
// array; the model's `tags` registry holds each tag's color + optional icon.
// Resolving a name against the registry (with a deterministic color fallback for
// legacy/unregistered names) gives consistent presentation everywhere.
import type { Model, TagDef } from "../types";

const PALETTE = [
  "#4a90e2", "#e2724a", "#3bb273", "#9b59b6", "#c9a227",
  "#e24a7b", "#16a3a3", "#7b8a4a", "#d35400", "#5a6acf",
];

// Stable fallback color for a tag with no registry entry.
export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const DEFAULT_TAG_COLOR = PALETTE[0];

// Tags assigned to a single attribute (its properties.tags names).
export function readTags(props: Record<string, unknown> | undefined): string[] {
  const v = props?.tags;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export interface ResolvedTag {
  name: string;
  color: string;
}

// Resolve a tag name to its presentation: registry color if present, otherwise a
// deterministic fallback color.
export function resolveTag(model: Model, name: string): ResolvedTag {
  const def = (model.tags ?? []).find((t) => t.name === name);
  return { name, color: def?.color ?? tagColor(name) };
}

// Every tag known to the model: registry definitions plus any name still
// referenced by an attribute but missing from the registry (legacy), sorted.
export function allTags(model: Model): string[] {
  const set = new Set<string>((model.tags ?? []).map((t) => t.name));
  for (const n of model.nodes) {
    if (n.type !== "Attribute") continue;
    for (const t of readTags(n.properties as Record<string, unknown>)) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Count how many attributes carry a given tag.
export function tagUsage(model: Model, name: string): number {
  let n = 0;
  for (const node of model.nodes) {
    if (node.type === "Attribute" && readTags(node.properties as Record<string, unknown>).includes(name)) n++;
  }
  return n;
}

export type { TagDef };
