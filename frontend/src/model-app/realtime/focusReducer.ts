// Pure reducer that maintains "which object(s) does each remote collaborator
// currently have focused" from a stream of focus broadcasts (see
// collaborationChannel.ts's FOCUS_EVENT) plus presence-leave events. Kept
// framework-free/dependency-free (like presenceReducer.ts) so it's trivially
// unit-testable.
import type { RemoteFocus, RemoteFocusByUser } from "./conflictDetection";

export interface FocusBroadcast {
  userId: string;
  name: string;
  color: string;
  objectIds: string[];
}

// Apply an incoming focus broadcast from a peer, replacing whatever that
// user's previous focus was. An empty `objectIds` array (sent on
// deselect/blur) clears that user's entry entirely so stale contested state
// doesn't linger once they've moved on.
export function applyFocus(
  state: RemoteFocusByUser,
  payload: FocusBroadcast
): RemoteFocusByUser {
  if (payload.objectIds.length === 0) {
    if (!(payload.userId in state)) return state;
    const next = { ...state };
    delete next[payload.userId];
    return next;
  }
  const entry: RemoteFocus = {
    userId: payload.userId,
    name: payload.name,
    color: payload.color,
    objectIds: payload.objectIds,
  };
  return { ...state, [payload.userId]: entry };
}

// Drop a user's focus entirely, e.g. when they leave the channel (presence
// sync no longer lists them) so their last-known focus doesn't stick around
// forever as a false-positive contested marker.
export function clearFocus(state: RemoteFocusByUser, userId: string): RemoteFocusByUser {
  if (!(userId in state)) return state;
  const next = { ...state };
  delete next[userId];
  return next;
}

// Reconcile the focus map against the current presence roster: drop any
// entries for users no longer present (they disconnected without sending an
// explicit empty-focus clear, e.g. tab closed / network drop).
export function reconcileFocusWithPresence(
  state: RemoteFocusByUser,
  presentUserIds: Set<string>
): RemoteFocusByUser {
  let changed = false;
  const next: RemoteFocusByUser = {};
  for (const [userId, entry] of Object.entries(state)) {
    if (presentUserIds.has(userId)) {
      next[userId] = entry;
    } else {
      changed = true;
    }
  }
  return changed ? next : state;
}
