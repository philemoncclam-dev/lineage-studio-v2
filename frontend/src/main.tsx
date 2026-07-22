import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import './styles/tokens.css'
import { initTheme } from './shell/theme'
import { initCanvasTokenCache } from './tokens/canvasTokens'
import { router } from './router'

// Restore a persisted theme choice before first paint (Pitfall 2: Phase 1
// wired the data-theme/light-dark() mechanism but shipped no control or
// boot-time restore — without this, the toggle's localStorage choice
// wouldn't survive a reload).
initTheme()

// Wired once, before the first render — not per component, not per render
// (THEME-03). Invalidates the canvas token snapshot whenever data-theme
// changes; GraphView.tsx and later canvas/SVG consumers read through
// getCanvasTokens() rather than reading the DOM's computed style themselves.
initCanvasTokenCache()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
