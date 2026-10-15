---
description: Playtest this project's web app. Matches the request to a flow in .jeyna/flows/, starts a run, spawns one jeyna-tester per scenario batch by batch, marks duplicate findings and ends with a report.
disable-model-invocation: true
argument-hint: "[what to test]"
---

# /jeyna:playtest

Request: $ARGUMENTS

You run one playtest run. Testers play the scenarios; you resolve scope, spawn them, read what they found, mark duplicates and finish the run. Every Jeyna tool is `mcp__plugin_jeyna_mcp__<tool>`.

Rules for the whole run:
- Read config and flows only through `get_context` and `get_flow`, never with your own file tools.
- Never write under `.jeyna/playtests/` or to `.jeyna/.env`. The server writes the run; the write guard denies you anyway.
- Never ask for, read or print an account's username or password.

## 1. Context

Call `get_context`.

- If it fails because there is no `.jeyna/jeyna.config.yaml` (or no `.jeyna/` at all), tell the developer to run `/jeyna:init` first, and stop.
- On any other error, show it and say which field of `.jeyna/jeyna.config.yaml` to fix; stop.
- Otherwise show the project root and the app url in your first message. If an account variable is `missing` in `secrets`, say so now: testers that sign in with that account will fail. Fill it in `.jeyna/.env` or export it before starting `claude`.

Keep from the result: `config.app.url`, `config.viewports`, `config.tester` (`model`, `effort`), `conventions`, and `flows` (each with its scenario names, or an `error`).

## 2. Match the request to a flow

Match the request against the flow names and their scenario names from `get_context`. There are no aliases: "authentication", "auth" and "login flow" match a flow named `authentication`; "add a todo" matches a flow with a scenario named "Add a todo with a priority".

- **One flow matches**: a guided run of that flow. Go on to 3.
- **Several flows match**: ask the developer which one, listing them with their scenarios, and wait.
- **The matching flow has an `error`**: show the error, tell the developer to fix `.jeyna/flows/<name>.md`, and stop.
- **No flow matches**: exploratory mode. It is not built yet (it comes with the scout and `save_flow`). Say that no flow matches the request, list the flows that exist with their scenario names, and say: run `/jeyna:playtest <flow name>`, or write a flow in `.jeyna/flows/<name>.md` (see the format below). Stop.

<!-- Exploratory mode goes here: scout look with case `scout`, derive scenarios and Pass: lines, confirm with the developer, session_start {scenarios, slug}, then the same steps 4 to 7, then offer save_flow. -->

A flow file is YAML frontmatter (`name`, `entry`, optional `viewports`, `accounts`) and, under `## Scenarios`, one `### <name>` heading per scenario, a description paragraph, a `Pass:` line and an optional `Account: none` or `Account: consumes` line.

## 3. Start the run

Call `get_flow {name}`. Keep `frontmatter.entry` and the body's `## Preconditions` and `## What matters most here` text, if present.

Narrow the run only when the request asks to:
- `only`: the exact names of the scenarios the request singles out ("only the reset scenario", or a request that matched the flow through one scenario's name). Use the names as `get_flow` returned them.
- `viewports`: the exact viewport strings the request asks for. "Phone" or "mobile" means the narrowest configured viewport, "desktop" the widest.

Call `session_start {flow, only?, viewports?}`.
- Unknown scenarios or viewports are refused with the valid ones. Pick the right ones if the request is clear, else ask.
- "A run is still running": tell the developer, and ask whether to abort it. Only on a yes, call again with `force: true`.

The result has `runDir` and `testers`, each with `id`, `scenario`, `account` (a handle, or none), `batch` and `cases` (`id`, `viewport`). State the plan in one line before spawning, e.g. "3 testers, 2 batches (2 accounts): batch 1 Sign-in page, Add a todo; batch 2 Complete and delete a todo."

## 4. Spawn the testers, batch by batch

For each batch number, in ascending order:
- spawn every tester of that batch **in one message** (one Agent tool call per tester in the same response), so they run in parallel;
- wait until all of them have returned before you spawn the next batch. A later batch reuses accounts the earlier one has freed.

Each Agent call:
- `subagent_type`: `jeyna:jeyna-tester`;
- `model`: `config.tester.model`; `effort`: `config.tester.effort`. Pass both on every spawn, whatever they are; never choose a model per scenario;
- `description`: `Jeyna tester <id>: <scenario>`;
- `prompt`: exactly this template, the marker line first and on its own line:

```
jeyna-tester-cases: <case ids of this tester, comma separated, in the order given>
App: <config.app.url>
Entry: <frontmatter.entry>
Cases, in order:
- <case id> at <viewport>
- ...
Account: <handle>. Sign in with {{account.user}} and {{account.pass}}.   (or: Account: none. Do not sign in.)

Scenario: <scenario name>
<scenario description>
Pass: <scenario pass line>

Preconditions:
<the flow's Preconditions text, or "None given.">

What matters most here:
<the flow's What matters most here text, or "Nothing given.">

Conventions:
<conventions from get_context, verbatim>
```

Never put a username, password or env variable value in a prompt. The tester reads each page with `snapshot` and takes one `screenshot` with `look: true` per case once the first page has settled (F4.7), so every viewport gets one visual check.

As each tester returns, report one line: scenario, the verdict of each case, and how many findings it recorded.

## 5. Check the run

Call `validate`.
- `case <id> has no verdict`: the tester ended without one, even after the exit hook blocked it once. Spawn one new tester for the cases of that scenario that lack a verdict (same template, marker line listing only those cases). If a case still has none, call `scenario_verdict {case, result: "blocked", note: "the tester ended without a verdict"}` yourself.
- Any other error: the run folder is written only by the server, so show the error to the developer and stop. The run stays `running`; the next run needs `force`.

## 6. Mark duplicates

List `<runDir>/findings/` and `Read` every `PT-*.md` in it.

A duplicate is the same problem in the app recorded twice: the same element and behaviour on the same route, usually by two scenarios (or by one tester at two viewports). Different symptoms of one cause are not duplicates. For each duplicate, keep the finding with the lowest number and call `update_status {id, status: "duplicate", of: <kept id>}`. Set no other status.

## 7. Finish and report

Call `session_finish {summary}` with two or three sentences: what was played and the most important findings. If it refuses, fix what it lists (as in 5) and call it again.

Its result has `reportPath`, `counts`, `elapsedSeconds` and `testers`. Tell the developer:
- the summary;
- cases passed, failed, blocked and skipped; findings by severity, and how many duplicates you marked;
- the most severe findings, one line each: id, kind, title;
- the report path (`reportPath`);
- elapsed time (from `elapsedSeconds`, as minutes and seconds) and the number of testers.
