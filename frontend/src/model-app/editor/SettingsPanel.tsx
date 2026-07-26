// Display settings dialog. A composable node style (presets that set
// everything at once, plus granular controls for corners, shadow, header
// style, edges, and per-type colors) + canvas/layout toggles. Everything reads
// and writes the shared settings store (see ../settings), persisted live.
import { useState } from "react";
import Modal from "./Modal";
import { useSettings, type SettingsState } from "../settings";
import {
  NODE_PRESETS,
  COLOR_FIELDS,
  EDGE_WIDTH_PX,
  matchPreset,
  type NodeStyle,
  type StylePreset,
  type Corners,
  type HeaderStyle,
  type EdgeWidth,
} from "../nodeThemes";
import { TypeGlyph } from "../ui/TypeGlyph";
import type { NodeType } from "../types";

// Node type → the matching color key on a NodeStyle.
const PREVIEW_TYPES: { type: NodeType; key: keyof NodeStyle }[] = [
  { type: "Layer", key: "layerColor" },
  { type: "Object", key: "objectColor" },
  { type: "Group", key: "groupColor" },
  { type: "Attribute", key: "attrColor" },
];

// Only the boolean-valued settings keys drive a switch.
type BooleanSettingKey = {
  [K in keyof SettingsState]: SettingsState[K] extends boolean ? K : never;
}[keyof SettingsState];

interface ToggleDef {
  key: BooleanSettingKey;
  label: string;
  help: string;
}

const SECTIONS: { title: string; toggles: ToggleDef[] }[] = [
  {
    title: "Canvas",
    toggles: [
      {
        key: "showTypeIcons",
        label: "Type icons",
        help: "Show the shape marker on each node. Off aligns labels flush left.",
      },
      {
        key: "showLegend",
        label: "Legend",
        help: "Pin the node-type key to the bottom of the canvas.",
      },
      {
        key: "showBackgroundGrid",
        label: "Background grid",
        help: "Show the dotted grid behind the canvas.",
      },
    ],
  },
  {
    title: "Layout",
    toggles: [
      {
        key: "autoHideRail",
        label: "Auto-hide the toolbar",
        help: "Collapse the left toolbar to a thin strip; reveal on hover.",
      },
    ],
  },
];

// Small labeled segmented control for a set of string choices.
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="settings-control-row">
      <span className="settings-control-label">{label}</span>
      <div className="settings-segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={`settings-segment${value === o.value ? " is-active" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// A color swatch that can be reset to "neutral" (empty string) — used by Edge
