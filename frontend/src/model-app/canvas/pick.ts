import { createContext, useContext } from "react";

// Drives "pick from canvas" mode for the attribute mapper: when active, clicking
// an Object or table on the canvas reports its id (instead of selecting it) so
// the mapper can use it as a source/target scope. The chosen source/target ids
// are highlighted with a red outline.
export interface PickCtx {
  active: boolean;
  sourceId: string | null;
  targetId: string | null;
  onPick: (nodeId: string) => void;
}

export const PickContext = createContext<PickCtx>({
  active: false,
  sourceId: null,
  targetId: null,
  onPick: () => {},
});

export const usePick = () => useContext(PickContext);
