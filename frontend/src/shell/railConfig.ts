// Per-mode rail destination arrays (SHELL-01, D-01/D-03). This is the single
// source of truth the Rail component maps over — adding a fifth destination
// to any mode is a one-line edit to the array below, no structural/JSX
// change anywhere else (SHELL-01's "adding a fifth destination" truth).
//
// Accessible-name text (`label`) is LOCKED to 02-UI-SPEC.md's Copywriting
// Contract table — do not reword, the tooltip and screen-reader text must
// never drift apart from that contract.
//
// Graph/Lineage mode items are honest placeholders this phase (D-03: "Rails
// may be thin in this phase; Phases 3-4 flesh out the canvas modes' tools")
// — none of filters/layout/trace-tools/drill-scope/dataset-scope has a real
// panel yet, so every item in those two modes points at the mode's own root
// view rather than a distinct sub-page. Only Purview's three items are real,
// independently-navigable destinations this phase.

export type ModeKey = 'graph' | 'lineage' | 'model' | 'purview' | 'products'

export type RailIconName =
  | 'scope'
  | 'filter'
  | 'layout'
  | 'trace'
  | 'push'
  | 'definitions'
  | 'products'
  | 'layers'
  | 'plus'
  | 'inbox'

export interface RailItem {
  key: string
  /** Locked accessible name — used for both the Tooltip label and the VisuallyHidden text. */
  label: string
  icon: RailIconName
  to: string
}

export const railConfig: Record<ModeKey, RailItem[]> = {
  graph: [
    { key: 'drill-scope', label: 'Drill scope', icon: 'scope', to: '/graph' },
    { key: 'filters', label: 'Filters', icon: 'filter', to: '/graph' },
    { key: 'layout', label: 'Layout', icon: 'layout', to: '/graph' },
  ],
  lineage: [
    { key: 'dataset-scope', label: 'Dataset scope', icon: 'scope', to: '/lineage' },
    { key: 'filters', label: 'Filters', icon: 'filter', to: '/lineage' },
    { key: 'trace-tools', label: 'Trace tools', icon: 'trace', to: '/lineage' },
  ],
  model: [
    { key: 'layers', label: 'Model layers', icon: 'layers', to: '/model' },
  ],
  purview: [
    { key: 'push', label: 'Push to Purview', icon: 'push', to: '/purview/push' },
    { key: 'definitions', label: 'Definitions import', icon: 'definitions', to: '/purview/definitions' },
    { key: 'data-products', label: 'Data products', icon: 'products', to: '/purview/data-products' },
  ],
  products: [
    { key: 'catalog', label: 'Products', icon: 'products', to: '/products' },
    { key: 'domains', label: 'Domains', icon: 'layers', to: '/products/domains' },
    { key: 'new-product', label: 'New product', icon: 'plus', to: '/products/new' },
    { key: 'requests', label: 'Requests', icon: 'inbox', to: '/products/requests' },
  ],
}

export function modeFromPathname(pathname: string): ModeKey {
  if (pathname.startsWith('/lineage')) return 'lineage'
  if (pathname.startsWith('/model')) return 'model'
  if (pathname.startsWith('/purview')) return 'purview'
  if (pathname.startsWith('/products')) return 'products'
  return 'graph'
}

/** Where the app-logo mode menu (D-02) navigates each mode to. */
export const MODE_LANDING: Record<ModeKey, string> = {
  graph: '/graph',
  lineage: '/lineage',
  model: '/model',
  // /purview has no index route (route.tsx is a pathless layout) — Definitions
  // is the one Purview destination with a real working view this phase.
  purview: '/purview/definitions',
  products: '/products',
}

export const MODE_LABEL: Record<ModeKey, string> = {
  graph: 'Knowledge Graph',
  lineage: 'Lineage',
  model: 'Modeling',
  purview: 'Purview',
  products: 'Data Products',
}
