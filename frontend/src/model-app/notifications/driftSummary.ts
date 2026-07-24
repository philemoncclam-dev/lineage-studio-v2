// Builds a human-readable schema-drift summary from an existing
// ReconcileResult (see src/connectors/reconcile.ts). Deliberately does NOT
// recompute any diffing — the reconcile step already determined what's
// added/changed/removed on a re-sync; this module only formats that result
// for a chat notification.
//
// Kept pure (no I/O) so it's trivially unit-testable and reusable by any
// future caller (manual sync today, a scheduler later) — see notifyDrift in
// webhooks.ts, which takes this summary and formats it per provider.
import type { ReconcileResult } from "../connectors/reconcile";
import type { LineageNode } from "../types";

export interface DriftItem {
  kind: "added" | "changed" | "removed";
  // NodeType-ish label, kept as a plain string since callers only display it.
  type: string;
  name: string;
}

export interface DriftSummary {
  // True only when the reconcile result actually represents a change (some
  // added/changed/removed nodes, or an edge delta). A no-op re-sync should not
  // trigger a notification.
  hasDrift: boolean;
  modelName: string;
  addedCount: number;
  changedCount: number;
  removedCount: number;
  edgesAdded: number;
  edgesRemoved: number;
  // One-line summary, e.g.:
  // "3 tables added, 1 removed, 2 columns retyped in Shop Analytics"
  headline: string;
  // Short itemized list (bounded — see MAX_ITEMS) for the notification body.
  items: DriftItem[];
  // True if items was truncated relative to the actual added/changed/removed
  // totals (headline counts always reflect the true totals either way).
  truncated: boolean;
}

// Cap the itemized list so a huge sync doesn't produce a wall of text in a
// chat message — the headline counts still reflect the true totals.
const MAX_ITEMS = 20;

function countLabel(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function buildDriftSummary(modelName: string, result: ReconcileResult): DriftSummary {
  const addedCount = result.added.length;
  const changedCount = result.changed.length;
  const removedCount = result.removed.length;
  const edgesAdded = result.edgesAdded;
  const edgesRemoved = result.edgesRemoved;

  const hasDrift =
    addedCount > 0 || changedCount > 0 || removedCount > 0 || edgesAdded > 0 || edgesRemoved > 0;

  // "table" reads more naturally than the internal type name ("Object") in a
  // chat notification, so the headline always uses table/column regardless
  // of the actual NodeType — the itemized list below still shows real types.
  const clauses: string[] = [];
  if (addedCount > 0) {
    clauses.push(`${countLabel(addedCount, "table")} added`);
  }
  if (removedCount > 0) {
    clauses.push(`${countLabel(removedCount, "table")} removed`);
  }
  if (changedCount > 0) {
    clauses.push(`${countLabel(changedCount, "column")} retyped`);
  }
  if (edgesAdded > 0 || edgesRemoved > 0) {
    const parts: string[] = [];
    if (edgesAdded > 0) parts.push(`${edgesAdded} added`);
    if (edgesRemoved > 0) parts.push(`${edgesRemoved} removed`);
    clauses.push(`edges ${parts.join(", ")}`);
  }

  const headline = hasDrift
    ? `${clauses.join(", ")} in ${modelName}`
    : `No schema drift detected in ${modelName}`;

  const toItem = (kind: DriftItem["kind"]) => (n: LineageNode): DriftItem => ({
    kind,
    type: n.type,
    name: n.name,
  });

  const allItems: DriftItem[] = [
    ...result.added.map(toItem("added")),
    ...result.changed.map(toItem("changed")),
    ...result.removed.map(toItem("removed")),
  ];

  const items = allItems.slice(0, MAX_ITEMS);
  const truncated = allItems.length > MAX_ITEMS;

  return {
    hasDrift,
    modelName,
    addedCount,
    changedCount,
    removedCount,
    edgesAdded,
    edgesRemoved,
    headline,
    items,
    truncated,
  };
}

// Render a single item line, e.g. "+ Table customers" / "~ Attribute email"
// / "- Group orders". Shared by both Slack and Teams formatters so wording
// stays consistent across providers.
export function formatDriftItemLine(item: DriftItem): string {
  const marker = item.kind === "added" ? "+" : item.kind === "removed" ? "-" : "~";
  return `${marker} ${item.type} ${item.name}`;
}
