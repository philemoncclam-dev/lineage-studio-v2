// Minimal root chrome for the router migration (D-14: new shell first, old
// canvases embedded purely as interim content). This is intentionally thin —
// 02-04 fleshes it out with the app-logo mode menu, per-mode icon rail, and
// rail-bottom cluster (SHELL-01/02/04). For now it only owns the outer
// `.app` flex column so the bridged LineageView/GraphView still fill the
// viewport the same way App.tsx's own `.app` wrapper did.

import type { ReactNode } from 'react'
import '../styles/components.css'

export default function AppShell({ children }: { children: ReactNode }) {
  return <div className="app">{children}</div>
}
