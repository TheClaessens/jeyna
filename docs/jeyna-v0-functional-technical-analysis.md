# Jeyna v0 — Functional & Technical Analysis

**Scope:** the playtest loop only.
**Status:** draft v3, 15 Oct 2026, after the first grill session; decisions D1–D19 in `decisions.md`, terms in `../GLOSSARY.md`, first build step in `first-slice.md`. Flow files are optional; exploratory mode added (F2). Intended to be interrogated in Claude Code before any code is written.
**Companion material:** concept page (report prototype) and architecture page (lanes, channels, formats) in the Jeyna project.

---

## 1. Purpose

Jeyna lets a developer type `/jeyna:playtest <flow>` in their own Claude Code session and get back a folder of markdown findings with screenshots, produced by Claude agents that drove the web app in real browsers. A small local studio renders that folder as a report. The folder is the only thing the two sides share.

The product is the **file contract**. The plugin (Claude side) and the studio (human side) are both consumers of it. If the contract is right, either side can be rewritten without touching the other, and the same contract can later carry human feedback, other runtimes (Cowork) and other app types (Flutter, Godot).

### 1.1 In scope for v0

- The `.jeyna/` file contract: config, flows, run folders, findings, report, evidence.
- `jeyna-mcp`: a local MCP server that is the only writer of run files and the only browser.
- The `jeyna` plugin for Claude Code: two skills (`playtest`, `init`), one agent definition (`jeyna-tester`), two hooks (D12), and the server as a committed single-file bundle (D13).
- `/jeyna:init`: per-project setup of `.jeyna/` (D13).
- `jeyna validate`: a linter over a run folder, run inside `session_finish` (D2) and from a shell via the bundle. CI use is v1 (D18).
- A sample web app with seeded bugs to test the loop against: a small todo app behind a login, specified in §5.10 (D16).

### 1.2 In scope for v1 (designed for, not built in v0)

- The Jeyna studio viewer (TanStack Start): watch, parse, render, live run status.
- **Personas (UX playtests). Not supported in v0; required for v1.** A persona (e.g. an 80-year-old first-time user vs a 20-year-old power user) changes who the tester is, so per the fan-out rule (D4) each (scenario, persona) gets its own tester, and a case becomes (scenario, persona, viewport). A persona may also carry browser-context settings (zoom, reduced motion, pace), which attach to the case like a viewport. v0 contains no `persona` field; the `schema` version field lets v1 add `persona?` to cases, findings and the report matrix without breaking v0 runs.

### 1.3 Explicitly out of scope

- Human feedback capture in the studio and `/jeyna-ingest`.
- Clips and video evidence (D9). Evidence in v0 is single screenshots.
- Evidence pruning / remote evidence storage.
- Cowork registration and testing.
- Non-web targets.
- Running `jeyna validate` in CI (no published package to install there; v1, D18).
- **Performance findings** (kind `perf`). No v0 tool measures anything, so perf findings would be guesses. v1 with real measurement.
- **Personas.** v0 runs one implicit persona (a technical tester). See §1.2: personas are a v1 requirement, not an afterthought.
- Jeyna starting or talking to Claude in any way.

---

## 2. Actors and surfaces

| Actor | Where | Does |
|---|---|---|
| Developer | Claude Code terminal | Types the command, reads the report, decides what to fix. |
| Main agent | Claude Code session, skill `playtest` | Resolves scope, starts the session, spawns testers batch by batch, marks duplicate findings, finishes the session (D12). |
| `jeyna-tester` × N | Subagents | One per scenario. Runs that scenario's cases (one per viewport) one after the other, each in a fresh browser context. Records findings and one verdict per case. |
| `jeyna-mcp` | Local child process of the session | Owns browsers, accounts, ids, file writes. |
| Hooks | Shell scripts run by Claude Code | Deny file writes into run folders; lint before an agent may stop. |
| Jeyna studio (v1) | Local app on the developer's machine | Reads the folder, renders it. Never writes, never calls Claude. |

---

## 3. Functional requirements

Numbered so they can be referenced in grill sessions. "Must" is v0; "should" is v0 if cheap, else v1.

### F1. Trigger
- F1.1 The loop starts only from a Claude Code prompt: `/jeyna:playtest <free text>`. No other trigger exists. The skill sets `disable-model-invocation: true` so Claude never starts a run on its own, and `argument-hint: [what to test]` (D5).
- F1.2 The skill matches the free text to a flow by flow name and scenario names, as returned by `get_context` (`"authentication"`, `"auth"`, `"login flow"` → `flows/authentication.md`). There are no aliases (D5). A match selects **guided mode**; no match selects **exploratory mode** (F2). Several matches: the skill asks which.
- F1.3 The developer may narrow a run: `/jeyna:playtest authentication, only the reset scenario at phone width`. The skill passes `only` (scenario names) and `viewports` to `session_start`; the server refuses unknown names and returns the valid ones (D5).

