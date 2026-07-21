# Stack Research

**Domain:** Dark-first, graph-canvas-heavy data lineage tool (Datadog/Grafana idiom) — React 19 + TypeScript + Vite frontend rebuild
**Researched:** 2026-07-20
**Confidence:** MEDIUM overall (versions verified directly against the npm registry — treat those as high-trust; qualitative/comparative claims are cross-referenced web search, no Context7/library-docs MCP or Exa/Tavily/Firecrawl access was available in this environment, so no HIGH-tier source was reachable)

This is a **brownfield stack addendum**, not a fresh-project stack. Python/FastAPI/Azure SDK/`LineageGraph` are explicitly out of scope per the milestone brief — this file only covers the frontend rebuild.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React | 19.2.7 (unchanged) | UI runtime | Already in place, not up for reconsideration |
| TypeScript | ~6.0.2 (unchanged) | Type safety | Already in place |
| Vite | ^8.1.1 (unchanged) | Build/dev server | Already in place; all recommendations below assume the Vite plugin ecosystem |
| Tailwind CSS | **4.3.3** | Utility CSS + design-token layer | v4's `@theme` block turns design tokens into real CSS custom properties at build time — zero JS config file, no runtime cost, and the resulting `--color-*` variables are readable from both CSS *and* `getComputedStyle()` in canvas/SVG rendering code. This directly solves the "colour tokens must be shared between DOM and canvas" requirement without a second system. |
| @xyflow/react | **12.11.2** | Structured lineage DAG rendering | This *is* `reactflow@11`'s successor — same team, renamed package. It is not a new evaluation, it's the mandatory upgrade path; v11 is EOL/unmaintained under its old name. |
| @cosmograph/react + @cosmograph/cosmos | latest (see Alternatives — license blocker) | Force-directed knowledge-graph rendering | GPU-computed force simulation, handles 100k+ nodes at interactive frame rates — but see the licensing caveat below before committing to it. |
| Motion (`motion` package, formerly Framer Motion) | **12.42.2** | Drill-in transitions, edge tracing, DOM/SVG micro-motion | Full React 19 support, `oklch`/`color-mix`-aware color interpolation (matches the theming approach below), hardware-accelerated scroll/layout animation. `framer-motion@12.42.2` still exists on npm as a re-export shim — new code should import from `motion/react`, not `framer-motion`. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@dagrejs/dagre` | **3.0.0** | Auto-layout for the lineage DAG | Default choice for the left-to-right table/column DAG. Simple, fast, native `rankdir: 'LR'` support. Use this, not the original `dagre` package (unmaintained since 2022 — see What NOT to Use). |
| `elkjs` | **0.12.0** | Auto-layout, fallback only | Only reach for this if dagre's layout quality genuinely fails on a real case (e.g. needs to respect fixed port positions for column-to-column edges at specific row offsets). It's async, far more configurable, and meaningfully more complex to integrate — actively maintained (last publish 2026-07-17) but not the default. |
| `@fontsource-variable/geist` + `@fontsource-variable/geist-mono` | **5.3.0** | Self-hosted UI + mono variable fonts | Primary recommendation for typography — see Typography section below. |
| `@radix-ui/react-*` (dialog, popover, dropdown-menu, etc.) | **1.1.20** (react-dialog, representative) | Headless primitives for shell chrome: dialogs, confirm-before-push modal, dropdown menus, tooltips | Mature, stable, huge surface area already proven in production UIs. Use for the parts of the shell that need to ship now. |
| `cmdk` | **1.1.1** | Command palette (Cmd+K search) | Purpose-built for exactly this pattern (already conceptually present as `SearchPalette.tsx`); pairs naturally with a Radix Dialog as the palette's shell. |
| `react-aria-components` | **1.19.0** | Only if a specific component needs deep a11y/i18n (e.g. a date range picker, if one is ever needed) | Not a wholesale replacement for Radix here — reach for it component-by-component when Radix/Base UI's a11y coverage is insufficient. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `@tailwindcss/vite` (v4.3.3) | Vite-native Tailwind v4 plugin | Replaces the old PostCSS-plugin setup; add directly to `vite.config.ts` plugins array — no `postcss.config.js` needed. |
| Fontsource CLI / packages | Font asset management | `npm install @fontsource-variable/geist @fontsource-variable/geist-mono`, import once in the app entry; Fontsource ships pre-subset woff2 + ready-made `@font-face` CSS, avoiding hand-rolled font pipelines. |

## Installation

```bash
# Core styling + tokens
npm install tailwindcss @tailwindcss/vite

