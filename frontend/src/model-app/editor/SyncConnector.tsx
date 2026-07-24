// Sync-from-source modal. Two auth modes depending on the connector:
//   "file"  — parses an uploaded file (dbt manifest.json).
//   "token" — calls a live API with a user-supplied workspace id + bearer
//             token (Microsoft Fabric).
// Both reconcile against the current model — matching previously-synced nodes
// so a re-sync updates rather than duplicates — and show an added/changed/
// removed preview before applying. Removed (upstream-deleted) nodes are only
// dropped if the user opts in.
import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import RuntimeNotebookLineage from "./RuntimeNotebookLineage";
import { Button, Select } from "../ui";
import type { LineageEdge, LineageNode, Model } from "../types";
import { CONNECTOR_LIST, CONNECTORS } from "../connectors";
import { reconcileConnectorSync, dropNodes, type ReconcileResult } from "../connectors/reconcile";
import { recordSync } from "../connectors/connections";
import { useAuth } from "../auth";
import { listPresets, savePreset, deletePreset, getNotificationConfig, setNotificationConfig } from "../cloudApi";
import type { ConnectionPreset } from "../connectors/presets";
import {
  listFabricWorkspaces,
  type FabricWorkspace,
} from "../connectors/fabricConnector";
import {
  isFabricAuthConfigured,
  getActiveAccount,
  signIn as fabricSignIn,
  signOut as fabricSignOut,
  getFabricToken,
  isFabricMockMode,
  type FabricAccountInfo,
} from "../connectors/fabricAuth";
// ── Drift notifications (Slack/Teams) ─────────────────────────────────────
// Scoped as its own block (mirrors the presets block above) so it's easy to
// lift or rebase independently. See src/notifications/ for the pure summary
// builder + webhook delivery this block wires up.
import { buildDriftSummary } from "../notifications/driftSummary";
import { notifyDrift, type NotificationProvider, type NotifyResult } from "../notifications/webhooks";

interface Props {
  model: Model;
  onApply: (nextNodes: LineageNode[], nextEdges: LineageEdge[]) => void;
  onClose: () => void;
  // Preselect a connector (used by the "re-sync" entry point).
  initialConnectorId?: string;
}

