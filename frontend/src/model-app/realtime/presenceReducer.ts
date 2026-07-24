// Pure reducer that turns a Supabase Realtime presence sync state into the
// flat list of collaborators the UI renders (avatars, live cursor owners).
// Kept framework-free and dependency-free so it's trivially unit-testable
// without a live channel.

export interface CollaboratorMeta {
  userId: string;
  name: string;
  color: string;
  // Cursor position is layered on separately (via broadcast), not presence —
  // presence payloads are for "who is here", broadcasts are for "where is
  // their cursor right now". Optional here so the reducer output can still
  // carry the last-known cursor if callers choose to merge it in.
  cursor?: { x: number; y: number } | null;
}

// Shape supabase-js's RealtimeChannel.presenceState() returns: a map of
// presence key -> array of metas (one per tab/connection sharing that key).
export type PresenceState = Record<string, CollaboratorMeta[]>;

// Reduce raw presence state into one entry per distinct user (a user with two
// tabs open collapses to a single avatar), excluding `selfId` so a user never
// sees their own avatar/cursor duplicated in the collaborator list.
export function deriveCollaborators(
  state: PresenceState,
  selfId: string | null
): CollaboratorMeta[] {
  const byUser = new Map<string, CollaboratorMeta>();
  for (const metas of Object.values(state)) {
    for (const meta of metas) {
      if (!meta || !meta.userId) continue;
      if (selfId && meta.userId === selfId) continue;
      // Last one wins if a user somehow has multiple presence entries — fine,
      // presence data (name/color) doesn't vary within a session.
      byUser.set(meta.userId, meta);
    }
  }
  return Array.from(byUser.values()).sort((a, b) => a.userId.localeCompare(b.userId));
}

// Deterministic, good-enough color for a given user id so every peer renders
// the same collaborator in the same color without coordination.
const CURSOR_COLORS = [
  "#e15554",
  "#4ea8de",
  "#3bb273",
  "#e0a458",
  "#7768ae",
  "#e8739f",
  "#2a9d8f",
  "#d68c45",
];

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % CURSOR_COLORS.length;
  return CURSOR_COLORS[idx];
}
