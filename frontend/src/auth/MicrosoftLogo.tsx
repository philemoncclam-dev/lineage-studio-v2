// Microsoft's four-square mark, inline.
//
// Inline rather than an icon package because it is the only vendor logo the
// app uses, and because Microsoft's brand guidance fixes these four colours —
// an icon set that themes or recolours its logos would quietly break that.

export function MicrosoftLogo({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 21 21"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}
