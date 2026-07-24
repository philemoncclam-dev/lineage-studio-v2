// Host-side mount for the vendored lineage-studio app (see ./README-PORT.md).
// Replicates the donor repo's main.tsx wiring — providers, visual settings,
// global CSS — inside the /model tab. The app runs its own react-router
// (basename /model) beneath the host's TanStack catch-all route.
import { lazy, Suspense, useEffect, useState } from 'react'
import './ui/theme.css'
import './ui/ui.css'
import './index.css'
import { AuthProvider } from './auth'
import { initVisualSettings, SettingsProvider } from './settings'
import { ToastProvider } from './ui/toast'
import { completeAuthRedirectBridge } from './connectors/fabricAuth'

const App = lazy(() => import('./App'))

export default function ModelAppMount() {
  // Same popup-bridge guard as the donor main.tsx: if this load is the
  // Microsoft sign-in popup, relay the response and render nothing.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    initVisualSettings()
    completeAuthRedirectBridge()
      .then((isClosingBridge) => {
        if (!isClosingBridge) setReady(true)
      })
      .catch(() => setReady(true))
  }, [])
  if (!ready) return null
  return (
    <AuthProvider>
      <SettingsProvider>
        <ToastProvider>
          <Suspense fallback={null}>
            <App />
          </Suspense>
        </ToastProvider>
      </SettingsProvider>
    </AuthProvider>
  )
}