// and Outline, where "" means "follow the theme's default border/edge color".
function ClearableSwatch({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  const isCustom = value !== "";
  return (
    <label className={`settings-swatch${isCustom ? " is-custom" : ""}`} title={`${label} color`}>
      <input
        type="color"
        value={value || fallback}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} color`}
      />
      <span className="settings-swatch-label">{label}</span>
      {isCustom && (
        <button
          type="button"
          className="settings-swatch-reset"
          title={`Reset ${label.toLowerCase()} to default`}
          aria-label={`Reset ${label.toLowerCase()} to default`}
          onClick={(e) => {
            e.preventDefault();
            onChange("");
          }}
        >
          ×
        </button>
      )}
    </label>
  );
}

// Live mini-card that mirrors the current node style so tweaks are visible
// without leaving the dialog. Inline styles map the same knobs applyNodeStyle
// writes as CSS variables, kept self-contained so it always reflects `style`.
function NodePreview({ style }: { style: NodeStyle }) {
  const radius = style.corners === "flat" ? 3 : 10;
  const border = style.outlineColor || "var(--border)";
  const shadow = style.shadow ? "0 1px 3px rgba(0,0,0,0.12)" : "none";
  const obj = style.objectColor;

  const headerStyle: React.CSSProperties =
    style.headerStyle === "filled"
      ? { background: obj, color: "#fff" }
      : style.headerStyle === "tinted"
        ? { background: `color-mix(in srgb, ${obj} 18%, var(--surface))`, color: "var(--text)" }
        : style.headerStyle === "outline"
          ? { borderBottom: `1.5px solid ${obj}`, color: obj }
          : { color: "var(--text)" };

  return (
    <div className="settings-preview" aria-hidden>
      <div
        className="settings-preview-card"
        style={{ borderRadius: radius, border: `1px solid ${border}`, boxShadow: shadow }}
      >
        <div className="settings-preview-header" style={headerStyle}>
          <span className="type-glyph" style={{ color: style.headerStyle === "filled" ? "#fff" : obj }}>
            <TypeGlyph type="Object" size={12} />
          </span>
          Orders
        </div>
        {(["Group", "Attribute"] as NodeType[]).map((t) => (
          <div key={t} className="settings-preview-row">
            <span
              className="type-glyph"
              style={{ color: t === "Group" ? style.groupColor : style.attrColor }}
            >
              <TypeGlyph type={t} size={11} />
            </span>
            {t === "Group" ? "line_items" : "total"}
          </div>
        ))}
      </div>
      <svg className="settings-preview-edge" width="100%" height="14" aria-hidden>
        <line
          x1="0"
          y1="7"
          x2="100%"
          y2="7"
          stroke={style.edgeColor || "var(--edge)"}
          strokeWidth={EDGE_WIDTH_PX[style.edgeWidth]}
        />
      </svg>
    </div>
  );
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, setSetting, patchNodeStyle } = useSettings();
  const style = settings.nodeStyle;
  const customPresets = settings.customPresets;
  const [newName, setNewName] = useState("");

  // The active preset can be a built-in (by id) or one the user saved (by id).
  // Custom preset ids are prefixed "custom:" so they never collide with builtins.
  const eqStyle = (a: NodeStyle, b: NodeStyle) =>
    (Object.keys(a) as (keyof NodeStyle)[]).every((k) => a[k] === b[k]);
  const activePreset =
    matchPreset(style) ?? customPresets.find((p) => eqStyle(p.style, style))?.id ?? null;

  // Update one field of the node style (functional patch, so rapid successive
  // edits don't clobber each other).
  const setStyle = <K extends keyof NodeStyle>(key: K, value: NodeStyle[K]) =>
    patchNodeStyle({ [key]: value });

  const saveCurrentAsPreset = () => {
    const label = newName.trim();
    if (!label) return;
    const preset: StylePreset = {
      id: `custom:${Date.now()}`,
      label,
      blurb: "Saved style",
      style: { ...style },
    };
    setSetting("customPresets", [...customPresets, preset]);
    setNewName("");
  };

  const deletePreset = (id: string) =>
    setSetting("customPresets", customPresets.filter((p) => p.id !== id));

  return (
    <Modal title="Display settings" onClose={onClose}>
      <p className="modal-hint">
        Changes how models look for you — no data is altered, and settings apply to every model on this device.
      </p>

      {/* No Appearance control: light/dark is the host shell's decision, and
          the editor now renders in the shell's tokens. A second switch here
          used to write data-theme on <html> for the whole app — including the
          Fabric screens — and leave it there after you navigated away. */}

      {/* Presets: one click sets every node-style knob below. Built-ins first,
          then any the user has saved (deletable). */}
      <section className="settings-section">
        <h4 className="settings-section-title">Node style presets</h4>
        <div className="settings-theme-grid" role="radiogroup" aria-label="Node style preset">
          {[...NODE_PRESETS, ...customPresets].map((p) => {
            const custom = p.id.startsWith("custom:");
            return (
              <div key={p.id} className="settings-theme-cell">
                <button
                  type="button"
                  role="radio"
                  aria-checked={activePreset === p.id}
                  className={`settings-theme-card${activePreset === p.id ? " is-active" : ""}`}
                  onClick={() => setSetting("nodeStyle", p.style)}
                >
                  <span className="settings-theme-swatches">
                    {PREVIEW_TYPES.map(({ type, key }) => (
                      <span key={type} className="type-glyph" style={{ color: p.style[key] as string }}>
                        <TypeGlyph type={type} size={13} />
                      </span>
                    ))}
                  </span>
                  <span className="settings-theme-text">
                    <span className="settings-theme-name">{p.label}</span>
                    <span className="settings-theme-blurb">{p.blurb}</span>
                  </span>
                </button>
                {custom && (
                  <button
                    type="button"
                    className="settings-theme-delete"
                    title={`Delete "${p.label}"`}
                    aria-label={`Delete preset ${p.label}`}
                    onClick={() => deletePreset(p.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="settings-save-preset">
          <input
            type="text"
            className="settings-preset-name"
            placeholder="Name this style…"
            value={newName}
            maxLength={24}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveCurrentAsPreset()}
            aria-label="New preset name"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!newName.trim()}
            onClick={saveCurrentAsPreset}
          >
            Save current
          </button>
        </div>
      </section>

      {/* Granular customization — tweak any knob; the matching preset (if any)
          stays highlighted above, otherwise none is. */}
      <section className="settings-section">
        <h4 className="settings-section-title">Customize</h4>

        <NodePreview style={style} />

        <Segmented<Corners>
          label="Corners"
          value={style.corners}
          options={[
            { value: "rounded", label: "Rounded" },
            { value: "flat", label: "Flat" },
          ]}
          onChange={(v) => setStyle("corners", v)}
        />

        <Segmented<HeaderStyle>
          label="Header style"
          value={style.headerStyle}
          options={[
            { value: "plain", label: "Plain" },
            { value: "tinted", label: "Tinted" },
            { value: "filled", label: "Filled" },
            { value: "outline", label: "Outline" },
          ]}
          onChange={(v) => setStyle("headerStyle", v)}
        />

        <Segmented<EdgeWidth>
          label="Edge thickness"
          value={style.edgeWidth}
          options={[
            { value: "thin", label: "Thin" },
            { value: "medium", label: "Medium" },
            { value: "thick", label: "Thick" },
          ]}
          onChange={(v) => setStyle("edgeWidth", v)}
        />

        <label className="settings-row">
          <span className="settings-row-text">
            <span className="settings-row-label">Card shadow</span>
            <span className="settings-row-help">Lift cards off the canvas with a soft shadow</span>
          </span>
          <span className="ui-switch">
            <input
              type="checkbox"
              role="switch"
              checked={style.shadow}
              onChange={(e) => setStyle("shadow", e.target.checked)}
            />
            <span className="ui-switch-track" aria-hidden="true" />
          </span>
        </label>

        {/* Colors: per-type accents + edge color. */}
        <div className="settings-control-row">
          <span className="settings-control-label">Colors</span>
          <div className="settings-swatch-row">
            {COLOR_FIELDS.map(({ key, label }) => (
              <label key={key} className="settings-swatch" title={`${label} color`}>
                <input
                  type="color"
                  value={style[key] as string}
                  onChange={(e) => setStyle(key, e.target.value)}
                  aria-label={`${label} color`}
                />
                <span className="settings-swatch-label">{label}</span>
              </label>
            ))}
            <ClearableSwatch
              label="Edge"
              value={style.edgeColor}
              fallback="#c7c7cc"
              onChange={(v) => setStyle("edgeColor", v)}
            />
            <ClearableSwatch
              label="Outline"
              value={style.outlineColor}
              fallback="#d1d1d6"
              onChange={(v) => setStyle("outlineColor", v)}
            />
          </div>
        </div>
      </section>

      {SECTIONS.map((section) => (
        <section className="settings-section" key={section.title}>
          <h4 className="settings-section-title">{section.title}</h4>
          {section.toggles.map((t) => (
            <label className="settings-row" key={t.key}>
              <span className="settings-row-text">
                <span className="settings-row-label">{t.label}</span>
                <span className="settings-row-help">{t.help}</span>
              </span>
              <span className="ui-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings[t.key]}
                  onChange={(e) => setSetting(t.key, e.target.checked)}
                />
                <span className="ui-switch-track" aria-hidden="true" />
              </span>
            </label>
          ))}
        </section>
      ))}
    </Modal>
  );
}
