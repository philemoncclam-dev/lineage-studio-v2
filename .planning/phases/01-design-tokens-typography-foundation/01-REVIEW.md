---
phase: 01-design-tokens-typography-foundation
reviewed: 2026-07-21T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - frontend/index.html
  - frontend/package.json
  - frontend/scripts/audit-tokens.mjs
  - frontend/src/App.tsx
  - frontend/src/main.tsx
  - frontend/src/styles/components.css
  - frontend/src/styles/tokens.css
  - frontend/src/tokens/canvasTokens.ts
  - frontend/src/views/definitions.css
  - frontend/src/views/graph.css
  - frontend/src/views/GraphView.tsx
  - frontend/src/views/purview.css
  - frontend/src/views/search.css
  - frontend/vite.config.ts
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the design-token foundation phase: `tokens.css` (tier-1/tier-2 OKLCH system +
typography/spacing), `components.css` (tier-3), the four view stylesheets, `canvasTokens.ts`
(the canvas token cache), `GraphView.tsx` (its first consumer), `audit-tokens.mjs`, and the
bootstrap/build wiring (`main.tsx`, `App.tsx`, `vite.config.ts`, `index.html`, `package.json`).

`audit-tokens.mjs` itself checks out: I ran both `node scripts/audit-tokens.mjs` and
`--self-test`. The self-test proves each of the five detectors fires on a known-bad fixture and
stays clean on the known-good one, and the OKLab/linear-sRGB matrices, WCAG luminance/contrast
formula, gamut clamp, and Machado/Oliveira/Fernandes CVD matrices all match their published
reference values on manual inspection. The real audit run against the shipped `tokens.css`
passes cleanly (0 failures across all 5 checks). Every `var(--…)` reference inside the reviewed
CSS files resolves to a token that is actually declared somewhere in `tokens.css` or
`components.css` — verified by cross-referencing every declaration against every usage
programmatically, not just by eye.

However, the phase left two real regressions live in the shipped code, both centered on the one
file (`GraphView.tsx`) that had to straddle the old ad hoc token names and the new tiered system:

1. Three DOM color swatches in `GraphView.tsx` still build CSS custom-property names by string
   interpolation from data values (`'bronze'`, `'silver'`, `'gold'`, `'notebook'`, `'workspace'`,
   `'accent'`) that were the *old* App.css token names. `tokens.css` never defines those bare
   names — only `--color-domain-bronze`, `--color-domain-silver`, etc. — so these three elements
   render with an unresolved custom property (i.e., no visible color) in the shipped build.
2. The canvas token cache's invalidation is wired to `data-theme` attribute mutations only.
   Nothing in the codebase ever sets `data-theme`, and `:root { color-scheme: light dark; }`
   means `light-dark()` — and therefore the *actual* live theme — already tracks the OS's
   `prefers-color-scheme` today, contradicting the stated "deliberately no prefers-color-scheme"
   design intent and leaving the canvas-drawn graph's colors stale relative to the rest of the
   DOM whenever the OS scheme flips while the app is open.

## Critical Issues

### CR-01: GraphView.tsx builds `var(--…)` names from data using retired token names — domain-color swatches render invisible

**File:** `frontend/src/views/GraphView.tsx:200`, `:228`, `:260`

**Issue:** Three places in `GraphView.tsx` build a CSS custom-property name at runtime from a
`ColorKey`/layer string and interpolate it straight into an inline style:

```tsx
// line 200 — hover-card category label
<div className="ct" style={{ color: `var(--${card.n.c})` }}>...

// line 228 — Mini (upstream/downstream) row indicator dot
<i style={{ background: `var(--${layer})` }} />

// line 260 — table-detail panel dot
<i className="td-dot" style={{ background: `var(--${table.c})` }} />
```

`card.n.c` / `table.c` are `ColorKey` values (`'bronze' | 'silver' | 'gold' | 'notebook' |
'workspace' | 'accent'`, from `model.tsx`), and `layer` is a raw layer string (`'bronze' |
'gold' | 'silver'`, also from `model.tsx`). These are the **old** App.css custom-property names
(`--bronze`, `--silver`, `--gold`, `--notebook`, `--workspace`, `--accent` — confirmed present in
the pre-phase `App.css` via `git show edd33d4:frontend/src/App.css`). The new `tokens.css`
retires all of them in favor of tier-2 semantics: `--color-domain-bronze`,
`--color-domain-silver`, `--color-domain-gold`, `--color-domain-notebook`,
`--color-domain-neutral` (not `--workspace`), and `--color-accent` (not bare `--accent`). None of
the six bare names these three call sites build exist anywhere in the shipped CSS (verified by
grep across `src/`).

