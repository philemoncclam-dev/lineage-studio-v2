// Remembers, per model, which connector it was last synced from and when — so
// the editor can offer a one-click "Re-sync" and show a "last synced" hint.
// Stored in localStorage (browser-local for now; a cloud model_connections
// table is the documented next step for cross-device durability).

export interface ModelConnection {
  connectorId: string;
  label: string;
  lastSyncedAt: string; // ISO
}

const KEY = (modelId: string) => `lineage:connection:${modelId}`;

export function getConnection(modelId: string): ModelConnection | null {
  try {
    const raw = localStorage.getItem(KEY(modelId));
    return raw ? (JSON.parse(raw) as ModelConnection) : null;
  } catch {
    return null;
  }
}

export function recordSync(modelId: string, connectorId: string, label: string): void {
  const conn: ModelConnection = { connectorId, label, lastSyncedAt: new Date().toISOString() };
  localStorage.setItem(KEY(modelId), JSON.stringify(conn));
}

// Compact "3h ago" style relative time.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}
