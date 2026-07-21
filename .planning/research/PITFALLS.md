# Pitfalls Research

**Domain:** Dark+light-parity frontend rebuild of a graph-canvas data lineage tool, with a first-class write path into Microsoft Purview (Atlas-family governance catalog)
**Researched:** 2026-07-20
**Confidence:** MEDIUM-HIGH — codebase claims (color token collision, font stack, current architecture) are HIGH confidence (direct file reads); Purview/Atlas API behavior is MEDIUM (official Microsoft Learn docs plus cross-referenced Apache Atlas community reports — Purview's Atlas-derived core makes Atlas known-issues a reasonable proxy, but Microsoft doesn't publish exhaustive throttling numbers); general UI/graph/accessibility pitfalls are MEDIUM (cross-referenced web search, no single canonical source)

This file assumes `.planning/research/STACK.md`, `FEATURES.md`, and `ARCHITECTURE.md` (already written) as context and does not repeat their content. Where a pitfall's *solution* is already implied by those files (e.g. OKLCH tokens, Zustand stores, TanStack Query dry-run flag), this file cites it rather than re-deriving it — its job is the failure mode and the warning signs, not the stack choice.

---

## Critical Pitfalls

### Pitfall 1: Purview write safety is treated as a UI feature instead of a system design problem

**What goes wrong:** The team builds a "preview → confirm → push" screen and considers Purview-write-safety solved, without addressing the underlying failure modes that make a *preview* untrustworthy: qualified-name collisions that silently overwrite existing lineage, partial-batch failure leaving half a push applied, or a preview computed from stale local state that no longer matches what's actually in Purview by the time "confirm" is clicked. The confirmation dialog becomes theater — it asks the user to approve a plan that may not execute as shown.

**Why it happens:** The backend's `apply: boolean` flag on the write endpoints (`lineage_push.py`, `definitions.py`, `dataproduct.py`) makes "dry run" look trivially solved — flip a flag, get the same payload back without sending it. That's necessary but not sufficient: it proves the *payload the app intends to send* is correct, not that *what Purview will do with it* matches what the preview implied. Qualified-name overwrite, partial-batch failure, and stale-read races all happen *inside* Purview's own write behavior, which a same-payload dry run cannot observe.

**How to avoid:** Treat write safety as five separate sub-problems (each detailed below in Pitfalls 2-6), not one preview screen. At minimum: (1) resolve/verify qualified names against live Purview state immediately before executing, not against a preview computed minutes earlier; (2) make writes idempotent and batched so partial failure has a defined, inspectable end state; (3) never let "preview looked fine" substitute for "confirmed post-write state matches intent."

**Warning signs:** The spec for the Purview-push destination has exactly one "preview" screen and one "confirm" button with no mention of re-verification at execute time, no per-entity result reporting, and no distinction between "created" and "overwrote an existing process."

**Phase to address:** Purview-push destination phase — this is the phase's actual design problem, not a late-stage add-on. Should be scoped explicitly in that phase's plan, not discovered during execution.

---

### Pitfall 2: Qualified-name collision silently overwrites existing lineage in Purview

**What goes wrong:** Purview's Atlas-derived data model identifies every entity (dataset or process) by a **string qualified name**, not just a GUID. If a lineage push computes or reuses a qualified name that already exists — even unintentionally, e.g. because the regex-derived table/notebook naming scheme collides with something already curated in Purview by a human or another tool — the existing entity's relationships are overwritten, not appended. There is no confirmation step inside Atlas/Purview itself; the overwrite is silent from the API's point of view. Apache Atlas's own known-issues history documents adjacent cases: the same logical operation (e.g. `INSERT OVERWRITE`) can be recorded with a qualified name whose casing differs depending on which connector/order of operations wrote it (`insert overwrite table` in lowercase vs `CTAS` producing uppercase for the same cluster), so two logically-identical writes can either collide unexpectedly *or* fail to collide when they should, producing either an unwanted overwrite or an unwanted duplicate.

**Why it happens:** This app's Phase 1 lineage is regex-derived from notebook code (`parser.py`) and Fabric metadata (GUIDs), giving it its own qualified-name construction logic that was never designed against Purview's actual existing catalog contents. The write path was built and tested against an empty or app-controlled slice of Purview; a real tenant will already have entities created by native Fabric scans, other tools, or previous manual pushes.

**How to avoid:** Before any write, resolve the target qualified name against live Purview (a read, not a guess) and classify the outcome as **create** (no existing entity), **update-own** (existing entity was created by this app in a prior push — safe to update), or **overwrite-foreign** (existing entity was not created by this app — block by default, require explicit opt-in per entity). Surface this classification in the preview/diff screen as the single most important line item, ahead of any other detail. Never construct a qualified name purely from regex-derived, unstable naming — anchor it to the same GUID-based identifiers `purview/ingest.py` already uses for reads, since PROJECT.md explicitly keeps GUIDs as node IDs for exactly this reason.

**Warning signs:** The preview screen shows what will be *sent* but not what will be *replaced*; there's no read-before-write step; qualified names are constructed by string concatenation from parser output rather than reused from a prior Purview read.

**Phase to address:** Purview-push destination phase, specifically the preview/diff step (`steps/Preview.tsx` per the architecture's proposed structure). This may require a backend addition (a "resolve and classify" endpoint) — flag it as a backend dependency early, the same way FEATURES.md already flags the dry-run/diff chain as the largest backend dependency in the milestone.

---

### Pitfall 3: Machine-generated (regex-derived) content silently overwrites human-curated Purview descriptions

**What goes wrong:** A steward has written a careful, business-context description for a column or table directly in Purview. This app's definitions-import or lineage-push flow later writes a machine-derived value (a regex-guessed description, an inferred transform label) to the same field, and the human-authored text is gone with no record it ever existed. Cross-industry data-catalog guidance is blunt about this: "any system capable of silently overwriting steward-authored content is a liability, not an asset" — automation should fill gaps, not override human judgment.

**Why it happens:** The existing `definitions.py` fuzzy-match/apply flow was built around the assumption that the spreadsheet is the source of truth being *imported into* Purview — it wasn't designed against the case where Purview already has better information than the spreadsheet. Once this becomes a first-class, easy-to-use UI destination (this milestone's explicit goal), the *volume* of writes goes up, and so does the chance of an accidental overwrite of something a human already curated well.

**How to avoid:** Default to **write-only-if-empty** for any field that plausibly has a human author (descriptions, glossary term assignments) — this is the standard mitigation pattern from data-catalog governance guidance. When a target field is already populated, require an explicit per-field "overwrite anyway" action in the UI, not a blanket batch confirmation. The diff/preview screen (Pitfall 2) should show the *current value* next to the *proposed value* for every field being written, not just the proposed value — a blind proposal invites blind confirmation.

**Warning signs:** The definitions-apply flow writes description fields unconditionally whenever a spreadsheet row matches; the preview shows only "what we will set," never "what is currently there."

**Phase to address:** Purview-push destination phase (definitions-import sub-flow specifically). Verify this against the *existing* `definitions.py` behavior early — it may already have this gap today, in which case it's a pre-existing bug this milestone should fix while giving the flow a first-class UI, not just a new problem to avoid introducing.

---

### Pitfall 4: Partial-batch failure leaves Purview in an inconsistent, unreported state

**What goes wrong:** A push targets N entities; entity 8 of 14 fails (timeout, 429, malformed payload) partway through a batch call. Purview now has 7 entities updated and 7 not, and the app either (a) reports a single pass/fail for the whole operation, hiding which 7 succeeded, or (b) crashes/loses the response before recording anything, leaving the user with no way to know what state Purview is actually in without manually cross-checking the portal. There is no atomic multi-entity transaction in Atlas/Purview's write API — every batch is a sequence of individual operations that can fail independently.

