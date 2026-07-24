// Context that hands the canvas's per-node renderers (ObjectContainer) the
// current "contested objects" map from useCollaboration, so a node/table/
// attribute row that a remote collaborator is also editing can render a
// subtle colored marker — without threading the map through layout.ts's
// node-data pipeline. Purely presentational: mirrors the pattern in
// editor/selection.ts. Advisory only; never affects save/last-write-wins
// behavior.
import { createContext, useContext } from "react";
import type { ContestedMap } from "../realtime/conflictDetection";

export const ContestedContext = createContext<ContestedMap>({});

export const useContested = () => useContext(ContestedContext);
