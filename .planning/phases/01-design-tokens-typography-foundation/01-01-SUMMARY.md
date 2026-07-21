---
phase: 01-design-tokens-typography-foundation
plan: 01
subsystem: ui
tags: [tailwindcss, vite, fontsource, geist, css-tokens, typography]

# Dependency graph
requires: []
provides:
  - "frontend/src/styles/tokens.css as the app's single CSS entry point (Tailwind v4 @import, two @font-face blocks, @theme tokens, base reset)"
  - "Self-hosted, preloaded Geist Variable / Geist Mono Variable fonts under a stable /fonts/ URL identical in dev and production"
  - "Four-step type ramp (text-micro/base/heading/display), eight 4px-multiple spacing steps, four radius tokens"
  - "Tailwind v4 wired into vite.config.ts with no PostCSS config"
affects: [01-02-color-tokens, 01-03-canvas-token-bridge, 01-04-component-tokens, 01-05-verification]

# Tech tracking
tech-stack:
  added: ["tailwindcss@4.3.3", "@tailwindcss/vite@4.3.3", "@fontsource-variable/geist@5.3.0", "@fontsource-variable/geist-mono@5.3.0"]
  patterns:
    - "Fonts vendored into public/ (not imported from Fontsource's own CSS) so the preload href and @font-face src are the same non-hashed URL in dev and prod"
    - "Tailwind v4 paired-modifier type tokens (--text-X plus --text-X--line-height/--letter-spacing) instead of separate line-height utilities"
    - "Single data-theme/color-scheme theme mechanism — no prefers-color-scheme media query anywhere in the token layer"

key-files:
  created:
    - frontend/src/styles/tokens.css
    - frontend/public/fonts/geist-latin-wght-normal.woff2
    - frontend/public/fonts/geist-mono-latin-wght-normal.woff2
  modified:
    - frontend/package.json
    - frontend/package-lock.json
    - frontend/vite.config.ts
    - frontend/index.html
    - frontend/src/main.tsx
  deleted:
    - frontend/src/index.css

key-decisions:
  - "Vendored the two latin variable woff2 files into frontend/public/fonts/ rather than importing Fontsource's own CSS, per the plan's flagged assumption 1 — keeps the preload href and @font-face src byte-identical across dev and a production build"
  - "unicode-range on both @font-face blocks copied verbatim from Fontsource's own latin.css split (U+0000-00FF plus a small extended set), which deliberately excludes U+2318 so the command-key glyph falls through to the generic fallback stack instead of tofu"
  - "Left a placeholder comment in the @theme block for plan 01-02's colour tokens instead of guessing tier-1/tier-2 colour names"

requirements-completed: [DS-01, DS-03, DS-04, DS-06, THEME-02]

coverage:
  - id: D1
    description: "Tailwind v4 installed and wired into the Vite build via the official plugin, no PostCSS config"
    requirement: "DS-01"
    verification:
      - kind: unit
        ref: "node -e check on vite.config.ts for @tailwindcss/vite + tailwindcss(); npm run build"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both Geist variable-weight woff2 families vendored byte-identical into frontend/public/fonts/ and preloaded from index.html at a stable, non-hashed URL"
    requirement: "DS-06"
    verification:
      - kind: unit
        ref: "cmp against node_modules originals; grep -c rel=\"preload\" index.html == 2; grep -c node_modules index.html == 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "tokens.css declares both self-hosted families with font-display: swap and a matching Fontsource latin unicode-range, replacing index.css/App.css as the single CSS entry point"
    requirement: "DS-06"
    verification:
      - kind: unit
        ref: "grep -cE '^\\s*@font-face' tokens.css == 2; grep -c 'font-display: *swap' tokens.css == 2; node -e URL-match check between tokens.css url() and index.html preload href"
        status: pass
    human_judgment: false
  - id: D4
    description: "Exactly four font-size tokens (11/13/18/22px) and eight 4px-multiple spacing tokens declared in @theme"
    requirement: "DS-03"
    verification:
      - kind: unit
        ref: "grep -oE '--text-(micro|base|heading|display): *[0-9]+px' | wc -l == 4; awk spacing-multiple-of-4 check exits 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "Radius tokens (card/input/control/pill), border-width and row-height density primitives declared"
    requirement: "DS-04"
    verification: []
    human_judgment: true
    rationale: "No automated check distinguishes 'radius tokens exist with correct values' from an arbitrary CSS custom property — visually inspected against 01-UI-SPEC.md's Radius & Border Tokens table but not independently test-covered"
  - id: D6
    description: "Single theme mechanism: color-scheme: light dark plus data-theme attribute is the only theme authority; zero prefers-color-scheme occurrences in tokens.css"
    requirement: "THEME-02"
    verification:
      - kind: unit
        ref: "grep -c 'color-scheme: *light dark' tokens.css == 1; grep -c 'prefers-color-scheme' tokens.css == 0"
        status: pass
    human_judgment: false
  - id: D7
    description: "Production build (tsc -b && vite build) and lint (oxlint) both exit 0 with the new token layer in place"
    verification:
      - kind: integration
        ref: "npm run build; npm run lint (pre-existing unrelated warnings in model.tsx/LineageView.tsx, exit 0)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Computed font-family in a real Windows 11 browser resolves to Geist Variable with no visible blank-text flash on a hard reload"
    verification: []
    human_judgment: true
    rationale: "Plan explicitly assigns this human-check to plan 01-05's full computed-font-family verification task; this plan only ships the mechanism (self-hosted @font-face + preload + swap), not the browser UAT"

