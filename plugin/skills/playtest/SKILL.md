---
description: Playtest this project's web app. Matches the request to a flow in .jeyna/flows/ (or, with none, takes a short scout look and proposes scenarios), starts a run, spawns one jeyna-tester per scenario batch by batch, marks duplicate findings, ends with a report (with the verdicts that changed since the last run) and offers to save an exploratory run as a flow. Given a finding id (PT-…), retests that one finding and marks it fixed when its scenario passes.
disable-model-invocation: true
argument-hint: "[what to test, or a finding id PT-…]"
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

If the request is a finding id (`PT-<slug>-<nnn>`, with or without words around it), skip to 2c.

Match the request against the flow names and their scenario names from `get_context`. There are no aliases: "authentication", "auth" and "login flow" match a flow named `authentication`; "add a todo" matches a flow with a scenario named "Add a todo with a priority".

- **One flow matches**: a guided run of that flow. Go on to 3.
- **Several flows match**: ask the developer which one, listing them with their scenarios, and wait.
- **The matching flow has an `error`**: show the error, tell the developer to fix `.jeyna/flows/<name>.md`, and stop.
- **No flow matches**: an exploratory run. Say in one line that no flow matches (naming the flows that exist, if any), and go on to 2b.


A flow file is YAML frontmatter (`name`, `entry`, optional `viewports`, `accounts`) and, under `## Scenarios`, one `### <name>` heading per scenario, a description paragraph, a `Pass:` line and an optional `Account: none` or `Account: consumes` line.

## 2b. Exploratory: scout, propose, confirm

Only when no flow matched. Otherwise skip to 3.

**Scout.** Take a short look at the app with the browser tools and case `scout`: it needs no session, uses the first configured viewport, signs in with the first account, and writes nothing to disk. At most about 10 browser calls in all:
- `goto {case: "scout", path: "/"}`, then `snapshot {case: "scout"}`.
- If that page is a login wall and the config has accounts, sign in: `fill` the username field with `{{account.user}}`, the password field with `{{account.pass}}`, `click` the sign-in button, `snapshot`. Signing in is read-only; do nothing else that changes data.
- Follow the visible navigation that bears on the request (`goto` or `click`, then `snapshot`). Stop once you know the pages the request touches.
- `screenshot {case: "scout"}` only for a question the snapshot cannot answer; it returns the image and saves nothing.
- Never call `record_finding` or `scenario_verdict` with `scout`. Problems you notice are for the testers to find; do not report them now.

**Derive.** From the request and what the scout saw, write 2 to 5 scenarios that cover what the request asks for, each:
- `name`: short, unique, in the developer's words where they gave any ("Sign in and sign out", "Reset password");
- `description`: one paragraph of prose saying what the user does, not scripted clicks;
- `pass`: one sentence a tester can check by looking at the app ("the todo list opens and Sign out returns to the sign-in page");
- `account`: leave it out when the scenario signs in; `none` when it must not sign in (it judges the logged-out pages); `consumes` when it may lock or change its account (wrong passwords, a password reset). Consuming scenarios run last, at most one per account.

Also choose:
- `entry`: the path the scenarios start from (where the scout first landed, e.g. `/login`);
- `slug`: the flow name the run would be saved as, lowercase words joined by `-`, taken from the request so the same request matches it next time ("let's test the authentication flow" → `authentication`).

**Propose, in one message**, and wait:

```
No flow matches "<request>". I looked at <app url> (<what the scout saw, one line>) and propose an exploratory run "<slug>" from <entry>, at <viewports>:

1. <name> (<Account: none | consumes, if set>)
   <description>
   Pass: <pass>
2. ...

Start this run, or tell me what to change?
```

Start only after the developer confirms. If they edit (add, drop or rename scenarios, change a Pass: line, the slug, the entry or the viewports), apply exactly what they said; if the edit is clear, start; if not, show the changed list once more and wait. If they decline, stop.

