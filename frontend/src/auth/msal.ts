// Entra ID sign-in for the browser.
//
// This app is a PUBLIC client: it runs in a tab, it holds no secret, and it
// cannot be made to hold one. So the flow is authorization-code-with-PKCE via
// a redirect, and the only thing the app is trusted with is a short-lived
// access token scoped to Fabric.
//
// **Why the user's own token, and not the service principal the backend
// already has.** The backend can read Fabric today using shared Purview
// credentials, and that is fine for a machine — the sandbox and the lineage
// build have no user in the loop. It is the wrong answer for a person: it
// shows every signed-in user the same workspaces, namely whichever ones a
// robot account happens to be a member of. "The workspaces you have access
// to" can only come from a token minted for you, evaluated by Fabric against
// your own memberships. Nothing this app computes could substitute for that,
// and anything that tried would be a guess wearing an authority it does not
// have.

import {
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type Configuration,
} from '@azure/msal-browser'

/**
 * The app registration. Absent is a NORMAL state, not a crash: a fresh clone
 * has no tenant of its own, and the sign-in screen explains what to set rather
 * than the app failing to boot. See `isConfigured`.
 */
const CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID ?? ''

/**
 * `organizations` lets any work or school account in, which is what you want
 * while developing against someone else's tenant. Pin `VITE_ENTRA_TENANT_ID`
 * to a tenant GUID to refuse everyone outside it — the authority, not the app,
 * is the right place to enforce that, because a check in our own code is one
 * an attacker reaches after the token is already issued.
 */
const TENANT = import.meta.env.VITE_ENTRA_TENANT_ID ?? 'organizations'

export const isConfigured = Boolean(CLIENT_ID)

/**
 * Whether "continue without signing in" is offered.
 *
 * DEVELOPMENT ONLY. That escape hatch exists so a fresh clone is usable before
 * anyone has registered an app, and on a laptop that is a convenience. On a
 * deployed build it is an unlocked door: the bundle is public, so the button
 * would be reachable by anyone with the URL, and clicking it hands them the
 * backend's service principal — a credential with real access to a real
 * tenant, held by someone who never proved who they were.
 *
 * So a production build with no `VITE_ENTRA_CLIENT_ID` deliberately has no way
 * in at all. That is the correct failure: shipping without configuring sign-in
 * should stop the deploy being useful, not silently downgrade every visitor to
 * the service principal.
 */
export const allowSkip = import.meta.env.DEV

/**
 * Delegated Fabric access — as narrow as Fabric's own API allows.
 *
 * Fabric does NOT expose `user_impersonation`; that scope belongs to Azure
 * Storage and Azure Data Explorer. Fabric's delegated scopes are granular
 * (`Workspace.Read.All`, `Item.Read.All`, …) and — confusingly — they are
 * registered under **Power BI Service** in the portal, not under anything
 * called Fabric. Asking for a scope the API does not define fails at consent
 * with an error that names the scope but not the reason.
 *
 * **Why two ReadWrite scopes are here in a read-only app.** Reading a
 * notebook's code is `POST .../getDefinition`, and Fabric documents that call
 * as requiring `Notebook.ReadWrite.All` or `Item.ReadWrite.All` — "the caller
 * must have read and write permissions for the notebook". There is no read-only
 * scope that can fetch a definition; `Notebook.Read.All` exists and does not
 * cover it. A read-only token therefore fails at the SCOPE check, before Fabric
 * ever looks at what the user can access, with a 403 `InsufficientScopes` that
 * reads like a permissions problem on their account and is not one.
 *
 * So the choice is between naming those two item types and asking for
 * `Item.ReadWrite.All`, which is write access to every item type in every
 * workspace the user can reach — and to whatever item types Fabric adds later.
 * These two are the narrowest thing that answers the question we ask.
 *
 * THE APP STILL NEVER WRITES. Nothing here calls an update or delete endpoint,
 * and the sandbox's dry-run sinks are unchanged (see CLAUDE.md). The scope is
 * what Fabric demands to hand over source code; it is not a capability this
 * code uses, and an admin reading the consent screen should be told exactly
 * that.
 */
export const FABRIC_SCOPES = [
  'https://api.fabric.microsoft.com/Workspace.Read.All',
  'https://api.fabric.microsoft.com/Item.Read.All',
  // Both are for `getDefinition` — notebook source and pipeline activities.
  // Drop either one and that half of Explore's detail pane 403s.
  'https://api.fabric.microsoft.com/Notebook.ReadWrite.All',
  'https://api.fabric.microsoft.com/DataPipeline.ReadWrite.All',
]

/**
 * OneLake is a SEPARATE audience — it speaks the ADLS Gen2 storage API, not
 * the Fabric REST API, so a Fabric token is rejected there and vice versa.
 * Table schemas are read from the Delta log in OneLake, which is why one
 * signed-in user needs two tokens.
 *
 * `user_impersonation` IS right here: it is Azure Storage's delegated scope,
 * which is where that name actually lives.
 */
export const ONELAKE_SCOPES = ['https://storage.azure.com/user_impersonation']

/** Enough for a name and an avatar; no directory read, no Graph call. */
export const LOGIN_SCOPES = ['openid', 'profile', 'email']

const config: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT}`,
    // The tab it is served from. Registering this URI in the portal is the
    // single most common thing to get wrong — a mismatch fails at Microsoft
    // with AADSTS50011 before any of our code runs, so the sign-in screen
    // prints the exact value it will send.
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    // sessionStorage, not localStorage: the token dies with the tab. A lineage
    // model is somebody's warehouse layout, and leaving a Fabric token on disk
    // on a shared machine outlives the reason it was issued.
    cacheLocation: 'sessionStorage',
  },
}

export const msal = new PublicClientApplication(config)

/** The redirect URI this build will send, so the error screen can quote it. */
export const redirectUri = config.auth.redirectUri as string

let redirect: Promise<AuthenticationResult | null> | null = null

/**
 * Consume the sign-in redirect — ONCE, and BEFORE React renders.
 *
 * Microsoft hands the authorization code back in the URL fragment
 * (`#code=…&state=…`), and it is readable exactly once: whoever changes the URL
 * first wins. React runs effects child-first, so `RouterProvider` mounts and
 * normalises the location *before* `AuthProvider`'s boot effect ever runs — the
 * fragment is gone by then, `handleRedirectPromise` resolves null, no account
 * is cached, and the gate renders again. From the user's side that is a loop:
 * pick an account, land straight back on the sign-in button.
 *
 * So `main.tsx` calls this at module scope, before `createRoot`, and the
 * provider awaits the same promise rather than starting its own. Memoised
 * because the code can only be redeemed once — a second call would race the
 * first and fail on an already-consumed code, and StrictMode guarantees a
 * second call if this is left to an effect.
 */
export function handleRedirect(): Promise<AuthenticationResult | null> {
  if (!redirect) {
    redirect = isConfigured
      ? msal.initialize().then(() => msal.handleRedirectPromise())
      : Promise.resolve(null)
  }
  return redirect
}

export function accountName(account: AccountInfo | null): string {
  if (!account) return ''
  return account.name || account.username || ''
}

/**
 * Initials for the avatar. Falls back to the first letter of the username so a
 * service account with no display name still renders something.
 */
export function initials(account: AccountInfo | null): string {
  const name = accountName(account).trim()
  if (!name) return '?'
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
