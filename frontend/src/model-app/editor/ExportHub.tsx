// Export hub: one centered dialog listing every export format as a tile,
// mirroring ImportHub's layout and interaction. Replaces the old rail
// popover list of plain buttons.
import { Icon, type IconName } from "../ui/Icon";
import Modal from "./Modal";
import type { Model } from "../types";
import { api } from "../api";
import { exportModelJson } from "../exportJson";
import { exportModelCsv } from "../exportCsv";
import { exportModelNarration } from "../exportNarration";
import { exportDictionaryMarkdown, exportDictionaryCsv } from "../exportDictionary";

interface Props {
  model: Model;
  onClose: () => void;
}

interface ExportTile {
  key: string;
  icon: IconName;
  name: string;
  description: string;
  run: (model: Model) => void;
}

const TILES: ExportTile[] = [
  {
    key: "xlsx",
    icon: "map",
    name: "Excel (.xlsx)",
    description: "Full model — nodes, edges, metadata",
    run: (m) => void api.exportModel(m),
  },
  {
    key: "json",
    icon: "export",
    name: "JSON",
    description: "Exact copy, re-importable",
    run: exportModelJson,
  },
  {
    key: "csv",
    icon: "link",
    name: "CSV lineage",
    description: "Source → target edges, one row each",
    run: exportModelCsv,
  },
  {
    key: "narration",
    icon: "sparkles",
    name: "Narration",
    description: "Plain-English lineage per attribute",
    run: exportModelNarration,
  },
  {
    key: "dict-md",
    icon: "sidebar",
    name: "Data dictionary (md)",
    description: "Readable attribute reference, markdown",
    run: exportDictionaryMarkdown,
  },
  {
    key: "dict-csv",
    icon: "filter",
    name: "Data dictionary (csv)",
    description: "Same reference, spreadsheet-ready",
    run: exportDictionaryCsv,
  },
];

export default function ExportHub({ model, onClose }: Props) {
  return (
    <Modal title="Export" onClose={onClose}>
      <div className="importhub-section">Choose a format</div>
      <div className="importhub-tiles">
        {TILES.map((t) => (
          <button
            key={t.key}
            className="importhub-tile"
            onClick={() => {
              t.run(model);
              onClose();
            }}
          >
            <span className="importhub-tile-glyph">
              <Icon name={t.icon} size={22} />
            </span>
            <span className="importhub-tile-name">{t.name}</span>
            <span className="importhub-tile-sub">{t.description}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
