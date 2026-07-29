# Handoff — Lineage Studio v2

_Last updated: 2026-07-27 — as of commit 419927b (master, pushed, deployed)_

## Where things stand

A Fabric-mode session: the sandbox stopped being a page and became part of
Explore, then grew a bridge into Modeling. Six commits, each pushed AND verified
live from the served Vercel bundle (see the gotcha below — a push is not a
deploy, and this session proved the verification itself can lie).

Frontend **233/233 vitest**, `tsc` + `vite build` clean. Working copy clean apart
from this file. Backend **not touched** — the two `test_sandbox_spark.py`
failures are still there and still unexamined.

## What landed

- **The sandbox lives inside Explore.** `/fabric/sandbox` and its rail entry are
  gone. Explore is three columns (tree | detail | sequence) at 1560px; the
  detail column has **Details | Sandbox** tabs, and the Sandbox tab holds the
  lineage canvas and run report.
- **`fabric/sequence.ts`** — a module store (steps, results, run logic) so the
  tree, the panel and the canvas are three views of one thing.
- **One way to add a step**: a hover ▶ on the tree row, which stays lit with a
  count once the item is in the sequence. The panel's flat picker and the detail
  pane's button were both deleted.
- **Table schemas on the canvas** — table cards carry columns as rows (capped at
  8 with an expand row); the report's I/O lists disclose the same.
- **Create model** (`fabric/toModel.ts`) — snapshots a run into a Modeling model
  and opens it. Layers, objects, attributes, transitions, column-level edges
  where they resolve.
- **A Sequence view** — steps on the left in run order, tables on the right,
  every edge step→table. Export honours whichever view is on screen.
- **Entity tags** (`model/tags.ts`) — on any layer/object/attribute, via "Tags…"
  on the context menu, badged on cards and rows. Sandbox imports tag every
  object Notebook/Pipeline/Table.
- **Arrowheads on transitions**, and **connecting right-to-left**: every entity
  has an IN handle on its left edge as well as the OUT handle on its right.

## In flight / next step

Nothing half-written.

Two things I raised repeatedly and the user has not yet picked up — both are
the obvious candidates:

1. **The `_capture` registration bug** (`backend/app/sandbox/child_spark.py:158`)
   — diagnosed this session, not fixed. See below; it is small and it is the
   reason `gold_customer_ltv` has no columns.
2. **The Inspector.** Tags are now the ONLY property readable in the UI.
   `Source`, `Step`, `Workspace`, `Access`, `Data type`, `Transform` and the
   Auto-Mapper's `Confidence` are all still write-only.

## Uncommitted work

Only `handoff.md` (this file). Note it arrived at this session ALREADY modified
and uncommitted from a previous session; that older draft has been overwritten
here rather than merged.

## The `_capture` bug — diagnosed, not fixed

Reproduced against a fresh backend on :8001 by running
`Notebook_1build_customer_ltv` and reading the log:

```
[spark] sql write to gold_customer_ltv not analyzable:
  java.io.FileNotFoundException: HADOOP_HOME and hadoop.home.dir are unset
```

`_capture` records a written table's name, columns and column lineage but never
**registers it back into the session as a temp view**. So a later
`spark.sql(... FROM silver_orders_enriched ...)` can't resolve that name, falls
through to the session catalog, and on Windows that path needs `winutils.exe`.

Consequences: `gold_customer_ltv` gets no columns, AND the **silver→gold read
edge is missing from the graph entirely** (`reads` lists only `raw_*`).

**The fix**: in `_capture`, after taking `df.schema`, register the table as an
empty temp view of that schema — the same thing startup already does for tables
fetched from OneLake. It is **engine-independent**: on Linux there is no
winutils crash, but the name still won't resolve, so you would get a clean
"table not found" and the same missing columns. Do not pay for Spark hosting
expecting this to fix itself.

## Prod topology — what the deployed app can and cannot do

- Frontend: Vercel. Backend: **`https://lineage-studio-api.onrender.com`**
  (verified from the bundle; Fabric `configured: true`).
- Render runs the **stub engine**, so on prod `table_schemas` and
  `column_lineage` are always empty: every table card is bare, every schema
  disclosure inert, and a model created there has objects and edges but **no
  attributes**. The engine chip in the run report is the tell.
