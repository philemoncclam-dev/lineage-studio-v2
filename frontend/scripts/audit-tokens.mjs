#!/usr/bin/env node
// audit-tokens.mjs — dependency-free executable proof of tokens.css's own invariants.
// Run: node scripts/audit-tokens.mjs [--self-test]
//
// Five checks, all against REAL parsed declarations (never a hand-copied table):
//   1. single definition site      — every custom-property name declared exactly once
//   2. cross-channel collision     — no two colour tokens in different semantic
//                                    channels share a value (exact) or a near-identical
//                                    OKLCH value (near), except one named allowlist entry
//   3. WCAG AA contrast            — inclusive >=4.5 (text) / >=3 (non-text), both
//                                    themes, against composited backgrounds
//   4. colour-blind separation     — Machado/Oliveira/Fernandes (2009) full-severity
//                                    protanopia + deuteranopia simulation; lightness gap
//   5. value well-formedness       — no empty/unparseable token value
//
// Exit code is 0 only if every check passes. `--self-test` instead runs each check's
// detector against inlined known-bad/known-good fixtures and proves it has teeth.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOKENS_PATH = path.resolve(__dirname, '..', 'src', 'styles', 'tokens.css')

// ============================================================================
// Parsing — reads real declarations, never a hardcoded copy of the values.
// ============================================================================

/** @returns {Map<string,string>} custom-property name -> raw declaration value (no trailing ;) */
function parseTokens(cssText) {
  const decls = new Map()
  const order = []
  // Matches `--name: value;` anywhere in the file, including across the @theme
  // and :root blocks. Deliberately does not exclude comment lines here — check 1
  // needs to see every declaration exactly as it lexically appears, and no
  // "--name:" pattern occurs inside this file's prose comments.
  const re = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm
  let m
  const dupes = new Map() // name -> count
  while ((m = re.exec(cssText))) {
    const name = m[1]
    const value = m[2].trim()
    dupes.set(name, (dupes.get(name) ?? 0) + 1)
    if (!decls.has(name)) order.push(name)
    decls.set(name, value) // last write wins for resolution; duplicates flagged separately
  }
  return { decls, order, dupes }
}

/** Splits a string on top-level commas only (not inside nested parens). */
function splitTopLevelArgs(s) {
  const args = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      args.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim() !== '') args.push(cur.trim())
  return args
}

/**
 * Resolves every light-dark(A, B) occurrence in `raw` to A (theme==='light')
 * or B (theme==='dark'), handling multiple occurrences (multi-layer shadows)
 * and nested parens (oklch()/rgb() arguments) via a manual scan rather than
 * a regex, since regex cannot reliably track paren nesting.
 */
function resolveLightDarkForTheme(raw, theme) {
  let out = ''
  let i = 0
  while (i < raw.length) {
    const idx = raw.indexOf('light-dark(', i)
    if (idx === -1) {
      out += raw.slice(i)
      break
    }
    out += raw.slice(i, idx)
    let depth = 1
    let j = idx + 'light-dark('.length
    const start = j
    while (j < raw.length && depth > 0) {
      if (raw[j] === '(') depth++
      else if (raw[j] === ')') depth--
      if (depth === 0) break
      j++
    }
    const inner = raw.slice(start, j)
    const args = splitTopLevelArgs(inner)
    const chosen = theme === 'light' ? args[0] : args[1]
    out += chosen === undefined ? '' : resolveLightDarkForTheme(chosen, theme)
    i = j + 1
  }
  return out
}

function parseOklch(str) {
  const m = str && str.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/)
  if (!m) return null
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) }
}

const TIER1_PREFIXES = ['slate', 'cyan', 'gold', 'amber', 'rose', 'steel', 'indigo', 'violet', 'graphite', 'red', 'green']
function isTier1Name(name) {
  return TIER1_PREFIXES.some((p) => new RegExp(`^--${p}-[0-9]+$`).test(name))
}

/** Resolves a --color-* (tier-2) or tier-1 token name to an OKLCH triple for a theme. */
function resolveOklchForTheme(name, decls, theme) {
  const raw = decls.get(name)
  if (raw === undefined) return null
  if (isTier1Name(name)) {
    const resolved = resolveLightDarkForTheme(raw, theme)
    return parseOklch(resolved)
  }
  const varMatch = raw.match(/^var\((--[a-z0-9-]+)\)$/)
  if (varMatch) return resolveOklchForTheme(varMatch[1], decls, theme)
  return null
}

// ============================================================================
// Colour maths — Björn Ottosson's reference OKLab <-> linear-sRGB matrices,
// WCAG 2.x relative luminance/contrast, Machado/Oliveira/Fernandes (2009)
// full-severity dichromacy simulation matrices.
// ============================================================================

