// Visual settings: user-tunable options that only affect how a model is
// presented (never its data). Persisted to localStorage and exposed through a
// context so any component can read them. useSettings() falls back to the
// defaults when no provider is mounted, so components (and their tests) render
// safely on their own.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  applyNodeStyle,
  NODE_STYLE_DEFAULT,
  NODE_PRESETS,
  type NodeStyle,
  type StylePreset,
} from "./nodeThemes";

export type Appearance = "light" | "dark";

export interface SettingsState {
  // Light or dark UI. Applied as data-theme on <html>.
  appearance: Appearance;
  // Composable node/edge look (colors, corners, shadow, header style, edges).
  // Presets in nodeThemes.ts set this all at once; individual knobs are tunable.
  nodeStyle: NodeStyle;
  // User-saved node-style presets, shown alongside the built-in ones. Each is a
  // full NodeStyle snapshot the user named from their current customization.
  customPresets: StylePreset[];
  // Show the per-type shape glyphs (Layer/Object/Group/Attribute) on canvas
  // nodes. Off → the glyphs are omitted and the labels left-align flush.
  showTypeIcons: boolean;
  // Show the type legend pinned at the bottom of the canvas.
  showLegend: boolean;
  // Show the dotted background grid behind the canvas.
  showBackgroundGrid: boolean;
  // Collapse the left activity rail to a thin strip that expands on hover,
  // reclaiming horizontal space for the canvas.
  autoHideRail: boolean;
}

export const DEFAULT_SETTINGS: SettingsState = {
  appearance: "light",
  nodeStyle: NODE_STYLE_DEFAULT,
  customPresets: [],
  showTypeIcons: true,
  showLegend: true,
  showBackgroundGrid: true,
  autoHideRail: false,
};

const KEY = "lineage:settings";
// Older builds stored just the light/dark choice under this key; honor it so
// signed-in users don't get their theme reset when settings first load.
const LEGACY_THEME_KEY = "lineage:theme";

function systemAppearance(): Appearance {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function load(): SettingsState {
  // First-visit default for appearance follows the OS preference.
  const base: SettingsState = { ...DEFAULT_SETTINGS, appearance: systemAppearance() };
  try {
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === "light" || legacy === "dark") base.appearance = legacy;
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<SettingsState> & { nodeTheme?: string };
    // Migrate the older `nodeTheme` preset id to the granular nodeStyle.
    let nodeStyle = base.nodeStyle;
    if (parsed.nodeStyle) {
      nodeStyle = { ...NODE_STYLE_DEFAULT, ...parsed.nodeStyle };
    } else if (parsed.nodeTheme) {
      nodeStyle = NODE_PRESETS.find((p) => p.id === parsed.nodeTheme)?.style ?? nodeStyle;
    }
    // Merge over defaults so new options added later get sensible values for
    // users with an older persisted blob.
    return { ...base, ...parsed, nodeStyle };
  } catch {
    return base;
  }
}

// Apply the presentation-affecting settings to the document root. Shared by the
// provider and the pre-render init below.
function applyGlobals(s: SettingsState): void {
  document.documentElement.setAttribute("data-theme", s.appearance);
  applyNodeStyle(s.nodeStyle);
}

// Call once before React renders so there's no flash of the wrong theme/palette.
export function initVisualSettings(): void {
  applyGlobals(load());
}

interface SettingsContextValue {
  settings: SettingsState;
  setSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  // Merge a partial patch into nodeStyle using a functional update, so several
  // rapid edits (before a re-render) all land instead of clobbering each other.
  patchNodeStyle: (patch: Partial<NodeStyle>) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  setSetting: () => {},
  patchNodeStyle: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SettingsState>(load);

  useEffect(() => {
    applyGlobals(settings);
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // storage full/blocked — settings just won't persist this session.
    }
  }, [settings]);

  const setSetting = useCallback(
    <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
      setSettings((s) => ({ ...s, [key]: value }));
    },
    []
  );

  const patchNodeStyle = useCallback((patch: Partial<NodeStyle>) => {
    setSettings((s) => ({ ...s, nodeStyle: { ...s.nodeStyle, ...patch } }));
  }, []);

  const value = useMemo(
    () => ({ settings, setSetting, patchNodeStyle }),
    [settings, setSetting, patchNodeStyle]
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
