import { createContext, useContext } from "react";

// Inline rename of a node from the canvas (double-click an object band, table
// header, or attribute name). Provided by Canvas, consumed by ObjectContainer.
export interface RenameCtx {
  onRename: (id: string, name: string) => void;
}

export const RenameContext = createContext<RenameCtx>({ onRename: () => {} });
export const useRename = () => useContext(RenameContext);
