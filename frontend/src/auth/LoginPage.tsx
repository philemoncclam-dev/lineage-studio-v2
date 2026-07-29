// The sign-in gate — the first thing the app renders.
//
// It exists to establish WHO is asking, because that is what decides what
// Explore can show them. Everything downstream reads the same identity: the
// workspaces in the tree are the ones Fabric returns for this person's token,
// not a fixed set a shared service principal happens to reach.

import { useAuth } from './auth'
import { isConfigured, redirectUri } from './msal'
import './login.css'

export function LoginPage() {
  const { signIn, skip, error } = useAuth()

  return (
    <main className="lg-page" aria-labelledby="lg-title">
      <section className="lg-card">
        <div className="lg-brand">
          <span className="lg-mark" aria-hidden="true" />
          <div>
            <h1 className="lg-title" id="lg-title">
              Lineage Studio
            </h1>
            <p className="lg-sub">Data lineage across Microsoft Fabric</p>
          </div>
        </div>

        {isConfigured ? (
          <>
            <p className="lg-lead">
              Sign in with your work account. You'll see the Fabric workspaces you
              already have access to — nothing more, nothing less.
            </p>
            <button className="lg-primary" onClick={() => void signIn()}>
              Sign in with Microsoft
            </button>
            <p className="lg-fine">
              Your session lasts until you close this tab. Lineage Studio reads
              Fabric on your behalf and never stores your credentials.
            </p>
          </>
        ) : (
          /* No app registration yet. This is a setup state, not a failure, so
             it says exactly what to create rather than showing a dead button —
             and it quotes the redirect URI, which is the single most common
             thing to get wrong (a mismatch fails at Microsoft with AADSTS50011
             before any of this code runs). */
          <>
            <p className="lg-lead">
              Sign-in isn't configured for this build yet.
            </p>
            <ol className="lg-steps">
              <li>
                Register a <strong>single-page application</strong> in Entra ID.
              </li>
              <li>
                Add this exact redirect URI: <code>{redirectUri}</code>
              </li>
              {/* There is no "Fabric" entry under API permissions — Fabric's
                  delegated scopes are registered under Power BI Service, and
                  there is no `user_impersonation` among them (that one belongs
                  to Azure Storage, which OneLake needs separately). Both of
                  those are easy half-hours to lose, so the steps name the
                  exact tiles. */}
              <li>
                API permissions → Add a permission →{' '}
                <strong>Power BI Service</strong> → Delegated. Add{' '}
                <code>Workspace.Read.All</code> and <code>Item.Read.All</code>.
              </li>
              <li>
                Add a permission → <strong>Azure Storage</strong> → Delegated →{' '}
                <code>user_impersonation</code>. This is for OneLake, where
                table schemas live — skip it and the tree works but schemas
                don't.
              </li>
              <li>Grant admin consent for both.</li>
              <li>
                Put the application (client) ID in{' '}
                <code>frontend/.env</code> as{' '}
                <code>VITE_ENTRA_CLIENT_ID</code>, and restart the dev server.
              </li>
            </ol>
            <button className="lg-secondary" onClick={skip}>
              Continue without signing in
            </button>
            <p className="lg-fine">
              Without sign-in the app reads Fabric using the backend's shared
              service principal, so the workspaces you see are{' '}
              <strong>whichever that account can reach</strong> — not yours.
              Everything that doesn't touch Fabric works normally.
            </p>
          </>
        )}

        {error && (
          <p className="lg-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}
