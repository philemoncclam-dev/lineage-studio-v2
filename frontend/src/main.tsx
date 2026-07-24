import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import './styles/tokens.css'
import { initTheme } from './shell/theme'
import { initCanvasTokenCache } from './tokens/canvasTokens'
import { router } from './router'
import { completeAuthRedirectBridge } from './model-app/connectors/fabricAuth'

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

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

// The Fabric (model tab) MSAL sign-in popup redirects to this origin ("/"),
// re-entering this entry rather than the model mount. On such a load, relay the
// auth response to the opener window and close instead of booting the full app.
// On every normal load (no auth response in the URL, or Fabric unconfigured)
// this resolves false immediately and is a no-op.
completeAuthRedirectBridge()
  .then((isClosingBridge) => {
    if (!isClosingBridge) renderApp()
  })
  .catch(() => renderApp())
