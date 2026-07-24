// Connection presets: per-account saved connector configuration (e.g. a dbt
// project ref, a Fabric workspace id) so re-syncing is one click instead of
// re-entering everything. Connector-agnostic — this module knows nothing
// about individual connectors; it just moves a plain config object in and
// out of storage, with secret fields stripped before persistence.
//
// Security posture (see also Claude App/supabase/schema.sql): bearer tokens /
// passwords are NEVER written to the `connection_presets.config` jsonb
// column. A preset stores only non-secret identifiers (workspace id, project
// ref, scopes, …); the user re-enters the secret at sync time, same as today.
// This is the safer of the two options considered — it avoids storing
// long-lived credentials server-side at all, rather than trying to separate
// and re-protect them. The one-time cost is retyping the token per sync,
// which is the existing UX anyway (no persistence today).

// Fields that must never be persisted in a preset's config, regardless of
// which connector produced them. Matched case-insensitively against the
// object's own key names — new connectors get this protection for free as
// long as they name their secret fields conventionally (token, password,
// secret, apiKey, ...).
const SECRET_FIELD_PATTERN = /token|password|secret|apikey|api_key|credential/i;

export type PresetConfig = Record<string, unknown>;

export interface ConnectionPreset {
  id: string;
  connectorType: string;
  name: string;
  config: PresetConfig;
  createdAt: string;
}

/** Raw row shape as stored/returned by Supabase (snake_case columns). */
export interface ConnectionPresetRow {
  id: string;
  owner: string;
  connector_type: string;
  name: string;
  config: PresetConfig | null;
  created_at: string;
}

export function rowToPreset(r: ConnectionPresetRow): ConnectionPreset {
  return {
    id: r.id,
    connectorType: r.connector_type,
    name: r.name,
    config: r.config ?? {},
    createdAt: r.created_at,
  };
}

/**
 * Strip any field whose key looks like a secret (token/password/secret/apiKey/
 * credential) from a config object, returning a new object safe to persist.
 * Pure and connector-agnostic — works for dbt's project ref fields and
 * Fabric's workspaceId+token alike.
 */
export function stripSecretFields(config: PresetConfig): PresetConfig {
  const out: PresetConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_FIELD_PATTERN.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/** True if this key would be excluded by stripSecretFields. */
export function isSecretField(key: string): boolean {
  return SECRET_FIELD_PATTERN.test(key);
}

/**
 * Validate a preset name + config shape before saving. Kept separate from the
 * Supabase call so it's trivially unit-testable without mocking anything.
 */
export function validatePresetInput(
  connectorType: string,
  name: string,
  config: PresetConfig
): string | null {
  if (!connectorType.trim()) return "A connector type is required.";
  if (!name.trim()) return "Give this preset a name.";
  if (Object.keys(config).length === 0) return "Nothing to save — fill in the connection fields first.";
  return null;
}
