// Token-to-canvas bridge (THEME-03). A typed, cached, theme-aware snapshot of
// every design token a <canvas>/SVG renderer needs — read once from the DOM's
// computed style, cached at module scope, and invalidated only when the
// data-theme attribute on <html> actually changes. Never re-read per frame,
// per node, or per edge: see 01-UI-SPEC.md's "Token-to-Canvas Bridge" section
// and its explicit prohibitions. GraphView.tsx's knowledge-graph draw loop is
// the first consumer; Phase 3's xyflow custom renderers and Phase 4's
// sigma.js reducers must follow the same pattern (call getCanvasTokens(),
// never read the DOM's computed style directly).

import type { ColorKey } from '../data'

export interface CanvasTokens {
  readonly surfaceCanvas: string
  /** Not enumerated by 01-03-PLAN.md's task-1 field list, but required by
   *  task-2's action text ("Replace the node's outline stroke with the
   *  surface-1 field") — added here so that instruction is satisfiable. */
  readonly surface1: string
  readonly gridDot: string
  readonly textPrimary: string
  readonly textSecondary: string
  readonly textTertiary: string
  readonly border: string
  readonly borderStrong: string
  readonly accent: string
  readonly accentHi: string
  readonly accentDim: string
  readonly domainBronze: string
  readonly domainGold: string
  readonly domainSilver: string
  readonly domainNotebook: string
  readonly domainNeutral: string
  readonly edgeReads: string
  readonly edgeWrites: string
  readonly edgeDerives: string
  readonly fontSans: string
  readonly fontMono: string
  readonly textMicro: string
  readonly textBase: string
  readonly textHeading: string
  readonly textDisplay: string
}

// Every CSS custom-property name below must be declared in
// frontend/src/styles/tokens.css — cross-checked by 01-03-PLAN.md's task-1
// acceptance criteria (a node script diffs this list against tokens.css).
const TOKEN_MAP: Record<keyof CanvasTokens, string> = {
  surfaceCanvas: '--color-surface-canvas',
  surface1: '--color-surface-1',
  gridDot: '--color-grid-dot',
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  textTertiary: '--color-text-tertiary',
  border: '--color-border',
  borderStrong: '--color-border-strong',
  accent: '--color-accent',
  accentHi: '--color-accent-hi',
  accentDim: '--color-accent-dim',
  domainBronze: '--color-domain-bronze',
  domainGold: '--color-domain-gold',
  domainSilver: '--color-domain-silver',
  domainNotebook: '--color-domain-notebook',
  domainNeutral: '--color-domain-neutral',
  edgeReads: '--color-edge-reads',
  edgeWrites: '--color-edge-writes',
  edgeDerives: '--color-edge-derives',
  fontSans: '--font-sans',
  fontMono: '--font-mono',
  textMicro: '--text-micro',
  textBase: '--text-base',
  textHeading: '--text-heading',
  textDisplay: '--text-display',
}

/**
 * Exhaustive mapping from every ColorKey the model can produce (data.ts) to
 * the CanvasTokens field that paints it. `workspace` is the fallback key
 * model.tsx's colorFor() returns for an unrecognised layer (THEME-05) and
 * maps to the neutral domain field, matching the neutral default the DOM
 * tick indicator already renders. Because this record is typed over the full
 * ColorKey union, adding a domain later without updating this map is a
 * compile error, not a runtime blank fill.
 */
export const DOMAIN_TOKEN: Record<ColorKey, keyof CanvasTokens> = {
  bronze: 'domainBronze',
  silver: 'domainSilver',
  gold: 'domainGold',
  notebook: 'domainNotebook',
  workspace: 'domainNeutral',
  accent: 'accent',
}

let cached: CanvasTokens | null = null
let observer: MutationObserver | null = null

function readTokensFromDOM(): CanvasTokens {
  const cs = getComputedStyle(document.documentElement)
  const result = {} as Record<keyof CanvasTokens, string>
  for (const field of Object.keys(TOKEN_MAP) as (keyof CanvasTokens)[]) {
    const cssVarName = TOKEN_MAP[field]
    const value = cs.getPropertyValue(cssVarName).trim()
    if (!value) {
      throw new Error(
        `canvasTokens: "${cssVarName}" (CanvasTokens.${field}) resolved to an empty value — ` +
          'check that the token is still declared in frontend/src/styles/tokens.css for both themes.',
      )
    }
    result[field] = value
  }
  return result as CanvasTokens
}

/** Returns the cached snapshot, populating it on first call (or after
 *  invalidation) with exactly one computed-style read. */
export function getCanvasTokens(): CanvasTokens {
  if (!cached) cached = readTokensFromDOM()
  return cached
}

/** Clears the cache; the next getCanvasTokens() call re-reads the DOM. */
export function invalidateCanvasTokens(): void {
  cached = null
}

/**
 * Registers the single data-theme MutationObserver that invalidates the
 * cache. Idempotent — a second call does not register a second observer.
 * Wire this once, at app bootstrap, before the first render (see main.tsx).
 * Returns a disconnect function.
 */
export function initCanvasTokenCache(): () => void {
  if (!observer) {
    observer = new MutationObserver(() => invalidateCanvasTokens())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
  return () => {
    observer?.disconnect()
    observer = null
  }
}

type CanvasFontWeight = 400 | 600
type CanvasFontSize = 'micro' | 'base' | 'heading' | 'display'
type CanvasFontFamily = 'sans' | 'mono'

const SIZE_FIELD: Record<CanvasFontSize, keyof CanvasTokens> = {
  micro: 'textMicro',
  base: 'textBase',
  heading: 'textHeading',
  display: 'textDisplay',
}

const FAMILY_FIELD: Record<CanvasFontFamily, keyof CanvasTokens> = {
  sans: 'fontSans',
  mono: 'fontMono',
}

/**
 * Builds a canvas `font` shorthand string from one of the two sanctioned
 * weights, one of the four type-ramp sizes, and one of the two font
 * families — so draw calls never concatenate a raw pixel literal. `scale`
 * (default 1) lets zoom-dependent draw loops grow text past the token's own
 * pixel value while never dropping below it — the floor is always the
 * token's own audited size, not a hand-picked literal.
 */
export function canvasFont(weight: CanvasFontWeight, size: CanvasFontSize, family: CanvasFontFamily, scale = 1): string {
  const tokens = getCanvasTokens()
  const basePx = parseFloat(tokens[SIZE_FIELD[size]])
  const px = Math.max(basePx, basePx * scale)
  const fontFamily = tokens[FAMILY_FIELD[family]]
  return `${weight} ${px}px ${fontFamily}`
}
