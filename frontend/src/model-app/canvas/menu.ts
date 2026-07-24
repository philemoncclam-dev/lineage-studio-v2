import { createContext, useContext } from "react";
import type { NodeType } from "../types";

// What was right-clicked on the canvas. `pane` is empty canvas; the rest carry
// the id (and type) of the node under the cursor so the menu can offer the
// relevant add/delete actions.
export type MenuTarget =
  | { kind: "pane" }
  | { kind: "layerArea"; layerId: string } // empty space inside a layer column
  | { kind: "node"; id: string; type: NodeType };

export interface MenuCtx {
  openMenu: (x: number, y: number, target: MenuTarget) => void;
}

export const MenuContext = createContext<MenuCtx>({ openMenu: () => {} });
export const useMenu = () => useContext(MenuContext);
