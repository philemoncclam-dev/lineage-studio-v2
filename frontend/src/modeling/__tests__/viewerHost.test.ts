// The rule every host of ModelViewer has to follow, checked statically.
//
// `.mv-host` sizes itself with `flex: 1; min-height: 0` — it has no height of
// its own and everything inside it is absolutely positioned. So its PARENT must
// be a flex column, or the canvas lays out at zero height and the page renders
// blank with no error, nothing in the console, and a perfectly healthy fetch.
// That is exactly how /fabric/lineage shipped broken.
//
// jsdom has no layout engine, so this cannot be caught by rendering. Reading
// the stylesheets is the next best thing: it pins the contract at the point a
// new host is added, which is the moment it gets forgotten.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** The declarations inside one rule, by exact selector. */
function block(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

/**
 * Every element ModelViewer is mounted into, as `[stylesheet, selector]`.
 * Add a row here when you mount it somewhere new — that is the point.
 */
const HOSTS: [string, string][] = [
  ['../../views/fabric.css', '.fx-lineage-canvas'],
  ['../../routes/shared.css', '.sh-canvas'],
]

describe('hosts of ModelViewer', () => {
  it('mv-host still relies on flex rather than a height of its own', () => {
    // If this changes, the rule below stops being the thing that matters and
    // this whole file needs rethinking.
    const mv = block(read('../modeling.css'), '.mv-host')
    expect(mv).toContain('flex: 1')
    expect(mv).toContain('min-height: 0')
  })

  it.each(HOSTS)('%s %s is a flex column', (sheet, selector) => {
    const rule = block(read(sheet), selector)
    expect(rule).toContain('display: flex')
    expect(rule).toContain('flex-direction: column')
    // A percentage height here is the specific bug: the shell canvas has no
    // definite height, so it resolves to auto and collapses.
    expect(rule).not.toContain('height: 100%')
  })
})
