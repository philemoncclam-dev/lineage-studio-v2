import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import './styles/tokens.css'
import { initTheme } from './shell/theme'
import { router } from './router'
import { AuthProvider } from './auth/auth'
import { handleRedirect } from './auth/msal'

// Restore a persisted theme choice before first paint (Pitfall 2: Phase 1
// wired the data-theme/light-dark() mechanism but shipped no control or
// boot-time restore — without this, the toggle's localStorage choice
// wouldn't survive a reload).
initTheme()

// Read the sign-in response off the URL before anything can rewrite the URL.
// The router mounts first (React runs effects child-first) and normalises the
// location, taking `#code=…&state=…` with it — which sent a user who had just
// picked their account straight back to the sign-in button. AuthProvider awaits
// this same promise; it is not started twice.
void handleRedirect()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Above the router: auth is not route-scoped, and the router's own
        pending fallback renders the shell (identity chip included) before any
        route component mounts. */}
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
