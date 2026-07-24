// Pure logic for deriving an "advisory conflict" warning when two
// collaborators have the same object focused (selected/being edited) at the
// same time. This is NOT locking or CRDT merge — last-write-wins behavior is
// unchanged; this only powers a UI warning so a save doesn't silently clobber
// someone else's in-flight edit.
//
// Kept framework-free and dependency-free (like presenceReducer.ts and
// revisionGuard.ts) so it's trivially unit-testable without React or a live
// channel.

export interface RemoteFocus {
  userId: string;
  name: string;
  color: string;
  objectIds: string[];
}

// One entry per remote collaborator currently broadcasting a focus.
export type RemoteFocusByUser = Record<string, RemoteFocus>;

// One entry per contested object id: which remote collaborators (besides the
// local user) also have it focused right now.
export interface ContestedEntry {
  objectId: string;
  collaborators: RemoteFocus[];
}

export type ContestedMap = Record<string, ContestedEntry>;

// Derive the set of objects that are contested: focused by the local user
// AND by at least one remote collaborator. `localFocus` is the list of
// object ids the local user currently has selected/focused (usually 0 or 1,
// but multi-select can produce more). `remoteFocusByUser` is keyed by
// userId -> that user's current focus broadcast.
export function deriveContested(
  localFocus: string[],
  remoteFocusByUser: RemoteFocusByUser
): ContestedMap {
  if (localFocus.length === 0) return {};
  const remotes = Object.values(remoteFocusByUser);
  if (remotes.length === 0) return {};

  const result: ContestedMap = {};
  for (const objectId of localFocus) {
    const collaborators = remotes.filter((r) => r.objectIds.includes(objectId));
    if (collaborators.length > 0) {
      result[objectId] = { objectId, collaborators };
    }
  }
  return result;
}

// Human-readable summary for the banner, e.g. "Alex is also editing Orders"
// or "Alex and 1 other are also editing Orders". `objectLabel` is the name of
// the (single, most-recently-focused) contested object to call out by name;
// when multiple objects are contested we still only name one to keep the
// banner short, and the caller decides which (see EditorPage: the primary
// selection wins).
export function describeContestedBanner(
  entry: ContestedEntry,
  objectLabel: string
): string {
  const names = entry.collaborators.map((c) => c.name);
  let who: string;
  if (names.length === 1) {
    who = names[0];
  } else {
    who = `${names[0]} and ${names.length - 1} other${names.length - 1 === 1 ? "" : "s"}`;
  }
  const verb = names.length === 1 ? "is" : "are";
  return `${who} ${verb} also editing ${objectLabel}`;
}
