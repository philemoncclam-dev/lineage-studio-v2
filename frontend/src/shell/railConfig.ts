// Per-mode rail destination arrays (SHELL-01, D-01/D-03). This is the single
// source of truth the Rail component maps over — adding a fifth destination
// to any mode is a one-line edit to the array below, no structural/JSX
// change anywhere else (SHELL-01's "adding a fifth destination" truth).
//
// Accessible-name text (`label`) is LOCKED to 02-UI-SPEC.md's Copywriting
// Contract table — do not reword, the tooltip and screen-reader text must
// never drift apart from that contract.
//
// Graph mode items are honest placeholders this phase (D-03: "Rails may be
// thin in this phase") — none of filters/layout/drill-scope has a real panel
// yet, so every item points at the mode's own root view rather than a
// distinct sub-page.

import type { RailActionKey } from './railActions'

export type ModeKey = 'model' | 'fabric' | 'products'

export type RailIconName =
  | 'scope'
  | 'filter'
  | 'layout'
  | 'definitions'
  | 'products'
  | 'layers'
  | 'plus'
  | 'inbox'
  | 'explore'
  | 'sandbox'
  | 'dashboard'
  | 'import'
  | 'export'

export interface RailItem {
  key: string
  /** Locked accessible name — used for both the Tooltip label and the VisuallyHidden text. */
  label: string
  icon: RailIconName
  /** Navigation target. Mutually exclusive with `action`. */
  to?: string
  /** Command to run instead of navigating — see shell/railActions.ts. */
  action?: RailActionKey
}

export const railConfig: Record<ModeKey, RailItem[]> = {
  model: [
    { key: 'layers', label: 'Model layers', icon: 'layers', to: '/model' },
    { key: 'import', label: 'Import', icon: 'import', action: 'import' },
    { key: 'export', label: 'Export', icon: 'export', action: 'export' },
  ],
  fabric: [
    { key: 'overview', label: 'Overview', icon: 'dashboard', to: '/fabric/overview' },
    { key: 'explore', label: '1. Explore', icon: 'explore', to: '/fabric/explore' },
    { key: 'sandbox', label: '2. Sandbox', icon: 'sandbox', to: '/fabric/sandbox' },
  ],
  products: [
    { key: 'catalog', label: 'Products', icon: 'products', to: '/products' },
    { key: 'domains', label: 'Domains', icon: 'layers', to: '/products/domains' },
    { key: 'new-product', label: 'New product', icon: 'plus', to: '/products/new' },
    { key: 'requests', label: 'Requests', icon: 'inbox', to: '/products/requests' },
  ],
}

export function modeFromPathname(pathname: string): ModeKey {
  if (pathname.startsWith('/model')) return 'model'
  if (pathname.startsWith('/products')) return 'products'
  return 'fabric'
}

/** Where the app-logo mode menu (D-02) navigates each mode to. */
export const MODE_LANDING: Record<ModeKey, string> = {
  model: '/model',
  // /fabric has no index route (route.tsx is a pathless layout) — Overview is
  // the mode's landing destination.
  fabric: '/fabric/overview',
  products: '/products',
}

export const MODE_LABEL: Record<ModeKey, string> = {
  model: 'Modeling',
  fabric: 'Fabric Toolkit',
  products: 'Data Products',
}
