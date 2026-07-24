// "Share via link" dialog. Publishes the current model snapshot to Supabase and
// shows a copyable read-only link — no sign-in required for either side.
import { useEffect, useState } from "react";
import type { Model } from "../types";
import { Button } from "../ui";
import {
  isSharingConfigured,
  publishShare,
  updateShare,
  deleteShare,
  setShareEditable,
  fetchShare,
  getShareToken,
  rememberShareToken,
  forgetShareToken,
  shareUrl,
  editShareUrl,
  errorText,
} from "../share";

export default function ShareDialog({
  model,
  onClose,
}: {
  model: Pick<Model, "id" | "name" | "nodes" | "edges">;
  onClose: () => void;
}) {
  const [token, setToken] = useState<string | null>(() => getShareToken(model.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"view" | "edit" | null>(null);
  const [updated, setUpdated] = useState(false);
  // Whether the (to-be-)created or existing link allows editing. For an existing
  // token we learn its real state from the server on open.
  const [editable, setEditable] = useState(false);

  const url = token ? shareUrl(token) : "";

  // Esc closes the dialog, matching every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Sync the editable toggle to the server state of an already-published link.
  useEffect(() => {
    if (!token || !isSharingConfigured) return;
    let cancelled = false;
    fetchShare(token)
      .then((s) => !cancelled && setEditable(s.editable))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function createLink() {
    setBusy(true);
    setError(null);
    try {
      const t = await publishShare(model, { editable });
      rememberShareToken(model.id, t);
      setToken(t);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // Flip an existing link between view-only and editable.
  async function toggleEditable(next: boolean) {
    if (!token) {
      setEditable(next);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setShareEditable(token, next);
      setEditable(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function pushUpdate() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setUpdated(false);
    try {
      await updateShare(token, model);
      setUpdated(true);
      setTimeout(() => setUpdated(false), 2000);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function stopSharing() {
    if (!token) return;
    if (!confirm("Stop sharing? Anyone with the current link will lose access.")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteShare(token);
      forgetShareToken(model.id);
      setToken(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(which: "view" | "edit", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy manually.");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Share “{model.name}”</h3>
          <button className="modal-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {!isSharingConfigured ? (
            <p className="modal-hint">
              Sharing isn’t configured — set a Supabase URL and key to enable link sharing.
            </p>
          ) : !token ? (
            <>
              <p className="modal-hint">
                Create a link anyone can open — no account needed
              </p>
              <fieldset className="share-access">
                <label className="share-access-opt">
                  <input
                    type="radio"
                    name="share-access"
                    checked={!editable}
                    onChange={() => setEditable(false)}
                  />
                  <span>
                    <strong>View only</strong>
                    <span className="share-access-desc">
                      Read-only snapshot of the model as it is now
                    </span>
                  </span>
                </label>
                <label className="share-access-opt">
                  <input
                    type="radio"
                    name="share-access"
                    checked={editable}
                    onChange={() => setEditable(true)}
                  />
                  <span>
                    <strong>Can edit</strong>
                    <span className="share-access-desc">
                      Anyone with the link can change this model; edits save to the shared copy
                    </span>
                  </span>
                </label>
              </fieldset>
              <div className="modal-actions">
                <Button variant="primary" onClick={createLink} disabled={busy}>
                  {busy ? "Creating…" : "Create link"}
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Primary link: for an editable share this is the EDIT link, so
                  the person you send it to lands in the editor and can actually
                  change the model — not the read-only snapshot. */}
              <p className="modal-hint">
                {editable
                  ? "Anyone with this link can edit — changes save to the shared copy"
                  : "Anyone with this link can view (read-only)"}
              </p>
              <div className="share-link-row">
                <input
                  className="ui-input share-link-input"
                  readOnly
                  value={editable ? editShareUrl(token) : url}
                />
                <Button
                  variant="primary"
                  onClick={() =>
                    editable ? copy("edit", editShareUrl(token)) : copy("view", url)
                  }
                >
                  {copied === (editable ? "edit" : "view") ? "Copied!" : "Copy"}
                </Button>
              </div>

              <label className="share-editable-toggle">
                <input
                  type="checkbox"
                  checked={editable}
                  disabled={busy}
                  onChange={(e) => toggleEditable(e.target.checked)}
                />
                <span>Allow anyone with the link to edit</span>
              </label>

              {editable && (
                <>
                  <p className="modal-hint">
                    To let someone only view, share this read-only link instead
                  </p>
                  <div className="share-link-row">
                    <input className="ui-input share-link-input" readOnly value={url} />
                    <Button variant="secondary" onClick={() => copy("view", url)}>
                      {copied === "view" ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                </>
              )}

              <p className="modal-hint">
                {editable
                  ? "Editors always see the latest saved state — push current changes now:"
                  : "The link shows a snapshot — push your latest changes after editing:"}
              </p>
              <div className="modal-actions share-actions">
                <Button variant="subtle" onClick={stopSharing} disabled={busy}>
                  Stop sharing
                </Button>
                <Button variant="secondary" onClick={pushUpdate} disabled={busy}>
                  {busy ? "…" : updated ? "Updated!" : "Update link"}
                </Button>
              </div>
            </>
          )}
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
