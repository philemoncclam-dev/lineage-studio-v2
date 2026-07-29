// Marks for the sign-in orbits.
//
// Drawn here rather than fetched: the component this came from hot-links a
// third-party CDN, which puts someone else's server on the one screen where a
// user is deciding whether to trust us, and gives it a chance to hang while
// they wait. These are a few hundred bytes of inline SVG with no network at all.
//
// **They are our own simplified marks, not official brand assets.** Each one is
// a recognisable shape in the product's own colour — Excel's green tile,
// Fabric's woven strands, OneLake's droplet over layers — and none is traced
// from a trademarked file we have no licence to redistribute. If the real
// assets are ever licensed, they drop in here and nothing else changes.
//
// The three systems with no mark here (Yardi, Advent Portfolio Exchange, kdb+)
// stay as text chips. Inventing a logo for a company is worse than naming it:
// a wrong mark is a false claim about someone else's brand, and a name is just
// true.

interface MarkProps {
  size?: number
}

/** Microsoft Fabric — the woven strands, in its teal-to-blue range. */
export function FabricMark({ size = 22 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lg-fabric" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3ba7d6" />
          <stop offset="100%" stopColor="#1e5fa8" />
        </linearGradient>
      </defs>
      <g fill="url(#lg-fabric)">
        <rect x="3" y="3" width="4.6" height="18" rx="2.3" opacity="0.95" />
        <rect x="9.7" y="3" width="4.6" height="13" rx="2.3" opacity="0.75" />
        <rect x="16.4" y="3" width="4.6" height="8" rx="2.3" opacity="0.55" />
      </g>
    </svg>
  )
}

/** Excel — the green tile with its X. */
export function ExcelMark({ size = 22 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="19" height="19" rx="3.2" fill="#1d7044" />
      <path
        d="M8 7.5l3.9 4.5L8 16.5h2.8l2.5-3 2.5 3H18.6L14.7 12l3.9-4.5H15.8l-2.5 3-2.5-3z"
        fill="#fff"
      />
    </svg>
  )
}

// The OneLake droplet lived here and is gone: it was a shape invented for a
// product whose real mark we do not have, and it read as exactly that. The
// lesson is the one at the top of this file — when there is no asset, a name is
// honest and a drawing is a guess wearing a brand's authority.
