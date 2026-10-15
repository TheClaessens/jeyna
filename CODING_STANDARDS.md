# Coding standards (jeyna)

Read at review time. Mechanical rules live in `npm run check` (scripts/check.mjs); these are the judgement calls the review found missing on v0 (D30).

## Run state across awaits

A tool that reads the current run, awaits, then writes into the run re-checks after the await that the same run is still current and running, and refuses otherwise. `session_start {force}` and `session_finish` can end a run while a tester's call is in flight, so a write without the re-check lands in an aborted or finished run.

## Secrets reach the model only redacted

Account values are redacted before any truncation, slicing or summarising of text that leaves the server (D9). A value cut in half no longer matches the redactor, so redacting afterwards leaks its prefix. New output paths go through the same redactor as the snapshot.

## One home per parser and resolver

Frontmatter splitting, run-folder resolution (with its `.jeyna/playtests/` containment), app-URL resolution and the unique-name check live in `src/shared.ts`. A new tool reuses them; a second copy drifts and loses the guard (as `validate` lost containment).

## Refusals name the way forward

A refused tool call says what was wrong and lists the valid values or the next call to make (`Unknown viewports: 1440x900. Flow phone runs at: 390x844.`). The tester and the skill act on this text without a human.