- The stub is not strictly worse: its static analysis DOES see
  `cell 2: reads=['silver_orders_enriched']` — the very edge Spark loses. Stub
  gets the shape right and knows no columns; Spark gets columns right and drops
  the chain.
- Render free tier sleeps: first request ~20s.
- **Spark cannot run on Vercel** (JVM, ~1GB, 10-30s session start vs stateless
  short-lived functions). The real option is a Docker deploy on Render with a
  JDK on a paid instance, or moving runs to a worker + queue.

## Decisions & dead ends

- **The tree is the picker.** Three ways to add a step (flat search list, detail
  button, tree) was the actual UX problem; the flat list also ignored the
  workspace/folder context the tree already has. Deleted both others.
- **Tags live in the property bag under a reserved `Tags` key**, not a new field
  on `LineageModel`: the bag is already the per-entity side table, already
  persisted and exported, and the viewer already badges off properties — so no
  migration for models saved before tags existed.
- **Sequence view orients reads step→table, against the true direction of
  travel.** Data moves table→notebook, but drawing that IS the line looping back
  under the whole tables column, which the view exists to avoid. `Access` and
  the row it leaves carry direction instead. **Flow view keeps true direction** —
  export from there if arrows must mean flow.
- **Steps carry their I/O rows as attributes in the exported model.** Without
  them a step exported as a bare object and the port didn't look like the canvas
  — the user reported exactly that. Edges anchor to the row, not the header.
- **Ambiguous column lineage is dropped, not guessed.** Spark names the source
  column but not its table; if `id` is on both sides of a join, the object-level
  edge stands alone. A wrong column edge is worse than a missing one.
- **`sequenceToModel` is a one-way snapshot.** Re-running does not update a model
  built from a previous run, or the user's edits would be clobbered.
- **The inbound gutter is now PERMANENT** (`INBOUND_GUTTER`, was opened only
  while connecting). Every entity has an in-handle now, so the space is always
  in use and nothing reflows mid-gesture.

## Gotchas still live

- **Deploy verification can produce a FALSE POSITIVE.** An `until` loop testing
  "hash changed" exits on a transient curl failure returning `""`. It reported a
  deploy that had not happened. Always require a **non-empty** hash that differs:
  `grep -o 'index-[A-Za-z0-9_-]*\.js' | grep -v '<old>'` inside `[ -n "$(...)" ]`.
  This is the second time deploy verification has misled in this project — see
  [[vercel-deploy-topology]].
- **A stale backend on :8000 looks fine.** The one running at session start
  predated `/fabric/catalog`, notebook-source, table-schema and
  pipeline-definition. Check `curl -s localhost:8000/openapi.json` before
  believing a 404 is a code bug.
- **`sed -i -e '<range>{r file' -e 'd}'` inserts the file once PER LINE** in the
  range. It shredded `sandbox.tsx` (115 copies). To replace a line range, rewrite
  the file (`rm` then Write) rather than scripting sed.
- **The Write tool refuses a file changed on disk since you read it** — including
  by your own `git checkout`. `rm` then Write is the way through.
- **Arrowheads must be aimed from the curve's incoming tangent**, not the
  source→target vector: a right-to-left edge arrives from the left, and the
  straight vector points the head backwards on exactly those edges.
- Everything in the previous handoff's gotchas still holds: **never add `left`
  to `.mv-band`**; `.mv-layer:last-of-type`; row left padding is inline;
  PowerShell can't pass a here-string to `git commit -m` (use Bash + `-F -`);
  `git push` reports success on stderr; `Inspo/` is gitignored and its contents
  are not to be pushed.

## Env facts

- Commands: `cd frontend && npm run dev`; `npm run build` doubles as the
  type-check (**no `npm test`** — use `npx vitest run`);
  `cd backend && .venv/Scripts/uvicorn app.main:app --port 8000`.
- App is pinned to light mode (`shell/theme.ts`).
- Fabric rail is now **Overview | Explore** only.
- New this session: `frontend/src/fabric/` (`sequence.ts`, `SequencePanel.tsx`,
  `SequenceCanvas.tsx`, `toModel.ts`) and `frontend/src/model/tags.ts`.
