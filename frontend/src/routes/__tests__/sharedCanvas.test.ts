// The shared page must give the viewer the container shape it needs.
//
// This is a CSS assertion, which is unusual, and it is here because the bug it
// pins is INVISIBLE to every other kind of test: jsdom computes no layout, so a
// render test of the shared route passes just as happily with a collapsed
// canvas as with a working one. The failure was only visible in a browser —
// header on screen, model blank — and the model itself was fine.
//
// `.mv-host` takes its height from `flex: 1; min-height: 0` (modeling.css says
// so in its own comment: "height: 100% alone collapses to the content"). Put it
// in anything that is not a flex column and it collapses, `.mv-scroll` —
// absolutely positioned to its inset — gets zero height, and the canvas
// renders nothing at all.

import { describe, expect, it } from 'vitest'
// `?raw` rather than node:fs — this project's tsconfig does not pull in Node
// types for `src`, and the CSS is a Vite asset, so asking Vite for its text is
// both typed and resolved the same way the app resolves it.
import css from '../shared.css?raw'

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} is missing from shared.css`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('the shared-link canvas', () => {
  it('is a flex column, like the app shell the viewer normally sits in', () => {
    const rules = block('.sh-canvas')
    expect(rules).toMatch(/display:\s*flex/)
    expect(rules).toMatch(/flex-direction:\s*column/)
  })

  it('lets that column shrink, so a tall model cannot push the canvas off-screen', () => {
    // Without `min-height: 0` a flex item refuses to shrink below its content,
    // which is the other half of the same trap.
    expect(block('.sh-canvas')).toMatch(/min-height:\s*0/)
  })

  it('gives the page a definite height for that column to fill', () => {
    const rules = block('.sh-page')
    expect(rules).toMatch(/height:\s*100vh/)
    expect(rules).toMatch(/grid-template-rows:\s*auto 1fr/)
  })
})
