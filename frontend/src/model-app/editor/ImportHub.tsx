// Import hub: one centered dialog that routes to every way of getting data
// into a model. Connector tiles (Microsoft Fabric, dbt) start the connect /
// sign-in flow of the Sync dialog; file tiles open the existing file-based
// import dialogs. Replaces the old rail popover list.
import { Icon } from "../ui/Icon";
import Modal from "./Modal";
import { relativeTime } from "../connectors/connections";

interface Props {
  onClose: () => void;
  // Start the sync/connect flow, preselecting a connector ("fabric" | "dbt").
  onSync: (connectorId: string) => void;
  // Open one of the file-based import dialogs.
  onFile: (kind: "schema" | "model" | "defs") => void;
  // This model's saved connection, if it has ever synced — shown as a
  // "last synced" hint on the matching tile.
  connection?: { connectorId: string; label: string; lastSyncedAt: string } | null;
}

// Simplified Microsoft Fabric mark: the folded "F" ribbon in Fabric greens.
function FabricLogo() {
  return (
    <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
      <defs>
        <linearGradient id="fabric-top" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#7ee8dc" />
          <stop offset="1" stopColor="#8ee98c" />
        </linearGradient>
        <linearGradient id="fabric-mid" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#0e7569" />
          <stop offset="1" stopColor="#8ee98c" />
        </linearGradient>
        <linearGradient id="fabric-low" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#0a5c55" />
          <stop offset="1" stopColor="#15978a" />
        </linearGradient>
      </defs>
      <path d="M14 6h28l-6 10H8z" fill="url(#fabric-top)" />
      <path d="M11 20h26l-5 9H6z" fill="url(#fabric-mid)" />
      <path d="M8 33h14l-4 9H4z" fill="url(#fabric-low)" />
    </svg>
  );
}

// Simplified dbt mark: the orange lens with a centered spark.
function DbtLogo() {
  return (
    <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
      <path
        d="M24 3c5 6 9 8 16 9-1 7 1 11 5 12-4 1-6 5-5 12-7 1-11 3-16 9-5-6-9-8-16-9 1-7-1-11-5-12 4-1 6-5 5-12 7-1 11-3 16-9z"
        fill="#ff694b"
      />
      <circle cx="24" cy="24" r="5.5" fill="#ffe9e3" />
    </svg>
  );
}

export default function ImportHub({ onClose, onSync, onFile, connection }: Props) {
  const syncedHint = (connectorId: string) =>
    connection && connection.connectorId === connectorId
      ? `Last synced ${relativeTime(connection.lastSyncedAt)}`
      : null;

  return (
    <Modal title="Import" onClose={onClose}>
      <div className="importhub-section">Connect a source</div>
      <div className="importhub-tiles">
        <button className="importhub-tile" onClick={() => onSync("fabric")}>
          <FabricLogo />
          <span className="importhub-tile-name">Microsoft Fabric</span>
          <span className="importhub-tile-sub">
            {syncedHint("fabric") ?? "Sign in and sync a workspace"}
          </span>
        </button>
        <button className="importhub-tile" onClick={() => onSync("dbt")}>
          <DbtLogo />
          <span className="importhub-tile-name">dbt</span>
          <span className="importhub-tile-sub">
            {syncedHint("dbt") ?? "Sync from manifest.json"}
          </span>
        </button>
      </div>

      <div className="importhub-section">From a file</div>
      <div className="importhub-tiles">
        <button className="importhub-tile" onClick={() => onFile("schema")}>
          <span className="importhub-tile-glyph">
            <Icon name="import" size={22} />
          </span>
          <span className="importhub-tile-name">Schema</span>
          <span className="importhub-tile-sub">Tables &amp; columns (CSV)</span>
        </button>
        <button className="importhub-tile" onClick={() => onFile("model")}>
          <span className="importhub-tile-glyph">
            <Icon name="map" size={22} />
          </span>
          <span className="importhub-tile-name">Model</span>
          <span className="importhub-tile-sub">JSON, Excel or CSV — any reasonable shape</span>
        </button>
        <button className="importhub-tile" onClick={() => onFile("defs")}>
          <span className="importhub-tile-glyph">
            <Icon name="sidebar" size={22} />
          </span>
          <span className="importhub-tile-name">Definitions</span>
          <span className="importhub-tile-sub">Attribute descriptions</span>
        </button>
      </div>
    </Modal>
  );
}
