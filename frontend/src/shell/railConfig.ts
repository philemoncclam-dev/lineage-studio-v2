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
  | 'fold'
  | 'explain'
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
  | 'overview'
  | 'mapping'
  | 'browser'
  | 'tag'
  | 'properties'
  | 'assistant'
  | 'share'

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
    // No 'All models' entry: the logo's mode menu already lands the mode on
    // /models, so a rail button for it was a second door to the same room and
    // the only NAVIGATION item among commands — it read as the odd one out.
    { key: 'properties', label: 'Properties', icon: 'properties', action: 'properties' },
    { key: 'views', label: 'Views', icon: 'filter', action: 'views' },
    { key: 'explain', label: 'Explain', icon: 'explain', action: 'explain' },
    { key: 'fold', label: 'Collapse & expand', icon: 'fold', action: 'fold' },
    { key: 'assistant', label: 'Assistant', icon: 'assistant', action: 'assistant' },
    { key: 'tags', label: 'Tags', icon: 'tag', action: 'tags' },
    { key: 'mapping', label: 'Auto-Mapper', icon: 'mapping', action: 'mapping' },
    { key: 'import', label: 'Import', icon: 'import', action: 'import' },
    { key: 'export', label: 'Export', icon: 'export', action: 'export' },
    // Snapshot history. Next to Share because both are about the model as a
    // whole rather than about anything selected inside it.
    { key: 'versions', label: 'History', icon: 'layers', action: 'versions' },
    // Last: sharing is what you do once the model says what you mean.
    { key: 'share', label: 'Share', icon: 'share', action: 'share' },
  ],
  fabric: [
    { key: 'overview', label: 'Overview', icon: 'overview', to: '/fabric/overview' },
    // No Sandbox entry: the sandbox is a tab inside Explore now (its sequence
    // builder and lineage canvas both live there), not a page of its own.
    { key: 'explore', label: 'Explore', icon: 'explore', to: '/fabric/explore' },
    // Item-level lineage for a whole workspace — the question Explore's tree
    // cannot answer, because a tree shows containment and this shows flow.
    { key: 'lineage', label: 'Lineage', icon: 'layers', to: '/fabric/lineage' },
    // What this app calls, and what breaks without each. Last in the mode
    // because it is setup and diagnosis rather than daily work.
    { key: 'integrations', label: 'Integrations', icon: 'definitions', to: '/fabric/integrations' },
  ],
  products: [
    { key: 'catalog', label: 'Products', icon: 'products', to: '/products' },
    { key: 'domains', label: 'Domains', icon: 'layers', to: '/products/domains' },
    { key: 'new-product', label: 'New product', icon: 'plus', to: '/products/new' },
    { key: 'requests', label: 'Requests', icon: 'inbox', to: '/products/requests' },
  ],
}

export function modeFromPathname(pathname: string): ModeKey {
  // Covers both /models (the browser) and /model/<id> (the viewer).
  if (pathname.startsWith('/model')) return 'model'
  if (pathname.startsWith('/products')) return 'products'
  return 'fabric'
}

/**
 * Whether the route wants the full-bleed canvas with a floating rail.
 *
 * Only the Model Viewer does — its layer band has to span the whole window (see
 * shell.css). The Model Browser is in the same mode but is an ordinary page, and
 * would have the floating rail sitting on top of its sidebar. So this is a
 * per-route question, not a per-mode one.
 */
export function isFullBleedPath(pathname: string): boolean {
  return pathname.startsWith('/model/')
}

/**
 * Whether the route renders without the shell's rail column entirely.
 *
 * The Model Browser does: it is the landing screen, it carries its own header
 * with its own actions, and none of the model rail's entries (Auto-Mapper,
 * Import, Export) can do anything before a model is open — the rail would be a
 * column of permanently disabled buttons. A chromeless route is responsible for
 * offering its own navigation to the other modes.
 */
export function isChromeless(pathname: string): boolean {
  return pathname === '/models'
}

/** Where the app-logo mode menu (D-02) navigates each mode to. */
export const MODE_LANDING: Record<ModeKey, string> = {
  // The browser, not a model — the mode menu has no way to know which model.
  model: '/models',
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
