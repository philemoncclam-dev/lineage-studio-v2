// Node style: the composable look of the canvas (colors, corners, shadow,
// header treatment, edges). Individual knobs are stored in settings and can be
// tuned freely; the presets below are just starting bundles that set them all
// at once.
//
// How it's applied: applyNodeStyle() writes CSS variables and a
// `data-header-style` attribute onto :root, which the base rules and the
// header-style blocks in App.css consume. This keeps the whole look
// data-driven from one place.

export type Corners = "rounded" | "flat";
export type HeaderStyle = "plain" | "tinted" | "filled" | "outline";
export type EdgeWidth = "thin" | "medium" | "thick";

export interface NodeStyle {
  layerColor: string;
  objectColor: string;
  groupColor: string;
  attrColor: string;
  // "" means use the theme's neutral edge color (var(--edge)).
  edgeColor: string;
  // Border color around the whole node card. "" means the theme's neutral
  // border (var(--border)).
  outlineColor: string;
  corners: Corners;
  shadow: boolean;
  headerStyle: HeaderStyle;
  edgeWidth: EdgeWidth;
}

// Per-type color knobs, in display order — shared by the settings color inputs.
export const COLOR_FIELDS: { key: keyof NodeStyle; label: string }[] = [
  { key: "layerColor", label: "Layer" },
  { key: "objectColor", label: "Object" },
  { key: "groupColor", label: "Group" },
  { key: "attrColor", label: "Attribute" },
];

export const EDGE_WIDTH_PX: Record<EdgeWidth, string> = {
  thin: "1.4",
  medium: "1.9",
  thick: "2.6",
};

export const NODE_STYLE_DEFAULT: NodeStyle = {
  layerColor: "#6e7b8f",
  objectColor: "#4a90e2",
  groupColor: "#5aa9a0",
  attrColor: "#8e8e93",
  edgeColor: "",
  outlineColor: "",
  corners: "rounded",
  shadow: true,
  headerStyle: "plain",
  edgeWidth: "medium",
};

export interface StylePreset {
  id: string;
  label: string;
  blurb: string;
  style: NodeStyle;
}

export const NODE_PRESETS: StylePreset[] = [
  {
    id: "classic",
    label: "Classic",
    blurb: "Cards with subtle borders",
    style: { ...NODE_STYLE_DEFAULT },
  },
  {
    id: "soft",
    label: "Soft",
    blurb: "Rounded, tinted headers",
    style: {
      layerColor: "#8b7fb0",
      objectColor: "#5b8def",
      groupColor: "#3fb0a3",
      attrColor: "#9aa0a6",
      edgeColor: "",
      outlineColor: "",
      corners: "rounded",
      shadow: true,
      headerStyle: "tinted",
      edgeWidth: "thick",
    },
  },
  {
    id: "blueprint",
    label: "Blueprint",
    blurb: "Flat schematic outlines",
    style: {
      layerColor: "#3b5bdb",
      objectColor: "#1c7ed6",
      groupColor: "#1098ad",
      attrColor: "#4263eb",
      edgeColor: "#1c7ed6",
      outlineColor: "#1c7ed6",
      corners: "flat",
      shadow: false,
      headerStyle: "outline",
      edgeWidth: "thin",
    },
  },
  {
    id: "bold",
    label: "Bold",
    blurb: "Filled color headers",
    style: {
      layerColor: "#7048e8",
      objectColor: "#2f6bff",
      groupColor: "#0ca678",
      attrColor: "#f59f00",
      edgeColor: "",
      outlineColor: "",
      corners: "rounded",
      shadow: true,
      headerStyle: "filled",
      edgeWidth: "thick",
    },
  },
];

// Which preset (if any) the current style exactly matches — used to highlight
// the active preset card while still allowing free customization.
export function matchPreset(style: NodeStyle): string | null {
  const eq = (a: NodeStyle, b: NodeStyle) =>
    (Object.keys(a) as (keyof NodeStyle)[]).every((k) => a[k] === b[k]);
  return NODE_PRESETS.find((p) => eq(p.style, style))?.id ?? null;
}

// Write the whole style onto :root as CSS variables + a header-style attribute.
export function applyNodeStyle(s: NodeStyle): void {
  const root = document.documentElement;
  root.style.setProperty("--t-layer", s.layerColor);
  root.style.setProperty("--t-object", s.objectColor);
  root.style.setProperty("--t-group", s.groupColor);
  root.style.setProperty("--t-attr", s.attrColor);
  root.style.setProperty("--edge-color", s.edgeColor || "var(--edge)");
  root.style.setProperty("--node-outline", s.outlineColor || "var(--border)");
  root.style.setProperty("--edge-width", EDGE_WIDTH_PX[s.edgeWidth]);
  root.style.setProperty("--node-radius", s.corners === "flat" ? "3px" : "var(--r-lg)");
  root.style.setProperty("--node-shadow", s.shadow ? "var(--sh-2)" : "none");
  root.style.setProperty("--node-shadow-hover", s.shadow ? "var(--sh-3)" : "none");
  root.setAttribute("data-header-style", s.headerStyle);
}
