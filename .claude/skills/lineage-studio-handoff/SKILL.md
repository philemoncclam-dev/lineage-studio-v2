---
name: lineage-studio-handoff
description: Read or write the Lineage Studio handoff doc at "handoff.md" in the repo root. Use at the START of any Lineage Studio work session (read the handoff first, before touching code) and at the END when the user signals they are done — "done for the day", "wrapping up", "that's it for today", "write the handoff". Triggers on any work in the datalineage repo.
---

# Lineage Studio handoff

The handoff doc is `handoff.md` in the repo root. It is the working memory
between sessions. It has two modes.

---

## Mode 1 — Starting work (read)

Run this **before** touching code, whenever a session begins working on
Lineage Studio.

1. Read `handoff.md`.
   - **If it does not exist**, say so plainly and don't invent one. Orient from
     `CLAUDE.md`, `README.md`, and `git log --oneline -15` instead, and offer to
     write a fresh handoff at the end of the session.
2. Check the doc against reality before trusting it:
   ```bash
   git log --oneline -10          # commits since the handoff was written
   git status --short             # uncommitted work in flight
   ```
   The handoff records what was true when written. If commits landed after it,
   the doc is stale in those areas — **say which parts you don't trust** rather
   than proceeding on them silently.
3. Summarize for the user in a few lines: where things left off, what was
   in flight, and anything the doc flags as blocked or half-done.

## Mode 2 — Ending work (write)

Run when the user says they're done for the day / wrapping up / asks for the
handoff.

1. Gather the actual state — don't write from memory of the conversation alone:
   ```bash
   git log --oneline -15
   git status --short
   git diff --stat
   ```
2. Overwrite `handoff.md` using the structure below.
3. Show the user the doc and ask if anything is missing before committing.
   Only commit if they ask.

### Structure

```markdown
# Handoff — Lineage Studio v2

_Last updated: YYYY-MM-DD — as of commit <sha>_

## Where things stand
2–4 sentences. What was just finished, what state the tree is in.

## In flight / next step
The single most important thing. Be concrete: file, function, what's half-done,
what the next action is. If nothing is in flight, say so.

## Uncommitted work
Output of `git status --short`, plus why anything is sitting uncommitted.
Write "clean" if clean.

## Decisions & dead ends
Things a future session would otherwise waste time rediscovering — approaches
tried and reverted, and *why*.

## Gotchas still live
Non-obvious traps in the code that are still true.
```

Add sections beyond these when the session earns them — e.g. **Blocked on
grants** when progress depends on an Azure/Fabric/Purview permission the user
must grant, or **Security posture** when a deployment decision is pending.

### Rules for writing it

- **Recency over completeness.** This is a handoff, not documentation. Durable
  architecture belongs in `CLAUDE.md`. Don't duplicate it here — link instead.
  An earlier handoff rotted precisely because it tried to be a full
  architecture doc.
- **Anchor to a commit sha and date** so the next session can diff against it
  and know exactly what the doc predates.
- **Write only what you verified this session.** No speculation about code you
  didn't read.
- **Prefer why over what.** `git log` already records what changed; it does not
  record why an approach was abandoned.
- **Record which live artefacts were created**, with ids, so a later session can
  clean them up rather than wonder whether they matter.
- Keep it short enough to read in under a minute.

---

## Project quick facts

- **Full stack**, both halves active — the backend is the centre of gravity, not
  a leftover:
  - `backend/` — Python + FastAPI. Lineage model, static parser, Fabric client,
    and the Purview read/write paths.
  - `frontend/` — React 19 + TS + Vite + React Flow v11.
- Commands:
  ```bash
  cd backend && .venv/Scripts/uvicorn app.main:app --reload   # :8000
  cd backend && .venv/Scripts/python.exe -m pytest -q
  cd frontend && npm run dev                                  # :5173
  cd frontend && npm run build                                # tsc -b + vite build
  ```
- `pytest` and `npm run build` must stay green. **There is no `npm test`** —
  the frontend has no test runner; type-check with the build instead.
- Default branch is **`master`** (not `main`). Pushing it auto-deploys the
  frontend via Vercel. Commit messages end with the `Co-Authored-By` trailer.

### Traps that have already cost a session

- **`.env` lives at the repo root** but the backend runs from `backend/`;
  `config.py` resolves it absolutely. It is gitignored — never stage it.
- **The documented uvicorn command omits `--reload`.** Testing an edit against a
  stale server has burned time twice. On Windows `pkill -f` does not reach it —
  use PowerShell `Stop-Process`.
- **`/tmp` in the Bash tool is not visible to Windows Python.** Use the session
  scratchpad for files handed between the two.
- **Empty means "no permission"** in several Microsoft APIs here — Purview
  search returns 0 rather than 403, and Fabric `GET /v1/workspaces` returns
  `200 {"value":[]}`. Never read emptiness as "correctly configured, nothing
  there".
- **Verify API shapes against the live account before coding against them.**
  Purview's swagger has been wrong repeatedly; several bugs were only ever found
  by being refused.
