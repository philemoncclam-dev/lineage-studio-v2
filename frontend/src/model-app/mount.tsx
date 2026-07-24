// Host-side mount for the vendored lineage-studio app. Replicates the donor
// repo's main.tsx provider wiring and global CSS inside the /model tab. The app
// runs its own react-router (basename /model) beneath the host's catch-all
// route.
//
// The MSAL sign-in popup redirects to window.location.origin ("/"), which boots
// the HOST app, not this mount — so completeAuthRedirectBridge() lives in the
// host entry (src/main.tsx), not here.
import { lazy, Suspense, useEffect, useState } from 'react'
import './ui/theme.css'
import './ui/ui.css'
import './index.css'
import { AuthProvider } from './auth'
import { initVisualSettings, SettingsProvider } from './settings'
import { ToastProvider } from './ui/toast'

const App = lazy(() => import('./App'))

export default function ModelAppMount() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    initVisualSettings()
    setReady(true)
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
