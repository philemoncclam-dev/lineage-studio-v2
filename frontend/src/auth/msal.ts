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

import { PublicClientApplication, type AccountInfo, type Configuration } from '@azure/msal-browser'

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
 * Delegated Fabric access — "act as the signed-in user".
 *
 * NOT `.default`: that is the client-credentials shape and asks for whatever
 * the app registration was granted, which for a public client is both wrong
 * and rejected. `user_impersonation` is the delegated permission the tenant
 * admin consents to, and it is what makes Fabric answer with the caller's
 * workspaces rather than the app's.
 */
export const FABRIC_SCOPES = ['https://api.fabric.microsoft.com/user_impersonation']

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
