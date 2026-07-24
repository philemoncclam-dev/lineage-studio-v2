import { createContext, useContext } from "react";

// Drag-reorder of attribute rows inside a table. Provided by Canvas (when the
// host page allows editing), consumed by ObjectContainer. `active` gates the
// rows' draggable attribute so read-only views stay inert.
export interface ReorderCtx {
  active: boolean;
  onReorder: (id: string, targetId: string, pos: "before" | "after") => void;
}

export const ReorderContext = createContext<ReorderCtx>({
  active: false,
  onReorder: () => {},
});
export const useReorder = () => useContext(ReorderContext);
