import { createContext, useContext } from "react";

export interface Selection {
  // The "primary" selection (last clicked) — drives the inspector, the layer
  // swimlane highlight, and lineage tracing.
  selectedId: string | null;
  // The full selection set (includes the primary). Holds more than one id when
  // the user shift-clicks to multi-select (e.g. several attributes to copy).
  selectedIds: Set<string>;
  // Select a node. With `additive` (shift-click) the id is toggled into/out of
  // the current set; otherwise it replaces the selection. `null` clears it.
  onSelect: (id: string | null, additive?: boolean) => void;
}

export const SelectionContext = createContext<Selection>({
  selectedId: null,
  selectedIds: new Set(),
  onSelect: () => {},
});

export const useSelection = () => useContext(SelectionContext);
