import { useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import type { Model } from "../types";
import Modal from "./Modal";
import FileDrop from "./FileDrop";
import { Button } from "../ui";
import {
  parseDefinitions,
  parseDefinitionsFile,
  matchDefinitions,
} from "./definitionsImport";

interface Props {
  model: Model;
  applyDefinitions: (updates: { id: string; description: string }[]) => void;
  onClose: () => void;
}

// Import business definitions for existing attributes. The user pastes (or
// uploads) rows of Column, Table, Definition; each is matched to an attribute by
// table + column name and its description is filled in. No new nodes are
// created — this only annotates columns that already exist.
export default function ImportDefinitions({ model, applyDefinitions, onClose }: Props) {
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [done, setDone] = useState<{ applied: number } | null>(null);

  const parsed = useMemo(() => parseDefinitions(text), [text]);
  const result = useMemo(
    () => matchDefinitions(model, parsed.rows),
    [model, parsed.rows]
  );

  // Distinct attributes that will be written (a row can match several).
  const applyCount = result.matched.length;
  const canApply = applyCount > 0;

  async function handleFile(file: File) {
    setFileError(null);
    try {
      const p = await parseDefinitionsFile(file);
      // Re-render as text so the preview/edit path is shared. Rebuild a simple
      // TSV the text parser understands (Column, Table, Definition).
      const tsv = p.rows
        .map((r) => [r.column, r.table, r.definition].join("\t"))
        .join("\n");
      setText(tsv);
    } catch {
      setFileError("Could not read that file. Use .xlsx or CSV/TSV.");
    }
  }

  function handleApply() {
    const updates = result.matched.map((m) => ({
      id: m.attrId,
      description: m.definition,
    }));
    applyDefinitions(updates);
    setDone({ applied: updates.length });
  }

  return (
    <Modal title="Import definitions" onClose={onClose} wide>
      {done ? (
        <div className="import-done">
          <p className="import-success"><Icon name="checkmark" /> Definitions imported</p>
          <ul>
            <li>{done.applied} attribute description(s) updated</li>
          </ul>
          <p className="muted">
            Definitions now appear in each attribute's Details panel — remember to save.
          </p>
          <div className="modal-actions">
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="modal-hint">
            Paste rows of <code>Column, Table, Definition</code> (CSV or
            tab-separated) — header row optional. Each row matches an existing
            column by table&nbsp;+&nbsp;name and fills in its description.
            Nothing new is created.
          </p>

          <FileDrop
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            onFile={handleFile}
            hint="Excel, CSV or TSV — or paste below"
          />
          {fileError && <div className="import-error">{fileError}</div>}

          <textarea
            className="import-textarea"
            rows={8}
            placeholder={
              "CustomerName,DimCustomer,The customer's full display name\nCustomerID,DimCustomer,Surrogate key for the customer dimension\nOrderDate,FactOrders,Date the order was placed"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {parsed.rows.length > 0 && (
            <div className="import-defsummary">
              <span className="import-defstat import-defstat--ok">
                {result.matched.length} match(es)
              </span>
              {result.unmatched.length > 0 && (
                <span className="import-defstat import-defstat--warn">
                  {result.unmatched.length} unmatched
                </span>
              )}
              {result.unmatched.length > 0 && (
                <div className="import-defunmatched">
                  Not found in the model:
                  <ul>
                    {result.unmatched.slice(0, 8).map((r, i) => (
                      <li key={i}>
                        <strong>{r.column}</strong>
                        {r.table ? ` · ${r.table}` : ""}
                      </li>
                    ))}
                    {result.unmatched.length > 8 && (
                      <li className="muted">
                        …and {result.unmatched.length - 8} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleApply} disabled={!canApply}>
              {applyCount > 0 ? `Apply ${applyCount} definition${applyCount === 1 ? "" : "s"}` : "Apply"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