**Why it happens:** The existing write orchestration (`writer.py`, `actions.py`) was built to *execute* writes, not necessarily to report granular per-item outcomes — FEATURES.md already flags this as a real backend gap ("if they're synchronous, all-or-nothing calls, this milestone needs a scoped backend task"). Batching itself is also somewhat forced: Purview's bulk entity endpoint exists (`POST /entity/bulk`) but real-world guidance (including this app's own likely usage pattern) still recommends small batches with multiple calls for reliability, meaning any push of meaningful size is inherently a sequence, not one atomic action.

**How to avoid:** Backend must return **per-entity results**, not a single batch-level pass/fail — success/failure/skipped per targeted entity, with the specific error for failures. Frontend must render this as a results table after execution (`steps/Results.tsx`), not a toast. Retry must operate on the failed subset only, never the whole batch (re-running succeeded items risks re-triggering the qualified-name-overwrite problem from Pitfall 2 on entities that already succeeded). If the backend genuinely cannot report per-item results without a larger rework, that is a go/no-go gate for this milestone's Purview-push scope, not a detail to discover during frontend polish.

**Warning signs:** A push either fully succeeds or the UI just says "push failed" with no indication of which entities landed; there's no retry-subset capability; results aren't persisted anywhere the user can return to after closing the results screen.

**Phase to address:** Purview-push destination phase. Confirm `writer.py`/`actions.py`'s actual current return shape *before* designing the Results.tsx UI — this determines whether a backend task must be scoped alongside the frontend work.

---

### Pitfall 5: No verification that a push actually landed — "see it land" becomes a false confirmation

**What goes wrong:** The app shows a green checkmark immediately after the write call returns 200, but Purview is not guaranteed to reflect that write on the very next read — eventual consistency in distributed catalog/search backends means an immediate re-fetch can return stale (pre-write) data, making a correctly-executed write look like it silently failed, or worse, making the user believe a write succeeded when the response was a false positive from a queued-but-not-yet-processed operation.

**Why it happens:** PROJECT.md's stated success criterion is literally "see confirmation that it landed" — this is explicitly designed as a round-trip re-fetch of the pushed entities through the existing Purview read path (`purview/ingest.py`). That's the right idea, but a naive immediate re-fetch is exactly where eventual-consistency races bite: the read path that proves success is the same one likely to return a stale snapshot if fired too eagerly.

**How to avoid:** Don't treat "the write call returned 200" as proof of landing. Treat the round-trip re-fetch as its own step with its own state (pending/confirmed/timed-out), poll with backoff for a bounded window (a few seconds to tens of seconds, not indefinitely) rather than firing exactly once, and if the window expires without the expected change appearing, report "write accepted, not yet visible — check again shortly" rather than either a false success or a false failure. This is a UX state the current design doesn't have a slot for yet (it only has "pushed" and presumably "confirmed") — add the intermediate "pending confirmation" state explicitly.

**Warning signs:** The "see it land" re-fetch fires once, immediately after the write response, with no retry/backoff and no distinct UI state for "write accepted, confirmation pending."

**Phase to address:** Purview-push destination phase, specifically `steps/Results.tsx` and the post-push re-fetch flow. Should be designed alongside Pitfall 4's per-entity results, since both live in the same screen.

---

### Pitfall 6: Pushing regex-derived (approximate) lineage into Purview without provenance, so an approximation acquires false authority

**What goes wrong:** Phase 1's lineage is explicitly acknowledged (`.planning/codebase/CONCERNS.md`) as brittle, regex-based, with known false positives/negatives on CTEs, subqueries, and complex joins. Once such an edge is pushed into Purview — a production governance catalog other people and possibly automated compliance/impact-analysis tooling will trust — it stops looking like a guess and starts looking like ground truth. A colleague doing real impact analysis ("what breaks if I change this column") now trusts a lineage edge that was a regex pattern match, with no way to tell the difference from a Purview-native, Fabric-scanned edge.

**Why it happens:** The write path was built to push lineage, full stop — there was no design requirement yet (this milestone introduces it) to distinguish *what kind* of lineage is being pushed. FEATURES.md already identifies confidence/provenance tagging as a table-stakes trust feature for the exploration UI; the same tagging is even more critical at the write boundary, because exploration-UI mistakes are locally contained (one user, one session) while a Purview write propagates the mistake into a shared system of record.

**How to avoid:** Provenance tagging (declared vs. inferred, per FEATURES.md) must gate the push flow, not just decorate the exploration canvas: the scope-selection step should visually distinguish inferred edges in the selection, the preview should flag every inferred edge being pushed as a distinct category (not mixed in with Purview-native/declared edges), and the confirmation copy should say something like "3 of 14 relationships being written were inferred from notebook code parsing, not confirmed against Fabric's own metadata" rather than a generic "push 14 relationships?" Consider whether inferred edges should require a *second*, explicit confirmation step beyond the standard one — this is the one place in the app where "confirm twice" is proportionate to risk, not friction for its own sake.

**Warning signs:** The Purview-push scope selector treats declared and inferred edges identically; the confirmation dialog doesn't mention confidence level at all.

**Phase to address:** Purview-push destination phase, but has a hard dependency on the confidence/provenance tagging work FEATURES.md already scopes as a P1 exploration feature — sequence the tagging work before or alongside the push flow, not after.

---

### Pitfall 7: Domain color and edge-type color are literally identical in the current token system — colour channels already collide before dark-mode work even starts

**What goes wrong:** In the current `App.css`, `--writes` (edge-type color) and `--notebook` (domain color) are the *exact same hex value* in both themes: `#8b5cf6` / `#a78bfa`. A "writes" edge and a "Notebook" domain node are visually indistinguishable by color alone today. This isn't a hypothetical dark-mode risk — it's a verified, present-tense bug in the color system this rebuild inherits, and it will get worse, not better, if the new palette is derived carelessly, because the rebuild is explicitly overloading three independent channels (domain, edge-type, interaction-state) onto one hue dimension on the same canvas.

**Why it happens:** The token system grew by adding new named colors ad hoc (`--bronze`, `--writes`, `--notebook`, `--accent`...) without a shared palette design that guaranteed each *semantic channel* (domain vs. edge-type vs. state) used a visually and hue-distinct sub-palette. Two colors chosen independently, at different times, for different purposes, coincidentally landed on the same violet.

**How to avoid:** Before assigning any new hex/OKLCH values, explicitly partition the palette into three non-overlapping hue families — one for domain (Bronze/Silver/Gold/Notebook, an open-ended, currently-4-value set), one for edge-type (reads/writes/derives, closed 3-value set), one for interaction-state (selected/traced/dimmed, typically communicated via *saturation/opacity/motion* rather than hue at all, see Pitfall 8). Verify programmatically, not by eye: compute perceptual (e.g. CIEDE2000 or simple OKLCH hue-angle) distance between every pair of tokens that can appear adjacent on the same canvas, and fail the palette if any two semantically-different tokens land within a confusable distance. This is a natural fit for the OKLCH-based palette already recommended in STACK.md — OKLCH's separated hue axis makes "reserve hue ranges 260-290° for interaction state, 20-50°/150-170°/0-15°/270-300° for the four domains, and a disjoint 200-220°/280-300°/220-240° for the three edge types" an explicit, checkable design rule instead of an eyeballed guess.

**Warning signs:** Any two tokens across different semantic channels share a hex value (grep the token file for duplicate values — this is literally how this pitfall was found in the current codebase); the palette was assigned by picking "nice" colors one at a time rather than from a pre-partitioned hue plan.

**Phase to address:** Design tokens phase (the milestone's first/foundational phase per ARCHITECTURE.md's build order) — this must be resolved before any canvas rebuild work starts, since both canvases will hardcode assumptions about which token means what.

---

### Pitfall 8: Colour-blind users cannot distinguish Bronze from Gold from Notebook — and interaction state compounds the problem

**What goes wrong:** Roughly 8% of men (deuteranopia + protanopia combined) cannot reliably distinguish red/green/amber/brown hues from each other. This app's domain palette is at specific, checkable risk: Bronze (`#d98a3a` light / `#e0a05c` dark — amber/orange) and Gold (`#16a06b` light / `#34d39c` dark — a green, chosen presumably because "gold" reads as a warm-associated color but is implemented as green) sit close together in hue for a deuteranope, where oranges and mid-saturation greens both collapse toward a similar muddy yellow-brown. Layer interaction state on top — a "traced" or "selected" node changing saturation/brightness of its domain color — and a color already borderline-distinguishable can become fully indistinguishable once state changes shift its lightness/chroma too.

