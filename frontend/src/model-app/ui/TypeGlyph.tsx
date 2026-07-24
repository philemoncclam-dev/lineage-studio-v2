import type { NodeType } from "../types";

// Small shape marker for a node type, so the four types read as distinct
// glyphs — not just colored squares. The shapes echo the hierarchy:
//   Layer     → stacked bands (the horizontal strips a layer is on canvas)
//   Object    → a hollow container box (it holds groups)
//   Group     → a table grid (a table of columns)
//   Attribute → a solid dot (a single leaf field)
// Rendered in currentColor, so callers set the type accent via `color`.
export function TypeGlyph({
  type,
  size = 11,
  className,
}: {
  type: NodeType;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      className={className}
      aria-hidden="true"
      style={{ flex: "0 0 auto", display: "block" }}
    >
      {type === "Layer" && (
        <g fill="currentColor">
          <rect x="1.5" y="2" width="9" height="2" rx="1" />
          <rect x="1.5" y="5" width="9" height="2" rx="1" />
          <rect x="1.5" y="8" width="9" height="2" rx="1" />
        </g>
      )}
      {type === "Object" && (
        <rect
          x="1.7"
          y="1.7"
          width="8.6"
          height="8.6"
          rx="2.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      )}
      {type === "Group" && (
        <g fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.7" y="1.7" width="8.6" height="8.6" rx="1.6" />
          <line x1="1.7" y1="6" x2="10.3" y2="6" />
          <line x1="6" y1="1.7" x2="6" y2="10.3" />
        </g>
      )}
      {type === "Attribute" && <circle cx="6" cy="6" r="2.7" fill="currentColor" />}
    </svg>
  );
}
