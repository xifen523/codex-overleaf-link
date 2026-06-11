---
name: parallel-subagents
description: >
  When a task decomposes into independent work on two or more SEPARATE files
  (polish chapters, per-section fixes), fan it out: write job files to the
  subagent queue and the host runs real parallel Codex workers for you. Use
  only when file ownership can be split cleanly; fall back to sequential work
  for a single monolithic file.
---

# Parallel Subagents

The native host can run parallel Codex workers for you. You cannot spawn
processes yourself (the sandbox forbids it) — instead you write **job files**
into a queue directory and poll for **result files**. Each worker is a full
Codex agent confined to the files you assign it.

## 1. When to use

Use this when ALL of these hold:
- The task splits into ≥ 2 independent slices, each touching **different
  files** (e.g. one chapter file per slice).
- Slices do not depend on each other's output.
- Each slice is small enough to finish in a few minutes.

Do NOT use it (work sequentially yourself instead) when:
- The project keeps everything in one monolithic file — never split one file
  across jobs.
- Slices are deeply cross-referenced and must be edited together.
- There are fewer than 2 real slices.
- The handshake file below is missing or not `ready`.

## 2. Handshake

Read `.codex-overleaf-subagents/broker.json`. If it is missing or its
`status` is not `ready`, the broker is off — do everything yourself. Respect
`maxWorkers`, `maxJobsPerRun`, and `perWorkerTimeoutMs` (size each job to
finish well inside it).

## 3. Write jobs

One job per slice. Each job OWNS its `files` exclusively — no file may appear
in two jobs. Write atomically: create a temp file, then `mv` it to its final
`.json` name.

```bash
cat > .codex-overleaf-subagents/jobs/.tmp-ch3 <<'JSON'
{
  "id": "ch3",
  "title": "Polish chapter 3",
  "task": "Polish sections/ch3.tex for grammar, flow, and concision. Keep all math and citations intact. Follow the shared style notes: <paste the style guidance here>.",
  "files": ["sections/ch3.tex"],
  "readOnlyContext": ["main.tex", "macros.tex"]
}
JSON
mv .codex-overleaf-subagents/jobs/.tmp-ch3 .codex-overleaf-subagents/jobs/ch3.json
```

Rules:
- `id`: lowercase letters/digits/hyphens, ≤ 32 chars, unique.
- `task`: complete, self-contained instructions — workers cannot ask
  questions. Repeat shared style guidance in EVERY job.
- `files`: workspace-relative paths the job may edit. Keep ownership
  disjoint across jobs.
- `readOnlyContext`: files the worker may read but must not edit.

## 4. Poll for results

```bash
while [ "$(ls .codex-overleaf-subagents/results/*.json 2>/dev/null | wc -l)" -lt <jobCount> ]; do
  sleep 10
  ls .codex-overleaf-subagents/results/ 2>/dev/null
done
```

Then read each `results/<id>.json` (`status`: completed | failed | rejected |
timeout | cancelled; `summary`; `changedFiles`) and, when you need the full
close-out, `results/<id>.last-message.md`.

## 5. Wave discipline (important)

While any job is queued or running, do **not** edit project files yourself —
write jobs, poll, wait. Do your own edits before the first job or after the
last result. Files changed during a wave that no job owns are reported as
ownership violations and **excluded from the Overleaf writeback**.

## 6. Integrate

- For each `completed` job: read its summary, spot-check the owned files, and
  smooth terminology/transitions ACROSS slice boundaries yourself.
- For each `failed` / `timeout` / `rejected` job: do that slice inline
  yourself now (check `reason`; a `file_conflict` means you mis-partitioned).
- Mention any violations in your close-out so the user knows those edits were
  withheld from writeback.

## 7. Close out

End with a per-slice one-liner (job → what changed) plus an overall summary.
This becomes the run report the user reads.
