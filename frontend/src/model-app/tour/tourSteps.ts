// Step config + pure state machine for the first-run onboarding tour (see
// Tour.tsx for the rendering side). Kept framework-free so it's trivially
// unit-testable.

export type TourPlacement = "top" | "bottom" | "left" | "right";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  // CSS selector for the real DOM element to spotlight. Elements are tagged
  // with data-tour="<id>" (see Canvas/EditorPage) rather than relying on
  // brittle structural selectors.
  selector: string;
  placement: TourPlacement;
}

// The core loop, kept to 6 steps per the "5-7 total" guidance.
export const TOUR_STEPS: TourStep[] = [
  {
    id: "canvas",
    title: "Your model, laid out",
    body:
      "Each column is a Layer. Inside it, Objects/tables hold Attributes — " +
      "the columns of your data. This sample has a few layers wired end to end.",
    selector: '[data-tour="canvas-legend"]',
    placement: "top",
  },
  {
    id: "add",
    title: "Add a node",
    body:
      "Use Add to create a new Layer, Object, table (Group), or Attribute — " +
      "or right-click empty canvas space for the same menu.",
    selector: '[data-tour="rail-add"]',
    placement: "right",
  },
  {
    id: "map",
    title: "Map lineage",
    body:
      "Drag from one attribute's dot to another to draw lineage. Or open Map and " +
      "\"Pick on canvas\": click any source and target — attributes connect directly, " +
      "and tables, objects, or layers auto-match their columns by name.",
    selector: '[data-tour="rail-map"]',
    placement: "right",
  },
  {
    id: "select",
    title: "Trace lineage",
    body:
      "Click any attribute to highlight its full upstream/downstream lineage " +
      "across the canvas — follow a value from source to report.",
    selector: '[data-tour="canvas-legend"]',
    placement: "top",
  },
  {
    id: "sync",
    title: "Sync from source",
    body:
      "Import brings in a schema, another model, or definitions, or re-syncs live " +
      "from a connected source (e.g. dbt) — keeping the model current.",
    selector: '[data-tour="rail-import"]',
    placement: "right",
  },
  {
    id: "export",
    title: "Export your work",
    body:
      "Export as Excel, JSON, CSV lineage, a narration, or a data dictionary — " +
      "whatever your downstream audience needs.",
    selector: '[data-tour="rail-export"]',
    placement: "right",
  },
];

export interface TourState {
  active: boolean;
  index: number;
}

export const INITIAL_TOUR_STATE: TourState = { active: false, index: 0 };

export type TourAction =
  | { type: "START" }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SKIP" }
  | { type: "FINISH" };

// Pure reducer: NEXT/BACK clamp to step bounds; NEXT past the last step (or
// SKIP/FINISH) ends the tour. No side effects (localStorage writes happen in
// the component, on the transition to !active) — keeps this unit-testable
// without touching the DOM or storage.
export function tourReduce(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case "START":
      return { active: true, index: 0 };
    case "NEXT": {
      if (!state.active) return state;
      const next = state.index + 1;
      if (next >= TOUR_STEPS.length) return { active: false, index: 0 };
      return { active: true, index: next };
    }
    case "BACK": {
      if (!state.active) return state;
      const prev = Math.max(0, state.index - 1);
      return { active: true, index: prev };
    }
    case "SKIP":
    case "FINISH":
      return { active: false, index: 0 };
    default:
      return state;
  }
}