# Metrics
duration: ~20min
completed: 2026-07-21
status: complete
---

# Phase 01 Plan 01: Design Tokens & Typography Foundation Summary

**Tailwind CSS v4 wired into Vite, self-hosted Geist/Geist Mono variable fonts vendored and preloaded with swap, and a four-step typography + 4px spacing + radius token layer replacing the old OS-dependent font stack.**

## Performance

- **Duration:** ~20 min (continuation agent, resumed after human package-legitimacy checkpoint approval)
- **Completed:** 2026-07-21T19:47:33Z
- **Tasks:** 3 (1 checkpoint gate cleared by human approval, 2 auto tasks executed)
- **Files modified:** 8 (2 created new dirs' worth of files, 5 modified, 1 deleted)

## Accomplishments

- Installed and pinned `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`, `@fontsource-variable/geist@5.3.0`, `@fontsource-variable/geist-mono@5.3.0`; wired the Tailwind Vite plugin into `vite.config.ts` with no PostCSS config file
- Vendored both latin variable-weight woff2 files into `frontend/public/fonts/` (verified byte-identical to their `node_modules` originals) and preloaded them from `index.html` at a URL that is identical in dev and a production build; set the document title to "Lineage Studio"
- Authored `frontend/src/styles/tokens.css` as the app's single CSS entry point: two hand-authored `@font-face` blocks (Geist Variable, Geist Mono Variable) with `font-display: swap` and Fontsource's own latin `unicode-range`, a Tailwind v4 `@theme` block with the four-step type ramp, eight 4px-multiple spacing steps and four radius tokens, theme/density `:root` primitives (`color-scheme: light dark`, `font-synthesis: none`, `--border-width`, `--row-height`), and the base reset
- Retired `frontend/src/index.css` and repointed `frontend/src/main.tsx` to `./styles/tokens.css`
- Verified: `npm run build` and `npm run lint` both exit 0; the built `dist/` contains both woff2 files under `dist/fonts/` and `dist/index.html` still preloads those exact paths; zero `prefers-color-scheme` occurrences in `tokens.css`

## Task Commits

Each task was committed atomically:

1. **Task 1: Package legitimacy gate for the four new npm dependencies** — checkpoint cleared by human approval ("approved"), no code commit (gate only)
2. **Task 2: Install Tailwind v4 and the fonts; wire the Vite plugin; vendor the woff2 files and preload them** - `de96eb6` (feat)
3. **Task 3: Author tokens.css — font faces, type ramp, spacing, radius, base reset — and retire index.css** - `821ada1` (feat)

**Plan metadata:** committed separately after this SUMMARY (see final commit)

## Files Created/Modified

- `frontend/package.json` / `frontend/package-lock.json` - four new pinned dependencies
- `frontend/vite.config.ts` - Tailwind v4 Vite plugin added alongside React
- `frontend/index.html` - two font preload links, document title changed to "Lineage Studio"
- `frontend/public/fonts/geist-latin-wght-normal.woff2` - vendored, byte-identical to Fontsource's package file
- `frontend/public/fonts/geist-mono-latin-wght-normal.woff2` - vendored, byte-identical to Fontsource's package file
- `frontend/src/styles/tokens.css` - new single CSS entry point (font-face, @theme tokens, reset)
- `frontend/src/main.tsx` - CSS import repointed from `./index.css` to `./styles/tokens.css`
- `frontend/src/index.css` - deleted (superseded by tokens.css)

## Decisions Made

- Vendored the two latin variable woff2 files into `frontend/public/fonts/` rather than importing Fontsource's own CSS (plan's flagged assumption 1) — keeps the preload href and `@font-face` src byte-identical across dev and a production build, closing the FOIT risk the UI-SPEC's original preload strategy would have reintroduced.
- Copied the `unicode-range` for both `@font-face` blocks verbatim from Fontsource's own `latin` split rather than hand-picking a range — this is what makes U+2318 (the search trigger's command-key glyph) deliberately fall through to the generic fallback stack instead of risking tofu.
- Left an explicit placeholder comment inside the `@theme` block for plan 01-02's colour tokens rather than guessing tier-1/tier-2 colour names, per the plan's own instruction.

## Deviations from Plan

None - plan executed exactly as written. Task 1's `blocking-human` checkpoint was cleared by explicit human approval of all four packages against npmjs.com before this continuation agent began; no package substitution or auto-approval occurred.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `frontend/src/styles/tokens.css` exists as the single token entry point with a labelled placeholder for plan 01-02 to add tier-1/tier-2 colour tokens into the same `@theme` block.
- Plan 01-02 (colour tokens), 01-03 (canvas token bridge), and 01-04 (component tokens) can now build directly on this file.
- Plan 01-05 still owns the mandatory Windows 11 devtools computed-font-family verification (`document.fonts.check('13px "Geist Variable"')`) — not run here, as this plan only ships the mechanism.
- No blockers.

---
*Phase: 01-design-tokens-typography-foundation*
*Completed: 2026-07-21*

## Self-Check: PASSED

All created files verified present on disk (`frontend/src/styles/tokens.css`, both vendored woff2 files, this SUMMARY.md), `frontend/src/index.css` verified absent, and both task commit hashes (`de96eb6`, `821ada1`) verified present in `git log`.