### F2. Scope resolution
- F2.1 The skill reads `jeyna.config.yaml` (and the flow file, if any) through `get_context` and `get_flow`, never with its own file tools.
- F2.2 **Guided mode.** The flow file declares scenarios, preconditions, accounts and what pass means. Viewports come from the flow if declared, otherwise from config. Runs are repeatable and comparable across builds.
- F2.3 **Exploratory mode.** No flow exists for the prompt. The skill derives a scenario list from the prompt plus a short look at the app through `jeyna-mcp` using the reserved case `scout` (D6): entry page snapshot, visible navigation, about 10 browser calls at most; it may log in with the first account in the pool when the entry page is a login wall. `scout` needs no session, uses the first configured viewport, writes nothing to disk (`screenshot` returns the image only), and is closed by `session_start`. The skill proposes the list and the pass criteria to the developer in one message, and proceeds after confirmation or edits. The derived scenarios are stored in `session.json` (`scenarios[]`, same shape as a flow's) so the run is self-describing.
- F2.4 **Promotion.** At the end of an exploratory run the skill offers to save the run's scenarios as `flows/<name>.md` via `save_flow {run, name}`; the server copies them from that run's `session.json`, so the saved flow is exactly what ran (D6). The developer edits it from there; the next run with the same prompt is guided. Flow files are therefore written by the loop and edited by people, not authored up front.
- F2.5 Fan-out rule (D4): axes that change the environment run in sequence inside one tester; axes that change who the tester is get their own tester. In v0 the only environment axis is viewport and there is one implicit persona, so: one **tester** per scenario; one **case** per (scenario, viewport), each with its own browser context and verdict. N testers = scenarios after filters. Concurrency is planned by the server (D10, D14): testers needing an account are limited to the number of accounts in the pool; testers needing none are not limited by Jeyna (Claude Code's own limit is 20 concurrent subagents). `session_start` returns a `batch` number per tester; the skill spawns batch by batch and states the plan up front ("4 testers, 2 at a time: 2 accounts").

### F3. Session
- F3.0 The server resolves the project root from its `--project` argument (`.mcp.json` passes `${CLAUDE_PROJECT_DIR}`, which the plugin docs say resolves in MCP `args`; D13), else `CLAUDE_PROJECT_DIR` from its environment, else the nearest folder containing `.jeyna/` above its working directory; if neither, `get_context` fails with an explicit message. `get_context` returns the resolved root and the skill shows it in its first message (D7).
- F3.1 `session_start` creates `playtests/<yyyy-mm-dd>-<slug>[-<n>]/` (slug = flow name, or the exploratory slug; never a colon) and writes `session.json` with status `running`, the build id, the tester list with the account and batch assigned to each tester, and the case list.
- F3.2 Build id is `app.build` from config if set, otherwise `git describe --always --dirty` in the project root (e.g. `a1b2c3d-dirty` for uncommitted work), otherwise `"unknown"` (D7).
- F3.3 Starting a session while another is `running` for the same project is refused unless `force: true`; the stale one is marked `aborted`.

### F4. Tester behaviour
- F4.1 A tester receives, in its prompt: a first marker line `jeyna-tester-cases: <case ids>`, the scenario text, each case's viewport, the tester's account handle (if any), the flow's preconditions, and the conventions file. It receives no credentials. It runs its cases in order and treats each as a fresh check, not a repeat of the previous viewport.
- F4.2 A tester may only use these eight `jeyna-mcp` tools, listed by exact name in `tools:` (no wildcard; see D1): `goto`, `click`, `fill`, `press`, `snapshot`, `screenshot`, `record_finding`, `scenario_verdict`. No `Write`, `Edit`, `Bash`, no other browser tool, and no run-control tool (`session_start`, `session_finish`, `save_flow`, `update_status`): the server cannot tell which agent is calling, so the allowlist is the only thing keeping a tester from aborting the run.
- F4.3 A tester must record exactly one verdict per case before it finishes, via `scenario_verdict`.
- F4.4 A tester records a finding whenever observed behaviour diverges from the flow's definition of pass, or from common expectations for the kind (a11y, ux) as described in `CONVENTIONS.md`. One finding per distinct problem.
- F4.5 Every finding of kind `bug` must carry at least one piece of evidence; `record_finding` refuses it otherwise (D2). Other kinds should.
- F4.6 A tester must not attempt to fix anything or read source code. Enforced by the allowlist (F4.2): no `Read`, `Bash` or file tools. Adding `Read` to the tester would break this.
- F4.7 A tester takes one `screenshot` with `look: true` once the scenario's first page has settled in each case, so every viewport gets at least one visual check (D3).
- F4.8 Model per role, not per scenario (D15). `jeyna-tester.md` sets `model: sonnet` and `effort: medium`. Config `tester: { model, effort }` overrides it project-wide; the skill passes it as the per-spawn `model`/`effort` on every tester. The skill never picks a model per scenario. The main agent stays on the developer's session model.

### F5. Browser actions
- F5.1 All browser tools take `case`. Calls with an unknown case id are refused.
- F5.2 `goto`, `click`, `fill`, `press`, `snapshot`, `screenshot`. Nothing else in v0 (no `evaluate`, no raw CDP, no clips; D9). `fill` on a `<select>` element calls Playwright's `selectOption` with the value, so dropdowns need no extra tool.
- F5.3 `snapshot` returns the page's accessibility tree as text (Playwright aria snapshot), truncated at about 90,000 characters (just under Claude Code's default 25,000-token `MAX_MCP_OUTPUT_TOKENS`) with an explicit note "truncated at N characters, the page continues" (D14). This is a correctness guard, not cost control. This is the tester's primary way of reading the page; `screenshot` is for evidence and for visual questions.
- F5.4 `fill` accepts the placeholders `{{account.user}}` and `{{account.pass}}`, substituted server-side from the env variables named in config. The server reads each variable from its own environment first, then from `.jeyna/.env` (Node's built-in dotenv parsing; gitignored; filled in by people only) (D18). On the way out, the server replaces every configured account value with its placeholder in every text it returns (snapshots, errors, URLs, titles), so a value echoed by the page never reaches the context (D9). Pixels are not redacted: a screenshot may show a username, never a password (password fields render masked).
- F5.5 `screenshot` always writes `evidence/<case>-<seq>[-<label>].png` and returns the file name. It returns the image too only when `look: true` (default `false`); the tool description says to look when the question is visual (layout, overlap, cut-off text) and to use `snapshot` otherwise. Full page is an option; viewport is the default (D3).
- F5.6 Selectors are Playwright selectors. The tool description teaches the three that matter: `role=button[name="Sign in"]`, `text=Forgot password`, CSS.

### F6. Findings
- F6.1 `record_finding` takes the payload defined in §5.2, validates it, assigns the id, adds server-side fields, writes `findings/<id>.md`, and returns the id.
- F6.2 Ids are `PT-<slug>-<nnn>` (same slug as the run folder), sequential per run, allocated by the server. Two concurrent calls cannot receive the same id: the number comes from an in-memory counter in one synchronous step before any `await`, and the file is created with the `wx` flag so a collision fails loudly instead of overwriting (D11). No lock.
- F6.3 Evidence names in the payload must exist in the run's `evidence/` folder, otherwise the call is refused with the list of files that do exist.
- F6.4 Findings are immutable in v0 except `status` (`open | duplicate | wontfix | fixed`, default `open`), changed through `update_status`. During a run the main agent sets only `duplicate`, with `of: PT-…`. `wontfix` and `fixed` are for later sessions or for people editing the file by hand (D11).
- F6.5 The server holds the session in memory as the only source of truth during a run. Every change updates memory, then writes the whole `session.json` through one write queue (temp file + rename). The server never reads `session.json` back during a run, so parallel verdicts cannot overwrite each other (D11).

### F7. Verdicts and report
- F7.1 `scenario_verdict` records `{case, result, note?, findings[]}` into `session.json`. Testers own verdicts; the server checks them (D8): `fail` needs at least one finding id belonging to that case; `blocked` and `skipped` need a `note`; `pass` may list findings.
- F7.2 After all testers return, the main agent calls `validate` and resolves every error. `session_finish` runs the same checks itself and refuses, returning the error list, while any remain (D2). This is the one gate where a run ends, and it does not depend on hooks.
- F7.3 `session_finish` writes `report.md` from `session.json` and the findings (summary counts, scenario matrix, finding list sorted by severity then kind; no ranking), sets status `done`, and closes all browser contexts.
- F7.4 Dedupe is the main agent's job, not the server's (D12). It reads the findings with `Read` and marks a duplicate with status `duplicate` and `of: PT-…`; the server never deletes files.

### F8. Validation
- F8.1 `jeyna validate [runDir]` checks: every finding parses (frontmatter schema, required sections); every evidence reference exists; every finding of kind bug has evidence; every case in `session.json` has a verdict; `report.md` exists when status is `done`.
- F8.2 Output is one line per error, `path: message`, exit code 1 on errors, 0 otherwise. Used by `session_finish` and by hand from a shell (CI is v1, D18); the exit hooks do not run it (D2).
- F8.3 The same checks run as the viewer's read-time validation.

### F9. Hooks
- F9.1 PreToolUse on `Write|Edit|NotebookEdit`: deny when `tool_input.file_path` is under `.jeyna/playtests/` or is `.jeyna/.env` (D18). Message explains to use `record_finding`. `Bash` is not guarded: testers do not have it, and a main-agent shell write is accepted risk.
- F9.2 Exit hooks check only the work of the agent that is stopping, never the whole run (D2). A whole-run check at a tester's exit fails on other testers' missing verdicts, which that tester cannot fix.
  - SubagentStop, matcher `^jeyna:jeyna-tester$`: block if any of this tester's cases has no verdict in the active run. The case ids come from the marker line `jeyna-tester-cases: <ids>` that opens every tester prompt, read from `agent_transcript_path`.
  - It allows the stop when `stop_hook_active` is true, so it blocks at most once. It is a no-op when no run is `running`.
  - No Stop hook on the main session: the main agent stops legitimately while waiting for background testers or for the developer. A main agent that stops before `session_finish` leaves the run `running`; the developer sees no report path, and the next run needs `force` (accepted for v0, D12).

### F11. Install and setup (D13)
- F11.1 Per developer, once: `/plugin marketplace add <owner>/jeyna` and `/plugin install jeyna`. The Jeyna GitHub repo is the plugin marketplace; no npm publish. The plugin folder contains `server/jeyna-mcp.mjs`, an esbuild bundle of the server with its dependencies, built and committed per release. No npm command, build or download on the developer's machine; Node ≥ 20 only.
- F11.2 If `playwright-core` cannot be bundled (unverified; first slice), it stays external and the server installs it once into `${CLAUDE_PLUGIN_DATA}` on first start. Still no developer command, nothing in the project's dependencies.
- F11.3 Browser: Playwright launches the installed Google Chrome (`channel: "chrome"`) with a temporary profile; the developer's own Chrome profile, cookies and tabs are never used. If Chrome is missing, `get_context` fails with one line: run `npx playwright install chromium`, after which the server uses that browser.
- F11.4 Per project, once: `/jeyna:init`. It inspects the project (dev script, port), asks for the app URL and the env variable names of test accounts, writes `.jeyna/jeyna.config.yaml`, `.jeyna/CONVENTIONS.md` and `.jeyna/.env` (empty entries for the account variables, gitignored, D18) from templates in the plugin, asks the evidence git policy and writes the matching `.gitignore` line (§7 Q10), optionally writes `.claude/settings.json` naming the marketplace and enabling the plugin for teammates, and ends by calling `get_context` to validate the config. No new MCP tool: config and conventions are hand-edited files, not run files.
- F11.5 No skill, agent or hook is copied into the project; the plugin namespace is the distribution.

### F10. Viewer (v1, listed for completeness)
- F10.1 Watch `playtests/**`, parse on change, hold an in-memory index, push via SSE.
- F10.2 Show run list, run status chip (from `session.json`), summary, scenario matrix, filterable finding list, finding detail with inline PNGs, source markdown.
- F10.3 Files that fail validation appear in a "needs attention" lane with the errors, never hidden.

---

## 4. Non-functional requirements

- **N1 Determinism of shape.** No agent ever formats a run file. Enforced by F4.2, F9.1 and the server being the only writer.
- **N2 Secrets.** No credential appears in markdown, JSON, tool results or agent context. Enforced by F5.4 and config holding env variable *names* only.
- **N3 Isolation.** Testers cannot affect each other: separate browser contexts (cookies, storage), and no account is used by two testers at the same time (D10). A tester's own cases share its account, in sequence.
- **N4 Durability.** Everything a later session needs is in markdown and PNG on disk, committed with the branch. `session.json` and the viewer's index are not part of the record.
- **N5 Cost visibility.** No limits: no token budget, no time target, no per-case call cap (D14). The skill reports elapsed time and tester count in its final message; token cost is visible in the developer's own Claude Code usage.
- **N6 Portability of the contract.** Nothing in the files depends on Claude Code. Cowork must be able to drive the same server; because `session_finish` refuses an invalid run (F7.2), Cowork needs no special fallback, only the missing per-tester exit check.
- **N7 Evidence size.** PNGs at viewport size by default. Git policy for `evidence/` is a per-project choice documented in the README (commit on branch, or gitignore).

---

## 5. Technical design

### 5.1 Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, Node ≥ 20, ESM | One language across server, CLI and viewer; the schema module is shared as code. |
| Schema | zod v4, `z.toJSONSchema` for tool definitions | One definition, three readers. |
| Markdown write | string template + gray-matter for frontmatter | No AST needed to write; trivially testable. |
| Markdown read | gray-matter + heading regex (server, CLI); remark or TanStack Markdown in the viewer only | Server never needs a body AST. |
| MCP | `@modelcontextprotocol/sdk`, stdio | Standard; one process per session. |
| Browser | Playwright library, headless Chromium | Contexts give isolation; aria snapshot gives a text view. |
| Config | YAML (`yaml` package) | Hand-edited by developers. |
| Hooks | POSIX sh + small node one-liners | No jq dependency. |
| Tests | vitest; one Playwright smoke test | Keep the contract honest. |
| Package manager | npm (Jeyna repo only) | Build-time only. Users install the plugin from the GitHub marketplace and run a committed esbuild bundle with `node`; no npm publish in v0 (D13). |
| Bundler | esbuild | One `server/jeyna-mcp.mjs` file in the plugin. |
| Viewer (v1) | TanStack Start + chokidar + SSE | Chosen for alignment with Studio; not required by the contract. |

### 5.2 Data model

**FindingInput** (what a tester sends):

| field | type | required | note |
|---|---|---|---|
| title | string 8–140 | yes | one line, no severity words |
| kind | bug \| ux \| a11y \| question | yes | no `perf` in v0 (D8) |
| severity | critical \| major \| minor \| note | yes | |
| route | string | yes | e.g. `/login` |
| steps | string[1..12] | yes | |
| expected | string | yes | |
| actual | string | yes | |
| evidence | string[] | default [] | file names under `evidence/` |
| next | string | no | suggested next step |

**Finding frontmatter** (server-added fields in bold): schema, **id**, kind, severity, **status** (`open | duplicate | wontfix | fixed`), **of?**, **flow**, **case**, **scenario**, route, **viewport**, **browser**, **build**, **author** (the tester's model id, D15), **created**, evidence. Scenario and viewport are copied from the case, so a tester cannot get them wrong (D4).

**Session** (`session.json`): schema, id, flow (name, or `exploratory:<slug>`), app, build, status (running | done | aborted), started, finished?, mode (guided | exploratory), scenarios[{name, description, pass, account?: none | consumes}], testers[{id, scenario, account?, batch, model, cases[]}], cases[{id, scenario, viewport}], verdicts[{case, result, note?, findings[]}], summary?.

**Config** (`jeyna.config.yaml`):

```yaml
app:
  name: todo-sample
  url: http://localhost:4173
  build: null            # optional fixed id; else git HEAD
viewports: [1440x900, 390x844]
browser:
  headed: false
tester:                  # optional; default model: sonnet, effort: medium (D15)
  model: sonnet
  effort: medium
accounts:
  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }
  - { handle: user_b, user_env: JEYNA_USER_B_USER, pass_env: JEYNA_USER_B_PASS }
```

**Flow file** (`flows/<name>.md`): YAML frontmatter `name, entry, viewports?, accounts?` and a body with `## Preconditions`, `## Scenarios`, `## What matters most here`. Under `## Scenarios`, each scenario is a `### <name>` heading, a description paragraph, and one line starting `Pass:` (D6). An optional line `Account: none` (needs no login) or `Account: consumes` (may lock its account; run last) follows it (D10). Prose, not scripted steps:

```markdown
## Scenarios
### Reset password
User requests a reset link from the login page and sets a new password.
Pass: the new password works, the old one is refused.
```

### 5.3 File layout

```
.jeyna/
├─ jeyna.config.yaml
├─ CONVENTIONS.md
├─ flows/<name>.md
└─ playtests/<yyyy-mm-dd>-<slug>[-<n>]/
   ├─ session.json
   ├─ report.md
   ├─ findings/PT-<slug>-<nnn>.md
   └─ evidence/<case>-<seq>[-label].png
```

### 5.4 Tool API (`jeyna-mcp`)

The plugin is `jeyna` and the server key in `.mcp.json` is `mcp`, so every tool is called `mcp__plugin_jeyna_mcp__<tool>` (e.g. `mcp__plugin_jeyna_mcp__record_finding`). Tool names carry no `jeyna_`/`browser_` prefix; the namespace already does. Hook matchers and agent allowlists must use the full name; the short `mcp__<server>__…` form never matches a plugin server (D1).

Run family:

| tool | input | output |
|---|---|---|
| `get_context` | — | project root, config (env variable names only), `secrets`: per account variable `env` \| `.env` \| `missing`, never the value (D18, D21), conventions text, flows with their scenario names, active session if any |
| `get_flow` | `{name}` | flow frontmatter + body + parsed scenario list |
| `session_start` | `{flow?, scenarios?: [{name, description, pass, account?}], only?: string[], viewports?: string[], force?}` | session id, run dir, testers[{id, scenario, account handle?, batch, cases[{id, viewport}]}]. Either `flow` (guided) or an explicit `scenarios` list (exploratory) is required. |
| `save_flow` | `{run, name}` | writes `flows/<name>.md` from that run's `session.json` scenarios (F2.4); refuses if the file exists |
| `scenario_verdict` | `{case, result, note?, findings?}` | ok; refused if `fail` has no finding of this case, or `blocked`/`skipped` has no note |
| `record_finding` | `{case, finding: FindingInput}` | `{id, path}`; refused if kind is `bug` with no evidence, or an evidence file does not exist |
| `update_status` | `{id, status, of?, note?}` | ok; `of` required when status is `duplicate` |
| `validate` | `{run?}` | `{errors: string[]}` |
| `session_finish` | `{summary}` | `{reportPath, counts}`, or a tool error listing validation errors (run stays `running`) |

Browser family (all `{case, …}`; `case: "scout"` is reserved for the pre-session look, F2.3):

| tool | input | output |
|---|---|---|
| `goto` | `{url \| path}` | final url, title |
| `click` | `{selector}` | ok, or error with nearest candidates |
| `fill` | `{selector, value}` | ok; placeholders substituted; `<select>` handled via `selectOption` |
| `press` | `{key}` | ok |
| `snapshot` | — | aria snapshot text, truncated with a note above ~90k characters |
| `screenshot` | `{label?, fullPage?, look?}` | file name; plus image content when `look: true` |

Errors are returned as tool errors with actionable text (what exists, what was expected), never as thrown exceptions that kill the server.

### 5.5 Browser pool

One `chromium.launch({ channel: "chrome" })` per server process (fallback: Playwright's Chromium if installed; F11.3); one `BrowserContext` per case, created lazily on first browser call with the case's viewport and a fresh storage state. Contexts are closed on `session_finish`, on `session_start(force)`, and on server shutdown. Headed mode is a config flag for tuning runs.

### 5.6 Accounts

Config lists handles and env variable names. `session_start` assigns one account per tester (none for `Account: none` scenarios) and plans batches so no account is held by two testers at once; a tester in a later batch reuses an account freed by an earlier one. `Account: consumes` testers go in the last batch. A flow may restrict to specific handles. Resetting a locked account between runs is the developer's job in v0 (D10). The server reads the env at substitution time. If an env variable is missing, `fill` fails with "account user_a not configured", not with an empty string.

### 5.7 Plugin layout

```
plugin/
├─ .claude-plugin/plugin.json
├─ .mcp.json                      # server key `mcp`: node ${CLAUDE_PLUGIN_ROOT}/server/jeyna-mcp.mjs --project ${CLAUDE_PROJECT_DIR}
├─ server/jeyna-mcp.mjs           # committed esbuild bundle (D13); also `validate` subcommand
├─ templates/                     # jeyna.config.yaml, CONVENTIONS.md for /jeyna:init
├─ skills/init/SKILL.md           # invoked as /jeyna:init; disable-model-invocation: true
├─ skills/playtest/SKILL.md       # invoked as /jeyna:playtest; disable-model-invocation: true
├─ agents/jeyna-tester.md         # tools: 8 exact names (D1, D9); one per scenario (D4); model: sonnet, effort: medium (D15)
└─ hooks/
   ├─ hooks.json
   ├─ guard-write.sh
   └─ check-exit.sh               # SubagentStop: tester recorded a verdict for each case
```

### 5.8 Skill procedure (`SKILL.md` outline)

1. Call `get_context`. If no `.jeyna/` exists, stop and tell the developer to run `/jeyna:init`.
2. Resolve the flow from the prompt (F1.2). Ask if ambiguous.
   - No flow: exploratory mode. Take an entry snapshot, derive scenarios and pass criteria, show them, wait for confirmation.
3. Call `session_start` with the flow name (guided) or the confirmed scenario list (exploratory), plus `only` / `viewports` read from the prompt.
4. For each batch in the result, spawn its `jeyna-tester`s in parallel with the prompt template (F4.1), listing their cases; start the next batch when the current one has returned.
5. Wait for all testers. Report progress as they return (scenario, verdict, finding count).
6. Call `validate`; read the findings with `Read`; mark cross-scenario duplicates with `update_status`; call `session_finish` with a short summary, fixing whatever it refuses.
7. Relay the summary and the report path. State elapsed time and tester count.
8. Exploratory run: offer to save the scenarios as a flow file (`save_flow`).

### 5.9 Sequence of one run

```
dev        main agent        jeyna-mcp              disk                     testers
 |  /jeyna:playtest auth |                            |                          |
 |--------------------->| get_context, get_flow      |                          |
 |                      |--------------------------->| read config, flow        |
 |                      | session_start              |                          |
 |                      |--------------------------->| write session.json       |
 |                      | Task × N -------------------------------------------->|
 |                      |                            |        browser_* (case k)|
 |                      |                            |<-------------------------|
 |                      |                            | write evidence/*.png     |
 |                      |                            |      record_finding      |
 |                      |                            |<-------------------------|
 |                      |                            | write findings/PT-*.md   |
 |                      |                            |      scenario_verdict    |
 |                      |<---- all testers returned --------------------------- |
 |                      | validate, update_status,   |                          |
 |                      | session_finish ----------->| validate                 |
 |                      |                            | write report.md, done    |
 |<--- summary + path --|                            |                          |
```

A SubagentStop hook fires at each tester's exit (verdict recorded for each case?). `session_finish` runs `validate` before writing the report.

---

### 5.10 Sample app (D16)

`sample-app/` in this repo: a small todo app behind an authentication gate. Zero dependencies: `node sample-app/server.mjs` (Node ≥ 20 built-ins only, plain HTML pages, no framework, no npm install), on `http://localhost:4173`.

- **Pages:** login; password reset; todo list (add, complete, delete; each todo has a priority chosen from a `<select>`).
- **Accounts:** `user_a`, `user_b`; credentials in `sample-app/.env.example` as `JEYNA_USER_A_USER/PASS`, `JEYNA_USER_B_USER/PASS`. State is in memory; restarting the server resets accounts and lockouts.
- **Answer key:** `sample-app/SEEDED-BUGS.md`, read by people to score AC2. Testers cannot read it (no `Read`).

| # | Seeded bug | Kind | Exercises |
|---|---|---|---|
| 1 | After a password reset, the old password still works | bug | judging against a `Pass:` line |
| 2 | The "Sign in" button is pushed off screen at 390 px wide | ux | testers see images (D3) |
| 3 | The password field has no label | a11y | reading the aria snapshot |
| 4 | Saving a todo drops the chosen priority (the `<select>` value) | bug | `fill` on `<select>` (D9) |
| 5 | Lockout after 3 wrong passwords never ends, even after a successful reset | bug | `Account: consumes`, batching (D10) |
| 6 | The login error echoes the typed username back into the page | bug | redaction; AC3 passes only if it holds (D9) |

---

## 6. Acceptance criteria for v0

1. On the sample app with **no flow file present**, `/jeyna:playtest let's test the authentication flow` proposes a sensible scenario list, runs it after one confirmation, and produces a run folder that passes `jeyna validate`.
1b. Accepting the offer to save the flow, then running the same command again, performs a guided run with the same scenario rows in the matrix.
2. At least 4 of the 6 seeded bugs in `sample-app/SEEDED-BUGS.md` (§5.10) are found as findings with evidence, across two runs.
3. No password appears anywhere under `.jeyna/` or in the session transcript, and no account username appears in any text file under `.jeyna/` or in the transcript (screenshot pixels may show a username) (D9).
4. The main agent attempting `Write` into `.jeyna/playtests/` or `.jeyna/.env` is denied by the hook. (Testers have no `Write` at all, D1; D19.)
5. A `record_finding` call of kind bug with no evidence is refused with an actionable error, and the tester retries it with a screenshot.
5b. A tester that ends without a verdict is blocked once by SubagentStop and then records one.
6. The report's scenario matrix has a verdict for every (scenario, viewport) pair.
7. The same run folder, opened in any markdown viewer, is readable without the studio.
8. In a project with no `.jeyna/`, `/jeyna:init` produces a config that `get_context` accepts, and the next `/jeyna:playtest` runs without any npm command on the developer's machine.

---

## 7. Questions to grill

These are the places where the design is a guess and a Claude Code session can disprove it quickly.

1. ~~**Tool naming in agent allowlists.**~~ Resolved, D1: `mcp__plugin_jeyna_mcp__<tool>`; wildcards (`mcp__<server>__*`) work but are not used for testers, which get 8 exact names (10 before D9 cut clips).
2. ~~**Hooks and MCP.**~~ Resolved, D2: all confirmed; exit hooks rescoped to the stopping agent, run-level validation moved into `session_finish`. Original question: Confirm Stop/SubagentStop can block with a reason and that `stop_hook_active` is present in the payload. Confirm the PreToolUse payload exposes `tool_input.file_path` for Write/Edit.
3. ~~**Image return.**~~ Open until the first-slice probe, D3: `screenshot` returns the image only on `look: true`; fallback is snapshot-only testers and no layout findings in v0. Original question: Does a screenshot returned as MCP image content reach a subagent's context as an image? If only text does, testers navigate by snapshot and screenshots are evidence only.
4. **Snapshot size.** Observed in the first full run, not a gate (D14). How large is an aria snapshot of a realistic page, and what cap keeps a tester under budget across a 10-step scenario?
5. **Parallelism.** Docs: 20 concurrent subagents by default. Whether 8+ browsers on one laptop slow each other is observed in the first full run, not a gate (D14). Original question: Does Claude Code actually run N spawned subagents concurrently, and is there a practical ceiling before tool calls queue?
6. ~~**Session concurrency inside the server.**~~ Resolved, D11: synchronous id allocation + `wx`; session in memory, written through a queue. Original question: Two testers calling `record_finding` at the same moment: is the stdio server single-threaded enough that id allocation is safe without a lock, or does it need one?
7. ~~**Verdict ownership.**~~ Resolved, D8: tester-owned, server-checked. Original question: Should testers record verdicts (current design) or should a reviewer derive them from findings? Tester-owned is simpler but trusts the tester's judgement of "pass".
8. ~~**Scenario × viewport fan-out.**~~ Resolved, D4: one tester per scenario, one case per viewport; identity axes (personas, v1) get their own tester. Original question: Is one tester per pair right, or one tester per scenario that walks both viewports? The latter halves N and keeps context, the former gives cleaner isolation.
9. ~~**Flow file format.**~~ Resolved, D6: prose with `### name`, description, `Pass:` line. Original question: Is a prose list of scenarios (name, description, pass) enough for the skill to spawn precise testers, or do scenarios need structured steps? The same shape is used for exploratory scenarios in `session.json`, so the answer applies to both modes.
9b. ~~**Exploratory scope quality.**~~ Partly resolved, D6: the scout may log in; quality is measured by AC1. Original question: How good is the derived scenario list from an entry snapshot alone? Does it need a login first, and if so, is that acceptable before the developer has confirmed anything?
10. ~~**Evidence in git.**~~ Resolved, D13: a per-project choice asked by `/jeyna:init`. Original question: Commit on branch and prune on merge, or gitignore from day one?
11. ~~**Clips.**~~ Moved to v1, D9: no clips in v0. Original question: Are burst screenshots acceptable to people reading reports, or is real video required before v1?
12. ~~**Account pool size.**~~ Resolved, D10: account per tester, never shared concurrently, `Account: consumes` runs last, reset is the developer's job. Original question: Is round-robin over a small pool safe for lockout scenarios, or does each lockout tester need a dedicated throwaway account?

---

## 8. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Findings are shallow or wrong | Report is noise | Flow files define pass precisely; main agent marks duplicates; a sceptical reviewer that can reject findings is a v1 option (D12); acceptance criterion 2 measures it. |
| Context blow-up from snapshots/screenshots | Testers fail mid-scenario | Snapshot truncation just under Claude Code's MCP output limit (D14); screenshot images only on `look: true` (D3). No cost caps by choice. |
| Testers do not see MCP images (unverified for subagents) | No layout/visual findings | First-slice probe (D3); fallback documented: snapshot-only, layout findings out of scope for v0. |
| Hook semantics differ from assumption | Guard or exit check silently inert | Verified against docs (D1, D2); `agent_type` string and transcript marker checked in the first slice; acceptance criteria 4, 5b verify. Shape rules live in the server, so an inert hook loses only the verdict nudge. |
| Playwright selectors flaky for the model | Many "element not found" turns | `click` error returns nearest candidates from the aria tree. |
| Account collisions | Single-session apps log a tester out mid-scenario; lockout scenarios poison others | Account per tester, never shared concurrently; `Account: consumes` runs last (D10). |
| Server crash mid-run | Lost run state | `session.json` is written (atomically, temp + rename) on every change; `validate` reports a `running` session with no finish as stale; `force` recovers. |

---

## 9. Glossary

Moved to [`GLOSSARY.md`](../GLOSSARY.md) at the repo root, the single glossary that this repo's agent tooling reads (D17).
