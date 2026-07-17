---
name: lineage-studio-handoff
description: Read or write the Lineage Studio handoff doc at "Claude App/handoff.md". Use at the START of any Lineage Studio work session (read the handoff first, before touching code) and at the END when the user signals they are done — "done for the day", "wrapping up", "that's it for today", "write the handoff". Triggers on any work in the datalineage repo / Claude App frontend.
---

# Lineage Studio handoff

The handoff doc is `Claude App/handoff.md`. It is the working memory between
sessions. It has two modes.

---

## Mode 1 — Starting work (read)

Run this **before** touching code, whenever a session begins working on
Lineage Studio.

1. Read `Claude App/handoff.md`.
   - **If it does not exist**, say so plainly and don't invent one. Orient from
     `Claude App/plan.md`, `Claude App/SPEC.md`, and `git log --oneline -15`
     instead, and offer to write a fresh handoff at the end of the session.
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
2. Overwrite `Claude App/handoff.md` using the structure below.
3. Show the user the doc and ask if anything is missing before committing.
   Only commit if they ask.

### Structure

```markdown
# Lineage Studio — Handoff

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
tried and reverted, and *why*. (e.g. orthogonal edge routing was built and
reverted by preference; the AADSTS650052 OneLake scope loop.)

## Gotchas still live
Non-obvious traps in the code that are still true.
```

### Rules for writing it

- **Recency over completeness.** This is a handoff, not documentation. Durable
  architecture belongs in `SPEC.md` / `plan.md`; the roadmap belongs in
  `plan.md`. Don't duplicate them here — link instead. The old handoff rotted
  precisely because it tried to be a full architecture doc.
- **Anchor to a commit sha and date** so the next session can diff against it
  and know exactly what the doc predates.
- **Write only what you verified this session.** No speculation about code you
  didn't read.
- **Prefer why over what.** `git log` already records what changed; it does not
  record why an approach was abandoned.
- Keep it short enough to read in under a minute.

---

## Project quick facts

- App lives in `Claude App/frontend` (React 19 + TS + Vite + React Flow v11).
- `cd "Claude App/frontend"` then `npm run dev` / `npm run build` / `npm test`.
- `npm run build` (tsc -b) and `npm test` must stay green.
- Pushing `main` auto-deploys via Vercel. Commit messages end with the
  `Co-Authored-By` trailer.
- `backend/` is legacy and unused.
