// Mode-based shell chrome (SHELL-01/02/04, D-01-D-05, D-10, D-17): app-logo
// mode menu, per-mode data-driven icon rail, rail-bottom cluster, the canvas
// region wrapping <Outlet/>, and the Inspector/CommandPalette overlay mount
// points 02-05/02-06 fill in. Replaces the 02-03 minimal `.app` stub.
import { type ReactNode, lazy, Suspense, useEffect, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useRouterState } from '@tanstack/react-router'
import ModeMenu from './ModeMenu'
import Rail from './Rail'
import RailBottomCluster from './RailBottomCluster'
import { isChromeless, isFullBleedPath, modeFromPathname, railConfig } from './railConfig'
import { requestSearch } from './searchBridge'
import '../styles/components.css'
import '../styles/shell.css'

// cmdk-backed palette is modal-only (Cmd+K / rail search), so keep it out of
// the boot chunk and load it the first time it's opened.
const CommandPalette = lazy(() => import('./CommandPalette'))

// `overlays` (default true) gates Inspector/CommandPalette — both read
// router match context (useMatch/useSearch/useLoaderData) via useSelection()
// and getRouteApi('__root__').useLoaderData(). The router's Suspense
// pendingComponent fallback slot never receives match context (CR-01), so
// RootPending renders with `overlays={false}` to mount the chrome
// (ModeMenu/Rail/RailBottomCluster, all router-*state*-only, never match
// context) without those two overlays. The normal, matched render path is
// unaffected — overlays defaults to true.
export default function AppShell({ children, overlays = true }: { children: ReactNode; overlays?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const mode = modeFromPathname(pathname)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Latches true on first open so the lazy palette stays mounted afterwards
  // (preserving its close animation) instead of unmounting each time.
  const [paletteMounted, setPaletteMounted] = useState(false)
  const openPalette = () => {
    // A page may own search for its own content (the Model Viewer searches the
    // open model). If one has claimed the trigger, defer to it entirely rather
    // than opening the catalog palette on top of it.
    if (requestSearch()) return
    setPaletteMounted(true)
    setPaletteOpen(true)
  }

  // Global Cmd+K listener (ported from the old App.tsx's effect, per
  // 02-PATTERNS.md) — the shell owns this once, rail-bottom's search trigger
  // is the second of the two triggers D-17 requires.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Tooltip.Provider delayDuration={300}>
      {/* data-mode drives the rail's contents; data-fullbleed is what actually
          opts a route into the floating-rail canvas (see shell.css). They are
          separate because Modeling contains both the Model Viewer, which needs
          it, and the Model Browser, which is an ordinary page. */}
      <div className="shell" data-mode={mode} data-fullbleed={isFullBleedPath(pathname) || undefined}>
        {!isChromeless(pathname) && (
          <div className="shell-rail-col">
            {/* Modeling drops the mode menu: the Model Viewer carries its own
                Lineage Studio mark in its top bar, which goes to the Model
                Browser, and the browser is where modes are switched now. */}
            {mode !== 'model' && <ModeMenu />}
            <Rail items={railConfig[mode]} />
            <RailBottomCluster onOpenSearch={openPalette} />
          </div>
        )}
        <div className="shell-canvas">
          {children}
        </div>
      </div>
      {overlays && paletteMounted && (
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        </Suspense>
      )}
    </Tooltip.Provider>
  )
}
