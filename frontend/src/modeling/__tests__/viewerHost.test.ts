// The rule every host of a canvas has to follow, checked statically.
//
// Both canvases in this app size themselves with `flex: 1; min-height: 0` and
// hold absolutely-positioned content — they have no height of their own. So the
// element each is mounted into must be a flex column, or the canvas lays out at
// zero height and the page renders blank with no error, nothing in the console,
// and a perfectly healthy fetch. That is exactly how /fabric/lineage shipped
// broken the first time.
//
// jsdom has no layout engine, so this cannot be caught by rendering. Reading
// the stylesheets is the next best thing: it pins the contract at the point a
// new host is added, which is the moment it gets forgotten.

// The stylesheets are pulled in with Vite's `?raw`, NOT `node:fs`. This file is
// compiled by `tsc -b` along with the app, and the app's `types` field is
// `["vite/client"]` only — so Node builtins are untyped here and importing them
// fails the production build while passing a local incremental one.
import { describe, expect, it } from 'vitest'
import fabricCss from '../../views/fabric.css?raw'
import sharedCss from '../../routes/shared.css?raw'
import modelingCss from '../modeling.css?raw'
import fabricLineageCss from '../../views/fabricLineage.css?raw'

/** The declarations inside one rule, by exact selector. */
function block(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

/**
 * Every element a self-sizing canvas is mounted into, as
 * `[label, stylesheet, selector]`. Add a row when you mount one somewhere new —
 * that is the point.
 *
 * Two canvases qualify: `.mv-host` (the Modeling viewer) and `.fl-wrap` (the
 * Fabric lineage canvas). Both size with `flex: 1; min-height: 0` and hold
 * absolutely-positioned content, so both are invisible inside a block parent.
 */
const HOSTS: [string, string, string][] = [
  ['fabric workspace lineage', fabricCss, '.fx-lineage-canvas'],
  ['a shared model', sharedCss, '.sh-canvas'],
]

describe('hosts of a self-sizing canvas', () => {
  it.each([
    ['.mv-host', modelingCss],
    ['.fl-wrap', fabricLineageCss],
  ])('%s still relies on flex rather than a height of its own', (selector, css) => {
    // If this changes, the rule below stops being the thing that matters and
    // this whole file needs rethinking.
    const rule = block(css, selector)
    expect(rule).toContain('flex: 1')
    expect(rule).toContain('min-height: 0')
  })

  it.each(HOSTS)('%s is a flex column', (_label, sheet, selector) => {
    const rule = block(sheet, selector)
    expect(rule).toContain('display: flex')
    expect(rule).toContain('flex-direction: column')
    // A percentage height here is the specific bug: the shell canvas has no
    // definite height, so it resolves to auto and collapses.
    expect(rule).not.toContain('height: 100%')
  })
})
