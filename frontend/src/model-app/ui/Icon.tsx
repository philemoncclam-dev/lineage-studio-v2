// Apple Human Interface Guidelines–style icon set.
//
// These are NOT Apple's SF Symbols (that font is licensed for Apple-platform
// apps only and can't be redistributed in a web app). Instead these are
// hand-drawn SVGs in the same visual language: a 24×24 grid, a single
// consistent stroke weight, round line caps/joins, and `currentColor` so they
// inherit text color. Sizing follows the em box, so an icon matches the font
// size of whatever it sits next to (the rail buttons, the theme toggle, etc.).
//
// To add a symbol: add a `<path>`/shape entry to PATHS keyed by a name, then
// pass that name to <Icon />.

import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "home"
  | "info"
  | "history"
  | "search"
  | "sidebar"
  | "filter"
  | "tag"
  | "check"
  | "plus"
  | "map"
  | "link"
  | "tidy"
  | "import"
  | "export"
  | "undo"
  | "redo"
  | "sun"
  | "moon"
  | "chevronRight"
  | "chevronDown"
  | "edit"
  | "checkmark"
  | "warning"
  | "arrowRight"
  | "arrowDown"
  | "arrowUpLeft"
  | "sparkles"
  | "target"
  | "settings";

// Each entry is the inner geometry of a 24×24 symbol, stroked (never filled)
// to mirror SF Symbols' default "monoline" weight.
const PATHS: Record<IconName, ReactNode> = {
  // house
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  // info.circle
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.75v.01" />
    </>
  ),
  // arrow.counterclockwise.clock (history)
  history: (
    <>
      <path d="M4.5 9A8 8 0 1 1 4 12" />
      <path d="M4.5 4.5V9H9" />
      <path d="M12 8.5V12l2.5 1.5" />
    </>
  ),
  // magnifyingglass
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 20 20" />
    </>
  ),
  // sidebar.right (details panel)
  sidebar: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M14.5 5v14" />
    </>
  ),
  // line.3.horizontal.decrease (filter)
  filter: (
    <>
      <path d="M4 7h16" />
      <path d="M6.5 12h11" />
      <path d="M9.5 17h5" />
    </>
  ),
  // tag
  tag: (
    <>
      <path d="M4 4h7l9 9-7 7-9-9V4z" />
      <path d="M8 8v.01" />
    </>
  ),
  // checkmark.circle
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.25 12.25 11 15l5-6" />
    </>
  ),
  // plus
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  // arrow.left.arrow.right (map/reconcile)
  map: (
    <>
      <path d="M7 8h13m-3-3 3 3-3 3" />
      <path d="M17 16H4m3 3-3-3 3-3" />
    </>
  ),
  // link
  link: (
    <>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M10.5 6.5 12 5a4 4 0 0 1 5.5 5.5L16 12" />
      <path d="M13.5 17.5 12 19a4 4 0 0 1-5.5-5.5L8 12" />
    </>
  ),
  // arrow.up.arrow.down (tidy/auto-layout)
  tidy: (
    <>
      <path d="M7.5 4v16m-3-3 3 3 3-3" />
      <path d="M16.5 20V4m-3 3 3-3 3 3" />
    </>
  ),
  // square.and.arrow.down (import)
  import: (
    <>
      <path d="M12 4v10m-3.5-3.5L12 14l3.5-3.5" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </>
  ),
  // square.and.arrow.up (export)
  export: (
    <>
      <path d="M12 20V10m-3.5 3.5L12 10l3.5 3.5" />
      <path d="M5 9V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
    </>
  ),
  // arrow.uturn.backward (undo)
  undo: (
    <>
      <path d="M8 8H15a5 5 0 0 1 0 10h-4" />
      <path d="M8 8 4.5 8m3.5 0V4.5m-3.5 3.5L8 11.5" />
    </>
  ),
  // arrow.uturn.forward (redo)
  redo: (
    <>
      <path d="M16 8H9a5 5 0 0 0 0 10h4" />
      <path d="M16 8h3.5m-3.5 0V4.5m3.5 3.5L16 11.5" />
    </>
  ),
  // sun.max
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" />
    </>
  ),
  // moon
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  // chevron.right (disclosure, collapsed)
  chevronRight: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  // chevron.down (disclosure, expanded)
  chevronDown: <path d="M5.5 9.5 12 16l6.5-6.5" />,
  // pencil
  edit: (
    <>
      <path d="M4 20h4L18.7 9.3a2.12 2.12 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </>
  ),
  // checkmark (plain, inline)
  checkmark: <path d="M5 12.5 9.5 17 19 7" />,
  // exclamationmark.triangle
  warning: (
    <>
      <path d="M12 4 21 19.5H3z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.5v.01" />
    </>
  ),
  // arrow.right
  arrowRight: <path d="M4 12h14m-5-5 5 5-5 5" />,
  // arrow.down
  arrowDown: <path d="M12 4v14m-5-5 5 5 5-5" />,
  // arrow.up.left
  arrowUpLeft: <path d="M17 17 7 7m0 0h6m-6 0v6" />,
  // sparkles
  sparkles: (
    <>
      <path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z" />
      <path d="M18 15.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
    </>
  ),
  // target / scope
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 11.9v.01" />
    </>
  ),
  // gearshape (settings)
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.4M12 19v2.4M21.4 12H19M5 12H2.6M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7M18.6 18.6l-1.7-1.7M7.1 7.1 5.4 5.4" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Pixel size; defaults to "1em" so it tracks surrounding font size. */
  size?: number | string;
}

export function Icon({ name, size = "1em", className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `app-icon ${className}` : "app-icon"}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
