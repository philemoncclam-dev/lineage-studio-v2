// The sign-in backdrop: the systems this app draws lineage across, in orbit.
//
// It is decorative, and it is also the one-line pitch — a person landing here
// should see what Lineage Studio reaches before they read a word of prose.
//
// **Logos come from `public/logos/`, and the file name is the whole contract.**
// Drop `excel.svg` in there and the Excel chip becomes the real mark, with no
// code change. Nothing is committed for us, because these are other companies'
// trademarks: a logo redrawn from memory is subtly wrong, and a subtly wrong
// logo is a false claim about someone else's brand. Hot-linking a CDN — what
// the component this came from does — is worse again: a third-party request on
// the one screen where a person is deciding whether to trust this app.
//
// So each chip degrades: dropped file → our own simplified mark, for the three
// that have one → the system's name as a pill. All three states are fine to
// ship, which is why the folder can stay empty.
//
// `aria-hidden`: this is scenery. The one thing on this screen that does
// something is the sign-in button.

import { useState, type ReactNode } from 'react'
import { ExcelMark, FabricMark, OneLakeMark } from './SourceMarks'

interface Chip {
  label: string
  angle: number
  /** Basename in `public/logos/`, without extension. See that folder's README. */
  file: string
  /** Shown until a real logo is dropped in; without one the chip is a text pill. */
  fallback?: ReactNode
}

interface Orbit {
  /** Ring diameter in px at full size; scaled down together on small screens. */
  size: number
  /** Seconds per revolution. Slower on the wider rings — a shared angular
      speed reads as one rigid object turning, not several independent ones. */
  duration: number
  /** Counter-clockwise. Alternating direction is what keeps the rings from
      looking like a single disc. */
  reverse?: boolean
  chips: Chip[]
}

const ORBITS: Orbit[] = [
  {
    size: 340,
    duration: 44,
    chips: [
      { label: 'Microsoft Fabric', angle: -50, file: 'fabric', fallback: <FabricMark /> },
      { label: 'kdb+', angle: 130, file: 'kdb' },
    ],
  },
  {
    size: 520,
    duration: 60,
    reverse: true,
    chips: [
      { label: 'Yardi', angle: 25, file: 'yardi' },
      { label: 'Excel', angle: 205, file: 'excel', fallback: <ExcelMark /> },
    ],
  },
  {
    size: 700,
    duration: 78,
    chips: [
      { label: 'Advent Portfolio Exchange', angle: -105, file: 'apx' },
      { label: 'OneLake', angle: 75, file: 'onelake', fallback: <OneLakeMark /> },
    ],
  },
]

/**
 * One chip: a dropped-in logo, our own mark, or the name — and the right SHAPE
 * for whichever it turned out to be.
 *
 * Shape and content are decided together here because only this component knows
 * which one resolved. A circle is right for a mark and wrong for "Advent
 * Portfolio Exchange", which is either cropped by it or makes a circle the size
 * of a sentence.
 *
 * Tries SVG, then PNG, then gives up. `onError` walking a list is what makes
 * "drop a file in and it appears" work with no build step and no manifest to
 * keep in sync. The cost is a 404 in the console for each name with no file
 * yet, which is the right trade for a folder anyone can add to.
 */
function ChipBody({ chip, style }: { chip: Chip; style: React.CSSProperties }) {
  const candidates = [`/logos/${chip.file}.svg`, `/logos/${chip.file}.png`]
  const [attempt, setAttempt] = useState(0)
  // Measured from the file, not declared per logo: a brand kit gives you a
  // square app icon or a wide wordmark and you find out which when you open it.
  // Reading `naturalWidth` means dropping either kind in just works.
  const [wide, setWide] = useState(false)

  const exhausted = attempt >= candidates.length
  // Round whenever the content is a mark — a dropped file, or our own drawing.
  const round = !exhausted || Boolean(chip.fallback)

  const shape = !round ? '' : wide ? ' lg-chip-wordmark' : ' lg-chip-mark'

  return (
    <span className={`lg-chip${shape}`} title={chip.label} style={style}>
      {exhausted ? (
        chip.fallback ?? chip.label
      ) : (
        <img
          className="lg-logo"
          src={candidates[attempt]}
          alt=""
          onError={() => setAttempt((n) => n + 1)}
          onLoad={(e) => {
            const img = e.currentTarget
            // A wordmark squeezed into a circle is either cropped or shrunk to
            // an illegible smudge. Past 1.6:1 it gets a pill instead.
            setWide(img.naturalWidth / (img.naturalHeight || 1) > 1.6)
          }}
        />
      )}
    </span>
  )
}

export function SourceOrbits() {
  return (
    <div className="lg-orbits" aria-hidden="true">
      {ORBITS.map((orbit) => (
        <div
          key={orbit.size}
          className="lg-ring"
          style={{
            width: orbit.size,
            height: orbit.size,
            // The ring itself turns; each chip counter-turns by the same
            // duration so its text stays upright all the way round.
            animationDuration: `${orbit.duration}s`,
            animationDirection: orbit.reverse ? 'reverse' : 'normal',
          }}
        >
          {orbit.chips.map((chip) => (
            <div
              key={chip.label}
              className="lg-spoke"
              style={{ transform: `rotate(${chip.angle}deg)` }}
            >
              <ChipBody
                chip={chip}
                style={{
                  animationDuration: `${orbit.duration}s`,
                  animationDirection: orbit.reverse ? 'normal' : 'reverse',
                  // Undo the spoke's own rotation, once and statically. The
                  // animation only cancels the ring's turning.
                  ['--spoke' as string]: `${-chip.angle}deg`,
                } as React.CSSProperties}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