The result: `var(--bronze)` / `var(--silver)` / `var(--gold)` / `var(--notebook)` /
`var(--workspace)` / `var(--accent)` all resolve to nothing, so `color`/`background` on these
three elements is effectively unset — the upstream/downstream mini-card dots, the table-detail
panel's colored dot, and the hover-card's category label color all lose the domain-color
identity that is the whole point of `--color-domain-*` (per THEME-05/THEME-06). This is a direct
visual regression introduced by this phase's token migration: `GraphCanvas`'s own `<canvas>` draw
calls in this same file were correctly migrated to go through
`DOMAIN_TOKEN`/`getCanvasTokens()` (see the diff replacing the old `cssVar(n.c)` helper), but
these three DOM-side call sites were missed.

**Fix:** Route these through the same `DOMAIN_TOKEN` map already imported in this file (or a
`layer -> tier-2 token name` map for the `Mini` rows), e.g.:

```tsx
import { DOMAIN_TOKEN_CSS_VAR } from '../tokens/canvasTokens' // or reuse DOMAIN_TOKEN + a name lookup

// or, simplest fix inline:
const domainVar = (c: ColorKey) => `var(--color-${c === 'workspace' ? 'domain-neutral' : c === 'accent' ? 'accent' : 'domain-' + c})`
```

or, more robustly, export a small `Record<ColorKey, string>` of literal CSS var *names* (not
`CanvasTokens` field keys) from `canvasTokens.ts` and use it at all three call sites plus the
`layer` lookup in `Mini`.

### CR-02: Canvas token cache invalidation never observes the theme mechanism actually driving the app today

**File:** `frontend/src/tokens/canvasTokens.ts:131-139`, `frontend/src/styles/tokens.css:180-198`, `frontend/src/views/GraphView.tsx:175-180`

**Issue:** `tokens.css` declares `color-scheme: light dark;` on `:root` (line 184), then
overrides it only inside `:root[data-theme="light"]` / `:root[data-theme="dark"]` (lines
192-198). Per the CSS Color Adjustment spec, when `color-scheme` is the unresolved `light dark`
(both keywords, no explicit override yet), the browser resolves it — and therefore every
`light-dark()` call inside every tier-1 primitive — using the user's OS-level
`prefers-color-scheme` preference. I grepped the entire `src/` tree for anything that ever calls
`setAttribute('data-theme', …)` or otherwise writes `data-theme`: there is none. So today, with
no theme-toggle UI shipped yet, the app's actual rendered theme is driven live by the OS
preference via this built-in `color-scheme` mechanism — directly contradicting this phase's own
stated design intent ("There is DELIBERATELY no `prefers-color-scheme`").

That's a design-intent problem on its own, but it also breaks the invalidation contract
`canvasTokens.ts` promises: `initCanvasTokenCache()` (called once in `main.tsx`) and
`GraphCanvas`'s own per-mount observer (`GraphView.tsx:179-180`) both watch **attribute
mutations on `data-theme`** exclusively (`attributeFilter: ['data-theme']`). Neither listens for
`matchMedia('(prefers-color-scheme: dark)')` changes. Because `data-theme` is never actually set
by anything, it can never mutate, so neither `MutationObserver` will ever fire from a live OS
theme change — yet the DOM/CSS *does* re-render live on that OS change today, since
`light-dark()` re-evaluates automatically. Concretely: if a user has the app open and their OS
flips from light to dark (a common real-world trigger — scheduled OS dark mode, manual OS
toggle), every DOM element restyles immediately via CSS, but `getCanvasTokens()`'s cached
snapshot — and therefore the `<canvas>`-rendered knowledge graph, including node fills, edge
strokes, and text — keeps rendering the old theme's colors until the `GraphCanvas` effect happens
to re-run for an unrelated reason (a drill-in/out, which remounts the effect via its
`[levelKey, level, onDrill]` deps). The canvas visibly desyncs from the surrounding chrome.

**Fix:** Either (a) stop declaring `color-scheme: light dark` at `:root` and instead pin it to a
single explicit scheme until a toggle exists (matching the stated "no prefers-color-scheme"
intent), or (b) if OS-driven theming is actually desired for Phase 1, additionally invalidate the
cache on `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)` in
`initCanvasTokenCache()` (and in `GraphCanvas`'s local observer, or better, have `GraphCanvas`
subscribe to a single shared "theme changed" event exported by `canvasTokens.ts` instead of
re-implementing its own `MutationObserver`):