**Why it happens:** Colors were very likely chosen for aesthetic/brand association ("gold" should look gold-ish, "bronze" should look bronze-ish) rather than perceptual distinguishability under color-vision deficiency — this is the single most common failure mode in categorical-color design generally, not specific to this app.

**How to avoid:** Vary domain colors on **both hue and lightness**, not hue alone — two colors that differ only in hue at matched lightness are the exact case that collapses under deuteranopia/protanopia. Cross-check the final 4-color domain palette (Bronze/Silver/Gold/Notebook) against a deuteranopia/protanopia simulator (Coblis, or a programmatic simulation library) before it ships, not after a colorblind user reports a bug. Where color distinguishability genuinely can't be guaranteed at the domain-legend's small dot/tick size, add a second encoding channel: PROJECT.md already explicitly approves a domain-color *legend* on the knowledge graph (an exception to the no-legend rule) — extend that legend to include a redundant shape or position cue (e.g., consistent left-to-right domain ordering, or a small glyph within the legend swatch only, not on every node) so the legend itself is decodable without color. Do not rely on the Wong-palette exact hues verbatim (they're tuned for scientific-figure contexts, not necessarily this brand), but do use the *principle*: reference the Wong 8-color colorblind-safe categorical set as a distance check, not a literal swap-in.

**Warning signs:** No colorblind simulation was ever run against the shipped palette; domain colors differ mainly in hue at similar lightness/saturation; the only way to tell Bronze from Gold from Notebook is the exact hue, with no lightness or secondary cue backing it up.

**Phase to address:** Design tokens phase, same as Pitfall 7 — run the simulation check as an explicit verification step before the palette is declared final, and again after dark-mode/light-mode values are both set (a palette that passes in light mode can fail in dark mode independently, since lightness relationships shift).

---

### Pitfall 9: Pure black backgrounds cause halation and force elevation to be redesigned from scratch — "just invert the light palette" does not work

**What goes wrong:** A team designs the dark theme first (per the milestone's dark-first decision), reaches for `#000000` or near-black because it looks "correctly dark" in isolation, and ships a canvas where bright text and thin high-contrast lines (SVG edges, node borders) produce a glowing "halation" effect — especially visible to the ~1-in-3 users with astigmatism, and especially bad on a graph canvas with many thin strokes rendered against black, which is close to worst-case for this effect. Separately, the existing `--shadow` token (`0 1px 2px rgba(...) , 0 8px 28px rgba(...)`) is close to invisible on a near-black surface — shadows work by being a darker region against a lighter surface, and there is very little room to go darker than an already-near-black background. Elevation (which card is "on top," which panel is a modal vs. inline) silently stops reading once shadow is the only mechanism carrying it.

**Why it happens:** Shadow-based elevation is a light-mode-native technique (it models a light source casting onto a plane) that was never designed to have to work in a value range where "darker than the surface" barely exists as a usable range. Halation happens because human vision genuinely perceives extreme contrast between bright foreground and near-black background as glow, not because of a specific implementation mistake — it's a property of contrast level, not code.

**How to avoid:** Use a dark gray (something in the `#0c0e18`-to-`#141826` range, which is already what this app's current dark tokens use for `--bg`/`--surface` — good instinct already present) rather than true black, and keep it that way rather than "purifying" it during the rebuild. Replace shadow-carries-elevation with **surface-lightness-carries-elevation**: each elevation tier gets a progressively lighter background tone (this is already latent in the existing `--surface` vs `--surface-2` two-tier system; the rebuild should extend it to 3-4 explicit elevation tiers with named tokens, e.g. `--surface-0` canvas, `--surface-1` card, `--surface-2` popover/modal, `--surface-3` topmost overlay) plus a thin 1px border at a lightness between the two adjacent surfaces. Keep a very subtle shadow as a secondary cue (it still helps at shallow elevation differences and costs nothing to keep), but never make it the *only* signal. For text: avoid pure `#ffffff` on the near-black surface too — this app's existing `--text: #e8eaf2` (dark mode) is already a good off-white choice; keep that discipline as new tokens are added, don't let a new component quietly introduce `#fff`.

**Warning signs:** Any new dark-theme token introduces `#000` or `#fff` at full opacity; a design review can't tell which of two adjacent panels is "above" the other with the monitor brightness turned down (removes the shadow's already-weak contribution); designers describe dark-mode halation only after implementation, not as a checked constraint during design.

**Phase to address:** Design tokens phase — the elevation-tier token scheme must exist before any canvas or shell component is built against it, since retrofitting a 2-tier surface system into a 4-tier one after 20+ components hardcode `var(--surface)` is expensive rework.

---

### Pitfall 10: Saturated accent/status colors that look correct in light mode "vibrate" or overpower on a near-black canvas

**What goes wrong:** A color tuned for light-mode contrast (this app's own documented case: `#4f5bd5` indigo accent, explicitly flagged in PROJECT.md as "a light-mode accent" that doesn't survive translation) either disappears (too dark relative to a black background) or, if naively brightened/saturated to compensate, starts to visually vibrate — a known perceptual effect where highly saturated colors at high value against a very dark background create an uncomfortable, buzzing appearance, especially at small sizes (edge strokes, tick dots) and especially for red/orange/magenta hues.

**Why it happens:** Perceived brightness and comfort are not linear functions of hex/RGB values — a color that's "medium bright" in sRGB terms can be uncomfortably intense against near-black while looking muted against near-white, because contrast ratio and perceptual intensity both compound in the dark direction. Mechanically inverting a light palette (swap light/dark endpoints, keep hue/saturation) ignores this and is the single most common shortcut that produces this failure.

**How to avoid:** Dark-mode colors generally need **lower saturation and higher lightness** than their light-mode counterparts to read as equally "present" without vibrating — this is exactly the adjustment STACK.md's OKLCH recommendation makes possible by construction (hold hue constant, deliberately tune lightness/chroma per theme rather than deriving dark from light by inversion). Test every load-bearing color (accent, domain set, edge-type set) at the *actual small sizes* they'll render at (a 1.5px edge stroke, an 8px tick dot) against the actual near-black canvas background, not just as a large swatch in a design tool — vibration is much more visible at small/thin sizes than in a color-picker preview.

**Warning signs:** The dark-mode palette was generated by a script that inverts lightness only, keeping saturation/hue identical to light mode; colors were approved as swatches in a design tool, never checked at in-canvas stroke/dot sizes against the real background.

**Phase to address:** Design tokens phase, verified again during the canvas-rebuild phases once real edge strokes and tick dots exist to check against (a token can look fine as an isolated swatch and still vibrate once rendered as a 1.5px line — budget a second look, not just token-definition-time review).

---

### Pitfall 11: WCAG contrast requirements are checked once against a single background, not against every surface tier a token actually appears on

**What goes wrong:** Text color `--text-2` is checked for contrast against `--bg` and passes 4.5:1 (WCAG AA normal text) or the relevant large-text 3:1 threshold, but the same token is also used inside a card (`--surface`), inside a hover state (`--surface-2`), and inside a colored pill/badge background (`color-mix(in srgb, var(--bronze) 12%, transparent)`) — several of which have different effective backgrounds and may fail contrast even though the "primary" check passed. This app has many such compound surfaces already (`.src-chip`, `.pill.verified`, `.col.sel` with an inset box-shadow border) where a token's *effective* contrast depends on layering, not just its nominal background variable.

**Why it happens:** Contrast auditing tools and manual review typically check "text token against its declared CSS variable background," which is correct for simple cases but misses compound/layered surfaces where the actual rendered background is a blend (opacity, color-mix, semi-transparent chip backgrounds) different from any single token.

**How to avoid:** Audit contrast against **rendered, composited backgrounds**, not just declared token pairs — for every text-on-colored-background combination (chips, pills, badges, the confidence/provenance edge treatments from Pitfall 6), compute the actual composited color (accounting for opacity/color-mix) and check that against WCAG AA thresholds (4.5:1 normal text, 3:1 large text/UI components — note UI component and graphical-object contrast has its own WCAG 1.4.11 threshold of 3:1, separately relevant for the SVG edge strokes and node borders on the canvas, which are not "text" but are still meaningful UI information). Do this per theme — a chip background tuned to pass in dark mode does not automatically pass in light mode with the same opacity percentage, since `color-mix` percentages produce different absolute contrast depending on the base surface lightness.

**Warning signs:** Contrast was checked with a browser devtools "pick two colors" tool against declared tokens only; no check exists for `color-mix()`-derived translucent backgrounds; light-mode contrast wasn't re-verified independently of dark-mode contrast on the same components.

**Phase to address:** Design tokens phase for the systemic check (build a checklist/script, not one-off spot checks); re-verify per-component during each canvas/shell phase since compound surfaces are introduced incrementally as components are built.

---

### Pitfall 12: The "light theme at full parity" decision quietly degrades into "light theme is dark theme's colors, lightness-inverted" under deadline pressure

**What goes wrong:** PROJECT.md already names this outcome explicitly as a risk worth flagging (`⚠️ Revisit` on the parity decision). The concrete failure mode: dark-theme work happens first (correctly, since it's the primary/first-designed mode), gets polished with real design review time, and light-mode tokens get filled in mechanically at the end via the same OKLCH-hue-held-constant transform used for the dark-mode derivation in STACK.md's Theming section — except that transform was designed to derive *dark from light*, and reversing its direction without equivalent design judgment produces a light theme that is technically present, technically passes contrast checks, and still looks like an afterthought: domain colors that felt vivid and glowing on black look washed out or slightly wrong-hued on white, because a mechanical lightness inversion doesn't account for the fact that human color perception isn't symmetric between dark and light surrounds.

**Why it happens:** Every incentive in a deadline-driven rebuild pushes toward "ship the primary mode well, backfill the secondary mode fast" — this is precisely what "accepted at roughly 2x the token and canvas-tuning cost... against the recommendation of dark-first/light-supported" (PROJECT.md, STACK.md) is naming as the risk, but naming the risk doesn't prevent the schedule pressure that causes it.

**How to avoid:** Budget and track light-mode design review as a **separate, explicitly-scheduled line item per component/canvas**, not an assumed side effect of the dark-mode work — this needs to be visible in phase planning as its own checklist item ("light-mode domain palette reviewed independently," "light-mode elevation tiers reviewed independently"), not folded silently into "build the token system." Use vanilla-extract's theme-contract pattern (STACK.md's alternative-considered option) if there's real appetite for *compile-time-enforced* parity, since it makes "light theme token is missing/unset" a build error rather than a silent gap — worth reconsidering even though Tailwind v4 is the primary recommendation, specifically because this is the one requirement where mechanical enforcement beats review discipline.
Concretely, "light mode is the weaker twin" looks like: domain-color legend swatches that are technically distinguishable but visibly less vivid/confident than their dark-mode counterparts; edge-type colors that pass contrast but look flat; elevation tiers on white that are harder to tell apart than on black (white-on-white has less perceptual room than black-on-black in the other direction, so the 3-4 tier elevation system from Pitfall 9 needs its *own* tuning pass in light mode, not a formula-derived one).

**Warning signs:** Light mode is only checked at the very end of a phase, by the same person who did dark mode, in one sitting; no user/reviewer looks at light mode without dark mode open side-by-side for comparison (comparison-only review tends to rubber-stamp "close enough").

**Phase to address:** Every phase that touches visual design (tokens, both canvas rebuilds, shell, Purview-push preview screens) — this is not a single phase's problem, it's a standing discipline that needs a checklist item in every phase's UAT, not a one-time token-phase fix.

---

### Pitfall 13: A "full rebuild" declaration causes the app to be unusable/undemoable for the entire rebuild duration, and behavior that was never written down gets lost

**What goes wrong:** Two related failure modes converge under "full rebuild": (1) the team works in a long-lived branch or a half-migrated state where the app is neither the old working prototype nor the new product, and there's no point during the rebuild where a stakeholder (or the user themselves, mid-project) can see something real; (2) small interaction behaviors that were never specified anywhere — hover thresholds, the exact trace-dim opacity, keyboard shortcut edge cases, the specific animation timing on caret rotation — exist only as "whatever the old CSS/JS did," and get silently dropped because no one thought to carry them forward, since there was no spec to check against. Rewrite-failure literature puts full-rewrite failure rates above 70%, largely from exactly this: scope creep (every deferred wish gets dumped into "since we're rebuilding anyway") and long feedback loops with no working intermediate state.

**Why it happens:** "Full frontend rebuild" as stated in PROJECT.md is a legitimate scope decision here (the current structure genuinely can't absorb Purview as a fourth peer destination, per PROJECT.md's own reasoning) — the risk isn't that a rebuild was chosen, it's *executing* it as one undifferentiated blob rather than a sequence of shippable states. Fred Brooks' "second system" observation applies directly: a rebuild is exactly the moment every accumulated wish (motion polish, command-palette-does-everything, canvas-native lasso-select) competes for inclusion in what should be a scoped v1.

**How to avoid:** ARCHITECTURE.md's own build-order sequencing (tokens → shell/model split → shared canvas infra → both canvases in parallel → Purview push → cross-canvas wiring → motion polish) is already structured as an incremental, demoable sequence rather than a big-bang swap — treat that sequencing as load-bearing, not just a nice-to-have plan, and resist collapsing it into fewer, bigger phases under schedule pressure. At the start of the rebuild, before any component is touched, do a deliberate pass capturing "what already works and must be preserved" as an explicit checklist (PROJECT.md has already started this: "the existing top-bar buttons and segmented control read well and are explicitly liked" is exactly this kind of note) — extend it to cover interaction-level details (hover/trace timing, exact keyboard shortcuts, caret animation, the two-tier column-expand behavior) that are easy to silently drop because they were never in a spec, only in the shipped CSS. FEATURES.md's MVP list (v1 / v1.x / v2+ split) is already the scope-discipline mechanism to lean on — treat anything not in "Launch With (v1)" as explicitly deferred, not implicitly assumed.

**Warning signs:** No one can currently run and click through a real demo of the in-progress rebuild for more than a couple of weeks running; feature requests keep getting added to "since we're rebuilding" phases that weren't in the original FEATURES.md MVP list; a behavior detail from the old app gets reported as "missing" only after a user notices, rather than being checked off against a pre-rebuild inventory.

**Phase to address:** Sequencing discipline belongs to the whole roadmap, not one phase — but the "what must be preserved" inventory should be captured explicitly before the design-tokens phase even starts (it's cheap, fast, and prevents the most annoying class of regression), and each subsequent phase should end with something clickable, per ARCHITECTURE.md's build order.

---

### Pitfall 14: Half-migrated design system makes the app look actively worse than the old prototype during the transition

**What goes wrong:** New shell chrome (left icon rail, new typography, new elevation tiers) ships before the canvases are rebuilt to match, or vice versa — the app spends a real stretch of time in a state where half the screen uses the new dark-first, self-hosted-font, OKLCH-token language and half still uses `-apple-system` fallback fonts and the old flat hex palette. This doesn't read as "in progress," it reads as broken/inconsistent, and if anyone outside the core working session sees it in that state, it actively damages confidence in the rebuild rather than demonstrating progress.

**Why it happens:** Fonts and tokens are global (touch every screen at once when swapped), but canvases (the largest, most complex components) take the longest to rebuild — so there's an inherent window where global chrome has changed but the dominant visual real estate (the canvas) hasn't caught up, unless this is deliberately sequenced to avoid a long straddle.

**How to avoid:** ARCHITECTURE.md's build order already puts tokens/fonts first specifically because "it blocks everything visual" — lean into that by making the token/font swap-in itself a single atomic commit/deploy across the whole app (not a token added here, a component migrated there, over weeks), so there's no visible period where two font stacks or two palettes coexist on screen at once. If the canvas rebuild genuinely takes longer than the shell rebuild, consider running the *old* canvases against the *new* tokens temporarily (a "compatibility" token mapping) rather than leaving old raw hex values in canvas CSS while the rest of the app has moved on — an intentionally-bridged intermediate state is far less jarring than an accidentally-mixed one.

**Warning signs:** A screenshot taken mid-rebuild shows two visibly different type systems or two different color languages on the same screen at once, and that state persists for more than a work session or two; the team's working definition of "done" for the tokens phase doesn't include "and nothing anywhere still references the old hardcoded values."

**Phase to address:** Sequencing concern spanning the design-tokens phase and both canvas-rebuild phases — explicitly verify at the end of the tokens phase that old raw values are fully retired (grep for old hex literals), not just that new tokens exist alongside them.

---

### Pitfall 15: Hairball graphs and unreadable density are hit well before "big data" scale — and node/edge count thresholds are lower than intuition suggests

**What goes wrong:** The knowledge-graph constellation view becomes an unreadable tangle of overlapping edges and unlabeled dots long before it becomes a *performance* problem. Perceptual/UX hairball onset happens far earlier than the rendering-performance cliff: a force-directed layout with even a few hundred densely-interconnected nodes is often visually unreadable well before it causes frame-rate problems. Separately, rendering performance has its own concrete thresholds (already surfaced in this project's cached research, consistent across sources): SVG-based rendering starts dropping frames around **~1,000 nodes**; Canvas 2D stays smooth to roughly **~10,000 objects/frame**; beyond **~10,000 nodes**, WebGL becomes necessary for interactive frame rates, comfortably handling 50,000+ instanced primitives. The force *simulation* itself (physics, not rendering) is CPU-bound regardless of renderer, and GPU-accelerated force computation (e.g. Cosmograph) only becomes a differentiator once the *simulation*, not just the draw call, is the bottleneck — typically only relevant well past 10,000+ nodes with frequent re-simulation (filter/drill-in triggering recompute).

**Why it happens:** A real Fabric tenant's estate (workspaces × lakehouses × tables × columns) plausibly reaches into the thousands-to-tens-of-thousands range for a large org — comfortably past the hairball-perception threshold even if it never reaches the rendering-performance threshold. Teams tend to design and test against small sample data (this app's bundled demo dataset) where neither hairball nor performance problems are visible, and only discover the gap against a real tenant late.

**How to avoid:** Perceptual hairball mitigation and rendering-performance mitigation are different problems needing different fixes — don't solve one and assume the other is covered. For hairball: aggressive default clustering/collapsing by domain or hierarchy level (the existing Estate → Workspace → Lakehouse → Table drill-down *is* this mitigation, already correctly designed — protect it as load-bearing, don't let a "show me everything at once" feature request undermine it), edge bundling or hiding low-weight edges by default, and a hop-depth/filter control (already flagged as a table-stakes feature in FEATURES.md) that keeps any single view's node count in a readable range regardless of estate size. For performance: choose a renderer with WebGL headroom from the start for the knowledge-graph view (STACK.md already recommends this — Sigma or Cosmograph over hand-rolled Canvas 2D), specifically because retrofitting a renderer swap after the fact is expensive, while building against a headroom-having renderer from day one costs little extra now.

**Warning signs:** The only graph tested during development is the small bundled sample dataset; a real Purview-backed load (`GET /purview/graph`) against a moderately large tenant hasn't been tried against the rebuilt canvas before a phase is called done; the drill-down/hop-depth filtering is treated as a "nice to have" rather than the load-bearing hairball mitigation it actually is.

**Phase to address:** Knowledge-graph canvas rebuild phase for the renderer/clustering choice; UAT for that phase should explicitly include a test against a larger-than-sample graph (synthesize one if a real large tenant isn't available), not just the demo dataset.

---

### Pitfall 16: Force-directed layouts that never settle, jump on every re-render, or reposition nodes when the underlying data barely changed — destroying the user's mental map

**What goes wrong:** Two related instability failures. First, a force simulation that never fully damps continues consuming CPU and visibly jittering nodes indefinitely, or worse, a naive re-render (e.g. triggered by an unrelated state change like a hover) re-seeds/re-runs the simulation from scratch, causing every node to visibly jump to a new position even though nothing about the underlying graph changed. Second — the more insidious version — a genuinely small data change (one new table appears) causes the *entire* layout to reflow because there's no positional continuity between the old and new simulation run; the user's spatial memory of "that cluster was over there" is destroyed by a change that should have been localized.

**Why it happens:** Force simulations are commonly re-initialized with fresh random starting positions on every data fetch/component re-render rather than being seeded from (or warm-started with) the previous run's settled positions; damping/alpha-decay settings are often left at library defaults tuned for "settle eventually" rather than "settle fast and stay settled," so any re-trigger looks like a fresh, jumpy simulation each time.

**How to avoid:** Warm-start the simulation from the previous run's node positions whenever the node/edge set is a superset or near-superset of the prior state — new nodes enter near their connected neighbors (not at a random point), existing nodes keep their prior coordinates as the simulation's starting alpha, so only the delta visibly moves. Use a deterministic seed for the *initial* cold-start layout (so reloading the same graph from scratch — e.g. via a deep link, per FEATURES.md's differentiator — reproduces a recognizable layout rather than a random one each time) while still allowing organic settling from there. Tune damping so the simulation reaches a low-energy stop within a bounded, short time window rather than asymptotically approaching stillness forever — and make sure re-renders triggered by *unrelated* state (hover, selection, theme toggle) never restart the simulation at all; layout recomputation should be gated strictly to actual graph-data changes.

**Warning signs:** Hovering a node causes visible position drift elsewhere on the canvas; reloading the same graph twice in a row produces two visibly different layouts; the simulation is still visibly moving nodes 5+ seconds after the graph loaded with no new data; a single new node appearing reflows dozens of unrelated nodes.

**Phase to address:** Knowledge-graph canvas rebuild phase — this belongs in `model/graphLayout.ts` per ARCHITECTURE.md's proposed structure (a pure function is exactly what makes "accept previous positions as an input" straightforward to implement and unit-test).

---

### Pitfall 17: Drill-in transitions disorient rather than orient — camera motion without spatial continuity is worse than a hard cut

**What goes wrong:** The Estate → Workspace → Lakehouse → Table drill-down is explicitly named as the product's spine and a place motion should "earn slick" — but a poorly-designed transition (e.g. a generic fade/zoom that doesn't preserve *where* the clicked node was on screen relative to where its children appear) can leave the user *more* lost than an instant cut would, because a transition implies continuity the user then can't actually find on the new screen. This is a well-documented graph-UX risk: motion is only helpful when it's legible; illegible motion is worse than none because it costs attention without delivering orientation.

**Why it happens:** Motion gets added as a polish pass late in the schedule (correctly sequenced last per ARCHITECTURE.md's build order) under time pressure, and the easiest thing to implement is a generic transition (fade, scale-from-center) rather than one that's actually anchored to the clicked node's screen position and animates the camera/viewport toward where that node's children will render.

**How to avoid:** Anchor every drill-in transition to the interaction that triggered it — the clicked node's on-screen position should visually "become" or clearly lead toward the new view's focal point, not just disappear while an unrelated new view fades in. Use the graph library's own camera-animation primitives for this (Sigma's/Cosmograph's camera easing, per STACK.md's Motion section — general-purpose DOM animation libraries like Motion are explicitly *not* the right tool for camera-internal transitions) since those are built to animate the actual coordinate system, not just DOM opacity/scale. Keep drill-out (breadcrumb "back") symmetric with drill-in, not a different transition — asymmetric forward/back motion is itself disorienting even when each direction is individually well-designed.

**Warning signs:** The drill-in transition is a CSS opacity fade with no spatial relationship to the clicked node; going back via breadcrumb looks nothing like reversing the drill-in; user testing (even informal, on the primary user) shows hesitation or a "wait, where am I" moment after a drill transition.

**Phase to address:** Motion/polish phase (explicitly last in ARCHITECTURE.md's build order) — but the *anchor point data* (clicked node's screen coordinates at time of click) needs to be available from the interaction layer built in the canvas-rebuild phases, so flag this dependency early even though the polish itself lands last.

---

### Pitfall 18: OS-dependent font stack silently falls back — this project's own root cause, and the specific way it recurs if not fixed structurally

**What goes wrong:** This is the actual, already-diagnosed bug driving this milestone: `-apple-system`/`SF Pro Text`/`SF Pro Display` don't resolve on Windows, so the whole app has been silently rendering in Segoe UI at weights (`560`, `620`) and letter-spacing (`-.01em`) tuned for a font that never loaded — with no error, no visual glitch obvious enough to immediately notice, just subtly-wrong spacing and weight for as long as no one checked what font was actually rendering. The risk for the rebuild isn't repeating this exact mistake (it's explicitly being fixed via self-hosting per STACK.md) — it's a *new* instance of the same class of bug: a self-hosted variable font that fails to load (network hiccup, incorrect Vite asset path, a missing weight axis) falling back silently to a system font stack still tuned for the wrong metrics, with no one noticing because the app "still looks fine at a glance."

**Why it happens:** Font-fallback failure is inherently silent by design (that's the point of a fallback) — there's no browser error, no console warning, nothing that surfaces "the font you expected isn't the font that's rendering" unless someone deliberately checks. This class of bug is specifically easy to miss on the machine where it was authored/tested (macOS, where `-apple-system` genuinely does resolve) and only surfaces for other users/platforms — which is exactly what happened here.

**How to avoid:** Never make the self-hosted font's fallback stack "tuned for the primary font" — per STACK.md's guidance, put genuinely generic fallbacks last (`ui-sans-serif, system-ui, sans-serif`) and don't hand-tune weights/letter-spacing values that only look right in the primary font, since those exact values become the symptom if fallback silently triggers again. Add a lightweight, deliberate verification step (not automated CI necessarily, but a checked step in the tokens-phase UAT) that confirms the actual computed font family in a real browser matches the intended self-hosted font — `document.fonts.check()` or simply inspecting computed styles in devtools on the actual target platform (Windows 11, per PROJECT.md's stated primary dev/use environment) rather than assuming it works because it was authored on/for that stack. Preload the primary weight range explicitly (STACK.md's Typography section already specifies this) so the failure window (before the self-hosted font loads) is minimized, and pair preload with `font-display: swap` so the fallback-then-swap window is visible/brief rather than invisible text (FOIT) if something is misconfigured.

**Warning signs:** No one has explicitly verified, on Windows, which font is actually rendering post-rebuild (as opposed to assuming the self-hosted font "should" be working); letter-spacing/weight values were copied forward from the old CSS without being re-tuned for the new font's actual metrics; the font verification step exists only as "it looks fine," not as an inspected computed-style check.

**Phase to address:** Design tokens phase — this is the direct fix for the milestone's own stated root cause, and its verification (not just implementation) belongs in that phase's UAT, on the actual Windows target environment.

---

### Pitfall 19: Graph canvases are commonly entirely invisible to screen readers and unusable by keyboard — and this is treated as acceptable "because it's a canvas app"

**What goes wrong:** Both the lineage DAG and knowledge-graph canvases end up with zero keyboard operability (mouse-only hover, click, drag, pan, zoom) and zero screen-reader exposure — Canvas 2D in particular is a single opaque DOM element that exposes nothing about its drawn content to assistive technology by default, and even the SVG-based lineage view can end up effectively inaccessible if elements lack semantic labels, since a screen reader can technically detect SVG DOM nodes but without ARIA labeling their structure and relationships are lost. For an internal tool this sometimes gets waved off as low-priority, but PROJECT.md itself names keyboard navigation as a place this app can "actually feel faster than Atlan/Collibra for the primary user" (FEATURES.md) — meaning the realistic bar here isn't full WCAG conformance, but it's also not zero.

**Why it happens:** Canvas-based and force-directed graph rendering is inherently visual-first, and accessibility for graph/network visualizations specifically is a known-hard, still-evolving area (the W3C's WAI-ARIA Graphics Module, published 2018, exists precisely because standard ARIA roles don't map well onto arbitrary diagrams) — it's genuinely more effort than adding `aria-label` to a form, so it's easy to defer indefinitely on an internal tool with a small user base.

**How to avoid:** Set a realistic, explicit minimum bar rather than aiming for full conformance or doing nothing: (1) every node/edge that's reachable by mouse must also be reachable via keyboard — arrow-key or Tab-based traversal between nodes, Enter/Space to select/activate (mirroring click), Escape to clear focus/selection — this is explicitly already named as a desired feature in FEATURES.md for power-user speed, so accessibility and the power-user goal are the same work, not competing priorities; (2) for the SVG-based lineage DAG specifically (which is real DOM, unlike the Canvas 2D knowledge graph), add `role`/`aria-label` to node and edge groups so a screen reader can at least announce "table: raw_orders, 4 columns" or "edge: writes, from cell 3 to raw_orders" on focus — the WAI-ARIA Graphics Module's `graphics-object`/`graphics-symbol` roles are the correct semantic fit here; (3) for the Canvas-2D knowledge graph, provide a parallel, non-canvas fallback for the information (not full parity — a "list view" toggle showing the current level's nodes/links as a plain accessible list/table is a well-established fallback pattern, cheap relative to making the canvas itself fully accessible, and directly reuses data the app already has); (4) ensure any hover-triggered tooltip/card (`.card`, `.tooltip` in the current CSS) is also reachable and dismissible via keyboard, not mouse-hover-only.

**Warning signs:** Tab key does nothing on either canvas; a screen reader announces nothing meaningful when focus reaches the canvas area; there is no non-visual way to answer "what nodes exist at this level" other than looking at the rendered graph.

**Phase to address:** Keyboard traversal (item 1) belongs in both canvas-rebuild phases, since it's explicitly dual-purpose with the power-user speed goal already in FEATURES.md — don't schedule it as a separate "accessibility phase" that's easy to cut, fold it into the core interaction work. SVG semantic labeling (item 2) belongs in the lineage-DAG canvas phase specifically. The list-view fallback (item 3) is lower priority and can land in a later phase, but should be explicitly scoped rather than silently dropped.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Ship Purview push with batch-level (not per-entity) results | Faster to build a first version | Users can't tell which of N entities actually landed after a partial failure; retry becomes all-or-nothing, risking re-triggering Pitfall 2's overwrite risk on already-succeeded entities | Never for the real Purview-push destination — only acceptable as a throwaway internal spike to validate the payload shape, never shipped to the user-facing flow |
| Mechanically invert light-mode tokens to produce dark-mode (or vice versa) | Fast, one script, "parity" achieved on paper | Vibrating saturated colors on dark (Pitfall 10), washed-out colors on light (Pitfall 12), colorblind-safety checks that pass for one theme and fail the other | Never for load-bearing tokens (domain, edge-type, accent); acceptable only for genuinely decorative, low-stakes values with no meaning attached |
| Defer keyboard navigation on the canvases to "a later accessibility pass" | Ship visual interaction faster | Re-architecting hover/click/drag interaction handlers to also support keyboard-driven focus later is more expensive than building both together, and the power-user speed goal (FEATURES.md) is lost, not just accessibility | Only acceptable if genuinely explicitly deferred and tracked, not silently dropped — better to build minimally from the start given the dual-purpose value |
| Treat "preview" as sufficient safety without re-verifying qualified names at execute time | One code path, simple mental model | Silent overwrite of foreign/human-curated Purview entities (Pitfall 2/3) — the single highest-consequence failure mode in the whole milestone | Never |
| Push regex-derived (inferred) lineage into Purview without distinct provenance flagging on the push flow | Simpler push UI, one path for all edges | Approximate, sometimes-wrong lineage acquires false authority in a shared governance system that other people and possibly automated tooling will trust (Pitfall 6) | Never for anything beyond a personal/sandboxed test Purview instance |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|--------------|------------------|-------------------|
| Purview/Atlas qualified names | Constructing qualified names from regex-derived table/notebook names without checking against Purview's existing catalog | Resolve/reuse the same GUID-anchored identifiers the read path (`purview/ingest.py`) already uses; classify every target as create/update-own/overwrite-foreign before writing |
| Purview bulk entity writes | Assuming `POST /entity/bulk` is atomic across all entities in the call | Treat every batch as a sequence of independently-failable operations; design for partial failure as the normal case, not the exception |
| Purview post-write read-back | Re-fetching immediately after a 200 response and treating a stale/unchanged result as failure (or a not-yet-applied result as false success) | Poll with bounded backoff for a "pending confirmation" window rather than a single immediate re-fetch; give this its own UI state |
| Purview descriptions/glossary fields | Writing machine-derived values unconditionally on match, overwriting steward-authored text | Default to write-only-if-empty; show current-vs-proposed value in the diff for every field with a plausible human author |
| Self-hosted variable fonts (Vite) | Assuming the font "just works" once installed, without verifying computed font-family on the actual target OS | Explicitly check `document.fonts`/computed styles on Windows (the stated primary environment) as part of UAT, not just visual inspection on the authoring machine |
| Force-directed graph libraries (Cosmograph/Sigma/react-force-graph) | Re-seeding/restarting the simulation on every unrelated re-render (hover, selection change, theme toggle) | Gate layout recomputation strictly to actual node/edge-set changes; warm-start from prior positions when the change is incremental |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| SVG-rendered knowledge graph nodes | Panning/zooming feels laggy; frame drops on drag | Use Canvas 2D or WebGL (Sigma/Cosmograph per STACK.md), not per-node SVG/DOM elements, for the force-directed view | ~1,000 nodes |
| Canvas 2D without spatial partitioning for force-sim repulsion | Simulation itself stutters (not just rendering) as node count grows, independent of renderer choice | O(n log n) repulsion via a spatial grid/quadtree before reaching for a Web Worker | O(n²) repulsion starts costing >16ms/frame around several hundred to ~1,000 densely-connected nodes |
| Per-frame `getComputedStyle` calls for canvas token colors | Frame budget consumed by style recalculation, worse as node/edge count grows | Cache tokens once on theme change (ARCHITECTURE.md's `useCanvasTokens`/Pattern 2 already specifies this) | Any node count once each node/edge triggers its own style read per frame |
| No hop-depth/filter control on dense subgraphs | First render of a busy table or a large lakehouse is an unreadable tangle well before any frame-rate problem appears | Default hop-depth limiting and drill-down clustering (already the app's Estate→Workspace→Lakehouse→Table structure) | Perceptual hairball onset is far lower than rendering-perf thresholds — often a few hundred densely-interconnected nodes, not thousands |
| N+1 Purview API calls during graph ingest (pre-existing, per CONCERNS.md) | Purview-backed loads for real tenants take 30+ seconds for ~100 tables | Not this milestone's scope to fix, but the Purview-push preview/diff step (which needs to read current state before writing, per Pitfall 2) risks compounding this same N+1 pattern on the write side too — design the pre-write resolve step to batch/paginate, not repeat the read-path's per-item mistake | Any push scope beyond a handful of entities |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Treating the Purview-push confirmation dialog as sufficient authorization control | The dialog is a UX safeguard, not an access-control boundary — anyone who can reach the app (any allowed CORS origin, per CONCERNS.md's existing finding) can trigger writes with the shared service principal's full write privilege | Out of this milestone's scope to fix at the auth layer (no per-user auth, per PROJECT.md), but the UI should not overstate what the confirmation step protects against — it protects against accidental/careless pushes, not malicious/unauthorized ones; don't let copy in the confirm dialog imply otherwise |
| Logging full push payloads (including any inferred/regex-derived content) without considering they may later be pushed to Purview verbatim | If push-history/audit logging (FEATURES.md's v1.x item) is added, sensitive/incorrect inferred content could be persisted in a log that outlives the original push decision | If a lightweight push-history log is built, scope it to what/when/result metadata, not full raw payload replication, unless there's a clear need |
| Silent fallback to sample data (pre-existing, per CONCERNS.md) extended into the Purview-push flow | If the Purview-push UI is ever shown against sample/demo data without an unmistakable "you are not connected to real Purview" indicator, a user could believe a push against demo data succeeded/failed against a real catalog | Make the Purview-push destination categorically unavailable (not just visually similar-but-disabled) when `purview_configured`/`purview_allow_write` are false — this already exists as a pattern for the rest of the app (CONCERNS.md notes the src-chip badge); extend the same discipline explicitly to the write flow, with higher visual weight given the write consequence |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Confirmation dialog with generic "Push 14 items?" copy | User can't tell what's risky (overwrite, inferred-edge, foreign-entity) from what's routine, so they habituate to clicking through | Restate scope with risk-differentiated counts: "push lineage for 14 tables — 3 will overwrite existing processes, 2 are inferred from notebook parsing" (per Pitfall 2 and 6) |
| Drill-in transition with no spatial anchor | User loses track of where they are relative to where they were (Pitfall 17) | Anchor transitions to the clicked node's screen position; symmetric forward/back motion |
| Domain-color legend that's technically present but only distinguishes by hue | Colorblind users (≈8% of men) can't use the legend that was added specifically to help understanding (Pitfall 8) | Vary legend swatches on lightness too, not hue alone; verify with a colorblind simulator before shipping |
| Light mode reviewed only at the end, by comparison against dark mode | Light mode ships technically-parity but perceptually weaker (Pitfall 12) | Schedule independent light-mode design review as its own checklist item per phase |
| Post-push "success" toast with no re-verification | False confidence that a write landed when Purview's read path is still eventually-consistent (Pitfall 5) | Explicit "pending confirmation" state with bounded polling before declaring success |

## "Looks Done But Isn't" Checklist

- [ ] **Purview push preview/confirm flow:** Often missing per-entity create-vs-overwrite classification — verify the preview shows what will be *replaced*, not just what will be *sent*
- [ ] **Purview push results:** Often missing per-entity success/failure — verify a partial failure (kill the network mid-batch in a test) produces a usable, inspectable result, not a single opaque "failed"
- [ ] **"See it land" confirmation:** Often missing a pending/retry state — verify it against a deliberately slow/delayed read (simulate eventual consistency), not just the happy path where Purview responds instantly
- [ ] **Dark+light parity:** Often missing independent light-mode review — verify by asking someone to review light mode *without* dark mode open for comparison, and check the domain-color legend passes a colorblind simulator in both themes independently
- [ ] **Font self-hosting:** Often missing an actual verification step — check computed font-family in devtools on the real target OS (Windows), don't assume the self-hosted font is rendering just because it "looks right"
- [ ] **Keyboard graph navigation:** Often missing entirely — verify by unplugging the mouse (or just not touching it) and trying to reach, select, and inspect a specific node
- [ ] **Force-directed layout stability:** Often missing warm-start — verify by loading the same graph twice and confirming positions are recognizably similar, and by hovering a node and confirming nothing elsewhere moves
- [ ] **Confidence/provenance on pushed edges:** Often missing at the write boundary even when present in the exploration UI — verify the Purview-push scope selector and preview both distinguish inferred from declared edges, not just the canvas

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| Qualified-name overwrite already happened in a real Purview tenant | HIGH | No app-level undo exists for this — recovery depends entirely on whether the overwritten entity's prior state is recoverable via Purview's own audit history/versioning (if enabled) or a human's memory of what it said; this is exactly why Pitfall 2's prevention must be in place *before* any real-tenant write, not retrofitted after an incident |
| Color-channel collision (domain/edge-type/state sharing hues) shipped and discovered late | MEDIUM | Re-derive the palette with explicit hue-family partitioning (Pitfall 7's method) and re-run the colorblind simulation check; this is a token-file change, not a component rewrite, if the token architecture (semantic layer) is already in place per ARCHITECTURE.md |
| Light mode shipped as a visibly weaker twin | MEDIUM | Dedicated light-mode design review pass, component by component, informed by Pitfall 12's specific failure list (domain vividness, elevation-tier distinguishability) — costly in review time but not a structural rewrite if tokens are already parameterized per theme |
| Half-migrated design system visible mid-rebuild caused stakeholder confidence loss | LOW-MEDIUM | Accelerate the remaining migration to close the visible gap quickly, or temporarily bridge old canvas CSS to new tokens (Pitfall 14's mitigation) rather than leaving the mixed state open-ended |
| Force-layout instability (jumpy re-renders) shipped and reported by users | LOW | Contained to `model/graphLayout.ts` per ARCHITECTURE.md's decomposition — a warm-start/damping fix there doesn't require touching rendering code |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| 1-6 (Purview write safety, all forms) | Purview-push destination phase | Per-entity result reporting exists and was tested against a deliberately-induced partial failure; qualified-name classification (create/update-own/overwrite-foreign) is visible in the preview for a real (or realistically simulated) Purview tenant, not just the sample dataset |
| 7 (color-channel collision) | Design tokens phase | Grep the final token file for duplicate hex/OKLCH values across domain/edge-type/state semantic groups — zero collisions |
| 8 (colorblind safety) | Design tokens phase | Domain palette run through a deuteranopia/protanopia simulator in both themes; legend has a non-hue-only distinguishing cue |
| 9-11 (halation, elevation, saturated vibration, compound-surface contrast) | Design tokens phase, re-verified in canvas-rebuild phases | Elevation tiers distinguishable with shadow disabled/reduced; accent and edge-type colors checked at actual stroke/dot render sizes, not swatch-only; contrast checked against composited (color-mix) backgrounds, not just declared tokens |
| 12 (light mode as weaker twin) | Every visual-design-touching phase | Independent light-mode-only review exists as a distinct checklist item per phase, not folded into dark-mode review |
| 13-14 (rebuild sequencing, half-migrated state) | Whole-roadmap sequencing discipline; explicit "what must be preserved" inventory before the tokens phase | A demoable, working state exists at the end of every phase per ARCHITECTURE.md's build order; no phase ends with two visibly-different visual languages coexisting |
| 15-16 (hairball, layout instability) | Knowledge-graph canvas rebuild phase | Tested against a larger-than-sample-data graph; reload produces recognizably-similar layout; hover doesn't move unrelated nodes |
| 17 (disorienting drill-in) | Motion/polish phase (dependency: interaction-layer anchor-point data from canvas-rebuild phases) | Drill-in and drill-out (breadcrumb back) use symmetric, node-anchored transitions |
| 18 (silent font fallback) | Design tokens phase | Computed font-family explicitly verified on Windows via devtools, not assumed |
| 19 (canvas accessibility) | Both canvas-rebuild phases (keyboard traversal, dual-purposed with power-user speed goal); lineage-DAG phase specifically for SVG ARIA labeling | Full node/edge reachability and selection via keyboard alone, tested without a mouse |

## Sources

- Direct codebase inspection (HIGH confidence): `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md`, `frontend/src/App.css` (the `--writes`/`--notebook` hex-value collision cited in Pitfall 7 was found by direct comparison of token values in this file)
- Sibling research (HIGH confidence, same research pass, not duplicated here): `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`
- [Why Big Rewrites Fail (Potapov.dev)](https://potapov.dev/blog/why-rewrites-fail/) — MEDIUM confidence, independent blog, corroborates well-established "second system"/rewrite-failure-rate framing
- [The Strangler-Fig Pattern (JavaScript in Plain English)](https://javascript.plainenglish.io/the-strangler-fig-pattern-my-favourite-way-to-upgrade-legacy-angular-projects-761fcc727ed1) and [Fig Tree Pattern (The Art of CTO)](https://theartofcto.com/frameworks/2026-02-06-fig-tree-strangler-pattern-replace-legacy-without-big-bang) — MEDIUM confidence, incremental-migration pattern reference
- [The Designer's Guide to Dark Mode Accessibility](https://www.accessibilitychecker.org/blog/dark-mode-accessibility/) — MEDIUM confidence, halation/pure-black/WCAG-contrast guidance
- [Dark Mode: Best Practices for Accessibility (DubBot)](https://dubbot.com/dubblog/2023/dark-mode-a11y.html) — MEDIUM confidence, elevation-without-shadows guidance
- [Why Your Dark Mode Looks Bad (The Skins Factory)](https://www.theskinsfactory.com/uiux-design-blog/why-your-dark-mode-looks-bad-ui-ux-guide) — MEDIUM confidence, saturated-color-vibration and mechanical-inversion critique
- [Colorblind-Safe Color Palettes for Designers](https://colorblind.io/guides/colorblind-safe-palettes) and [Datylon — best charts for color blind viewers](https://www.datylon.com/blog/data-visualization-for-colorblind-readers) — MEDIUM confidence, Wong-palette and hue+lightness-variation guidance
- [Push data lineage to Microsoft Purview — best practices](https://tonyjacobscloudpro.github.io/Jalpc/azure/data%20governance/microsoft%20purview/2024/12/15/azure-data-explore-03.html) and [How to build custom lineage in Microsoft Purview using REST APIs (Microsoft Learn)](https://learn.microsoft.com/en-us/purview/legacy/how-to-purview-custom-lineage-api-user-guide) — HIGH confidence (official docs) / MEDIUM (practitioner blog)
- [Entity - Bulk Create Or Update (Microsoft Learn, Purview REST API)](https://learn.microsoft.com/en-us/rest/api/purview/datamapdataplane/entity/bulk-create-or-update) — HIGH confidence, official API reference
- [Use Azure Purview's REST APIs for creating custom lineage (Piethein Strengholt, Medium)](https://piethein.medium.com/use-azure-purviews-rest-apis-for-creating-custom-lineage-ad8efacc6230) — MEDIUM confidence, practitioner-authored
- [Known Issues in Apache Atlas (Cloudera docs)](https://docs.cloudera.com/runtime/7.2.17/release-notes/topics/rt-pubc-known-issues-atlas.html) and [Apache Atlas update DELETED entity to ACTIVE (Cloudera Community)](https://community.cloudera.com/t5/Support-Questions/Apache-Atlas-update-DELETED-entity-to-ACTIVE/td-p/201173) — MEDIUM confidence, Atlas (Purview's underlying model) known qualified-name/duplicate-entity issues, used as a reasonable proxy since Microsoft doesn't publish equivalent issue-tracker detail for Purview specifically
- [What Is Automated Data Curation? (Alation)](https://www.alation.com/blog/automated-data-curation/) — MEDIUM confidence, vendor content, corroborates the "write-only-if-empty" / steward-authored-content-protection pattern
- [How to build accessible graph visualization tools (Cambridge Intelligence)](https://cambridge-intelligence.com/build-accessible-data-visualization-apps-with-keylines/) and [How to make diagrams more accessible (JointJS)](https://www.jointjs.com/blog/diagram-accessibility) — MEDIUM confidence, specialist graph-visualization vendors
- [SVG Accessibility/ARIA roles for charts (W3C Wiki)](https://www.w3.org/wiki/SVG_Accessibility/ARIA_roles_for_charts) — HIGH confidence, W3C reference (WAI-ARIA Graphics Module)
- [Fixing Layout Shifts Caused by Web Fonts (DebugBear)](https://www.debugbear.com/blog/web-font-layout-shift) and [Web Fonts and the Dreaded Cumulative Layout Shift (Sentry)](https://blog.sentry.io/web-fonts-and-the-dreaded-cumulative-layout-shift/) — MEDIUM confidence, FOUT/FOIT/font-display guidance
- [react-force-graph (GitHub)](https://github.com/vasturiano/react-force-graph) and [spring_layout — NetworkX docs](https://networkx.org/documentation/stable/reference/generated/networkx.drawing.layout.spring_layout.html) — MEDIUM/HIGH confidence, deterministic-seeding and damping guidance for force-directed layout stability

---
*Pitfalls research for: dark+light-parity data lineage frontend rebuild with Microsoft Purview write path*
*Researched: 2026-07-20*