**Start.** Call `session_start {scenarios, slug, entry, viewports?}` with the confirmed list: `[{name, description, pass, account?}]`, exactly as confirmed. It closes the scout. Then go on as in 3 from "The result has `runDir`": state the plan, and steps 4 to 7. In the tester prompt template, `Entry` is the confirmed entry, Preconditions is "None given." and What matters most here is the developer's request in their words. Afterwards, step 8.

## 2c. Retest a finding

Only when the request is a finding id. The run plays the finding itself: its Steps, judged against its Expected. Not the scenario it was found in: a finding is often something seen on the way (an unlabelled field while signing in to add a todo), and that scenario's `Pass:` line says nothing about it.

**Find it.** `Glob` `.jeyna/playtests/*/findings/<id>.md`. None: say so and stop. Several (ids repeat across runs of a flow): take the newest run folder (folder names sort by date) unless the request names a run. `Read` the finding: its frontmatter (`flow`, `scenario`, `viewport`, `status`), the title and the Steps, Expected and Actual sections. Then `Read` that run's `session.json` for `entry` and the `account` of the scenario named in the finding. Reading these files is fine; never write them.

**Start it.** An exploratory run of one scenario at one viewport:

`session_start {scenarios: [{name, description, pass, account?}], slug: "retest-<flow without the exploratory: prefix>", entry, viewports: [viewport]}` with
- `name`: `Retest <id>: <title>`;
- `description`: `Retest of <id> from run <run folder name>. <the Steps, as one paragraph: "Open /login, then read the snapshot."> Last time: <the Actual text>.`;
- `pass`: the finding's Expected text;
- `account`: the `account` of the scenario the finding was found in, if it has one.

The run folder and the new finding ids carry the `retest-` slug, so they never look like the retested one. Then continue at 3 from "The result has `runDir`" and do steps 4 to 7 (not 8: a retest is never saved as a flow). In the tester prompt, Preconditions is "None given." and What matters most here is: `Whether <id> is fixed: <title>.` In 7, name every finding id with its run, and the retested case's verdict decides the finding:
- `pass`: call `update_status {id, run: <the old run's folder name>, status: "fixed", note: "passed retest in run <new run id>"}` and say the finding is fixed;
- `fail`: say it persists and name the new finding ids with their run; the old finding stays `open`;
- `blocked` or `skipped`: say why and leave the status.

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

A duplicate is the same problem in the app recorded twice: the same element and behaviour on the same route, usually by two scenarios (or by one tester at two viewports). Different symptoms of one cause are not duplicates, and neither are two problems that one finding happens to mention together: if a finding describes anything the kept one does not (another element, message or behaviour), it is not a duplicate. When in doubt, keep both. For each duplicate, keep the finding with the lowest number and call `update_status {id, status: "duplicate", of: <kept id>}`. Set no other status.

## 7. Finish and report

Call `session_finish {summary}` with two or three sentences: what was played and the most important findings. If it refuses, fix what it lists (as in 5) and call it again.

Its result has `reportPath`, `counts`, `elapsedSeconds` and `testers`. Tell the developer:
- the summary;
- cases passed, failed, blocked and skipped; findings by severity, and how many duplicates you marked;
- the most severe findings, one line each: id, kind, title;
- what changed since the last run of this flow, from `since` (null on the first run): the previous run id and each changed case as `<scenario> at <viewport>: <was> → <now>`, or "no changes" when `changed` is empty;
- the report path (`reportPath`);
- elapsed time (from `elapsedSeconds`, as minutes and seconds) and the number of testers.

## 8. Exploratory run: offer to save it as a flow

Only after an exploratory run. In the same message as the report, ask: "Save these <n> scenarios as `.jeyna/flows/<slug>.md`, so `/jeyna:playtest <slug>` runs them guided next time?"

On a yes (or another name), call `save_flow {run: <id from session_start>, name}`. It copies the scenarios that ran from the run's `session.json`; never write the flow file with your own tools. If it refuses because the file exists, say so and offer another name; never overwrite. Then give the path and say the developer may edit the file (preconditions, what matters most, scenarios).
