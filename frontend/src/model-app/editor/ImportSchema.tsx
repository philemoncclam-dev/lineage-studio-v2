import { useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import type { LineageNode, Model } from "../types";
import Modal from "./Modal";
import FileDrop from "./FileDrop";
import { Button } from "../ui";
import {
  parseSchema,
  guessColumn,
  groupByTable,
  buildImportNodes,
  type BuildResult,
} from "./schemaImport";

interface Props {
  model: Model;
  onImport: (nodes: LineageNode[]) => void;
  onClose: () => void;
}

const TABLE_PATTERNS = [/^table$/i, /table/i, /entity/i];
const COLUMN_PATTERNS = [/^column$/i, /column/i, /field/i, /attribute/i, /^name$/i];
const ORDINAL_PATTERNS = [/ordinal/i, /position/i, /order/i, /index/i];
const TYPE_PATTERNS = [/data.?type/i, /^type$/i];

export default function ImportSchema({ model, onImport, onClose }: Props) {
  const [text, setText] = useState("");
  const [done, setDone] = useState<BuildResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Load a dropped/browsed CSV/TSV file into the textarea so the existing
  // parse/preview/mapping path is reused. Excel is read via SheetJS to a TSV.
  async function handleFile(file: File) {
    setFileError(null);
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", raw: false });
        setText(matrix.map((r) => r.map((c) => String(c ?? "")).join("\t")).join("\n"));
      } else {
        setText((await file.text()).replace(/^﻿/, ""));
      }
    } catch {
      setFileError("Could not read that file. Use .xlsx or CSV/TSV.");
    }
  }

  const parsed = useMemo(() => parseSchema(text), [text]);
  const hasData = parsed.rows.length > 0;

  // For a headerless paste we use fixed positions; otherwise guess from headers.
  const tIdx = parsed.hasHeader ? guessColumn(parsed.headers, TABLE_PATTERNS) : 0;
  const cIdx = parsed.hasHeader ? guessColumn(parsed.headers, COLUMN_PATTERNS) : 1;
  const oIdx = parsed.hasHeader ? guessColumn(parsed.headers, ORDINAL_PATTERNS) : 2;
  const yIdx = parsed.hasHeader ? guessColumn(parsed.headers, TYPE_PATTERNS) : 3;

  const tables = useMemo(
    () => groupByTable(parsed, tIdx, cIdx, oIdx, yIdx),
    [parsed, tIdx, cIdx, oIdx, yIdx]
  );

  const existingLayers = useMemo(
    () => model.nodes.filter((n) => n.type === "Layer").map((n) => n.name),
    [model.nodes]
  );

  // Per-table Layer assignment. Defaults every newly-seen table to the first
  // existing layer (or "P-S") so the user can import in one click.
  const defaultLayer = existingLayers[0] ?? "P-S";
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  useEffect(() => {
    setAssignments((prev) => {
      const next = { ...prev };
      for (const t of tables) if (!(t.table in next)) next[t.table] = defaultLayer;
      return next;
    });
  }, [tables, defaultLayer]);

  const setAll = (layer: string) =>
    setAssignments(Object.fromEntries(tables.map((t) => [t.table, layer])));

  const canImport =
    hasData && tIdx >= 0 && cIdx >= 0 &&
    tables.some((t) => (assignments[t.table] ?? "").trim());

  function handleImport() {
    const result = buildImportNodes(model, tables, assignments);
    onImport(result.nodes);
    setDone(result);
  }

  return (
    <Modal title="Import schema" onClose={onClose} wide>
      {done ? (
        <div className="import-done">
          <p className="import-success"><Icon name="checkmark" /> Imported</p>
          <ul>
            <li>{done.tables} table(s)</li>
            <li>{done.columns} new column(s)</li>
            <li>{done.layersCreated} new layer(s) created</li>
          </ul>
          <p className="muted">
            Each table is now a card on the canvas under its layer. Use{" "}
            <strong>Map attributes</strong> to draw source → target lineage, then save.
          </p>
          <div className="modal-actions">
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="modal-hint">
            Paste your schema as <code>Table, Column, Ordinal, DataType</code>{" "}
            (CSV or tab-separated) — header row optional. Each table becomes a
            card; columns become attributes in ordinal order.
          </p>
          <FileDrop
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onFile={handleFile}
            hint="CSV, TSV or Excel — or paste below"
          />
          {fileError && <div className="import-error">{fileError}</div>}

          <textarea
            className="import-textarea"
            rows={8}
            placeholder={
              "Customers,CustomerID,1,INTEGER\nCustomers,FirstName,2,VARCHAR(50)\nOrders,OrderID,1,INTEGER\nOrders,OrderDate,2,DATE"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {hasData && tables.length > 0 && (
            <>
              <div className="import-assign-head">
                <span>
                  {tables.length} table(s) detected
                  {parsed.hasHeader ? "" : " · no header"}
                </span>
                {existingLayers.length > 0 && (
                  <label className="import-setall">
                    <span>Set all to</span>
                    <select onChange={(e) => e.target.value && setAll(e.target.value)} defaultValue="">
                      <option value="" disabled>
                        choose layer…
                      </option>
                      {existingLayers.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="import-tables">
                {tables.map((t) => (
                  <div key={t.table} className="import-table-row">
                    <div className="import-table-info">
                      <strong>{t.table}</strong>
                      <span className="muted"> · {t.columns.length} columns</span>
                    </div>
                    <label className="field import-table-layer">
                      <span>Layer</span>
                      <input
                        list="layer-options"
                        value={assignments[t.table] ?? ""}
                        onChange={(e) =>
                          setAssignments((a) => ({ ...a, [t.table]: e.target.value }))
                        }
                        placeholder="e.g. P-S"
                      />
                    </label>
                  </div>
                ))}
              </div>
              <datalist id="layer-options">
                {existingLayers.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </>
          )}

          <div className="modal-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleImport} disabled={!canImport}>
              Import
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
