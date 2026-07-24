import { createContext, useContext } from "react";

export interface CollapseCtx {
  collapsed: Set<string>;
  toggle: (id: string) => void;
}

export const CollapseContext = createContext<CollapseCtx>({
  collapsed: new Set(),
  toggle: () => {},
});

export const useCollapse = () => useContext(CollapseContext);