# Fonts (self-hosted, Windows-safe)
npm install @fontsource-variable/geist @fontsource-variable/geist-mono

# Lineage DAG (replaces reactflow)
npm uninstall reactflow
npm install @xyflow/react

# Layout engine for the DAG
npm install @dagrejs/dagre
# (elkjs only if/when dagre proves insufficient)
# npm install elkjs

# Knowledge-graph canvas
npm install @cosmograph/react @cosmograph/cosmos
# See "What NOT to Use" — confirm commercial licensing before committing

# Component primitives
npm install @radix-ui/react-dialog @radix-ui/react-popover @radix-ui/react-dropdown-menu @radix-ui/react-tooltip @radix-ui/react-tabs
npm install cmdk

# Motion
npm install motion
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| `@cosmograph/react` | `sigma.js` (v3.0.3) + `graphology` | If the CC-BY-NC-4.0 license on Cosmograph is a genuine blocker (see below) and node counts stay under ~20-50k. Sigma is WebGL-rendered, mature, MIT-licensed, and has a real plugin ecosystem (force-atlas2 layout, node-image, etc.). Slightly more assembly required than Cosmograph (you own the layout↔render wiring via Graphology) but there is no licensing risk. |
| `@cosmograph/react` | `react-force-graph` (v1.48.2) | If you want the fastest path to "it just works" with d3-force under the hood and don't need six-figure node counts. MIT-licensed. Weaker raw performance ceiling than Cosmograph or Sigma at very large graphs, and its API is less React-idiomatic (it's a thin wrapper over an imperative force-graph library). |
| `@cosmograph/react` | hand-rolled `d3-force` + `<canvas>` (current approach) | Keep this only if the estate graph realistically never exceeds a few thousand nodes *and* the team wants zero new dependencies. Given "whole Fabric estate" is explicitly the target, this is the path most likely to hit a performance wall first — not recommended as the long-term answer, but a legitimate incremental step if Cosmograph's license is rejected and Sigma is deemed too much rework for this milestone. |
| `@dagrejs/dagre` | `elkjs` | Layouts need per-port routing precision (e.g. an edge must terminate at the exact row of a specific column in an expanded table card, not just "somewhere on the node boundary") that dagre's simpler algorithm can't express. |
| Tailwind v4 (`@theme`) | `vanilla-extract` (v1.21.1) | If the team wants compile-time-enforced theme parity — vanilla-extract's theme contracts *require* every token to be defined in both light and dark themes, which would mechanically enforce the "light theme at full parity" requirement rather than relying on discipline. Costs: CSS-in-TS build step, steeper learning curve, and token access from canvas code needs an explicit `vars` export rather than "just read the CSS custom property." |
| Tailwind v4 (`@theme`) | Panda CSS (v1.11.4) | If you want semantic tokens (`bg="surface"` resolves automatically per color-mode with no `dark:` prefix anywhere) and are comfortable with a `panda codegen` build step generating a `styled-system` directory. More powerful token semantics than Tailwind, more moving parts. |
| Radix UI | Base UI (`@base-ui-components/react`) | Only once it leaves `1.0.0-rc.0` (verified npm as of 2026-07-15 — **still a release candidate, not GA**, despite web coverage describing a "December 2025 stable" milestone). Revisit at the next roadmap checkpoint; if it's GA by execution time, Base UI's render-prop API and built-in RTL are genuinely nicer, and it's shadcn/ui's new default base. Do not build the shell's foundation on an RC today. |
| shadcn/ui as distribution model | Hand-assembled Radix + Tailwind components (recommended for this milestone) | shadcn/ui's copy-into-repo model is genuinely good and worth adopting *if* the team wants a component vocabulary fast and is comfortable owning the copied source. Given this is a from-scratch design system with a specific Datadog/Grafana visual language (not a generic shadcn look), hand-building on Radix primitives directly gives more control over the exact visual outcome without fighting shadcn's default aesthetic. Reconsider shadcn if velocity becomes the bottleneck — its 2026 `registry:base` full-payload installs (components + tokens + fonts + config in one command) are a legitimate way to bootstrap fast. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `reactflow` (the old package name) | Renamed to `@xyflow/react` at v12; the `reactflow` package itself has stopped receiving v12+ features under that name. Currently pinned at 11.11.4 in this repo. | `@xyflow/react` 12.11.2 |
| `dagre` (unscoped, original package) | Last published 2022-06-14 — over four years stale, unmaintained. | `@dagrejs/dagre` 3.0.0 (actively maintained fork, same API) |
| `-apple-system` / `BlinkMacSystemFont` / `"SF Pro Text"` / `"SF Pro Display"` as the primary font stack | This is the actual bug driving this milestone: none of these resolve on Windows 11, so the entire app silently renders in Segoe UI at weights (`560`, `620`) and letter-spacing (`-.01em`) tuned for a font that never loads. Windows is the explicit primary dev/use platform. | Self-hosted variable font (see Typography section), loaded via `@font-face`/Fontsource, with system-font fallbacks only as the *last* stack entry, never the first |
| `prefers-color-scheme` media query as the *only* theme mechanism | The current `App.css` sets tokens via `@media (prefers-color-scheme: dark)` **and separately** via `:root[data-theme="light"]`/`[data-theme="dark"]` attribute selectors — two competing mechanisms with duplicated token values (already a source of the "no shared vocabulary" problem named in PROJECT.md). | A single `data-theme` attribute switch is authoritative; use `light-dark()` (Baseline 2026, shipped in all evergreen browsers) inside token definitions instead of hand-duplicating every token block twice |
| `@cosmograph/*` in a context where the product might ever be sold/licensed commercially without checking | CC-BY-NC-4.0 — free for non-commercial use only. Confirm whether Lineage Studio's deployment (internal tool now, but "colleagues in your org" — read: your employer) triggers the "commercial" clause before adopting. This is a licensing decision, not just a technical one — flag it explicitly for the roadmap. | If commercial-use risk is real: `sigma.js` (MIT) is the closest-quality alternative |
| Hand-rolled six-file CSS custom-property system (current `App.css`/`index.css`/view-local CSS) | No shared vocabulary between files, one `--shadow` token doing all elevation work, scattered unsystematic font sizes (10.5/11.5/12.5/13/14/17px), and — per PROJECT.md — accent/domain colors tuned for light mode that collapse toward each other at low luminance on a dark canvas. | Tailwind v4 `@theme` token layer as the single source of truth, with an explicit OKLCH-based palette re-derivation (see Theming section) |

