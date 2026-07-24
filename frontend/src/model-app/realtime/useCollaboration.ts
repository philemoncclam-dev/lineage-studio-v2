// useCollaboration — the single hook EditorPage wires in for real-time
// multiplayer: presence/avatars, live cursors, and live model sync.
//
// Completely inert (no channel opened, no listeners, no overhead) whenever
// the model is local (role === "local") or the user isn't signed in / cloud
// isn't configured — see the early bail-out in the effect below.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isCloudConfigured } from "../supabase";
import { useAuth } from "../auth";
import type { Model, ModelRole } from "../types";
import {
  joinCollaborationChannel,
  type CollaborationChannel,
  type CursorBroadcast,
  type FocusBroadcast,
} from "./collaborationChannel";
import { deriveCollaborators, colorForUser, type CollaboratorMeta } from "./presenceReducer";
import { RevisionTracker } from "./revisionGuard";
import { openModel } from "../cloudApi";
import { applyFocus, reconcileFocusWithPresence } from "./focusReducer";
import { deriveContested, type ContestedMap, type RemoteFocusByUser } from "./conflictDetection";

// Cursor broadcasts are throttled to ~40ms (within the requested 30-60ms
// range) — frequent enough to feel live, infrequent enough to not flood the
// channel or redraw thrash on peers.
const CURSOR_THROTTLE_MS = 40;

// Focus broadcasts (which object(s) a collaborator has selected) are far
// lower-frequency than cursor moves but still debounced so rapid selection
// changes (e.g. arrow-keying through a list) don't spam the channel.
const FOCUS_DEBOUNCE_MS = 150;

// Full-model inline broadcasts are only worth it for small/medium models;
// beyond this many characters of JSON we just send the revision number and
// let behind peers pull fresh data via cloudApi.openModel (a single already-
// fast, RLS-checked read they'd need to do anyway on next open).
const INLINE_MODEL_SIZE_LIMIT = 50_000;

export interface LiveCursor extends CollaboratorMeta {
  cursor: { x: number; y: number } | null;
}

export interface UseCollaborationOptions {
  modelId: string;
  model: Model | null;
  role: ModelRole;
  // Called when a remote model update should become the new local baseline.
  onRemoteModel: (model: Model) => void;
}

export interface UseCollaborationResult {
  active: boolean; // is a channel actually open (cloud model, not "local")?
  collaborators: LiveCursor[];
  // Report this client's own cursor position, already converted to
  // scroll-space content coordinates (see cursorMapping.ts). No-op for
  // viewers and when inactive.
  reportCursor: (point: { x: number; y: number } | null) => void;
  // Notify peers that the local model changed (after a successful save).
  // No-op for viewers and when inactive.
  broadcastModelChanged: () => void;
  // Report which object id(s) this client currently has selected/focused, so
  // peers can warn about a potential conflicting edit. Pass an empty array on
  // deselect/blur. No-op for viewers (they can't edit, so nothing to warn
  // about) and when inactive.
  reportFocus: (objectIds: string[]) => void;
  // Advisory-only map of object id -> the remote collaborator(s) who also
  // currently have it focused. Purely derived (see conflictDetection.ts);
  // never used to block a save — last-write-wins is unchanged.
  contested: ContestedMap;
}

