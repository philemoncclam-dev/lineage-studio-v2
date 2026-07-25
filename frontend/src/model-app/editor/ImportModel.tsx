// Modal for importing a model file. Uses the forgiving universal parser
// (importAny) so JSON, Excel, or CSV in almost any reasonable shape is accepted;
// a preview with counts + warnings is shown before applying.
// Used on HomePage (always creates new) and EditorPage (create-or-replace).
import { useState } from "react";
import Modal from "./Modal";
import FileDrop from "./FileDrop";
import { BarsSpinner, Button } from "../ui";
import { importAny, resultToModel, summarize, type ImportResult } from "./importAny";
import type { Model } from "../types";

export type ImportMode = "new" | "replace";

interface Props {
  /** If provided, show a "replace current model" option */
  currentModel?: Model;
  onImportNew: (model: Model) => Promise<void>;
  onReplace?: (model: Model) => Promise<void>;
  onClose: () => void;
}

export default function ImportModel({
  currentModel,
  onImportNew,
  onReplace,
  onClose,
}: Props) {
  const [mode, setMode] = useState<ImportMode>("new");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setLoading(true);
    setFileName(file.name);
    try {
      const res = await importAny(file);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!result) return;
    setError(null);
    setLoading(true);
    try {
      const model = resultToModel(result);
      if (mode === "replace" && onReplace) await onReplace(model);
      else await onImportNew(model);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  const counts = result ? summarize(result) : null;

  return (
    <Modal title="Import model" onClose={onClose}>
      <p className="modal-hint">
        Import a full model as <code>JSON</code>, <code>Excel</code>, or{" "}
        <code>CSV</code> — any reasonable shape. Preview before applying.
      </p>

      <FileDrop
        accept=".json,.lineage.json,.xlsx,.xls,.csv,.tsv"
        disabled={loading}
        onFile={handleFile}
        fileName={fileName}
        hint="JSON model, {nodes, edges}, spreadsheets or CSV/TSV"
      />

      {loading && !result && <div className="import-loading loading-row"><BarsSpinner size={16} />Reading file…</div>}

      {result && counts && (
        <div className="import-preview">
          <div className="import-preview-head">
            <strong>{result.name}</strong>
          </div>
          <div className="import-stats">
            <span className="import-stat">{counts.layers} layers</span>
            <span className="import-stat">{counts.objects} objects</span>
            <span className="import-stat">{counts.attributes} attributes</span>
            <span className="import-stat">{counts.edges} edges</span>
          </div>

          {result.warnings.length > 0 && (
            <div className="import-warnings">
              <div className="import-warnings-title">
                {result.warnings.length} note
                {result.warnings.length === 1 ? "" : "s"}
              </div>
              <ul>
                {result.warnings.slice(0, 6).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {result.warnings.length > 6 && (
                  <li className="muted">…and {result.warnings.length - 6} more</li>
                )}
              </ul>
            </div>
          )}

          {currentModel && onReplace && (
            <div className="import-mode-row">
              <label className="import-mode-label">
                <input
                  type="radio"
                  name="import-mode"
                  value="new"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                Create as new model
              </label>
              <label className="import-mode-label">
                <input
                  type="radio"
                  name="import-mode"
                  value="replace"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                />
                Replace current model ({currentModel.name})
              </label>
            </div>
          )}
        </div>
      )}

      {error && <div className="import-error">{error}</div>}

      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleImport}
          disabled={!result || loading}
        >
          {loading && result ? "Importing…" : "Confirm import"}
        </Button>
      </div>
    </Modal>
  );
}