## Stack Patterns by Variant

**If token-parity enforcement matters more than setup speed:**
- Use `vanilla-extract` instead of Tailwind v4
- Because its theme-contract type system makes it a compile error to define a dark-theme token without its light-theme counterpart (or vice versa) — given the roadmap explicitly flags "light theme at full parity" as a cost the user accepted "against recommendation," a mechanism that *enforces* parity rather than trusting review discipline is worth the extra setup ceremony

**If the knowledge-graph estate view realistically stays under ~5,000 nodes for the foreseeable future:**
- Use `sigma.js` + `graphology` instead of Cosmograph
- Because it avoids any licensing ambiguity entirely, is WebGL-rendered (so headroom exists well past 5,000 nodes anyway), and its plugin ecosystem (force-atlas2, node images, camera animations) covers the "zoom/pan/drag and drill-in transitions" requirement without a build vs. license tradeoff

**If the lineage DAG needs exact column-row edge anchoring (edges must terminate at a specific expanded-row's exact vertical offset, not just node-boundary):**
- Use `elkjs` instead of `@dagrejs/dagre` for that view only
- Because dagre's layout model doesn't expose fixed-port constraints the way elkjs's `layoutOptions` can; this is a real cost (async layout, more complex integration) so only pay it if dagre's simpler node-boundary edges genuinely look wrong for column-level connections

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `@xyflow/react@12.11.2` | `react@19.2.7` | v12 line targets React 18/19; no known incompatibility with the pinned React version here |
| `tailwindcss@4.3.3` | `vite@^8.1.1` | Use `@tailwindcss/vite@4.3.3` (matching major/minor), not the older PostCSS-plugin integration path — v4's Vite plugin is the documented fast path and avoids a separate `postcss.config.js` |
| `motion@12.42.2` / `framer-motion@12.42.2` | `react@19.2.7` | Both package names currently resolve to the same v12.42.2 release; only one needs to be installed — install `motion`, import from `motion/react` |
| `@radix-ui/react-dialog@1.1.20` | `react@19.2.7` | Radix v1.x line has supported React 19 since its release; no adapter needed |
| `@base-ui-components/react@1.0.0-rc.0` | — | **Not GA on npm as of 2026-07-15** despite some web coverage describing a stabilized December 2025 release — verify the dist-tag again before adopting as a foundation; treat as pre-1.0 for planning purposes today |
| `@fontsource-variable/*` packages | Vite (any version) | The whole `@fontsource-variable` scope publishes in lockstep — geist, geist-mono, inter, jetbrains-mono, and ibm-plex-sans were all observed at `5.3.0` on npm during this research pass |

## Typography — Detail

**Recommendation: Geist (sans) + Geist Mono, self-hosted via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` (v5.3.0).**

- **Why Geist over Inter:** Inter is the safer, more battle-tested choice for dense UI at small sizes and has zero personality risk — it is the "can't go wrong" option. Geist (Vercel) was purpose-designed for developer-tool/infra-SaaS surfaces and ships a same-family monospace, which matters here because column identifiers, GUIDs, and transform expressions appear constantly next to prose in this app — a designed sans/mono pair reads more coherently than pairing Inter with an unrelated mono family. The one real risk flagged in research: Geist reportedly feels tight/cramped at small sizes (~14px) under Windows ClearType specifically — the exact rendering environment this milestone targets. **Mitigate by verifying rendering at the actual body size (12.5-13px, matching current `.ls-node .sub`/`.col .name` sizes) on a real Windows 11 machine before committing** — this is cheap to check and directly addresses the platform constraint. If it reads poorly at those sizes, fall back to Inter + a separate mono (JetBrains Mono is the safe default there).
- **Why not IBM Plex Sans:** Solid, self-hostable, distinct "enterprise/engineering" character — a legitimate alternative if the Datadog/Grafana-adjacent aesthetic ever tips toward "IBM enterprise tool" rather than "modern observability dashboard," but Geist/Inter are closer to the actual visual reference (Datadog, Grafana, Linear-adjacent tools) the milestone specifies.
- **Mono pairing:** Geist Mono (if Geist sans is chosen — same design family, visually coherent) or JetBrains Mono (safe, ligature-toggleable, excellent for long-session code/identifier reading — the better choice if Geist Sans is rejected for the small-size issue above). IBM Plex Mono only if IBM Plex Sans is chosen for the UI font.

**Concrete self-hosting guidance for Vite (addresses the Windows constraint directly):**

1. `npm install @fontsource-variable/geist @fontsource-variable/geist-mono`
2. Import once, in the app's CSS entry (not per-component): `@import "@fontsource-variable/geist";` and `@import "@fontsource-variable/geist-mono";` — Fontsource ships pre-built `@font-face` blocks pointing at woff2 files with `font-display: swap` already set, and Vite fingerprints/hashes the served assets automatically.
3. Preload the primary weight range in `index.html`: `<link rel="preload" href="/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>` (exact path depends on Fontsource's file layout for the variable-weight axis — confirm via the installed package's `files/` directory). Preload without `font-display: swap` still causes a flash of invisible text; use both together.
4. Set the token: `--sans: "Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif;` — the self-hosted font is always first, system fallbacks are a genuine fallback (used only during the swap window or on preload failure), never the primary delivery mechanism. This is the direct fix for the bug this milestone exists to fix.
5. Subsetting: Fontsource variable packages already ship reasonably scoped `latin` subsets by default; only pursue custom subsetting if bundle-size audits show the font payload is a real problem (unlikely at ~80-110KB for one variable file per family).

## Styling Approach — Detail

**Recommendation: Tailwind CSS v4 (`@theme`) as the token + utility layer.**

Given the specific requirement that "colour tokens must be shared between DOM CSS and canvas/SVG rendering code (JS needs to read them)": Tailwind v4's `@theme` block compiles design tokens into real, standard `:root` CSS custom properties — not a JS object, not a CSS-in-TS runtime, not a codegen artifact. That means:
- DOM/CSS consumes them the normal way (`bg-[--color-accent]` utilities, or direct `var(--color-accent)` in hand-written CSS for the canvas-heavy views where utility classes don't fit well)
- Canvas/SVG rendering code reads the *exact same* tokens via `getComputedStyle(document.documentElement).getPropertyValue('--color-accent')` — one source of truth, zero duplication, which directly fixes the current problem of six CSS files with "no shared vocabulary."

This is a genuine migration, not a drop-in: the current app is hand-rolled CSS custom properties with zero utility classes. Given the milestone is already a **full frontend rebuild**, this is the right moment to make that change — retrofitting Tailwind onto an existing hand-rolled system later would be far more expensive than adopting it while every view is being rewritten anyway.

**vanilla-extract** is the strongest alternative if compile-time-enforced light/dark parity is valued over setup speed (see Stack Patterns above) — flagging it as a real option because the roadmap explicitly notes light-theme parity was accepted "against recommendation," which is exactly the situation a theme-contract type system is built for.

## Component Primitives — Detail

**Recommendation: Radix UI primitives, hand-composed (not via shadcn/ui's CLI), for shell chrome — dialogs, dropdown menus, popovers, tooltips, tabs. `cmdk` specifically for the command palette.**

- Radix (`@radix-ui/react-dialog` etc., v1.1.20 representative) is the stable, production-proven choice today. Base UI is the more modern option on paper (render-prop composition, built-in RTL, MUI's full-time engineering) but **is still `1.0.0-rc.0` on npm as of 2026-07-15** — not GA despite some coverage framing it as stabilized. Building this milestone's foundation on a release candidate is an avoidable risk; Radix is the pragmatic choice now, with Base UI worth revisiting once it actually ships 1.0.
- `cmdk` (v1.1.1) is purpose-built for the exact Cmd+K palette pattern this app already has (`SearchPalette.tsx`) — pair it with a Radix `Dialog` as the palette's overlay/focus-trap shell rather than reinventing focus management.
- **On shadcn/ui as a distribution model specifically:** it's a legitimate way to bootstrap a component vocabulary fast (2026's `registry:base` full-payload installs are genuinely convenient), but its default visual output fights against a from-scratch, specifically-scoped Datadog/Grafana visual language. Recommend building directly on Radix primitives for this milestone's bespoke design system; reconsider shadcn only if component-authoring velocity becomes the actual bottleneck.
- Accessibility/bundle note: both Radix and Base UI ship per-primitive packages (tree-shakeable, install only what's used); React Aria's hook-based model has the deepest a11y/i18n coverage of the three but is heavier to hand-compose visually — reserve it for specific components (if any) with real internationalization or complex-widget accessibility requirements the other two don't fully cover.

## Graph Rendering — Detail

**Lineage DAG (structured, left-to-right, expandable table cards, column edges):**
`@xyflow/react` (12.11.2) + `@dagrejs/dagre` (3.0.0) for auto-layout. This is the direct, low-risk upgrade from the current `reactflow@11.11.4` — same mental model, same component API surface (renamed import path, some prop renames per the official migration guide), and dagre is the standard low-ceremony layout companion for exactly this DAG shape. Reach for `elkjs` only if column-row-precise edge anchoring genuinely requires it (see Stack Patterns).

**Knowledge-graph constellation (whole Fabric estate, force-directed, zoom/pan/drag, drill-in):**
This is the harder call, and the one requiring an explicit product decision before execution:

- **`@cosmograph/react` + `@cosmograph/cosmos`** — best raw performance (GPU-computed force simulation, not just GPU-rendered; handles hundreds of thousands to millions of nodes), but **CC-BY-NC-4.0 licensed — non-commercial use only**. Flag this for the roadmap: confirm whether an internal-but-employer-owned tool counts as "commercial" under that license before adopting it as the foundation of a whole view.
- **`sigma.js` (3.0.3) + `graphology`** — MIT-licensed, WebGL-rendered, mature plugin ecosystem including force-atlas2 layout and camera-animation utilities that map directly onto "drill-in transitions." Recommended as the safe default if the Cosmograph license is rejected or unresolved by the time this phase is planned.
- **`react-force-graph` (1.48.2)** — MIT, easiest integration, weakest ceiling at very large node counts, less idiomatic React API. Reasonable fallback if team velocity matters more than headroom and the estate is not expected to reach tens of thousands of nodes soon.
- **Hand-rolled `d3-force` + `<canvas>` (current approach)** — keep only as a bridge, not the destination; the app already does this and the milestone's own framing ("whole Fabric estate," "constellation") implies growth past where hand-rolled canvas physics stays comfortable.

**Node-count threshold guidance (cross-referenced across multiple sources, consistent findings):**
- SVG-based rendering (D3 selections attaching DOM/SVG nodes) starts dropping frames around **~1,000 nodes**.
- Canvas 2D (immediate-mode, no per-node DOM) stays smooth to roughly **~10,000 objects per frame**.
- Beyond **~10,000 nodes**, WebGL (whether via Sigma, Cosmograph, or a custom regl/PixiJS layer) is the point where it stops being a "nice to have" and becomes necessary for interactive frame rates; WebGL comfortably handles 50,000+ instanced primitives per frame.
- Separately: the *force simulation itself* (physics/layout computation) is CPU-bound in a standard `d3-force` setup regardless of renderer — a large estate can be render-smooth on Canvas/WebGL but still stutter on layout ticks. This is the actual argument for Cosmograph/GPU-computed force over "WebGL-rendered but CPU-simulated" — if physics recomputation on drill-in/filter is expected to be frequent and the estate is large, GPU-computed force layout is the differentiator, not just the renderer choice.

**Practical framing for roadmap phasing:** a real Fabric tenant's full estate (workspaces × lakehouses × tables × columns) could plausibly reach the thousands-to-tens-of-thousands range depending on org size — comfortably inside "canvas is fine, WebGL is future-proofing" territory for most orgs, but "WebGL is the correct choice from day one" for a large enterprise tenant. Given this is unknowable without real data, recommend building the knowledge-graph view against a renderer that has WebGL headroom from the start (Sigma or Cosmograph) rather than a Canvas-only library that would need replacing later.

## Motion — Detail

**Recommendation: Motion (`motion`, formerly Framer Motion, v12.42.2) for DOM/SVG-level transitions — panel open/close, inspector slide-in, breadcrumb crumb transitions, node-card expand/collapse in the lineage DAG.**

Motion is a DOM/SVG animation library — it animates React-rendered elements and their CSS properties, including SVG paths (directly relevant to "edge tracing": animating `stroke-dashoffset` or a path's `pathLength` for a traced/highlighted lineage edge is a well-supported Motion pattern). It is **not** the right tool for canvas-internal motion (e.g. animating positions inside a `@xyflow/react` custom canvas layer, or animating Cosmograph/Sigma's own camera/node positions) — those libraries have their own animation primitives (Cosmograph's camera transitions, Sigma's `animateNodes`/camera easing, `@xyflow/react`'s built-in `fitView`/viewport transition options) and should use those instead of trying to drive canvas-internal state through Motion.

**Practical split for this app:**
- Motion: inspector panel transitions, command palette open/close, table-card expand/collapse chrome (the DOM parts of the lineage view), SVG edge-tracing highlight animations
- Native library animation APIs: `@xyflow/react`'s viewport/fitView transitions for DAG pan/zoom; Sigma's or Cosmograph's own camera-animation methods for the knowledge-graph drill-in ("Estate → Workspace → Lakehouse → Table" zoom transitions) — this is genuinely a case where the *graph library's own* transition APIs will look and perform better than reimplementing camera easing through a general-purpose DOM animation library

v12's `oklch`/`color-mix`-aware color interpolation is directly relevant to the theming approach below — animating between token colors (e.g. a node transitioning from "default" to "focused" state) will interpolate correctly in perceptual color space rather than muddying through naive RGB interpolation.

## Theming Mechanics — Detail

**Recommendation: OKLCH-defined palette, `light-dark()` as the single switching mechanism, tokens exposed as plain CSS custom properties (via Tailwind's `@theme`) readable from both CSS and JS.**

This directly addresses two things flagged in PROJECT.md: the current accent color (`#4f5bd5`) being "a light-mode accent" that doesn't survive translation to dark, and Bronze/Notebook domain colors "collapsing toward each other at low luminance."

1. **Define the palette in OKLCH, not hex.** OKLCH separates lightness, chroma, and hue as independent, perceptually-uniform axes — which means you can take an accent color and mechanically produce a dark-mode-appropriate variant by adjusting *only* lightness/chroma while holding hue constant, rather than eyeballing a new hex value that might drift in perceived hue. This is the direct fix for "accent that doesn't survive a near-black canvas": derive the dark-mode accent from the light-mode one by construction, not by separate design judgment each time. OKLCH is Baseline/shipped in all evergreen browsers as of 2026 — no fallback layer needed.
2. **Use `light-dark()` as the single theme-switch mechanism**, replacing the current app's two competing systems (`@media (prefers-color-scheme)` *and* a separate `[data-theme]` attribute selector with fully duplicated token blocks). Baseline as of 2026: `--color-accent: light-dark(oklch(0.55 0.18 265), oklch(0.75 0.15 265));` inside a single token definition, switched by toggling a `color-scheme` value on `:root` (typically via the same `data-theme` attribute the app already uses) — one definition per token instead of two full duplicated blocks. This is a direct, mechanical fix for the "single coherent token layer" requirement in PROJECT.md's Active section.
3. **`color-mix()`** (Baseline 2023, ~89%+ support) for derived states — hover/focus rings, subtle backgrounds derived from a base token (the current app already does this: `color-mix(in srgb, var(--accent) 16%, transparent)`). Keep doing this, but do it in `oklch` color-space (`color-mix(in oklch, ...)`) rather than `srgb` for perceptually-even results, particularly important for the near-black canvas background where small lightness differences need to read as intentional, not muddy.
4. **Expose tokens to canvas/JS**: because the token layer is plain CSS custom properties (Tailwind `@theme`'s output), canvas/SVG rendering code reads them via `getComputedStyle(document.documentElement).getPropertyValue('--color-accent')` at render time, or — better for a canvas render loop that shouldn't call `getComputedStyle` every frame — read them once into a JS constants object on theme change (listen for the `data-theme` attribute mutation, or a custom "theme changed" event) and cache until the next switch. This is the concrete mechanism for "colour tokens must be shared between DOM CSS and canvas/SVG rendering code."

**Dark+light parity cost — explicit acknowledgment:** PROJECT.md already accepts this "knowingly against the recommendation of dark-first/light-supported" at roughly 2x the token and canvas-tuning cost. The OKLCH + `light-dark()` approach reduces but does not eliminate that cost: it removes the *duplication* tax (one token definition instead of two divergent blocks) but does not remove the *design* tax — every domain/status color still needs a human check that it reads correctly at both ends of the lightness range, especially the flagged Bronze/Silver/Gold/Notebook domain colors on the knowledge graph, where PROJECT.md explicitly permits a color legend precisely because color is load-bearing there. Budget real design-review time per domain color, per theme, not just mechanical token generation.

## Sources

- npm registry (`npm view <package> version` / `time.modified` / `dist-tags`) — direct, authoritative version verification for: `@xyflow/react` (12.11.2), `tailwindcss` (4.3.3), `@tailwindcss/vite` (4.3.3), `motion`/`framer-motion` (12.42.2), `elkjs` (0.12.0), `dagre` (0.8.5, last published 2022-06-14), `@dagrejs/dagre` (3.0.0), `@radix-ui/react-dialog` (1.1.20), `@base-ui-components/react` (1.0.0-rc.0, last published 2026-07-15), `react-aria-components` (1.19.0), `sigma` (3.0.3), `d3-force` (3.0.0), `react-force-graph` (1.48.2), `cmdk` (1.1.1), `@vanilla-extract/css` (1.21.1), `@pandacss/dev` (1.11.4), `@fontsource-variable/{geist,geist-mono,inter,jetbrains-mono,ibm-plex-sans}` (all 5.3.0) — confidence: authoritative for version numbers specifically (registry is ground truth), MEDIUM for surrounding qualitative claims — Web search, cross-referenced across multiple independent results, for: React Flow v12 migration shape (reactflow.dev official migration guide surfaced in results), dagre vs elkjs tradeoffs, sigma.js/Cosmograph/react-force-graph comparison, SVG/Canvas/WebGL node-count thresholds, Tailwind v4 `@theme` mechanics, vanilla-extract/Panda/Tailwind token-parity tradeoffs, Radix/Base UI/React Aria comparison (including the Base UI RC-vs-GA discrepancy, caught by cross-checking against the npm registry directly), shadcn/ui 2026 changelog entries, Geist/Inter/IBM Plex Sans comparison, font self-hosting/Fontsource/preload/font-display guidance, Motion v12 feature set, `light-dark()`/`color-mix()`/OKLCH browser-support status, JetBrains Mono/Geist Mono/IBM Plex Mono comparison, Cosmograph GPU force-layout capability and CC-BY-NC-4.0 licensing — confidence: MEDIUM (no single-source-of-truth docs MCP was reachable in this environment; claims reflect convergence across multiple independent search results, not a single vendor page)
- Local repo inspection — `.planning/PROJECT.md`, `.planning/codebase/STACK.md`, `.planning/codebase/ARCHITECTURE.md`, `frontend/package.json`, `frontend/src/App.css` — confidence: HIGH (direct file reads, current state of the actual codebase)

---
*Stack research for: dark-first, graph-canvas-heavy data lineage frontend rebuild (React 19 + TypeScript + Vite)*
*Researched: 2026-07-20*
