// Thin wrapper around a single Supabase Realtime channel scoped to one model.
// One channel per model id: `model:<modelId>`. Every collaborator currently
// viewing that model joins the same channel, using Realtime's Presence
// feature for "who's here" (avatars) and Broadcast for ephemeral, high-
// frequency events (cursor position) and low-frequency coordination events
// (model changed).
//
// This module intentionally knows nothing about React — `useCollaboration`
// (the hook) owns lifecycle/state; this just wraps the raw channel calls so
// they're easy to mock in tests and easy to reason about independent of
// render cycles.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { CollaboratorMeta, PresenceState } from "./presenceReducer";

export interface CursorBroadcast {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

export interface ModelChangedBroadcast {
  revision: number;
  // The full model is included only when small enough (see useCollaboration's
  // SIZE_INLINE_LIMIT) — otherwise peers behind this revision re-fetch via
  // cloudApi.openModel. This keeps the common case (small/medium models)
  // a single round-trip while never sending huge payloads over the wire.
  model?: unknown;
  updatedBy: string;
}

// "Editing focus" — advisory-only broadcast of which object id(s) a
// collaborator currently has selected/focused, so peers can warn each other
// about a potential conflicting edit (see realtime/conflictDetection.ts).
// An empty `objectIds` array signals "no longer focused anything" (sent on
// deselect/blur and on channel leave).
export interface FocusBroadcast {
  userId: string;
  name: string;
  color: string;
  objectIds: string[];
}

const CURSOR_EVENT = "cursor";
const MODEL_CHANGED_EVENT = "model-changed";
const FOCUS_EVENT = "focus";

export function channelNameForModel(modelId: string): string {
  return `model:${modelId}`;
}

export interface CollaborationChannelHandlers {
  onCursor?: (payload: CursorBroadcast) => void;
  onModelChanged?: (payload: ModelChangedBroadcast) => void;
  onPresenceSync?: (state: PresenceState) => void;
  onFocus?: (payload: FocusBroadcast) => void;
}

export interface CollaborationChannel {
  channel: RealtimeChannel;
  trackPresence: (meta: CollaboratorMeta) => Promise<void>;
  sendCursor: (payload: CursorBroadcast) => void;
  sendModelChanged: (payload: ModelChangedBroadcast) => void;
  sendFocus: (payload: FocusBroadcast) => void;
  presenceState: () => PresenceState;
  unsubscribe: () => void;
}

// Open (or reuse) the realtime channel for a model and wire up the given
// handlers. Returns helpers for sending presence/broadcast events plus a
// cleanup function.
export function joinCollaborationChannel(
  client: SupabaseClient,
  modelId: string,
  handlers: CollaborationChannelHandlers
): CollaborationChannel {
  const channel = client.channel(channelNameForModel(modelId), {
    config: {
      // Cursor events are frequent and stale ones are worthless the instant a
      // newer one arrives — self-broadcasting off (we don't need our own
      // events echoed back) keeps volume down.
      broadcast: { self: false, ack: false },
      presence: { key: undefined },
      // Private channel: Supabase Realtime Authorization checks the
      // `realtime.messages` RLS policies (see supabase/schema.sql) before
      // letting this connection join/broadcast/receive on this topic, so a
      // signed-in user who merely guesses another model's UUID can't listen
      // in — only owners/invitees of that specific model pass the policy.
      private: true,
    },
  });

  if (handlers.onPresenceSync) {
    channel.on("presence", { event: "sync" }, () => {
      handlers.onPresenceSync!(channel.presenceState() as unknown as PresenceState);
    });
  }
  if (handlers.onCursor) {
    channel.on("broadcast", { event: CURSOR_EVENT }, ({ payload }) => {
      handlers.onCursor!(payload as CursorBroadcast);
    });
  }
  if (handlers.onModelChanged) {
    channel.on("broadcast", { event: MODEL_CHANGED_EVENT }, ({ payload }) => {
      handlers.onModelChanged!(payload as ModelChangedBroadcast);
    });
  }
  if (handlers.onFocus) {
    channel.on("broadcast", { event: FOCUS_EVENT }, ({ payload }) => {
      handlers.onFocus!(payload as FocusBroadcast);
    });
  }

  channel.subscribe();

  return {
    channel,
    trackPresence: async (meta: CollaboratorMeta) => {
      await channel.track(meta);
    },
    sendCursor: (payload: CursorBroadcast) => {
      channel.send({ type: "broadcast", event: CURSOR_EVENT, payload });
    },
    sendModelChanged: (payload: ModelChangedBroadcast) => {
      channel.send({ type: "broadcast", event: MODEL_CHANGED_EVENT, payload });
    },
    sendFocus: (payload: FocusBroadcast) => {
      channel.send({ type: "broadcast", event: FOCUS_EVENT, payload });
    },
    presenceState: () => channel.presenceState() as unknown as PresenceState,
    unsubscribe: () => {
      client.removeChannel(channel);
    },
  };
}
