// Structured attribute metadata. These keys live inside a node's `properties`
// bag so they round-trip automatically through JSON and the xlsx Properties
// column; exportXlsx additionally surfaces them as their own readable columns.

export interface MetaDropdown {
  key: string;
  label: string;
  options: string[]; // first entry is the empty "—" placeholder
  /** Excel column header used by export/import for this field. */
  column: string;
}

export const DATA_TYPES = [
  "",
  "STRING",
  "INT",
  "BIGINT",
  "DECIMAL",
  "FLOAT",
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
  "BINARY",
  "GUID",
];
export const NULLABLE = ["", "Yes", "No"];
export const KEYS = ["", "Primary Key", "Foreign Key"];
export const CLASSIFICATIONS = ["", "Public", "Internal", "Confidential", "PII"];

// Dropdown fields shown in the inspector for Attribute nodes (in order).
export const META_DROPDOWNS: MetaDropdown[] = [
  { key: "dataType", label: "Data type", options: DATA_TYPES, column: "DataType" },
  { key: "nullable", label: "Nullable", options: NULLABLE, column: "Nullable" },
  { key: "key", label: "Key", options: KEYS, column: "Key" },
  {
    key: "classification",
    label: "Classification",
    options: CLASSIFICATIONS,
    column: "Classification",
  },
];

// Free-text field (separate because it renders as a textarea).
export const META_DESCRIPTION = { key: "description", label: "Description", column: "Description" };

// All metadata Excel columns in order, for export/import.
export const META_COLUMNS = [...META_DROPDOWNS, META_DESCRIPTION];

export const readMeta = (props: Record<string, unknown>, key: string): string => {
  const v = props[key];
  return typeof v === "string" ? v : v == null ? "" : String(v);
};
