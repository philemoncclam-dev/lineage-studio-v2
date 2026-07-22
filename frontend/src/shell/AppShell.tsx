// Mode-based shell chrome (SHELL-01/02/04, D-01-D-05, D-10, D-17): app-logo
// mode menu, per-mode data-driven icon rail, rail-bottom cluster, the canvas
// region wrapping <Outlet/>, and the Inspector/CommandPalette overlay mount
// points 02-05/02-06 fill in. Replaces the 02-03 minimal `.app` stub.
import { type ReactNode, useEffect, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useRouterState } from '@tanstack/react-router'
import CommandPalette from './CommandPalette'
import Inspector from './Inspector'
import ModeMenu from './ModeMenu'
import Rail from './Rail'
import RailBottomCluster from './RailBottomCluster'
import { modeFromPathname, railConfig } from './railConfig'
import '../styles/components.css'
import '../styles/shell.css'

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const mode = modeFromPathname(pathname)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Global Cmd+K listener (ported from the old App.tsx's effect, per
  // 02-PATTERNS.md) — the shell owns this once, rail-bottom's search trigger
  // is the second of the two triggers D-17 requires.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="shell">
        <div className="shell-rail-col">
          <ModeMenu />
          <Rail items={railConfig[mode]} />
          <RailBottomCluster onOpenSearch={() => setPaletteOpen(true)} />
        </div>
        <div className="shell-canvas">
          {children}
          <Inspector />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </Tooltip.Provider>
  )
}
