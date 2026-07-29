// Who is signed in, and how the rest of the app gets their Fabric token.
//
// One provider mounted above the router, because two things need it at very
// different depths: the gate that decides whether to render the app at all,
// and `api.ts` deep inside a fetch. The token therefore also lives in a module
// variable — see `setTokenSource` — so a plain async function can reach it
// without every caller threading a hook result down through the tree.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  InteractionRequiredAuthError,
  type AccountInfo,
} from '@azure/msal-browser'
import { FABRIC_SCOPES, LOGIN_SCOPES, ONELAKE_SCOPES, isConfigured, msal } from './msal'
import { setTokenSource } from '../api'

export type AuthPhase = 'starting' | 'signed-out' | 'signed-in' | 'skipped'

interface AuthValue {
  phase: AuthPhase
  account: AccountInfo | null
  error: string | null
  signIn: () => Promise<void>
  signOut: () => void
  /** Continue on the service principal — only offered when unconfigured. */
  skip: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

/** Remembers a deliberate skip across a reload, so it is not re-asked. */
const SKIP_KEY = 'lineage.auth.skipped'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>('starting')
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Guards against React 18 StrictMode double-invoking the boot effect, which
  // would run handleRedirectPromise twice and consume the code on the second.
  const booted = useRef(false)

  /**
   * A Fabric token, refreshed silently while the session lasts.
   *
   * Silent first, always: MSAL caches the token and renews it from the refresh
   * token without a round trip through the UI. Only a genuine
   * InteractionRequiredAuthError — consent revoked, MFA required, session
   * expired — earns a popup, and a popup fired on any other failure is a
   * blocked-popup bug that reads to the user as the app freezing.
   */
  const forScopes = useCallback(async (scopes: string[]): Promise<string | null> => {
    const current = msal.getActiveAccount()
    if (!current) return null
    try {
      const result = await msal.acquireTokenSilent({ scopes, account: current })
      return result.accessToken
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        try {
          const result = await msal.acquireTokenPopup({ scopes })
          return result.accessToken
        } catch {
          return null
        }
      }
      return null
    }
  }, [])

  /**
   * Both tokens a Fabric request may need.
   *
   * Two, not one, because OneLake is a different audience: the Fabric REST API
   * and the ADLS-Gen2 storage endpoint each reject the other's token. Table
   * schemas come from the Delta log in OneLake, so a signed-in user who only
   * held a Fabric token would browse the tree fine and then fail on every
   * schema with a 401 that reads like a permissions problem.
   *
   * Requested in parallel and independently: OneLake consent can be missing
   * (it is a separate grant an admin may not have made) without taking the
   * whole tree down with it. A null there degrades one feature, not the app.
   */
  const getToken = useCallback(async () => {
    const [fabric, onelake] = await Promise.all([
      forScopes(FABRIC_SCOPES),
      forScopes(ONELAKE_SCOPES),
    ])
    return { fabric, onelake }
  }, [forScopes])

  useEffect(() => {
    if (booted.current) return
    booted.current = true

    if (!isConfigured) {
      // No app registration. The gate still renders — it is the only place
      // that can explain what is missing — but a prior skip is honoured so the
      // screen is not re-shown every reload.
      setPhase(sessionStorage.getItem(SKIP_KEY) ? 'skipped' : 'signed-out')
      return
    }

    void (async () => {
      try {
        await msal.initialize()
        // Completes a redirect if we are coming back from Microsoft; resolves
        // null on a normal load.
        const result = await msal.handleRedirectPromise()
        const found = result?.account ?? msal.getAllAccounts()[0] ?? null
        if (found) {
          msal.setActiveAccount(found)
          setAccount(found)
          setPhase('signed-in')
        } else {
          setPhase(sessionStorage.getItem(SKIP_KEY) ? 'skipped' : 'signed-out')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('signed-out')
      }
    })()
  }, [])

  // Hand `api.ts` a way to reach the token. Cleared on sign-out so a stale
  // closure cannot keep authenticating requests for someone who left.
  useEffect(() => {
    setTokenSource(phase === 'signed-in' ? getToken : null)
    return () => setTokenSource(null)
  }, [phase, getToken])

  const value = useMemo<AuthValue>(
    () => ({
      phase,
      account,
      error,
      signIn: async () => {
        setError(null)
        try {
          await msal.initialize()
          sessionStorage.removeItem(SKIP_KEY)
          // Redirect, not popup: a popup on first sign-in is the one most
          // likely to be blocked, and being silently blocked at the front door
          // is indistinguishable from the button not working.
          await msal.loginRedirect({ scopes: [...LOGIN_SCOPES, ...FABRIC_SCOPES] })
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      },
      signOut: () => {
        sessionStorage.removeItem(SKIP_KEY)
        const current = msal.getActiveAccount()
        setAccount(null)
        setPhase('signed-out')
        if (current) void msal.logoutRedirect({ account: current })
      },
      skip: () => {
        sessionStorage.setItem(SKIP_KEY, '1')
        setPhase('skipped')
      },
    }),
    [phase, account, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Auth, required. Throws outside a provider — for the gate and anything else
 * whose whole job depends on knowing who is signed in, where a silent default
 * would render the wrong thing rather than fail.
 */
export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/**
 * Auth, if there is any — for CHROME.
 *
 * The shell is mounted in places that legitimately sit outside the provider:
 * the router's Suspense pending fallback, and tests that construct their own
 * RouterProvider. An identity chip has nothing to say in those cases, and
 * rendering nothing is the truthful answer rather than a swallowed bug. The
 * real app is structurally safe regardless — `main.tsx` mounts the provider
 * above the router, so nothing user-facing can reach this null.
 */
export function useOptionalAuth(): AuthValue | null {
  return useContext(AuthContext)
}
