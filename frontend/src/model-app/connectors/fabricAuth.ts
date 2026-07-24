// "Sign in with Microsoft" for the Fabric connector, via MSAL.js (SPA/PKCE,
// no backend token exchange). Replaces manual bearer-token pasting as the
// primary auth path in SyncConnector.tsx — the manual token field remains as
// a fallback for anyone who'd rather paste one (or whose tenant isn't set up
// for this app registration).
//
// Configuration (see vite-env.d.ts):
//   VITE_FABRIC_CLIENT_ID  — Entra SPA app registration client id. Required;
//                            when absent, isFabricAuthConfigured() is false
//                            and the UI simply doesn't show the button.
//   VITE_FABRIC_TENANT_ID  — Entra tenant id, or "organizations" (default),
//                            "common", "consumers". "organizations" accepts
//                            any work/school account without restricting to
//                            a single tenant — the right default for a dev
//                            registration used across different Fabric
//                            trials/tenants.
//
// Scopes: Microsoft Fabric REST APIs document that *delegated* (user) calls
// use resource-specific scopes of the form
// "https://api.fabric.microsoft.com/<Scope>", e.g. Workspace.Read.All /
// Item.Read.All — NOT the "<resource>/.default" form, which is reserved for
// app-only (client-credentials) flows. See:
//   https://learn.microsoft.com/en-us/rest/api/fabric/articles/scopes
//   https://learn.microsoft.com/en-us/rest/api/fabric/articles/get-started/fabric-api-quickstart
// We request the read scopes this connector actually needs (items, lakehouse
// tables, semantic model definitions) plus Tenant.Read.All for the optional
// admin Scanner API deep-scan path — consent for the latter is only actually
// exercised if the signed-in user is a tenant admin, but requesting it
// upfront avoids a second consent prompt mid-sync.
const FABRIC_SCOPES = [
  "https://api.fabric.microsoft.com/Workspace.Read.All",
  "https://api.fabric.microsoft.com/Item.Read.All",
  "https://api.fabric.microsoft.com/Tenant.Read.All",
];

// Phase 2 (runtime notebook lineage) needs to CREATE and RUN a helper notebook,
// which the read-only FABRIC_SCOPES above can't do. These write/execute scopes
// are requested only when the runtime path is actually used (getFabricWriteToken)
// so a plain read-only sync never triggers the extra consent prompt. NOTE: the
// Entra app registration must expose these + have admin consent granted, or the
// token request fails — see docs/fabric-msal-session-handoff.md.
const FABRIC_WRITE_SCOPES = [
  "https://api.fabric.microsoft.com/Item.ReadWrite.All",
  "https://api.fabric.microsoft.com/Item.Execute.All",
];

// OneLake (the ADLS Gen2 surface at onelake.dfs.fabric.microsoft.com) accepts
// Entra tokens with the Azure *Storage* audience, not the Fabric API audience
// — so reading Delta logs for column schema needs its own token acquisition.
// MSAL can't mix audiences in one request, hence the separate scope set.
const ONELAKE_SCOPES = ["https://storage.azure.com/user_impersonation"];

export interface FabricAccountInfo {
  name: string;
  username: string;
}

// Lazily imported so this module (and its dependency on @azure/msal-browser)
// never gets pulled into a bundle/execution path when Fabric auth isn't
// configured — matches the "feature simply doesn't appear" requirement.
type MsalModule = typeof import("@azure/msal-browser");
let msalModulePromise: Promise<MsalModule> | null = null;
function loadMsal(): Promise<MsalModule> {
  if (!msalModulePromise) msalModulePromise = import("@azure/msal-browser");
  return msalModulePromise;
}

function getEnv(key: "VITE_FABRIC_CLIENT_ID" | "VITE_FABRIC_TENANT_ID" | "VITE_FABRIC_MOCK") {
  return (import.meta.env as unknown as Record<string, string | undefined>)[key];
}

export function isFabricMockMode(): boolean {
  return getEnv("VITE_FABRIC_MOCK") === "1";
}

export function isFabricAuthConfigured(): boolean {
  return isFabricMockMode() || Boolean(getEnv("VITE_FABRIC_CLIENT_ID"));
}

let pcaPromise: Promise<import("@azure/msal-browser").PublicClientApplication> | null = null;

async function getPca() {
  if (!pcaPromise) {
    pcaPromise = (async () => {
      const clientId = getEnv("VITE_FABRIC_CLIENT_ID");
      if (!clientId) {
        throw new Error("VITE_FABRIC_CLIENT_ID is not set — Fabric sign-in is not configured.");
      }
      const tenantId = getEnv("VITE_FABRIC_TENANT_ID") || "organizations";
      const { PublicClientApplication } = await loadMsal();
      const pca = new PublicClientApplication({
        auth: {
          clientId,
          authority: `https://login.microsoftonline.com/${tenantId}`,
          redirectUri: window.location.origin,
        },
        cache: {
          // localStorage (not sessionStorage) so acquired tokens persist across
          // reloads/tabs — otherwise the OneLake (storage-audience) token can't
          // be acquired silently on a fresh load and MSAL falls back to a popup.
          cacheLocation: "localStorage",
        },
      });
      await pca.initialize();
      return pca;
    })();
  }
  return pcaPromise;
}

