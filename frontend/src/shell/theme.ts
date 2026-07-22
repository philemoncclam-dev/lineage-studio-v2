// Theme toggle (D-05, Pitfall 2). Phase 1 wired the data-theme/light-dark()
// mechanism and CSS but shipped no control — this is genuinely new work.
// `setTheme` is the single write path (rail-bottom toggle button, this
// phase's only caller); `initTheme` restores a persisted choice on boot so
// the toggle actually survives a reload as the must_haves truth requires.
export const THEME_STORAGE_KEY = 'lineage-studio-theme'

export type Theme = 'light' | 'dark'

export function setTheme(theme: Theme | null): void {
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } else {
    document.documentElement.removeAttribute('data-theme') // falls back to OS prefers-color-scheme
    localStorage.removeItem(THEME_STORAGE_KEY)
  }
  // canvasTokens.ts's MutationObserver (wired once in main.tsx via
  // initCanvasTokenCache()) picks up the attribute change automatically —
  // no manual invalidateCanvasTokens() call belongs here.
}

export function getTheme(): Theme | null {
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'light' || attr === 'dark' ? attr : null
}

/** Applies a persisted theme choice before first paint. Call once at boot. */
export function initTheme(): void {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored)
  }
  // No stored value: leave data-theme unset — tokens.css's
  // `color-scheme: light dark` + every tier-1 light-dark() primitive already
  // falls back to the OS preference with no attribute present.
}

export function isDarkResolved(): boolean {
  const explicit = getTheme()
  if (explicit) return explicit === 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}