```ts
export function initCanvasTokenCache(): () => void {
  if (!observer) {
    observer = new MutationObserver(() => invalidateCanvasTokens())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const onSchemeChange = () => invalidateCanvasTokens()
  mq.addEventListener('change', onSchemeChange)
  return () => {
    observer?.disconnect(); observer = null
    mq.removeEventListener('change', onSchemeChange)
  }
}
```

## Warnings

### WR-01: `@fontsource-variable/geist{,-mono}` ship as runtime dependencies but are never imported

**File:** `frontend/package.json:14-15`

**Issue:** `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` are listed under
`"dependencies"`. Neither package is imported anywhere in `src/` (confirmed by grep) — the fonts
are instead self-hosted manually via `@font-face` in `tokens.css` pointing at
`/fonts/geist-*-wght-normal.woff2` in `public/fonts/`, per the comment in `tokens.css:3-9`
("Vendored into `frontend/public/fonts/` by plan 01-01, task 2"). As shipped, these two packages
are pure dead weight in the production `node_modules`/lockfile — they were only ever needed to
source the `.woff2` files that got copied out.

**Fix:** Move both to `devDependencies` (they're a one-time vendoring source, not a runtime
dependency), or drop them entirely once the vendored files are committed and document how to
re-vendor them (e.g., a `scripts/vendor-fonts.mjs` note) instead of keeping the whole package
installed at runtime.

### WR-02: `audit:tokens` is not wired into `build`, `lint`, or any CI gate

**File:** `frontend/package.json:6-11`

**Issue:** `audit:tokens` (`node scripts/audit-tokens.mjs`) is a standalone script. `build` is
`tsc -b && vite build` and `lint` is `oxlint` — neither invokes the token audit. A future edit
that reintroduces a contrast failure, a channel collision, or an unparseable token value will
build and lint cleanly and only get caught if a human remembers to run `npm run audit:tokens` by
hand. This defeats a good part of the audit script's purpose as a regression guard.

**Fix:** Chain it into an existing gate, e.g. `"build": "npm run audit:tokens && tsc -b && vite build"`,
or add it as a dedicated CI step alongside `lint`.

### WR-03: Two independent `MutationObserver`s watch the same `data-theme` attribute, undocumented as a coupled pair

**File:** `frontend/src/main.tsx:11`, `frontend/src/tokens/canvasTokens.ts:131-139`, `frontend/src/views/GraphView.tsx:175-180`

**Issue:** `main.tsx`'s comment says the observer is "Wired once, before the first render — not
per component, not per render," implying `canvasTokens.ts`'s bootstrap-level observer is *the*
single invalidation point. In practice `GraphCanvas` also instantiates its own
`MutationObserver` on the exact same target/attribute filter on every mount (and every
`levelKey`/`level` change), because the bootstrap observer only nulls the module-level `cached`
value — it can't reach into `GraphCanvas`'s already-hoisted `tokensRef.current` snapshot. That
second observer is currently load-bearing (removing it would leave `tokensRef` stale forever
after a real `data-theme` change), but nothing states this dependency explicitly, and the
`main.tsx` comment reads as though it's unnecessary. A future contributor "simplifying" by
deleting `GraphCanvas`'s local observer (reasoning that the global one already exists) would
silently reintroduce a stale-canvas bug.

**Fix:** Document the coupling explicitly at both sites, or better, have `canvasTokens.ts` expose
a `subscribeToThemeChange(cb)` helper backed by a single shared observer, so per-consumer draw
loops register a callback instead of standing up their own `MutationObserver` instance.

## Info

### IN-01: `readTokensFromDOM()` throws with no error boundary anywhere in the app

**File:** `frontend/src/tokens/canvasTokens.ts:96-111`, `frontend/src/App.tsx`

**Issue:** `readTokensFromDOM()` deliberately throws if any mapped token resolves empty — a
reasonable fail-fast choice for catching typos during development. But `App.tsx` has no
`ErrorBoundary`, so if this throws at runtime (e.g., a future token rename in `tokens.css` that
misses one consumer, or a test environment like jsdom that doesn't compute values from an
imported stylesheet), the *entire* app crashes to a white screen on first draw of the graph view
rather than degrading a single swatch.

**Fix:** Not necessarily wrong for Phase 1, but worth a top-level `ErrorBoundary` around `<App />`
before this pattern gets more consumers in Phase 3/4 (xyflow, sigma.js), so a token drift becomes
a visible, scoped error rather than a full-app crash.

---

_Reviewed: 2026-07-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