// True when the current URL carries an OAuth response (code/error/state) in
// its fragment or query — i.e. this page load is the redirect landing after a
// sign-in, not a normal app load.
function hasAuthResponseInUrl(): boolean {
  const parts = `${window.location.hash}${window.location.search}`;
  return /[#&?](code|error|state|id_token)=/.test(parts);
}

/**
 * Complete a pending MSAL popup sign-in when this page load is the redirect
 * landing.
 *
 * MSAL v5 uses a "redirect bridge": when the "Sign in with Microsoft" popup
 * finishes, MSAL navigates it back to our redirect URI (our own origin),
 * reloading this SPA *inside the popup window*. That instance must parse the
 * auth response out of the URL and broadcast it to the opener window (over a
 * BroadcastChannel) — otherwise the popup just sits on ".../#code=..." and the
 * opener's loginPopup() never resolves. broadcastResponseToMainFrame() does
 * exactly that and then closes the popup; it's a lightweight standalone entry
 * point that needs no PublicClientApplication instance.
 *
 * Returns true when it handled a response (this window is a closing bridge, so
 * the caller should NOT render the app). Returns false on a normal load.
 * No-op in mock mode or when Fabric auth isn't configured.
 */
export async function completeAuthRedirectBridge(): Promise<boolean> {
  if (isFabricMockMode()) return false;
  if (!getEnv("VITE_FABRIC_CLIENT_ID")) return false;
  if (!hasAuthResponseInUrl()) return false;
  const { broadcastResponseToMainFrame } = await import("@azure/msal-browser/redirect-bridge");
  await broadcastResponseToMainFrame();
  return true;
}

// ── Mock mode ────────────────────────────────────────────────────────────
// A fake, always-signed-in session so the whole connector flow is
// click-through-able with zero Microsoft involvement. See mockFabric.ts for
// the corresponding fake API responses.
const MOCK_ACCOUNT: FabricAccountInfo = { name: "Dev User", username: "dev.user@contoso.test" };
let mockSignedIn = false;

// ── Public API ───────────────────────────────────────────────────────────

/** Currently-signed-in account, if any (checked from MSAL's cache — no network call). */
export async function getActiveAccount(): Promise<FabricAccountInfo | null> {
  if (isFabricMockMode()) return mockSignedIn ? MOCK_ACCOUNT : null;
  if (!getEnv("VITE_FABRIC_CLIENT_ID")) return null;
  const pca = await getPca();
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
  if (!account) return null;
  return { name: account.name ?? account.username, username: account.username };
}

/** Interactive sign-in via popup. Resolves with the signed-in account. */
export async function signIn(): Promise<FabricAccountInfo> {
  if (isFabricMockMode()) {
    mockSignedIn = true;
    return MOCK_ACCOUNT;
  }
  const pca = await getPca();
  // Prefer to also pre-consent the OneLake (Azure Storage) audience in this one
  // sign-in popup (extraScopesToConsent) so its token acquires SILENTLY later —
  // browsers block MSAL's silent iframe renewal for a fresh resource. But that
  // resource needs a service principal in the tenant; if it's missing/not ready
  // the whole request fails with AADSTS650052. So try it, and on ANY failure
  // fall back to a Fabric-only sign-in — login must never be blocked by the
  // optional storage scope.
  let result;
  try {
    result = await pca.loginPopup({ scopes: FABRIC_SCOPES, extraScopesToConsent: ONELAKE_SCOPES });
  } catch {
    result = await pca.loginPopup({ scopes: FABRIC_SCOPES });
  }
  pca.setActiveAccount(result.account);
  return { name: result.account.name ?? result.account.username, username: result.account.username };
}

export async function signOut(): Promise<void> {
  if (isFabricMockMode()) {
    mockSignedIn = false;
    return;
  }
  const pca = await getPca();
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
  if (account) {
    await pca.logoutPopup({ account });
  }
}

// Internal: acquire a token silently, falling back to an interactive popup
// only when silent acquisition needs user interaction (consent/MFA/expired
// session) — never popup on every call.
async function acquireToken(): Promise<string> {
  const pca = await getPca();
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
  if (!account) {
    throw new Error("Not signed in to Microsoft — click \"Sign in with Microsoft\" first.");
  }
  try {
    const result = await pca.acquireTokenSilent({ scopes: FABRIC_SCOPES, account });
    return result.accessToken;
  } catch (err) {
    const { InteractionRequiredAuthError } = await loadMsal();
    if (err instanceof InteractionRequiredAuthError) {
      const result = await pca.acquireTokenPopup({ scopes: FABRIC_SCOPES, account });
      pca.setActiveAccount(result.account);
      return result.accessToken;
    }
    throw err;
  }
}

/**
 * Get a Fabric access token for the currently signed-in account, used by the
 * connector/scanner in place of the pasted bearer token. Silent-first
 * (acquireTokenSilent), popup fallback only on InteractionRequiredAuthError.
 */
export async function getFabricToken(): Promise<string> {
  if (isFabricMockMode()) return "mock-fabric-token";
  return acquireToken();
}

/**
 * Fabric token carrying the write/execute scopes for the Phase 2 runtime path
 * (create + run a helper notebook). Silent-first with popup fallback, same
 * pattern as getFabricToken but with FABRIC_WRITE_SCOPES — so the extra consent
 * is only ever requested when the runtime feature is actually invoked.
 */
export async function getFabricWriteToken(): Promise<string> {
  if (isFabricMockMode()) return "mock-fabric-write-token";
  const pca = await getPca();
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
  if (!account) {
    throw new Error("Not signed in to Microsoft — click \"Sign in with Microsoft\" first.");
  }
  try {
    const result = await pca.acquireTokenSilent({ scopes: FABRIC_WRITE_SCOPES, account });
    return result.accessToken;
  } catch (err) {
    const { InteractionRequiredAuthError } = await loadMsal();
    if (err instanceof InteractionRequiredAuthError) {
      const result = await pca.acquireTokenPopup({ scopes: FABRIC_WRITE_SCOPES, account });
      pca.setActiveAccount(result.account);
      return result.accessToken;
    }
    throw err;
  }
}

/**
 * Get an Azure-Storage-audience token for OneLake DFS calls (Delta-log column
 * schema for Lakehouse tables — see oneLake.ts). Silent-first, popup fallback,
 * same pattern as getFabricToken(). Only callable when signed in via MSAL;
 * manually-pasted Fabric tokens carry the wrong audience for OneLake.
 */
export async function getOneLakeToken(): Promise<string> {
  if (isFabricMockMode()) return "mock-onelake-token";
  const pca = await getPca();
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
  if (!account) {
    throw new Error("Not signed in to Microsoft — click \"Sign in with Microsoft\" first.");
  }
  try {
    const result = await pca.acquireTokenSilent({ scopes: ONELAKE_SCOPES, account });
    return result.accessToken;
  } catch (err) {
    const { InteractionRequiredAuthError } = await loadMsal();
    if (err instanceof InteractionRequiredAuthError) {
      const result = await pca.acquireTokenPopup({ scopes: ONELAKE_SCOPES, account });
      pca.setActiveAccount(result.account);
      return result.accessToken;
    }
    throw err;
  }
}

/**
 * Silent-only OneLake token — returns null instead of ever opening an
 * interactive popup. Used by the connector's best-effort OneLake enrichment /
 * schema-enabled table discovery, which must NOT interrupt a Preview with a
 * popup window. When it returns null the caller simply skips OneLake reads.
 */
export async function getOneLakeTokenSilent(): Promise<string | null> {
  if (isFabricMockMode()) return "mock-onelake-token";
  if (!getEnv("VITE_FABRIC_CLIENT_ID")) return null;
  const pca = await getPca();
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
  if (!account) return null;
  try {
    const result = await pca.acquireTokenSilent({ scopes: ONELAKE_SCOPES, account });
    return result.accessToken;
  } catch {
    return null; // no popup — best-effort
  }
}

/**
 * Force a fresh token, bypassing whatever's cached — used by the 401-retry
 * path in fabricConnector.ts: one silent refresh + retry before surfacing an
 * error asking the user to sign in again.
 */
export async function refreshFabricToken(): Promise<string> {
  if (isFabricMockMode()) return "mock-fabric-token";
  const pca = await getPca();
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
  if (!account) {
    throw new Error("Not signed in to Microsoft — click \"Sign in with Microsoft\" first.");
  }
  try {
    const result = await pca.acquireTokenSilent({ scopes: FABRIC_SCOPES, account, forceRefresh: true });
    return result.accessToken;
  } catch (err) {
    const { InteractionRequiredAuthError } = await loadMsal();
    if (err instanceof InteractionRequiredAuthError) {
      const result = await pca.acquireTokenPopup({ scopes: FABRIC_SCOPES, account });
      pca.setActiveAccount(result.account);
      return result.accessToken;
    }
    throw err;
  }
}

// Test-only: reset cached PublicClientApplication + mock sign-in state
// between test cases (module-level singletons otherwise leak across tests).
export function __resetFabricAuthForTests(): void {
  pcaPromise = null;
  mockSignedIn = false;
}
