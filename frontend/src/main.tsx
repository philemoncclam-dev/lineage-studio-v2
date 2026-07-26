import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import './styles/tokens.css'
import { initTheme } from './shell/theme'
import { router } from './router'

// Restore a persisted theme choice before first paint (Pitfall 2: Phase 1
// wired the data-theme/light-dark() mechanism but shipped no control or
// boot-time restore — without this, the toggle's localStorage choice
// wouldn't survive a reload).
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