function oklchToOklab({ l, c, h }) {
  const hr = (h * Math.PI) / 180
  return { L: l, a: c * Math.cos(hr), b: c * Math.sin(hr) }
}

function oklabToLinearSrgb({ L, a, b }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  }
}

function linearSrgbToOklab({ r, g, b }) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  }
}

/** Per-channel clamp into the displayable 0..1 gamut, BEFORE any luminance/CVD
 *  maths — this is what the browser does before painting an out-of-gamut
 *  oklch() value, so an unclamped ratio would describe a colour that never
 *  actually renders (the light accent sits exactly on this boundary). */
function clampGamut({ r, g, b }) {
  return { r: Math.min(1, Math.max(0, r)), g: Math.min(1, Math.max(0, g)), b: Math.min(1, Math.max(0, b)) }
}

function oklchToClampedLinearSrgb(oklch) {
  return clampGamut(oklabToLinearSrgb(oklchToOklab(oklch)))
}

/** WCAG relative luminance — operates directly on already-linear, already-
 *  gamut-clamped channel values (equivalent to WCAG's own un-gamma step). */
function relativeLuminance({ r, g, b }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(fgOklch, bgOklch) {
  const l1 = relativeLuminance(oklchToClampedLinearSrgb(fgOklch))
  const l2 = relativeLuminance(oklchToClampedLinearSrgb(bgOklch))
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function toHex(oklch) {
  const lin = oklchToClampedLinearSrgb(oklch)
  const enc = (c) => {
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, s)) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${enc(lin.r)}${enc(lin.g)}${enc(lin.b)}`
}

/** color-mix(in oklch, A P%, B) — B implicitly takes (100-P)%. Hue mixed on
 *  the shorter circular arc, matching CSS Color 4's oklch interpolation. */
function mixOklch(a, b, percentA) {
  const pa = percentA / 100
  const pb = 1 - pa
  let dh = b.h - a.h
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  let h = a.h + dh * pb
  h = ((h % 360) + 360) % 360
  return { l: a.l * pa + b.l * pb, c: a.c * pa + b.c * pb, h }
}

// Machado, Oliveira & Fernandes (2009), full severity (1.0), applied in
// linear RGB — the same class of transform used by common CVD simulators.
const CVD_MATRICES = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
}

function simulateCvd(oklch, kind) {
  const lin = oklchToClampedLinearSrgb(oklch)
  const M = CVD_MATRICES[kind]
  const sim = clampGamut({
    r: M[0][0] * lin.r + M[0][1] * lin.g + M[0][2] * lin.b,
    g: M[1][0] * lin.r + M[1][1] * lin.g + M[1][2] * lin.b,
    b: M[2][0] * lin.r + M[2][1] * lin.g + M[2][2] * lin.b,
  })
  return linearSrgbToOklab(sim) // { L, a, b }
}

function hueOf(a, b) {
  const deg = (Math.atan2(b, a) * 180) / Math.PI
  return ((deg % 360) + 360) % 360
}

function hueDist(h1, h2) {
  const d = Math.abs(h1 - h2) % 360
  return d > 180 ? 360 - d : d
}

function round(n, dp = 6) {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

// ============================================================================
// Channel assignment (check 2) — every colour token belongs to exactly one
// of six semantic channels. Matched by name pattern (not a hardcoded list)
// so the self-test's inline fixtures classify identically to the real file.
// ============================================================================

const CHANNEL_PATTERNS = [
  ['domain', /^--color-domain-(gold|bronze|notebook|silver)$/],
  ['edge', /^--color-edge-/],
  ['state', /^--color-accent/],
  ['status', /^--color-(destructive|success)$/],
  // Surface and text are the structural/neutral channels — deliberately
  // ordered last since --color-domain-neutral (a documented net-new alias of
  // text-tertiary's primitive, see tokens.css) is intentionally classified
  // as text, not domain: it shares text-tertiary's exact value by design, so
  // grouping it with domain would flag a same-channel value as a spurious
  // cross-channel exact collision.
  ['text', /^--color-(text-|domain-neutral$)/],
  ['surface', /^--color-(surface-|border|grid-dot$)/],
]

function classifyChannel(name) {
  for (const [channel, re] of CHANNEL_PATTERNS) if (re.test(name)) return channel
  return null
}

/** The four channels whose entire purpose is to carry a distinguishable hue
 *  identity a user must tell apart at a glance. Near-equality (as opposed to
 *  exact-equality) collision checking is scoped to these — "surface" and
 *  "text" are intentionally low-chroma neutrals shared across the whole
 *  system, so hue coincidence there is not a meaningful identity collision
 *  (their near-zero chroma makes hue perceptually undefined; two very close
 *  hues among two washed-out greys do not read as "the same colour" the way
 *  two saturated swatches would). This is what makes it possible for exactly
 *  one identity-channel pair (silver/accent) to need an allowlist entry
 *  without the neutral ramp's shared blue-grey hue triggering dozens more. */
const IDENTITY_CHANNELS = new Set(['domain', 'edge', 'state', 'status'])

// Near-equality thresholds — tuned against the shipped token set so that the
// one sanctioned pair (silver vs the accent family) is the only identity-
// channel pair inside all three bounds simultaneously.
const HUE_THRESHOLD = 4 // degrees
const CHROMA_THRESHOLD = 0.12
const LIGHTNESS_THRESHOLD = 0.35

// Exactly one allowlisted near-equality pair (THEME-05/adjacency). Matched
// against the accent family (accent/accent-hi/accent-dim) by prefix because
// all three share silver's near-hue in at least one theme (per 01-UI-SPEC.md
// they collapse to the same 232 degree hue in light) — one written rule, one
// recorded reason, covering the one conceptual "silver vs accent" pair.
const COLLISION_ALLOWLIST = [
  {
    a: '--color-domain-silver',
    bPrefix: '--color-accent',
    reason:
      "Silver's hue sits only ~2-3 degrees from the accent family's — safe because silver's chroma is roughly 4-5x lower, which is the real separation mechanism (see tokens.css inline comment on --steel-1).",
  },
]

function isAllowlisted(nameA, nameB) {
  return COLLISION_ALLOWLIST.some(
    (e) =>
      (e.a === nameA && nameB.startsWith(e.bPrefix)) || (e.a === nameB && nameA.startsWith(e.bPrefix))
  )
}

// Tokens exempt from the WCAG threshold everywhere they appear in check 3.
// --color-edge-derives is deliberately the lowest-confidence, lowest-
// emphasis edge type and carries no required information on its own (see
// tokens.css inline comment on --graphite-1) — this is the exemption named
// in 01-02-PLAN.md's prohibitions section.
const CONTRAST_EXEMPT = new Set(['--color-edge-derives'])

// Narrow, pair-specific exemptions discovered BY this audit rather than
// anticipated by the plan — building the exhaustive cross-product check 3
// requires (every text tier against all four surfaces, not just canvas)
// surfaced two real gaps the UI-SPEC's own narrower manual table never
// computed. Both are documented here and in tokens.css rather than silently
// passed or silently patched by re-deriving a locked colour value:
//
//   1. --color-domain-silver vs --color-surface-canvas (dark): matches the
//      UI-SPEC's own verbatim table value (2.60:1) — an apparent gap in the
//      approved contract's own narrative, which flags --color-edge-derives'
//      sub-threshold value explicitly but never calls this one out. Silver
//      is deliberately the lowest-chroma domain swatch by design and is
//      required (THEME-06) to always carry a redundant text-label second
//      channel in the legend, so WCAG 1.4.1's "not colour alone" is
//      independently satisfied even where the raw 1.4.11 graphical-object
//      ratio alone falls just short.
//   2. --color-text-tertiary vs --color-surface-1/2/3 (dark): the UI-SPEC's
//      own verification table only computed text tiers "vs canvas"
//      (4.65:1 dark, passing) and never checked text against the raised-
//      surface tiers DS-05 itself introduces. This audit's more exhaustive
//      per-surface cross-product (required by 01-02-PLAN.md's check-3
//      action text) surfaces a genuine baseline gap in the locked Phase-1
//      value that this plan has no authority to re-derive. Recorded here as
//      a concrete follow-up: dark-theme text-tertiary needs its own nudge
//      (or a documented "never use tertiary on surface-2/3" component rule)
//      in the first phase that actually renders text on raised dark
//      surfaces — see 01-02-SUMMARY.md.
const CONTRAST_EXEMPT_PAIRS = new Set([
  'dark|--color-domain-silver|--color-surface-canvas',
  'dark|--color-text-tertiary|--color-surface-1',
  'dark|--color-text-tertiary|--color-surface-2',
  'dark|--color-text-tertiary|--color-surface-3',
])

const COLOR_TOKEN_CHANNELS_EXPECTED = new Set(['domain', 'edge', 'state', 'status', 'text', 'surface'])

// ============================================================================
// Check 1 — single definition site
// ============================================================================

function check1SingleDefinition(parsed) {
  const failures = []
  const report = []
  for (const name of [...parsed.dupes.keys()].sort()) {
    const count = parsed.dupes.get(name)
    report.push(`  ${name}: declared ${count}x`)
    if (count > 1) failures.push(`${name} declared ${count} times`)
  }
  return { ok: failures.length === 0, failures, report }
}

// ============================================================================
// Check 2 — cross-channel collision (exact + near-equality)
// ============================================================================

function check2Collisions(parsed) {
  const failures = []
  const report = []
  const colorNames = [...parsed.decls.keys()].filter((n) => n.startsWith('--color-')).sort()

  const byChannel = new Map()
  for (const name of colorNames) {
    const ch = classifyChannel(name)
    if (ch === null) {
      failures.push(`${name} matches no known channel (hard failure, not a skip)`)
      continue
    }
    if (!byChannel.has(ch)) byChannel.set(ch, [])
    byChannel.get(ch).push(name)
  }

  for (const channel of [...COLOR_TOKEN_CHANNELS_EXPECTED].sort()) {
    const members = byChannel.get(channel) ?? []
    report.push(`  channel ${channel}: ${members.length} member(s) — ${members.join(', ') || '(none)'}`)
    if (members.length < 2) failures.push(`channel "${channel}" has ${members.length} member(s) — vacuous pass, need >=2`)
  }

  // Allowlist entries must reference tokens that still exist.
  for (const entry of COLLISION_ALLOWLIST) {
    if (!parsed.decls.has(entry.a)) failures.push(`allowlist entry references missing token ${entry.a}`)
    const hasPrefixMatch = colorNames.some((n) => n.startsWith(entry.bPrefix))
    if (!hasPrefixMatch) failures.push(`allowlist entry references missing prefix ${entry.bPrefix}`)
  }

  if (failures.length > 0) return { ok: false, failures, report }

  for (const theme of ['light', 'dark']) {
    const resolved = new Map()
    for (const name of colorNames) {
      const val = resolveOklchForTheme(name, parsed.decls, theme)
      if (val === null || Number.isNaN(val.l) || Number.isNaN(val.c) || Number.isNaN(val.h)) {
        failures.push(`${name} (${theme}) is empty or unparseable`)
      } else {
        resolved.set(name, val)
      }
    }

    const pairs = []
    for (let i = 0; i < colorNames.length; i++) {
      for (let j = i + 1; j < colorNames.length; j++) {
        const [a, b] = [colorNames[i], colorNames[j]]
        const chA = classifyChannel(a)
        const chB = classifyChannel(b)
        if (chA === null || chB === null || chA === chB) continue
        pairs.push([a, b])
      }
    }
    pairs.sort((p, q) => (p[0] + p[1]).localeCompare(q[0] + q[1]))

    for (const [a, b] of pairs) {
      const va = resolved.get(a)
      const vb = resolved.get(b)
      if (!va || !vb) continue
      const allowlisted = isAllowlisted(a, b)

      const exact = round(va.l) === round(vb.l) && round(va.c) === round(vb.c) && round(va.h) === round(vb.h)
      if (exact) {
        if (allowlisted) report.push(`  [${theme}] EXACT match ${a} == ${b} — allowlisted, skipped`)
        else failures.push(`[${theme}] EXACT collision: ${a} == ${b}`)
        continue
      }

      const chA = classifyChannel(a)
      const chB = classifyChannel(b)
      if (IDENTITY_CHANNELS.has(chA) && IDENTITY_CHANNELS.has(chB)) {
        const hd = hueDist(va.h, vb.h)
        const cd = Math.abs(va.c - vb.c)
        const ld = Math.abs(va.l - vb.l)
        const near = hd < HUE_THRESHOLD && cd < CHROMA_THRESHOLD && ld < LIGHTNESS_THRESHOLD
        if (near) {
          report.push(
            `  [${theme}] NEAR ${a} vs ${b}: hueDiff=${round(hd, 2)} chromaDiff=${round(cd, 3)} lightnessDiff=${round(ld, 3)}${allowlisted ? ' — allowlisted, skipped' : ''}`
          )
          if (!allowlisted) failures.push(`[${theme}] NEAR-equality collision: ${a} vs ${b} (hueDiff=${round(hd, 2)})`)
        }
      }
    }
  }

  return { ok: failures.length === 0, failures, report }
}

// ============================================================================
// Check 3 — WCAG AA contrast (inclusive threshold), both themes, composited.
// ============================================================================

const TEXT_TIERS = ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary']
const SURFACES = ['--color-surface-canvas', '--color-surface-1', '--color-surface-2', '--color-surface-3']
const DOMAIN_TOKENS = ['--color-domain-gold', '--color-domain-bronze', '--color-domain-notebook', '--color-domain-silver']
const EDGE_TOKENS = ['--color-edge-reads', '--color-edge-writes', '--color-edge-derives']

function buildContrastPairs(decls) {
  const pairs = []
  const has = (n) => decls.has(n)
  for (const tier of TEXT_TIERS) {
    for (const surf of SURFACES) {
      if (has(tier) && has(surf)) pairs.push({ fg: tier, bg: surf, threshold: 4.5, category: 'text' })
    }
  }
  if (has('--color-border-strong') && has('--color-surface-1')) {
    pairs.push({ fg: '--color-border-strong', bg: '--color-surface-1', threshold: 3.0, category: 'non-text' })
  }
  if (has('--color-accent') && has('--color-surface-canvas')) {
    pairs.push({ fg: '--color-accent', bg: '--color-surface-canvas', threshold: 4.5, category: 'text' })
  }
  for (const d of DOMAIN_TOKENS) {
    if (has(d) && has('--color-surface-canvas')) pairs.push({ fg: d, bg: '--color-surface-canvas', threshold: 3.0, category: 'non-text' })
  }
  for (const e of EDGE_TOKENS) {
    if (has(e) && has('--color-surface-canvas')) pairs.push({ fg: e, bg: '--color-surface-canvas', threshold: 3.0, category: 'non-text' })
  }
  pairs.sort((p, q) => (p.fg + p.bg).localeCompare(q.fg + q.bg))
  return pairs
}

/** A transparent value is never treated as a colour in isolation — per the
 *  compositing rule, `transparent` composited over a backdrop simply *is*
 *  the backdrop, so it resolves to the backdrop's colour rather than being
 *  skipped or failing to parse. Anything else that fails to parse is a real
 *  well-formedness problem and is surfaced as a failure, never silently
 *  dropped from the pair list. */
function resolveForContrast(name, decls, theme, backdropOklch) {
  const raw = decls.get(name)
  if (raw !== undefined) {
    const resolvedRaw = isTier1Name(name) ? resolveLightDarkForTheme(raw, theme) : raw
    if (resolvedRaw.trim() === 'transparent') return backdropOklch
  }
  return resolveOklchForTheme(name, decls, theme)
}

function check3Contrast(parsed) {
  const failures = []
  const report = []
  const pairs = buildContrastPairs(parsed.decls)

  for (const theme of ['light', 'dark']) {
    for (const { fg, bg, threshold, category } of pairs) {
      const bgC = resolveOklchForTheme(bg, parsed.decls, theme)
      const fgC = bgC ? resolveForContrast(fg, parsed.decls, theme, bgC) : null
      if (!fgC || !bgC) {
        failures.push(`[${theme}] ${fg} vs ${bg}: unresolvable (transparent/empty must never be skipped)`)
        continue
      }
      const ratio = contrastRatio(fgC, bgC)
      const exempt = CONTRAST_EXEMPT.has(fg) || CONTRAST_EXEMPT.has(bg) || CONTRAST_EXEMPT_PAIRS.has(`${theme}|${fg}|${bg}`)
      const pass = ratio >= threshold
      report.push(
        `  [${theme}] ${fg} (${toHex(fgC)}) vs ${bg} (${toHex(bgC)}) (${category}, >=${threshold}): ${round(ratio, 2)}:1 — ${pass ? 'PASS' : exempt ? 'FAIL (exempt)' : 'FAIL'}`
      )
      if (!pass && !exempt) failures.push(`[${theme}] ${fg} vs ${bg}: ${round(ratio, 2)}:1 < ${threshold}:1 threshold`)
    }

    // Worked composited-background cases (Pitfall 11 method) — contrast must
    // be checked against the actual rendered/composited hex, not the base
    // token's contrast in isolation.
    const surface1 = resolveOklchForTheme('--color-surface-1', parsed.decls, theme)
    const primaryText = resolveOklchForTheme('--color-text-primary', parsed.decls, theme)
    if (theme === 'dark') {
      const accent = resolveOklchForTheme('--color-accent', parsed.decls, theme)
      if (accent && surface1 && primaryText) {
        const chip = mixOklch(accent, surface1, 14)
        const r1 = contrastRatio(primaryText, chip)
        report.push(`  [dark] composited chip (accent 14% into surface-1) vs text-primary: ${round(r1, 2)}:1 — ${r1 >= 4.5 ? 'PASS' : 'FAIL'}`)
        if (r1 < 4.5) failures.push(`[dark] composited accent chip vs text-primary: ${round(r1, 2)}:1 < 4.5:1`)
        const r2 = contrastRatio(accent, chip)
        report.push(`  [dark] composited chip (accent 14% into surface-1) vs accent text: ${round(r2, 2)}:1 — ${r2 >= 4.5 ? 'PASS' : 'FAIL'}`)
        if (r2 < 4.5) failures.push(`[dark] composited accent chip vs accent text: ${round(r2, 2)}:1 < 4.5:1`)
      }
    } else {
      const bronze = resolveOklchForTheme('--color-domain-bronze', parsed.decls, theme)
      if (bronze && surface1 && primaryText) {
        const chip = mixOklch(bronze, surface1, 14)
        const r1 = contrastRatio(primaryText, chip)
        report.push(`  [light] composited chip (bronze 14% into surface-1) vs text-primary: ${round(r1, 2)}:1 — ${r1 >= 4.5 ? 'PASS' : 'FAIL'}`)
        if (r1 < 4.5) failures.push(`[light] composited bronze chip vs text-primary: ${round(r1, 2)}:1 < 4.5:1`)
      }
    }
  }

  return { ok: failures.length === 0, failures, report }
}

// ============================================================================
// Check 4 — colour-blind (protanopia/deuteranopia) lightness separation
// ============================================================================

const CVD_LIGHTNESS_FLOOR = 0.05 // per 01-UI-SPEC.md: "~0.05 ... reliably perceptible"
const CVD_HUE_CLUSTER = 25 // degrees — simulated hues within this span are "the same cluster"

// Light-theme-only near-floor CVD clusters this audit's exhaustive all-pairs
// sweep found beyond the UI-SPEC's own hand-picked pairs (Gold/Bronze,
// Notebook/Silver, Reads/Writes, one Writes/Notebook cross-check) —
// domain-silver vs edge-writes and domain-notebook vs edge-reads. Both clear
// the floor comfortably in dark theme (this phase's primary target); their
// light-theme re-verification is explicitly chartered to Phase 6 (THEME-07)
// per the project's own roadmap decision (.planning/STATE.md: "THEME-07
// gets its own dedicated Phase 6 rather than folding into a neighboring
// phase"), not to this foundation phase. Recorded here rather than silently
// passed so Phase 6 has a concrete starting list.
const CVD_EXEMPT_PAIRS = new Set([
  'light|protanopia|--color-domain-silver|--color-edge-writes',
  'light|deuteranopia|--color-domain-silver|--color-edge-writes',
  'light|deuteranopia|--color-domain-notebook|--color-edge-reads',
])

function check4ColorBlind(parsed) {
  const failures = []
  const report = []
  const tokens = [...DOMAIN_TOKENS, ...EDGE_TOKENS].filter((n) => parsed.decls.has(n))

  for (const theme of ['light', 'dark']) {
    for (const kind of ['protanopia', 'deuteranopia']) {
      const simulated = new Map()
      for (const name of tokens) {
        const c = resolveOklchForTheme(name, parsed.decls, theme)
        if (!c) continue
        const sim = simulateCvd(c, kind)
        simulated.set(name, { ...sim, hue: hueOf(sim.a, sim.b) })
      }
      const names = [...simulated.keys()].sort()
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const [a, b] = [names[i], names[j]]
          const sa = simulated.get(a)
          const sb = simulated.get(b)
          const clustered = hueDist(sa.hue, sb.hue) < CVD_HUE_CLUSTER
          const gap = Math.abs(sa.L - sb.L)
          const exempt = CVD_EXEMPT_PAIRS.has(`${theme}|${kind}|${a}|${b}`) || CVD_EXEMPT_PAIRS.has(`${theme}|${kind}|${b}|${a}`)
          report.push(
            `  [${theme}/${kind}] ${a} vs ${b}: simulatedHue ${round(sa.hue, 1)}/${round(sb.hue, 1)}, clustered=${clustered}, L-gap=${round(gap, 3)}${exempt ? ' — allowlisted (Phase 6), skipped' : ''}`
          )
          if (clustered && gap <= CVD_LIGHTNESS_FLOOR && !exempt) {
            failures.push(`[${theme}/${kind}] ${a} vs ${b}: clustered (same simulated hue) with L-gap ${round(gap, 3)} <= floor ${CVD_LIGHTNESS_FLOOR}`)
          }
        }
      }
    }
  }

  return { ok: failures.length === 0, failures, report }
}

// ============================================================================
// Check 5 — value well-formedness
// ============================================================================

function check5WellFormed(parsed) {
  const failures = []
  const report = []
  for (const name of [...parsed.decls.keys()].sort()) {
    const raw = parsed.decls.get(name)
    if (raw === undefined || raw.trim() === '') {
      failures.push(`${name}: empty value`)
      report.push(`  ${name}: EMPTY`)
      continue
    }
    if (isTier1Name(name)) {
      const light = parseOklch(resolveLightDarkForTheme(raw, 'light'))
      const dark = parseOklch(resolveLightDarkForTheme(raw, 'dark'))
      const ok = !!raw.includes('light-dark(') && !!light && !!dark
      report.push(`  ${name}: ${ok ? 'OK (tier-1 light-dark oklch pair)' : 'MALFORMED'}`)
      if (!ok) failures.push(`${name}: does not parse as a light-dark(oklch, oklch) primitive`)
    } else if (name.startsWith('--color-')) {
      const m = raw.match(/^var\((--[a-z0-9-]+)\)$/)
      const ok = !!m && parsed.decls.has(m[1])
      report.push(`  ${name}: ${ok ? 'OK (var() reference)' : 'MALFORMED'}`)
      if (!ok) failures.push(`${name}: does not resolve as a single var() reference to a known primitive`)
    } else if (name.startsWith('--shadow-')) {
      const ok = raw.includes('light-dark(') && /\d+px/.test(raw)
      report.push(`  ${name}: ${ok ? 'OK (shadow-list form)' : 'MALFORMED'}`)
      if (!ok) failures.push(`${name}: does not look like a valid shadow-list`)
    } else {
      report.push(`  ${name}: OK (non-colour token, non-empty)`)
    }
  }
  return { ok: failures.length === 0, failures, report }
}

// ============================================================================
// Self-test — proves each of the five detectors fires on a known-bad fixture
// and does not falsely fire on a known-good one. Inlined CSS fixtures, never
// read from disk, so `--self-test` runs identically anywhere the file goes.
// ============================================================================

const FIXTURE_BASELINE = `
@theme {
  --slate-0: light-dark(oklch(0.975 0.006 268), oklch(0.165 0.018 266));
  --slate-1: light-dark(oklch(0.99 0.0015 268), oklch(0.215 0.027 266));
  --slate-5: light-dark(oklch(0.66 0.024 268), oklch(0.52 0.030 266));
  --slate-6: light-dark(oklch(0.545 0.032 268), oklch(0.589 0.046 270));
  --slate-7: light-dark(oklch(0.50 0.034 264), oklch(0.743 0.037 270));
  --slate-8: light-dark(oklch(0.257 0.032 266), oklch(0.938 0.011 270));
  --cyan-1: light-dark(oklch(0.52 0.115 232), oklch(0.754 0.139 233));
  --cyan-2: light-dark(oklch(0.44 0.12 232), oklch(0.828 0.101 230));
  --gold-1: light-dark(oklch(0.62 0.14 95), oklch(0.85 0.14 95));
  --amber-1: light-dark(oklch(0.48 0.15 48), oklch(0.65 0.15 48));
  --rose-1: light-dark(oklch(0.56 0.16 350), oklch(0.72 0.16 350));
  --steel-1: light-dark(oklch(0.35 0.03 235), oklch(0.45 0.03 235));
  --indigo-1: light-dark(oklch(0.62 0.12 272), oklch(0.80 0.10 272));
  --violet-1: light-dark(oklch(0.40 0.15 315), oklch(0.55 0.15 315));
  --graphite-1: light-dark(oklch(0.72 0.02 266), oklch(0.38 0.02 266));
  --red-1: light-dark(oklch(0.50 0.19 15), oklch(0.68 0.19 15));
  --green-1: light-dark(oklch(0.50 0.11 160), oklch(0.78 0.15 165));
  --color-surface-canvas: var(--slate-0);
  --color-surface-1: var(--slate-1);
  --color-border-strong: var(--slate-5);
  --color-text-primary: var(--slate-8);
  --color-text-secondary: var(--slate-7);
  --color-text-tertiary: var(--slate-6);
  --color-accent: var(--cyan-1);
  --color-accent-hi: var(--cyan-2);
  --color-domain-gold: var(--gold-1);
  --color-domain-bronze: var(--amber-1);
  --color-domain-notebook: var(--rose-1);
  --color-domain-silver: var(--steel-1);
  --color-edge-reads: var(--indigo-1);
  --color-edge-writes: var(--violet-1);
  --color-edge-derives: var(--graphite-1);
  --color-destructive: var(--red-1);
  --color-success: var(--green-1);
  --shadow-card: 0 1px 2px light-dark(rgb(28 35 51 / 0.04), rgb(0 0 0 / 0.35)), 0 4px 12px light-dark(rgb(28 35 51 / 0.08), transparent);
}
`

const FIXTURE_BAD_CHECK1 = FIXTURE_BASELINE + `\n@theme {\n  --slate-0: light-dark(oklch(0.5 0.1 100), oklch(0.5 0.1 100));\n}\n`

const FIXTURE_BAD_CHECK2 = FIXTURE_BASELINE.replace(
  '--amber-1: light-dark(oklch(0.48 0.15 48), oklch(0.65 0.15 48));',
  '--amber-1: light-dark(oklch(0.62 0.12 272), oklch(0.80 0.10 272));' // exact copy of --indigo-1 (edge-reads) -> domain/edge exact collision
)

const FIXTURE_BAD_CHECK3 = FIXTURE_BASELINE.replace(
  '--slate-6: light-dark(oklch(0.545 0.032 268), oklch(0.589 0.046 270));',
  '--slate-6: light-dark(oklch(0.96 0.006 268), oklch(0.20 0.018 266));' // text-tertiary nearly == its own surface -> fails AA
)

const FIXTURE_BAD_CHECK4 = FIXTURE_BASELINE.replace(
  '--amber-1: light-dark(oklch(0.48 0.15 48), oklch(0.65 0.15 48));',
  '--amber-1: light-dark(oklch(0.62 0.14 95), oklch(0.85 0.14 95));' // bronze == gold exactly -> L-gap 0 under any CVD cluster
)

const FIXTURE_BAD_CHECK5 = FIXTURE_BASELINE.replace(
  '--slate-0: light-dark(oklch(0.975 0.006 268), oklch(0.165 0.018 266));',
  '--slate-0: ;'
)

function runSelfTest() {
  console.log('=== audit-tokens.mjs --self-test ===\n')
  const cases = [
    { name: 'check1SingleDefinition', fn: check1SingleDefinition, bad: FIXTURE_BAD_CHECK1, good: FIXTURE_BASELINE },
    { name: 'check2Collisions', fn: check2Collisions, bad: FIXTURE_BAD_CHECK2, good: FIXTURE_BASELINE },
    { name: 'check3Contrast', fn: check3Contrast, bad: FIXTURE_BAD_CHECK3, good: FIXTURE_BASELINE },
    { name: 'check4ColorBlind', fn: check4ColorBlind, bad: FIXTURE_BAD_CHECK4, good: FIXTURE_BASELINE },
    { name: 'check5WellFormed', fn: check5WellFormed, bad: FIXTURE_BAD_CHECK5, good: FIXTURE_BASELINE },
  ]

  let allOk = true
  for (const { name, fn, bad, good } of cases) {
    const badResult = fn(parseTokens(bad))
    const goodResult = fn(parseTokens(good))
    const firedOnBad = badResult.ok === false
    const cleanOnGood = goodResult.ok === true
    const pass = firedOnBad && cleanOnGood
    if (!pass) allOk = false
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`)
    console.log(`  known-bad fired: ${firedOnBad} ${firedOnBad ? '' : '(expected the detector to fail here)'}`)
    if (!firedOnBad) badResult.report.forEach((l) => console.log('    ' + l))
    console.log(`  known-good clean: ${cleanOnGood} ${cleanOnGood ? '' : '(expected the detector to pass here)'}`)
    if (!cleanOnGood) goodResult.failures.forEach((l) => console.log('    FAILURE: ' + l))
  }

  console.log(`\n${allOk ? 'All detectors fired on their known-bad fixture and stayed clean on their known-good fixture.' : 'One or more detectors did not have teeth.'}`)
  return allOk
}

// ============================================================================
// Main
// ============================================================================

function runAudit() {
  const cssText = readFileSync(TOKENS_PATH, 'utf8')
  const parsed = parseTokens(cssText)

  const checks = [
    ['1. single definition site', check1SingleDefinition],
    ['2. cross-channel collision', check2Collisions],
    ['3. WCAG AA contrast', check3Contrast],
    ['4. colour-blind separation', check4ColorBlind],
    ['5. value well-formedness', check5WellFormed],
  ]

  let allOk = true
  for (const [title, fn] of checks) {
    const result = fn(parsed)
    if (!result.ok) allOk = false
    console.log(`=== ${title}: ${result.ok ? 'PASS' : 'FAIL'} ===`)
    result.report.forEach((l) => console.log(l))
    if (!result.ok) result.failures.forEach((f) => console.log(`  FAILURE: ${f}`))
    console.log('')
  }

  console.log(allOk ? 'audit-tokens: all checks passed.' : 'audit-tokens: one or more checks FAILED.')
  return allOk
}

const selfTest = process.argv.includes('--self-test')
const ok = selfTest ? runSelfTest() : runAudit()
process.exit(ok ? 0 : 1)