export default function SyncConnector({ model, onApply, onClose, initialConnectorId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [connectorId, setConnectorId] = useState(
    initialConnectorId ?? CONNECTOR_LIST[0]?.id ?? "dbt"
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [dropRemoved, setDropRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const connector = CONNECTORS[connectorId];
  const isTokenAuth = connector?.authMode === "token";
  const [workspaceId, setWorkspaceId] = useState("");
  const [token, setToken] = useState("");
  // Fabric-specific: Admin Scanner API enrichment for Lakehouse/Warehouse
  // column schema. Off by default — it needs a tenant-admin-scoped token and
  // is async/rate-limited, unlike the rest of the per-workspace sync.
  const [deepScan, setDeepScan] = useState(false);
  const [notebooks, setNotebooks] = useState(false);
  // Phase 2: reveal the runtime notebook-lineage workflow (Step 3). Read-only
  // scaffolding; its Run action is gated until write/execute scopes exist.
  const [runtimeNotebooks, setRuntimeNotebooks] = useState(false);

  // ── Fabric "Sign in with Microsoft" (MSAL) ────────────────────────────────
  // Primary auth path when VITE_FABRIC_CLIENT_ID is configured (or mock mode
  // is on). The manual bearer-token field above remains as a collapsed
  // fallback. Scoped to its own block, mirroring the presets/notifications
  // blocks, so it's easy to lift independently.
  const fabricAuthAvailable = connectorId === "fabric" && isFabricAuthConfigured();
  const [fabricAccount, setFabricAccount] = useState<FabricAccountInfo | null>(null);
  const [fabricAuthBusy, setFabricAuthBusy] = useState(false);
  const [fabricAuthError, setFabricAuthError] = useState<string | null>(null);

  // Workspaces the signed-in user can access — drives the workspace picker.
  // null = not loaded (signed out / fetch failed → fall back to the id input).
  const [workspaces, setWorkspaces] = useState<FabricWorkspace[] | null>(null);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);

  useEffect(() => {
    if (!fabricAuthAvailable || !fabricAccount) {
      setWorkspaces(null);
      return;
    }
    let cancelled = false;
    setWorkspacesLoading(true);
    setWorkspacesError(null);
    (async () => {
      const list = await listFabricWorkspaces(await getFabricToken());
      if (cancelled) return;
      setWorkspaces(list);
      // Preselect: keep a still-valid previous choice, else the only option.
      setWorkspaceId((prev) =>
        list.some((w) => w.id === prev) ? prev : list.length === 1 ? list[0].id : ""
      );
    })()
      .catch((err) => {
        if (cancelled) return;
        setWorkspaces(null);
        setWorkspacesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setWorkspacesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fabricAuthAvailable, fabricAccount]);

  useEffect(() => {
    if (!fabricAuthAvailable) return;
    let cancelled = false;
    getActiveAccount()
      .then((acct) => {
        if (!cancelled) setFabricAccount(acct);
      })
      .catch(() => {
        /* not signed in yet — leave null */
      });
    return () => {
      cancelled = true;
    };
  }, [fabricAuthAvailable]);

  async function handleFabricSignIn() {
    setFabricAuthError(null);
    setFabricAuthBusy(true);
    try {
      const acct = await fabricSignIn();
      setFabricAccount(acct);
    } catch (err) {
      setFabricAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setFabricAuthBusy(false);
    }
  }

  async function handleFabricSignOut() {
    setFabricAuthBusy(true);
    try {
      await fabricSignOut();
      setFabricAccount(null);
    } catch (err) {
      setFabricAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setFabricAuthBusy(false);
    }
  }

  // ── Connection presets (saved connector config per account) ──────────────
  // Cloud-only: hidden/inert in local (not-signed-in) mode, since presets are
  // stored per Supabase account. Scoped as its own block so it stays easy to
  // lift or rebase independently of the rest of this file.
  const { configured, user } = useAuth();
  const presetsEnabled = configured && !!user;
  const [presets, setPresets] = useState<ConnectionPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);

  useEffect(() => {
    if (!presetsEnabled) {
      setPresets([]);
      return;
    }
    let cancelled = false;
    listPresets(connectorId)
      .then((p) => {
        if (!cancelled) setPresets(p);
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [presetsEnabled, connectorId]);

  function applyPresetConfig(config: Record<string, unknown>) {
    // Connector-agnostic: fill whichever fields the config happens to carry.
    // Secret fields (token) are never in a saved preset, so they're left for
    // the user to re-enter.
    if (typeof config.workspaceId === "string") setWorkspaceId(config.workspaceId);
  }

  function handleSelectPreset(id: string) {
    setSelectedPresetId(id);
    setPresetError(null);
    const preset = presets.find((p) => p.id === id);
    if (preset) applyPresetConfig(preset.config);
  }

  async function handleSavePreset() {
    setPresetError(null);
    const name = presetName.trim();
    if (!name) {
      setPresetError("Give this preset a name.");
      return;
    }
    // Only non-secret, connector-agnostic fields go into the saved config —
    // savePreset() also strips any secret-looking key defensively.
    const config: Record<string, unknown> = isTokenAuth ? { workspaceId } : {};
    setPresetBusy(true);
    try {
      const saved = await savePreset(connectorId, name, config);
      setPresets((prev) => [saved, ...prev]);
      setSelectedPresetId(saved.id);
      setPresetName("");
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : String(err));
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleDeletePreset() {
    if (!selectedPresetId) return;
    setPresetBusy(true);
    setPresetError(null);
    try {
      await deletePreset(selectedPresetId);
      setPresets((prev) => prev.filter((p) => p.id !== selectedPresetId));
      setSelectedPresetId("");
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : String(err));
    } finally {
      setPresetBusy(false);
    }
  }

  // ── Drift notifications (Slack/Teams) ───────────────────────────────────
  // Cloud-only, same gating as presets above. Config is per-model, loaded
  // once and saved on demand; firing happens in handleApply() below, reusing
  // the reconcile `result` that's already computed rather than re-diffing.
  const notificationsEnabled = presetsEnabled; // same "signed in + cloud" gate
  const [notifProvider, setNotifProvider] = useState<NotificationProvider>("slack");
  const [notifUrl, setNotifUrl] = useState("");
  const [notifOn, setNotifOn] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [notifTestResult, setNotifTestResult] = useState<NotifyResult | null>(null);

  useEffect(() => {
    if (!notificationsEnabled) return;
    let cancelled = false;
    getNotificationConfig(model.id)
      .then((cfg) => {
        if (cancelled || !cfg) return;
        setNotifProvider(cfg.provider);
        setNotifUrl(cfg.webhookUrl);
        setNotifOn(cfg.enabled);
        setNotifSaved(true);
      })
      .catch(() => {
        /* no config yet, or not reachable — leave defaults */
      });
    return () => {
      cancelled = true;
    };
  }, [notificationsEnabled, model.id]);

  async function handleSaveNotificationConfig() {
    setNotifError(null);
    setNotifBusy(true);
    try {
      await setNotificationConfig(model.id, {
        provider: notifProvider,
        webhookUrl: notifUrl,
        enabled: notifOn,
      });
      setNotifSaved(true);
    } catch (err) {
      setNotifError(err instanceof Error ? err.message : String(err));
    } finally {
      setNotifBusy(false);
    }
  }

  async function handleSendTestMessage() {
    setNotifError(null);
    setNotifTestResult(null);
    setNotifBusy(true);
    try {
      const testSummary = buildDriftSummary(model.name, {
        nextNodes: [],
        nextEdges: [],
        added: [],
        changed: [],
        removed: [],
        edgesAdded: 0,
        edgesRemoved: 0,
      });
      // Test message should send regardless of the (usually empty) drift
      // state, so force hasDrift true rather than relying on real data.
      const forced = { ...testSummary, hasDrift: true, headline: `Test message from ${model.name}` };
      const res = await notifyDrift({ provider: notifProvider, url: notifUrl, enabled: true }, forced);
      setNotifTestResult(res);
    } catch (err) {
      setNotifError(err instanceof Error ? err.message : String(err));
    } finally {
      setNotifBusy(false);
    }
  }

  async function handleConnect() {
    if (!connector?.parseFromApi) return;
    setError(null);
    setLoading(true);
    setFileName(`workspace ${workspaceId}`);
    try {
      const usingFabricAuth = connectorId === "fabric" && fabricAuthAvailable && !!fabricAccount;
      const effectiveToken = usingFabricAuth ? await getFabricToken() : token;
      const parsed = await connector.parseFromApi({
        workspaceId,
        token: effectiveToken,
        ...(connectorId === "fabric"
          ? {
              options: {
                deepScan,
                msalSignedIn: usingFabricAuth,
                // OneLake Delta-log column schema needs a storage-audience
                // token, which we can only mint via MSAL (or mock mode) —
                // pasted Fabric tokens carry the wrong audience.
                oneLakeSchema: usingFabricAuth || isFabricMockMode(),
                notebooks,
              },
            }
          : {}),
      });
      const rec = reconcileConnectorSync(model, connector.id, connector.id, parsed);
      setResult(rec);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setLoading(true);
    setFileName(file.name);
    try {
      const parsed = await connector.parse(file);
      // One connection per connector per model (v1): the connector id doubles as
      // the connection id, so re-syncing the same source reconciles.
      const rec = reconcileConnectorSync(model, connector.id, connector.id, parsed);
      setResult(rec);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleApply() {
    if (!result) return;
    let nextNodes = result.nextNodes;
    let nextEdges = result.nextEdges;
    if (dropRemoved && result.removed.length) {
      nextNodes = dropNodes(nextNodes, new Set(result.removed.map((n) => n.id)));
      // Drop any edge whose endpoint no longer exists after the removal.
      const alive = new Set(nextNodes.map((n) => n.id));
      nextEdges = nextEdges.filter(
        (e) => alive.has(e.sourceNodeId) && alive.has(e.targetNodeId)
      );
    }
    onApply(nextNodes, nextEdges);
    if (connector) recordSync(model.id, connector.id, connector.label);
    // Fire the drift notification (if configured) from the reconcile result
    // already computed above — never recomputed. This never blocks or fails
    // the sync: the apply above has already happened, and any notify failure
    // here just gets logged (the modal is closing, so there's no inline UI
    // left to show a warning in). Designed so a future scheduler can call the
    // same buildDriftSummary + notifyDrift pair on its own reconcile result.
    if (notificationsEnabled && notifSaved && notifOn && notifUrl.trim()) {
      const summary = buildDriftSummary(model.name, result);
      if (summary.hasDrift) {
        notifyDrift({ provider: notifProvider, url: notifUrl, enabled: notifOn }, summary).catch(
          (err) => {
            console.warn("Drift notification failed:", err);
          }
        );
      }
    }
    onClose();
  }

  // Whether the source is sufficiently configured to fetch a preview. Drives
  // the footer's contextual primary button (Preview changes → Apply sync).
  const canPreview =
    !loading &&
    !!workspaceId.trim() &&
    (connectorId === "fabric" ? fabricAuthAvailable && !!fabricAccount : !!token.trim());

  // A preview reflects a specific source config — if the user changes the
  // workspace, connector, or a schema toggle after previewing, drop the stale
  // result so the footer reverts to "Preview changes" and can't apply it.
  useEffect(() => {
    setResult(null);
  }, [connectorId, workspaceId, deepScan, notebooks, token]);

  return (
    <Modal title="Sync from source" onClose={onClose} wide>
      <p className="modal-hint">
        Import from a connector and re-run any time — nodes already synced from
        this source update in place, keeping tags and descriptions.
      </p>

      {/* ── Step 1: Source ──────────────────────────────────────────────── */}
      <section className="sync-section">
        <h4 className="sync-section-title">1. Source</h4>

        <div className="import-file-row">
          <Select value={connectorId} onChange={(e) => setConnectorId(e.target.value)}>
            {CONNECTOR_LIST.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          {!isTokenAuth && (
            <>
              <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={loading}>
                Choose {connector?.fileHint ?? "file"}…
              </Button>
              <span className="import-file-name">
                {fileName ?? <span className="muted">No file chosen</span>}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleFile}
              />
            </>
          )}
        </div>

        {presetsEnabled && (
          <div className="sync-field-group">
            <label className="ui-field-label" htmlFor="sync-preset-select">
              Saved connections
            </label>
            <div className="sync-inline-row">
              <Select
                id="sync-preset-select"
                value={selectedPresetId}
                onChange={(e) => handleSelectPreset(e.target.value)}
                disabled={presetBusy || loading}
              >
                <option value="">
                  {presets.length ? "Choose a saved connection…" : "No saved connections yet"}
                </option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                onClick={handleDeletePreset}
                disabled={!selectedPresetId || presetBusy || loading}
              >
                Delete
              </Button>
            </div>
            <div className="sync-inline-row">
              <input
                type="text"
                placeholder="Name this connection, e.g. Prod workspace"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                disabled={presetBusy || loading}
              />
              <Button
                variant="secondary"
                onClick={handleSavePreset}
                disabled={presetBusy || loading || !presetName.trim()}
              >
                {presetBusy ? "Saving…" : "Save as preset"}
              </Button>
            </div>
            {presetError && <div className="import-error">{presetError}</div>}
          </div>
        )}

        {isTokenAuth && (
          <div className="sync-field-group">
            {/* Fabric-only: "Sign in with Microsoft" (MSAL) is the ONLY auth
                path — manual bearer tokens were removed (they expire hourly,
                can't be refreshed, and carry the wrong audience for the
                OneLake column-schema enrichment). When the Entra app
                registration isn't wired in, we show setup instructions
                instead of a degraded token flow. */}
            {connectorId === "fabric" && fabricAuthAvailable && (
              <div className="sync-field-group">
                {fabricAccount ? (
                  <div className="sync-inline-row">
                    <span>
                      Signed in as <strong>{fabricAccount.name}</strong> (
                      {fabricAccount.username})
                    </span>
                    <Button
                      variant="secondary"
                      onClick={handleFabricSignOut}
                      disabled={fabricAuthBusy || loading}
                    >
                      Sign out
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    onClick={handleFabricSignIn}
                    disabled={fabricAuthBusy || loading}
                  >
                    {fabricAuthBusy ? "Signing in…" : "Sign in with Microsoft"}
                  </Button>
                )}
                {fabricAuthError && <div className="import-error">{fabricAuthError}</div>}
              </div>
            )}

            {/* Workspace: a picker of the workspaces the signed-in user can
                access; the raw-id input only remains for the signed-out /
                list-failed cases. */}
            {connectorId === "fabric" && fabricAccount && workspaces ? (
              <>
                <label className="ui-field-label" htmlFor="sync-workspace-select">
                  Workspace
                </label>
                <select
                  id="sync-workspace-select"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  disabled={loading}
                >
                  <option value="">Select a workspace…</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.displayName}
                    </option>
                  ))}
                </select>
                <p className="sync-field-help">
                  Workspaces your Microsoft account can access
                  {workspaces.length ? ` (${workspaces.length})` : ""}.
                </p>
              </>
            ) : connectorId === "fabric" && fabricAccount && workspacesLoading ? (
              <p className="sync-field-help">Loading your workspaces…</p>
            ) : (
              <>
                <label className="ui-field-label" htmlFor="sync-workspace-id">
                  Workspace ID
                </label>
                <input
                  id="sync-workspace-id"
                  type="text"
                  placeholder="e.g. cfafbeb1-8037-4d0c-896e-a46fb27ff229"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  disabled={loading}
                />
                <p className="sync-field-help">
                  Find this in the Fabric portal URL when viewing the workspace:
                  app.fabric.microsoft.com/groups/<strong>&lt;workspace-id&gt;</strong>
                </p>
                {workspacesError && (
                  <p className="sync-field-help">
                    Couldn't list your workspaces ({workspacesError}) — paste the id manually instead
                  </p>
                )}
              </>
            )}

            {connectorId === "fabric" && !fabricAuthAvailable && (
              <div className="sync-setup-hint">
                <strong>Microsoft sign-in isn't configured in this build.</strong>
                <p className="sync-field-help">
                  Connecting to Fabric uses your Microsoft account — no tokens
                  to paste. To enable it, set the Application (client) ID
                  from your Entra app registration as{" "}
                  <code>VITE_FABRIC_CLIENT_ID</code> (plus optionally{" "}
                  <code>VITE_FABRIC_TENANT_ID</code>) in{" "}
                  <code>frontend/.env.local</code>, then restart the dev server.
                </p>
              </div>
            )}

            {/* Generic bearer-token input for future non-Fabric token-auth
                connectors (Fabric itself is sign-in only). */}
            {connectorId !== "fabric" && (
              <>
                <label className="ui-field-label" htmlFor="sync-token">
                  Bearer token
                </label>
                <input
                  id="sync-token"
                  type="password"
                  placeholder="eyJ0eXAiOiJKV1Qi..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={loading}
                />
                <p className="sync-field-help">
                  An access token for this source's API. Tokens expire — if the
                  sync fails with an auth error, generate a fresh one.
                </p>
              </>
            )}

            {/* Fabric-only: Admin Scanner API enrichment toggle. Self-contained
                block — scoped to this connector so it doesn't affect dbt/other
                token-auth connectors added later. */}
            {connectorId === "fabric" && (
              <label className="import-mode-label">
                <input
                  type="checkbox"
                  checked={deepScan}
                  onChange={(e) => setDeepScan(e.target.checked)}
                  disabled={loading}
                />
                Deep scan column schema (requires tenant-admin permissions)
              </label>
            )}
            {connectorId === "fabric" && (
              <p className="sync-field-help">
                Lakehouse table columns are read automatically from OneLake
                Delta logs when you're signed in with Microsoft — no admin
                needed. Deep scan additionally fetches Warehouse tables and
                columns via the Fabric Admin Scanner API, but is slower and
                only works if your account has tenant-admin permissions.
              </p>
            )}

            {connectorId === "fabric" && (
              <label className="import-mode-label">
                <input
                  type="checkbox"
                  checked={notebooks}
                  onChange={(e) => setNotebooks(e.target.checked)}
                  disabled={loading}
                />
                Notebook transformations (adds a Transformations layer)
              </label>
            )}
            {connectorId === "fabric" && notebooks && (
              <p className="sync-field-help">
                Reads each notebook's code and statically extracts the tables it
                reads and writes, adding a Transformations layer where notebooks
                link source tables to the tables they produce. Intermediate
                results appear as staged tables. Read-only — no admin needed.
              </p>
            )}

            {/* Phase 2 (runtime): a dedicated Step 3 workflow, shown only once
                signed in with a workspace selected. Read-only scaffolding; the
                Run action inside is gated. */}
            {connectorId === "fabric" && fabricAccount && workspaces && workspaceId && (
              <label className="import-mode-label">
                <input
                  type="checkbox"
                  checked={runtimeNotebooks}
                  onChange={(e) => setRuntimeNotebooks(e.target.checked)}
                  disabled={loading}
                />
                Runtime notebook lineage — execute notebooks to capture exact
                lineage (preview)
              </label>
            )}
            {connectorId === "fabric" && runtimeNotebooks && fabricAccount && workspaces && workspaceId && (
              <RuntimeNotebookLineage workspaces={workspaces} sourceWorkspaceId={workspaceId} />
            )}

          </div>
        )}
      </section>

      {result && (
        <section className="sync-section">
          <h4 className="sync-section-title">2. Review changes</h4>
          <div className="import-preview">
            <ul className="version-diff-stats">
              <li><span className="diff-dot diff-added" /> {result.added.length} added</li>
              <li><span className="diff-dot diff-changed" /> {result.changed.length} changed</li>
              <li><span className="diff-dot diff-removed" /> {result.removed.length} removed upstream</li>
              <li><span className="diff-dot diff-edge" /> {result.edgesAdded} edges added, {result.edgesRemoved} removed</li>
            </ul>
            {result.removed.length > 0 && (
              <label className="import-mode-label">
                <input
                  type="checkbox"
                  checked={dropRemoved}
                  onChange={(e) => setDropRemoved(e.target.checked)}
                />
                Delete the {result.removed.length} node
                {result.removed.length === 1 ? "" : "s"} removed upstream
                (otherwise they're kept, unlinked from this source)
              </label>
            )}
          </div>
        </section>
      )}

      {notificationsEnabled && (
        <details className="sync-section sync-collapsible">
          <summary className="sync-section-title">
            Drift notifications
            {notifSaved && notifOn && <span className="ui-badge ui-badge--accent">On</span>}
          </summary>
          <p className="modal-hint" style={{ marginTop: 0 }}>
            When a sync detects schema drift (tables or columns added,
            removed, or retyped), post a summary to Slack or Microsoft Teams.
            Set up once per model; every future sync notifies automatically.
          </p>
          <div className="sync-inline-row">
            <Select
              value={notifProvider}
              onChange={(e) => {
                setNotifProvider(e.target.value as NotificationProvider);
                setNotifSaved(false);
              }}
              disabled={notifBusy}
            >
              <option value="slack">Slack</option>
              <option value="teams">Microsoft Teams</option>
            </Select>
            <input
              type="text"
              placeholder="https://hooks.slack.com/services/…"
              value={notifUrl}
              onChange={(e) => {
                setNotifUrl(e.target.value);
                setNotifSaved(false);
              }}
              disabled={notifBusy}
              style={{ flex: 1 }}
            />
          </div>
          <label className="import-mode-label">
            <input
              type="checkbox"
              checked={notifOn}
              onChange={(e) => {
                setNotifOn(e.target.checked);
                setNotifSaved(false);
              }}
              disabled={notifBusy}
            />
            Send notifications for this model
          </label>
          {notifProvider === "teams" && (
            <p className="modal-hint" style={{ margin: 0 }}>
              Microsoft Teams webhooks typically reject direct browser POSTs
              (CORS) — delivery may fail unless proxied through a server-side
              relay. Slack delivery works from the browser but can't confirm
              success (the response is opaque).
            </p>
          )}
          <div className="sync-actions-row">
            <Button
              variant="secondary"
              onClick={handleSaveNotificationConfig}
              disabled={notifBusy || !notifUrl.trim()}
            >
              {notifBusy ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="secondary"
              onClick={handleSendTestMessage}
              disabled={notifBusy || !notifUrl.trim()}
            >
              Send test message
            </Button>
            {notifSaved && <span className="muted">Saved.</span>}
          </div>
          {notifTestResult && (
            <span className={notifTestResult.ok ? "muted" : "import-error"}>
              {notifTestResult.message}
            </span>
          )}
          {notifError && <div className="import-error">{notifError}</div>}
        </details>
      )}

      {error && <div className="import-error">{error}</div>}

      <div className="modal-actions">
        {result && !loading && (
          <span className="sync-step-hint">
            Step 2 of 2 — review the changes above, then apply.
          </span>
        )}
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        {/* Contextual primary: fetch a preview first, then apply it. Keeps the
            prominent action aligned with the user's next step instead of a
            permanently-disabled "Apply" sitting next to a buried preview. */}
        {result ? (
          <Button variant="primary" onClick={handleApply} disabled={loading}>
            Apply sync
          </Button>
        ) : (
          <Button variant="primary" onClick={handleConnect} disabled={!canPreview}>
            {loading ? "Reading…" : "Preview changes"}
          </Button>
        )}
      </div>
    </Modal>
  );
}
