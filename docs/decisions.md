# Jeyna — decisions

Dated entries from grill sessions. Each entry: the decision, the reason, and what it changed in which document. The three design docs are updated in place; this file is the trail.

---

## D1 · 2026-10-15 · Names, tool namespace and agent allowlists

**Decision**
- The command is `/jeyna:playtest`, not `/jeyna-playtest`. The skill is named `playtest` inside the plugin `jeyna`.
- The MCP server key in the plugin's `.mcp.json` is `mcp`. Tool names drop the `jeyna_` and `browser_` prefixes. The model sees `mcp__plugin_jeyna_mcp__<tool>` (e.g. `mcp__plugin_jeyna_mcp__record_finding`).
- `jeyna-tester` gets exactly ten tools, listed by exact name in `tools:`: `goto`, `click`, `fill`, `press`, `snapshot`, `screenshot`, `clip_start`, `clip_stop`, `record_finding`, `scenario_verdict`. No wildcard, no `get_context`. Everything a tester needs comes in its prompt.
- `jeyna-reviewer` gets `validate`, `update_status`, `session_finish` and the built-in `Read` to read findings. No new `get_findings` tool.

**Reason** (verified against the official docs, 2026-10-15)
- Plugin MCP tools are named `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`. The short form `mcp__<server>__…` never matches a plugin server. ([mcp.md](https://code.claude.com/docs/en/mcp.md))
- `tools:` and `disallowedTools:` accept exact names and `mcp__<server>` / `mcp__<server>__*`. ([sub-agents.md](https://code.claude.com/docs/en/sub-agents.md))
- Plugin skills are namespaced `/<plugin>:<skill>`.
- Plugin subagents ignore the `hooks`, `mcpServers` and `permissionMode` frontmatter fields. Our hooks live in the plugin's `hooks/hooks.json`, so the design was not affected.
- A wildcard works, but it would give testers `session_start(force)`, `session_finish`, `save_flow` and `update_status`. MCP calls carry no caller identity, and `tester` is a model-filled argument, so the server cannot stop a tester from aborting the run. An exact allowlist is the only guard.
- A `jeyna_` prefix inside a `jeyna` namespace only makes names longer.

**Changed**
- concept: scope line (command); contract summary (plugin name, skill invocation, allowlists, tool namespace).
- architecture: lane components (skill name, tester and reviewer tools, server key); diagram label.
- analysis: §1, §2, F1.1, F1.3, F2.1, F3.1, F4.2 (rewritten), F4.3, F6.1, F6.4, F7.1–F7.3, F9.1, §5.4 (namespace note, tool names), §5.7 (plugin layout), §5.8, §5.9, §6 AC1, §7 Q1 (marked resolved), glossary.

---

## D2 · 2026-10-15 · Rules live in the server; exit hooks check only the stopping agent

**Decision**
- Shape rules are enforced at call time. `record_finding` refuses a finding of kind `bug` with no evidence (F4.5 becomes a hard rule) and refuses missing evidence files (F6.3).
- `session_finish` runs the `validate` checks and refuses, returning the error list, while errors remain. It is the one gate where a run ends.
- SubagentStop, matcher `^jeyna:jeyna-tester$`: block once if this tester has no verdict. The tester id comes from a marker line `jeyna-tester-id: <id>` that opens every tester prompt, read from `agent_transcript_path`.
- SubagentStop, matcher `^jeyna:jeyna-reviewer$`: block once if the active run is still `running`.
- Both allow the stop when `stop_hook_active` is true, and do nothing when no run is `running`.
- No Stop hook on the main session in v0.
- The PreToolUse guard matches `Write|Edit|NotebookEdit` on `tool_input.file_path` under `.jeyna/playtests/`. `Bash` is not guarded.
- AC5 is rewritten (refusal at call time). New AC5b: a tester that ends without a verdict is blocked once, then records one.

**Reason** (verified against [hooks.md](https://code.claude.com/docs/en/hooks.md), 2026-10-15)
- Confirmed facts:
  - PreToolUse gets `tool_input.file_path` for Write and Edit. `MultiEdit` is not documented.
  - Stop and SubagentStop block with `{decision: "block", reason}`, and `stop_hook_active` is in the payload.
  - An 8-consecutive-continuation cap applies.
  - SubagentStop gets `agent_type` and `agent_transcript_path`, and its matcher filters on agent type.
  - Stop can fire while background work is in flight (the `background_tasks` field exists for that).
  - Plugin hooks run inside subagents.
- Why the old design fails:
  - A whole-run `validate` at a tester's exit fails on other testers' missing verdicts. That tester cannot fix them, so it is blocked until the cap releases it, and the tokens are wasted.
  - The same happens to the main agent while it waits for background testers.
  - The plugin hook runs in every session in the project, so a stale `running` run would block unrelated sessions.
- Refusing bad data when it arrives is stronger than linting afterwards.
- A gate inside `session_finish` also works in Cowork, which has no hooks.

**Unverified, check in the first slice**
- The exact `agent_type` string for plugin agents (expected `jeyna:jeyna-tester`).
- That the marker line can be read reliably from the subagent transcript.

**Changed**
- concept: plugin/hooks line; guard 3; Cowork constraint.
- architecture: hooks lane; diagram (hooks read `session.json` and answer Claude Code; `session_finish` runs validate); boundary table (hook payload in, decision out, hooks read `session.json`, CI runs validate).
- analysis: F4.5, F7.2, F8.2, F9.1, F9.2 (rewritten), N6, §5.4 (`record_finding` and `session_finish` outputs), §5.7 (`lint-on-stop.sh` → `check-exit.sh`), §5.9 footnote, §6 AC5 + AC5b, §7 Q2 marked resolved, §8 hook risk row.

---

## D3 · 2026-10-15 · Screenshots return the image only on request

**Decision**
- `screenshot` always writes the PNG to `evidence/` and returns the file name. It returns image content too only when called with `look: true` (default `false`).
- Each tester takes one `look: true` screenshot once the scenario's first page has settled (new F4.7), so every viewport gets a visual check.
- The first slice includes a probe: a plugin subagent calls `screenshot` with `look: true` on a page with a known visual detail and must describe it. The result is recorded here.
- If the probe fails: testers are snapshot-only, layout findings are out of scope for v0 in `CONVENTIONS.md`, and the limit is stated in the docs.

**Reason**
- [mcp.md](https://code.claude.com/docs/en/mcp.md) states MCP images are shown inline in the conversation and count against `MAX_MCP_OUTPUT_TOKENS` (default 25,000). It does not say this holds inside a subagent. **Unverified without running.**
- Layout bugs (off-screen buttons, overlap, cut-off text) are invisible in the aria snapshot, so vision is the only way a phone-width tester finds them.
- An image costs on the order of 1,500 tokens. Most evidence screenshots record something the tester already found from the snapshot, so returning the image every time wastes context.

**Changed**
- concept: constraints (new line on `look` and the probe).
- architecture: tester→server channel label in the diagram; boundary table row for agents → jeyna-mcp.
- analysis: new F4.7; F5.5 rewritten; §5.4 `screenshot` row; §7 Q3 marked open-until-probe; §8 risk rows (context blow-up updated, new row for unverified images).

---

## D4 · 2026-10-15 · Fan-out: one tester per scenario, one case per viewport; personas are v1

**Decision**
- **Fan-out rule.** Axes that change the environment (viewport; later zoom, reduced motion) run in sequence inside one tester. Axes that change who the tester is (persona) get their own tester.
- v0 has one implicit persona, so:
  - a **tester** is one subagent per scenario;
  - a **case** is one (scenario, viewport) pair with its own browser context, account, evidence prefix and verdict.
- Tool arguments are keyed by `case`, not `tester`: the browser family, `record_finding` and `scenario_verdict`.
  - `session_start` returns testers, each with its cases.
  - The tester prompt opens with `jeyna-tester-cases: <ids>`. The SubagentStop hook (D2) blocks if any of those cases has no verdict.
- `FindingInput` drops `scenario` and `viewport`. The server copies both from the case into the frontmatter, so a tester cannot get them wrong.
- The concurrency cap (default 8) now counts testers, that is scenarios after filters.
- **Personas are not supported in v0 and are a v1 requirement** (the owner's priority). This is marked in:
  - concept, under "Not supported in v0, required in v1";
  - analysis §1.2 (v1 scope) and §1.3 (out of scope);
  - the analysis glossary.
  - v1 adds `persona?` to cases, findings and the report matrix under a new `schema` version. A case becomes (scenario, persona, viewport).

**Reason**
- With one tester per pair, the same bug is recorded twice (once per viewport), so the reviewer has to dedupe duplicates.
- Most of the second tester's tokens repeat the first one's: the same prompt, the same login, the same navigation.
- No single tester sees "works at desktop, broken at phone".
- Isolation is kept by giving each case a fresh browser context and its own verdict.
- A persona cannot share a context: a subagent that already knows where the button is cannot credibly play a first-time 80-year-old.

**Changed**
- concept: key architecture decision (context per case); MCP tools line; constraints; new section "Not supported in v0, required in v1".
- architecture: tester lane; browser-family key; Playwright context per case; `session.json` contents; diagram label; boundary table (prompt contents, context per case).
- analysis: §1.2, §1.3 (personas); §2 tester row; F2.5 rewritten; F3.1; F4.1; F4.3; F4.7; F5.1; F5.5; F6.2; F8.1; F9.2; §5.2 (FindingInput, frontmatter, Session); §5.3; §5.4 (`session_start`, `scenario_verdict`, `record_finding`, browser family); §5.5; §5.6; §5.7; §5.8 step 4; §5.9; §7 Q8 marked resolved; glossary (Tester, Case, Persona, Verdict).

---

## D5 · 2026-10-15 · Trigger: manual only, no aliases, explicit narrowing fields

**Decision**
- The `playtest` skill sets `disable-model-invocation: true` and `argument-hint: [what to test]`.
- No aliases. The skill matches the prompt on flow names and scenario names. `get_context` returns flows with their scenario names.
- `session_start` drops the undefined `filters` and takes `only?: string[]` (scenario names) and `viewports?: string[]`. The server refuses unknown names and returns the valid ones.

**Reason**
- By default Claude auto-loads skills that match the conversation. [skills.md](https://code.claude.com/docs/en/skills.md) documents `disable-model-invocation: true` as "Use for workflows you want to trigger manually with `/name`". A run costs minutes and dollars, and F1.1 already says there is no other trigger.
- The flow frontmatter had no `aliases` field. A model matching on names does this without one.
- `filters` had no shape, and it overlapped with `viewports`.

**Changed**
- analysis: F1.1, F1.2, F1.3; §5.4 (`get_context` output, `session_start` input); §5.7 comment; §5.8 step 3.

---

## D6 · 2026-10-15 · Scope resolution: scout case, flow scenario format, save_flow from the run

**Decision**
- A reserved case id, `scout`, serves the exploratory look before `session_start`:
  - it needs no session and uses the first configured viewport;
  - it writes nothing to disk (`screenshot` returns the image only);
  - it may log in with the first pool account when the entry page is a login wall;
  - a soft cap of about 10 browser calls is written in the skill;
  - `session_start` closes it.
- Flow file scenarios: under `## Scenarios`, each scenario is a `### <name>` heading, a description paragraph and one `Pass:` line. Prose, not scripted steps. This settles §7 Q9.
- `save_flow {run, name}`: the server copies the scenarios from that run's `session.json` and refuses if the file already exists.

**Reason**
- Since D4 every browser tool needs a case, and cases exist only after `session_start`, which comes after the developer confirms. So the exploratory look had no browser to use.
- The old flow format (`**name**: prose`) had no place for `pass`, yet a scenario is `{name, description, pass}` everywhere else and F4.4 judges findings against `pass`.
- A model-supplied scenario list at save time can drift from what actually ran.
- A logged-out entry page shows only the login form, so it is too thin to derive scenarios. Logging in with a test account before confirmation is read-only and harmless.

**Changed**
- analysis: F2.3, F2.4; §5.2 flow file; §5.4 (`save_flow`, browser-family note); §7 Q9 and Q9b.
- architecture: browser-family line (scout).

---

## D7 · 2026-10-15 · Session: project root, dirty build id, slug rule

**Decision**
- The project root is `CLAUDE_PROJECT_DIR` if set. Otherwise it is the nearest folder containing `.jeyna/` above the server's working directory. Otherwise `get_context` fails with an explicit message. `get_context` returns the resolved root, and the skill shows it.
- Build id: `app.build` from config, otherwise `git describe --always --dirty`, otherwise `"unknown"`.
- The run folder is `<yyyy-mm-dd>-<slug>[-<n>]` and finding ids are `PT-<slug>-<nnn>`. The slug is the flow name or the exploratory slug, never containing a colon.
- F3.3 is unchanged: one running run per project, and `force` aborts a stale one.

**Reason**
- An MCP server's working directory is not documented. [mcp.md](https://code.claude.com/docs/en/mcp.md) says Claude Code sets `CLAUDE_PROJECT_DIR` for spawned servers, but the plugin reference's environment table for plugin MCP servers omits it. **Unverified for plugin servers; check in the first slice.** Getting it wrong writes `.jeyna/` into the plugin cache without anyone noticing.
- Playtests usually run on uncommitted work. A bare `HEAD` hash mislabels the build and makes comparisons across builds misleading.
- The session's `flow` value `exploratory:<slug>` contains a colon, which is not a safe folder name.

**Changed**
- analysis: new F3.0; F3.1; F3.2; F6.2; §5.3 layout; §5.4 `get_context`; §5.7 `.mcp.json` comment.

---

## D8 · 2026-10-15 · Verdicts are tester-owned and server-checked; no perf in v0

**Decision**
- Testers record verdicts, and `scenario_verdict` checks them:
  - `fail` needs at least one finding id belonging to that case;
  - `blocked` and `skipped` need a `note`;
  - `pass` may list findings.
- This settles §7 Q7.
- `perf` is removed from v0 finding kinds, leaving `bug | ux | a11y | question`. Perf is out of scope until v1 adds real measurement.
- F4.6 (no source code) is documented as enforced by the allowlist.

**Reason**
- Without checks, a `fail` with no finding, or a `blocked` with no reason, gives the report a cell nobody can act on.
- A reviewer-derived verdict would judge pass from findings alone, without having seen the app.
- No v0 tool returns a timing and there is no `evaluate`. A perf finding would be a guess presented as fact, which is the "shallow or wrong findings" risk in §8.

**Changed**
- analysis: §1.3 (perf added to out of scope); F4.4; F4.6; F7.1; §5.2 `kind`; §5.4 `scenario_verdict`; §7 Q7.

---

## D9 · 2026-10-15 · Browser tools: select via fill, redaction on output, no clips

**Decision**
- `fill` on a `<select>` element calls Playwright's `selectOption`. No new tool.
- The server replaces every configured account value (user and pass) with its `{{account.*}}` placeholder in every text it returns: snapshots, errors, URLs and titles. This happens at one exit point.
- AC3 is narrowed:
  - no password anywhere under `.jeyna/` or in the transcript;
  - no username in any text under `.jeyna/` or in the transcript;
  - screenshot pixels may show a username.
- Clips (`clip_start`, `clip_stop`, `clipMaxSeconds`, `.kNN.png`) are cut from v0. The tester allowlist (D1) is now 8 tools: `goto`, `click`, `fill`, `press`, `snapshot`, `screenshot`, `record_finding`, `scenario_verdict`. §7 Q11 moves to v1 with real video.
- Selectors stay as Playwright selectors. Snapshot element refs (as Playwright MCP uses them) are a possible v1 improvement. Whether that API is public is **unverified**.

**Reason**
- Dropdowns cannot be operated reliably with `fill` or `click`, and the allowlist leaves the tester no other route.
- F5.4 only kept secrets out of the `fill` result. A later `snapshot` reads the field value, or an error message that echoes the username, back into context, which breaks AC3.
- Pixels cannot be redacted cheaply. Password fields render masked, so only usernames can appear.
- Clips need a background timer, a cap, frame naming and cleanup. Their only reader is a human, and v0 has no studio to play them. The tester never looks at the frames.

**Changed**
- concept: MCP tools line; tester allowlist count; constraints (clips line replaced, secrets line extended).
- architecture: tester allowlist count; browser family (no clips, redaction step); clip-frames line removed; evidence line; PNG format note.
- analysis: §1.3; F4.2; F5.2; F5.4; F5.6 removed (old F5.7 renumbered to F5.6); F10.2; N7; §5.2 config (`clipMaxSeconds` removed); §5.3; §5.4 (`fill` row, clip rows removed); §5.7; §6 AC3; §7 Q1 note and Q11.

---

## D10 · 2026-10-15 · Accounts per tester, never shared concurrently; server plans batches

**Decision**
- `session_start` assigns one account per tester, not per case. A tester's cases share its account, one after the other.
- No account is held by two testers at the same time. The server plans batches:
  - at most 8 testers at once;
  - testers needing an account are further limited to the pool size;
  - each tester gets a `batch` number, and a later batch reuses accounts freed by earlier ones.
- The skill spawns batch by batch and states the plan up front.
- Scenarios get an optional `account`, written as a flow line after `Pass:`:
  - `Account: none` means no login, so the tester takes no account;
  - `Account: consumes` means the scenario may lock its account, so it runs in the last batch.
- Resetting a locked account between runs is the developer's job in v0. There are no throwaway accounts. This settles §7 Q12.

**Reason**
- Round-robin per case puts one account in two browsers at once. Single-session apps then log the first tester out mid-scenario, which produces a false "session expired" bug with nothing in the report to explain it. Shared server-side state (drafts, counters) collides the same way. This broke N3.
- A lockout scenario locks its account for every later case that uses it.
- Batching makes runs slower on small pools, but correct.

**Changed**
- concept: key architecture decision (account per tester).
- architecture: Playwright line.
- analysis: F2.5; F3.1; F4.1; N3; §5.2 Session and flow file; §5.4 `session_start`; §5.6 rewritten; §5.8 step 4; §7 Q12; §8 account risk row; glossary (Case).

---

## D11 · 2026-10-15 · Server state: no lock, in-memory session, honest statuses

**Decision**
- Finding ids come from an in-memory counter in one synchronous step, before any `await`. Files are created with the `wx` flag. No lock. This settles §7 Q6.
- During a run the server holds the session in memory as the only source of truth. Every change writes the whole `session.json` through one queue (temp file + rename). The server never reads it back mid-run.
- Finding statuses are `open | duplicate | wontfix | fixed`, with `of: PT-…` required for `duplicate`.
  - The reviewer may set only `duplicate`.
  - `wontfix` and `fixed` belong to later sessions or to people editing the file.
- Ranking is dropped. The report sorts findings by severity, then kind.

**Reason**
- Node runs one piece of JavaScript at a time, so synchronous allocation cannot hand out the same id twice. `wx` turns any mistake into a loud failure instead of an overwrite.
- Read-modify-write of `session.json` with `await`s in between loses verdicts when two testers finish together. The run would then fail `validate`, and D2's hook would block a tester that did its job.
- Temp + rename means the studio never reads half a file.
- The reviewer cannot know anything is `fixed`. "Duplicate" was squeezed into `wontfix` plus a note.
- No field stored a rank, and a deterministic sort needs no judgment.

**Changed**
- architecture: reviewer line; new session-state line in the jeyna-mcp lane.
- analysis: §2 reviewer row; F6.2; F6.4; new F6.5; F7.3; F7.4; §5.2 finding frontmatter; §5.4 `update_status`; §7 Q6; §8 crash row.

---

## D12 · 2026-10-15 · No reviewer agent in v0

**Decision**
- `jeyna-reviewer` is dropped. After all testers return, the main agent:
  - calls `validate`;
  - reads the findings with `Read`;
  - marks cross-scenario duplicates with `update_status`;
  - calls `session_finish` with a short summary.
- The plugin ships one agent (`jeyna-tester`) and two hooks: the PreToolUse write guard and the tester SubagentStop check. The reviewer SubagentStop hook from D2 goes with it.
- A main agent that stops before `session_finish` leaves the run `running`. The developer sees no report path, and the next run needs `force`. This is accepted for v0.
- A v1 sceptical reviewer that can *reject* weak findings is an option. It would come with that mandate and a `rejected` status.

**Reason**
- After D2, D4 and D11, the reviewer's job had shrunk:
  - ranking is gone;
  - validation is enforced by `session_finish`;
  - cross-viewport duplicates mostly disappear.
- That leaves cross-scenario duplicates and a summary, which is not worth an agent definition, an allowlist, a hook and a second read of every finding.
- At that point the main agent's context is small: the skill, the scout look and one short summary per tester.
- The reviewer could not reject anything, so it was never an independent quality check.

**Changed**
- concept: plugin line.
- architecture: main-agent line; reviewer line removed; hooks line; diagram (reviewer node and edges removed; hook edges to testers and main agent); boundary table row.
- analysis: §1.1; §2 (main agent row; reviewer row removed); F6.4; F7.2; F7.4; F9.2; §5.7; §5.8 steps 6–7; §5.9; §8 findings-quality row.
- D2 is partly superseded: its reviewer SubagentStop hook no longer exists.

---

## D13 · 2026-10-15 · Install from GitHub, no npm on the user's machine; `/jeyna:init` sets up a project

**Decision**
- **Per developer, once:** `/plugin marketplace add <owner>/jeyna` and `/plugin install jeyna`.
  - The Jeyna GitHub repo is the plugin marketplace. No npm publish in v0.
  - The plugin contains `server/jeyna-mcp.mjs`, an esbuild bundle of the server and its dependencies, built and committed per release.
  - `.mcp.json` runs `node ${CLAUDE_PLUGIN_ROOT}/server/jeyna-mcp.mjs --project ${CLAUDE_PROJECT_DIR}`.
  - The developer runs no npm command and nothing enters the project's dependencies.
- **Fallback if `playwright-core` does not bundle:** it stays external and the server installs it once into `${CLAUDE_PLUGIN_DATA}` on first start.
- **Browser:** installed Google Chrome via `channel: "chrome"` with a temporary profile. If Chrome is missing, the fallback is Playwright's Chromium after `npx playwright install chromium`, which `get_context` prints as one line.
- **Per project, once:** a new skill `/jeyna:init`. It writes:
  - `.jeyna/jeyna.config.yaml` and `.jeyna/CONVENTIONS.md` from plugin templates;
  - the evidence `.gitignore` choice (settles §7 Q10);
  - optionally `.claude/settings.json` to enable the plugin for teammates.
  - It then validates with `get_context`. No new MCP tool.
- No skills, agents or hooks are copied into projects.
- The config stays YAML (`jeyna.config.yaml`), not `jeyna.jsonrc`: it is hand-edited and needs comments.
- D7 is amended: the project root comes from `--project` first, then the `CLAUDE_PROJECT_DIR` environment variable, then the nearest `.jeyna/`.
- New AC8: `/jeyna:init` in a fresh project, then `/jeyna:playtest`, with no npm command on the developer's machine.

**Reason**
- The owner does not want to publish to npm yet.
- `npx github:…` would build TypeScript on the user's machine on first run (dev dependencies, slow, fragile) and needs git credentials for a private repo.
- [plugins-reference.md](https://code.claude.com/docs/en/plugins-reference.md):
  - nothing says Claude Code runs `npm install` for plugins;
  - `${CLAUDE_PLUGIN_DATA}` is the documented place for "installed dependencies such as `node_modules`";
  - `${CLAUDE_PROJECT_DIR}` resolves in MCP stdio `command`/`args`/`env` (only `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` are exported to the process environment). So passing `--project` is documented, where reading the environment variable was not.
- Using the installed Chrome binary avoids a ~150 MB browser download and still never touches the developer's profile.
- Copied skills would be forks that never receive updates. The plugin namespace is the distribution.

**Unverified, check in the first slice**
- Whether `playwright-core` bundles into one file with esbuild.

**Changed**
- concept: key architecture decision (Chrome binary, temporary profile); stack; build order (step 0).
- architecture: jeyna-mcp lane header; Playwright line; `jeyna validate` line.
- analysis: §1.1; F3.0; new F11 (Install and setup); §5.1 stack (npm build-time only, esbuild); §5.5; §5.7 layout (bundle, templates, init skill, `.mcp.json` command); §5.8 step 1; §6 AC8; §7 Q10.

---

## D14 · 2026-10-15 · No cost limits; snapshot truncation only as a correctness guard

**Decision**
- N5 becomes cost *visibility*: the skill reports elapsed time and tester count.
- Dropped: the token budget, the 15-minute target, a per-case browser-call cap, and the concurrency cap of 8 testers.
- Concurrency is limited only by the account pool (D10) and Claude Code's own limit of 20 concurrent subagents.
- `snapshot` truncates at about 90,000 characters, with an explicit note. Its `maxChars` input is removed.
- §7 Q4 and Q5 are observed in the first full run, not gates.

**Reason**
- No component sees token counts, so a budget could not be enforced. The owner prefers no limits over guessed ones.
- Claude Code caps MCP output at 25,000 tokens by default (`MAX_MCP_OUTPUT_TOKENS`, [mcp.md](https://code.claude.com/docs/en/mcp.md)). An oversized snapshot would be cut by Claude Code without the tester knowing. Truncating just below that limit, with a note, keeps the tester informed.

**Changed**
- analysis: F2.5 (concurrency); F5.3; N5; §5.4 `snapshot`; §7 Q4, Q5; §8 context risk row.
- D10 is amended: "at most 8 testers at once" is removed.

---

## D15 · 2026-10-15 · Model per role, fixed and recorded

**Decision**
- `jeyna-tester.md` frontmatter sets `model: sonnet` and `effort: medium`.
- `jeyna.config.yaml` may set `tester: { model, effort }`. The skill passes it as the per-spawn `model`/`effort` on every tester, so it applies project-wide.
- The skill never picks a model per scenario.
- The main agent stays on the developer's session model. Jeyna does not change the session.
- Each tester's model is recorded in `session.json` (`testers[].model`) and in each finding's `author` field.

**Reason** (verified against [sub-agents.md](https://code.claude.com/docs/en/sub-agents.md), 2026-10-15)
- Model resolution order: per-invocation `model` parameter, then frontmatter `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main conversation's model. Without a setting, every tester would run on the developer's (often most expensive) model.
- `effort` exists in frontmatter, and per invocation from v2.1.292.
- The owner wants no expensive agents where they are not needed.
- Per-scenario model choice would make guided runs incomparable across builds (F2.2): a changed finding could be the model, not the code. It would also rest on a guess about difficulty made before running.
- Haiku's weaker judgment risks more false findings. Sonnet is the default until a project measures otherwise.

**Changed**
- concept: plugin line.
- architecture: tester line.
- analysis: new F4.8; §5.2 config (`tester`), Session (`testers[].model`), finding frontmatter (`author`); §5.7 agent comment.

---

## D16 · 2026-10-15 · Sample app: a todo app behind a login, six seeded bugs

**Decision**
- `sample-app/` in this repo: a small todo app behind an authentication gate.
  - Zero dependencies: `node sample-app/server.mjs`, plain HTML, in-memory state, port 4173.
  - Pages: login, password reset, todo list (add, complete, delete, priority `<select>`).
  - Accounts: `user_a` and `user_b`, with credentials in `sample-app/.env.example`.
- Answer key `sample-app/SEEDED-BUGS.md` with six bugs, each exercising a decision:
  1. old password still works after a reset (judging against `Pass:`);
  2. Sign in off screen at 390 px (images, D3);
  3. password field unlabelled (aria snapshot);
  4. priority `<select>` dropped on save (D9);
  5. lockout never ends (D10);
  6. login error echoes the username (redaction, D9/AC3).
- The analysis's config examples are renamed from `clinic-portal`/`nurse_*` to `todo-sample`/`user_*`.
- Not built yet: this is the specification. It is built in build-order step 1 (see first-slice.md).

**Reason**
- §1.1 put a sample app in scope, and AC2 counted "6 seeded bugs", but neither was defined, so AC2 could not be checked.
- The owner chose a todo app with an auth gate.
- Zero dependencies keeps the sample app out of the install question (D13).

**Changed**
- analysis: §1.1; §5.2 config example; §5.6 example message; new §5.10; §6 AC2.

---

## D17 · 2026-10-15 · One glossary at the repo root; decisions stay in decisions.md

**Decision**
- `GLOSSARY.md` at the repo root is the single glossary. It holds every term settled in D1–D16: tester, case, scout, batch, persona, finding statuses, fan-out axes and so on.
- Analysis §9 is reduced to a pointer.
- This is the one exception to "all documentation in ./docs".
- Decisions stay in `docs/decisions.md`, not `docs/adr/`. `docs/agents/domain.md` now says so.

**Reason**
- The repo's agent config (`CLAUDE.md`, `docs/agents/domain.md`) reads `GLOSSARY.md` from the root by path. Terms kept only in §9 are invisible to that tooling.
- A copy in both places would drift.

**Changed**
- New `GLOSSARY.md`.
- analysis §9 (pointer).
- `docs/agents/domain.md` (decisions location).

---

## D18 · 2026-10-15 · Architecture page: every channel drawn; secrets from env or `.jeyna/.env`

**Decision**
- Seven channels that already existed but were not drawn are added to the diagram and the boundary table:
  - tester → main agent return summary;
  - `.jeyna/` → main agent `Read`;
  - subagent transcript → hook;
  - git → jeyna-mcp;
  - plugin templates → `init` → `.jeyna/`;
  - `CONVENTIONS.md` → jeyna-mcp → tester prompt;
  - secrets → jeyna-mcp.
- Stale items are fixed:
  - hooks no longer "return stderr from validate";
  - validate is drawn as an in-server function;
  - the tool is called Agent, not Task;
  - the studio's install path is marked as a v1 question (not `npx`);
  - CI use of `jeyna validate` is marked v1.
- **Secrets:** the server reads each configured variable from its environment first, then from `.jeyna/.env`.
  - `.jeyna/.env` uses Node's built-in dotenv parsing, so no dependency.
  - `/jeyna:init` creates it with empty entries and gitignores it.
  - The write guard is extended to deny `Write`/`Edit` on `.jeyna/.env`. Only people fill it.

**Reason**
- An architecture page that omits real channels hides exactly the places where things break.
- The docs never said how account values reach the server process. Whether a plugin MCP server inherits the shell environment of `claude` is **unverified for plugin servers; check in the first slice**. Even if it does, a missed `export` would be a silent setup failure.
- No npm publish (D13) means CI has no way to get the validator in v0.

**Changed**
- architecture: rewritten in place (lanes, diagram, boundary table, formats) with the above.
- concept: guard 3 (CI → v1); secrets constraint.
- analysis: §1.1 validate line; §1.3 (CI out of scope); F5.4; F8.2; F9.1; F11.4.

---

## D19 · 2026-10-15 · First slice is a walking skeleton with eight probes; AC4 corrected

**Decision**
- The first build step is the walking skeleton in `docs/first-slice.md`. It has:
  - six server tools;
  - the real install path;
  - the tester agent;
  - both hooks;
  - `/jeyna:init`;
  - the sample app's login page with seeded bugs 2 and 3.
- Its definition of done is eight probes (P1–P8), each recorded here as verified or failed. A failure gets a follow-up decision before slice 2.
- AC4 is rewritten: the *main agent* attempting `Write` into `.jeyna/playtests/` or `.jeyna/.env` is denied by the hook.

**Reason**
- Eight facts behind D2, D3, D4, D7, D10, D11, D13 and D18 could not be verified from the docs:
  - bundling `playwright-core`;
  - project root resolution;
  - environment inheritance;
  - installed Chrome;
  - images in subagents;
  - the plugin `agent_type` string;
  - the transcript marker;
  - concurrent MCP calls.
- Building features on top of an unverified fact risks rework. Probing first is cheaper.
- Testers have no `Write` tool (D1), so the old AC4 could never trigger. The hook in fact guards the main agent.

**Changed**
- New `docs/first-slice.md`.
- concept: build order step 0.
- analysis: §6 AC4.
