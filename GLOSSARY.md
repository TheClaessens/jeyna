# Jeyna glossary

The one glossary for Jeyna. Use these words in docs, code, issues and agent prompts. Decisions behind them are in `docs/decisions.md` (D-numbers).

## The loop

- **Run**: one execution of `/jeyna:playtest`, stored as one folder `.jeyna/playtests/<yyyy-mm-dd>-<slug>[-<n>]/`.
- **Guided run**: a run whose scenarios come from a flow file.
- **Exploratory run**: a run whose scenarios were derived from the prompt and a scout look, and confirmed by the developer.
- **Flow**: a named set of scenarios for one area of the app, in `flows/<name>.md`. Usually first written by the loop at the end of an exploratory run (`save_flow`), then edited by people.
- **Scenario**: one named path through a flow, with a description, a `Pass:` line and an optional `Account:` line (`none` or `consumes`).
- **Reset**: the `app.reset` shell command in `jeyna.config.yaml`, run by `session_start` from the project root before every run so each run starts from the same app state. A failing command refuses the run. (D31)
- **Retest**: a run of one finding's scenario at its viewport, started by `/jeyna:playtest PT-<slug>-<nnn>`. A `pass` marks the finding `fixed`. (D31)
- **Slug**: the flow name or exploratory slug used in the run folder and finding ids. It never contains a colon. (D7)

## Who does the work

- **Main agent**: the developer's own Claude Code session running the `playtest` skill. It resolves scope, starts the session, spawns testers, marks duplicates and finishes the run. There is no reviewer agent in v0. (D12)
- **Tester**: one `jeyna-tester` subagent per scenario. It runs that scenario's cases in sequence. Sonnet at medium effort by default. (D4, D15)
- **Case**: one (scenario, viewport) pair in a run. It has its own browser context, evidence prefix and verdict, and uses its tester's account. Browser tools are keyed by case. (D4)
- **Scout**: the reserved case id for the exploratory look before a session exists. It writes nothing to disk. (D6)
- **Batch**: a group of testers that run at the same time. No account is held by two testers in the same batch. (D10)
- **Account**: a test login from the pool in `jeyna.config.yaml` (handle plus environment variable names). One per tester, never shared by concurrently running testers. (D10)
- **Persona**: *not supported in v0; required in v1.* Who the tester pretends to be. It changes behaviour, so each persona gets its own tester. (D4)

## What a run produces

- **Finding**: one observed divergence, one markdown file `findings/PT-<slug>-<nnn>.md`. Its kind is `bug`, `ux`, `a11y` or `question` (no `perf` in v0, D8). Its status is `open`, `duplicate` (with `of`), `wontfix` or `fixed`. (D11)
- **Verdict**: `pass`, `fail`, `blocked` or `skipped` for one case. Recorded by the tester and checked by the server. (D8)
- **Evidence**: PNG files under the run's `evidence/` folder, named `<case>-<seq>[-<label>].png` and referenced by name from findings. No clips in v0. (D9)
- **Console**: the app's page errors, console errors, failed requests and 4xx/5xx responses in a case's browser since the tester's last call, carried by the results of `goto`, `click`, `press` and `snapshot`. Not stored. (D31)
- **Report**: `report.md`, written by `session_finish`: counts, scenario matrix, the verdicts that changed since the latest done run of the same flow, and findings sorted by severity then kind.

## Reading a run

- **Studio**: the read-only viewer of `.jeyna/playtests/`, shipped in the plugin and started by `/jeyna:studio`. A sidecar watches the folder, validates every file with the server's rules and pushes an index to a browser page; it edits nothing. (D34)
- **Needs attention**: the studio's lane for what `validate` reports: a finding or session file that does not parse, or a check that fails. The file stays listed with its errors and its source; nothing is dropped. (D34)
- **Fold**: in the studio, a finding with status `duplicate` sits under the finding its `of` names and leaves the counts. One whose target is not in the run stands on its own. (D34)

## Rules of the fan-out

- **Environment axis**: something that changes the browser (viewport; later zoom, reduced motion). It runs in sequence inside one tester.
- **Identity axis**: something that changes who the tester is (persona). It gets its own tester. (D4)