export function useCollaboration({
  modelId,
  model,
  role,
  onRemoteModel,
}: UseCollaborationOptions): UseCollaborationResult {
  const { user } = useAuth();
  const canBroadcast = role === "owner" || role === "editor";
  // Cloud mode only: a "local" role (or no cloud config / no signed-in user)
  // means this feature must be fully inert.
  const isCloudModel = role !== "local" && isCloudConfigured && !!user && !!supabase;

  const [collaborators, setCollaborators] = useState<LiveCursor[]>([]);
  const channelRef = useRef<CollaborationChannel | null>(null);
  const revisionRef = useRef(new RevisionTracker(0));
  const lastCursorSentAt = useRef(0);
  const pendingCursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selfMetaRef = useRef<CollaboratorMeta | null>(null);
  // Latest known cursor per userId, merged with presence-derived identity so
  // a peer's avatar and live cursor are one consistent object for rendering.
  const cursorsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Remote collaborators' current "editing focus" (see conflictDetection.ts),
  // keyed by userId. Reconciled against presence so a peer who disconnects
  // without an explicit clear doesn't leave a stale false-positive conflict.
  const [remoteFocus, setRemoteFocus] = useState<RemoteFocusByUser>({});
  const [localFocus, setLocalFocus] = useState<string[]>([]);
  const pendingFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentFocusIds = useRef<string[]>([]);

  useEffect(() => {
    if (!isCloudModel || !supabase || !user) {
      channelRef.current = null;
      setCollaborators([]);
      setRemoteFocus({});
      setLocalFocus([]);
      return;
    }

    const selfMeta: CollaboratorMeta = {
      userId: user.id,
      name: user.email ?? "Anonymous",
      color: colorForUser(user.id),
    };
    selfMetaRef.current = selfMeta;
    cursorsRef.current = new Map();
    revisionRef.current = new RevisionTracker(0);
    lastSentFocusIds.current = [];
    setRemoteFocus({});

    const recompute = (presenceState: Parameters<typeof deriveCollaborators>[0]) => {
      const list = deriveCollaborators(presenceState, user.id);
      setCollaborators(
        list.map((c) => ({ ...c, cursor: cursorsRef.current.get(c.userId) ?? null }))
      );
      // Drop focus entries for anyone no longer present (tab closed / network
      // drop without an explicit empty-focus clear) so a stale conflict
      // marker never lingers forever.
      const presentIds = new Set(list.map((c) => c.userId));
      setRemoteFocus((prev) => reconcileFocusWithPresence(prev, presentIds));
    };

    const chan = joinCollaborationChannel(supabase, modelId, {
      onPresenceSync: (state) => recompute(state),
      onCursor: (payload: CursorBroadcast) => {
        if (payload.userId === user.id) return;
        cursorsRef.current.set(payload.userId, { x: payload.x, y: payload.y });
        recompute(chan.presenceState());
      },
      onFocus: (payload: FocusBroadcast) => {
        if (payload.userId === user.id) return;
        setRemoteFocus((prev) => applyFocus(prev, payload));
      },
      onModelChanged: (payload) => {
        if (payload.updatedBy === user.id) return;
        if (!revisionRef.current.tryApply(payload.revision)) return; // stale/duplicate, drop
        if (payload.model) {
          onRemoteModel(payload.model as Model);
        } else {
          // Payload was too large to inline — pull the authoritative model.
          openModel(modelId)
            .then(({ model: fresh }) => onRemoteModel(fresh))
            .catch(() => {
              // Best-effort: if the re-fetch fails (e.g. transient network
              // blip) the user simply keeps their current view; the next
              // successful edit/broadcast will resync them.
            });
        }
      },
    });
    channelRef.current = chan;
    chan.trackPresence(selfMeta);

    return () => {
      // Clear focus on leave so peers don't keep warning about a conflict
      // with someone who's no longer even viewing the model. Best-effort —
      // if canBroadcast is false (viewer) there was never anything to clear.
      if (canBroadcast && lastSentFocusIds.current.length > 0) {
        chan.sendFocus({ userId: selfMeta.userId, name: selfMeta.name, color: selfMeta.color, objectIds: [] });
      }
      chan.unsubscribe();
      channelRef.current = null;
      if (pendingCursorTimer.current) clearTimeout(pendingCursorTimer.current);
      if (pendingFocusTimer.current) clearTimeout(pendingFocusTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCloudModel, modelId, user?.id]);

  const reportCursor = useCallback(
    (point: { x: number; y: number } | null) => {
      const chan = channelRef.current;
      const meta = selfMetaRef.current;
      if (!chan || !meta || !canBroadcast || !point) return;
      const send = () => {
        lastCursorSentAt.current = Date.now();
        chan.sendCursor({ userId: meta.userId, name: meta.name, color: meta.color, ...point });
      };
      const elapsed = Date.now() - lastCursorSentAt.current;
      if (elapsed >= CURSOR_THROTTLE_MS) {
        send();
      } else {
        if (pendingCursorTimer.current) clearTimeout(pendingCursorTimer.current);
        pendingCursorTimer.current = setTimeout(send, CURSOR_THROTTLE_MS - elapsed);
      }
    },
    [canBroadcast]
  );

  const reportFocus = useCallback(
    (objectIds: string[]) => {
      setLocalFocus(objectIds);
      const chan = channelRef.current;
      const meta = selfMetaRef.current;
      if (!chan || !meta || !canBroadcast) return;
      const send = () => {
        lastSentFocusIds.current = objectIds;
        chan.sendFocus({ userId: meta.userId, name: meta.name, color: meta.color, objectIds });
      };
      if (pendingFocusTimer.current) clearTimeout(pendingFocusTimer.current);
      // Deselect/blur (empty array) is sent immediately rather than debounced
      // so a peer's conflict marker clears promptly instead of lingering for
      // the debounce window.
      if (objectIds.length === 0) {
        send();
      } else {
        pendingFocusTimer.current = setTimeout(send, FOCUS_DEBOUNCE_MS);
      }
    },
    [canBroadcast]
  );

  const contested = useMemo(
    () => deriveContested(localFocus, remoteFocus),
    [localFocus, remoteFocus]
  );

  const broadcastModelChanged = useCallback(() => {
    const chan = channelRef.current;
    const meta = selfMetaRef.current;
    if (!chan || !meta || !canBroadcast || !model) return;
    const revision = revisionRef.current.next();
    const json = JSON.stringify(model);
    const inline = json.length <= INLINE_MODEL_SIZE_LIMIT;
    chan.sendModelChanged({
      revision,
      model: inline ? model : undefined,
      updatedBy: meta.userId,
    });
  }, [canBroadcast, model]);

  return {
    active: isCloudModel,
    collaborators,
    reportCursor,
    broadcastModelChanged,
    reportFocus,
    contested,
  };
}
