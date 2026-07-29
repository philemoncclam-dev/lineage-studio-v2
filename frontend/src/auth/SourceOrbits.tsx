// The sign-in backdrop: the systems this app draws lineage across, in orbit.
//
// It is decorative, and it is also the one-line pitch — a person landing here
// should see what Lineage Studio reaches before they read a word of prose.
// Fabric is first because it is the only one wired today; the rest are the
// estate this is being built for, and naming them is a promise the roadmap has
// to keep.
//
// Text chips rather than vendor logos, deliberately. Half of these have no mark
// we hold a licence to, and the alternative — hot-linking someone's CDN — puts a
// third-party request on the sign-in screen, where it is both a privacy leak and
// a thing that can fail while a user waits.
//
// `aria-hidden`: the names are repeated in the card's prose, so a screen reader
// gets them once, in a sentence, rather than as a ring of floating nouns.

import type { ReactNode } from 'react'
import { ExcelMark, FabricMark, OneLakeMark } from './SourceMarks'

interface Orbit {
  /** Ring diameter in px at full size; scaled down together on small screens. */
  size: number
  /** Seconds per revolution. Slower on the wider rings — a shared angular
      speed reads as one rigid object turning, not several independent ones. */
  duration: number
  /** Counter-clockwise. Alternating direction is what keeps the rings from
      looking like a single disc. */
  reverse?: boolean
  /** `mark` gives a round icon chip; without one the chip is a text pill. */
  chips: { label: string; angle: number; mark?: ReactNode }[]
}

const ORBITS: Orbit[] = [
  {
    size: 340,
    duration: 44,
    chips: [
      { label: 'Microsoft Fabric', angle: -50, mark: <FabricMark /> },
      { label: 'kdb+', angle: 130 },
    ],
  },
  {
    size: 520,
    duration: 60,
    reverse: true,
    chips: [
      { label: 'Yardi', angle: 25 },
      { label: 'Excel', angle: 205, mark: <ExcelMark /> },
    ],
  },
  {
    size: 700,
    duration: 78,
    chips: [
      { label: 'Advent Portfolio Exchange', angle: -105 },
      { label: 'OneLake', angle: 75, mark: <OneLakeMark /> },
    ],
  },
]

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
              <span
                className={chip.mark ? 'lg-chip lg-chip-mark' : 'lg-chip'}
                title={chip.label}
                style={{
                  animationDuration: `${orbit.duration}s`,
                  animationDirection: orbit.reverse ? 'normal' : 'reverse',
                  // Undo the spoke's own rotation, once and statically. The
                  // animation only cancels the ring's turning.
                  ['--spoke' as string]: `${-chip.angle}deg`,
                }}
              >
                {chip.mark ?? chip.label}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
