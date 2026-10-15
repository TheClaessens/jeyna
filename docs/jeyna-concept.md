# Jeyna — concept (playtest loop), v0.4, 15 Oct 2026 (after grill session; see decisions.md)

## Scope
One loop only: `/jeyna:playtest <free text>` typed in the developer's own Claude Code session → tester subagents drive the web app in headless browsers → findings recorded through a typed MCP tool → markdown + evidence in `.jeyna/playtests/<run>/` → Jeyna (read-only studio, v1) watches and renders the report. Human feedback capture / ingest is out of scope for now; the contract must not block it later.

## Principles
- Claude stays Claude (Claude Code + jeyna plugin). Jeyna never starts or talks to Claude; it infers run status from `session.json` and file events. Progress is quasi-realtime because every finding is a file written immediately.
- Files are the API; `.jeyna/` is git-tracked and is Claude's context in later sessions. Markdown on disk is the record; JSON exists only in flight (tool calls, viewer push) and in `session.json` (status, not record).
- Agents supply meaning, code supplies shape: findings enter via `record_finding` with a JSON schema; the server renders markdown from a template. An agent never formats a run file.
- The file contract is the product; plugin and studio are consumers of it.
- Flow files are optional. With no flow, a run is exploratory: scenarios are derived from the prompt, confirmed by the developer, stored in `session.json`, and can be promoted to `flows/<name>.md` at the end. Flow files are written by the loop and edited by people.

## Key architecture decision
**The browser lives in jeyna-mcp.** MCP servers are one per Claude Code session and shared by all subagents, so parallel testers on the stock Playwright MCP or the Chrome extension would clobber one shared page and one cookie jar. jeyna-mcp owns one headless Playwright context per case (scenario × viewport); each tester holds one account from the pool, never shared with a concurrently running tester. One tester subagent runs all cases of one scenario in sequence. Nothing touches the developer's Chrome profile (the installed Chrome binary is launched headless with a temporary profile); the studio needs no browser.

## Contract (summary; the analysis has the full data model)
`.jeyna/`: `jeyna.config.yaml`, `CONVENTIONS.md`, `flows/*.md` (optional), `playtests/<run>/{session.json, report.md, findings/*.md, evidence/*}`.
Finding frontmatter: schema, id, kind, severity, status, flow, scenario, route, viewport, browser, build, author, created, evidence[]. Body: Steps / Expected / Actual / Evidence / Suggested next step.
Plugin `jeyna`: skill `playtest` (invoked as `/jeyna:playtest`); agent `jeyna-tester` (Sonnet, medium effort by default, overridable in config; 8 exact jeyna-mcp tools: browser family + `record_finding` + `scenario_verdict`), no reviewer agent in v0 (the main agent marks duplicates and finishes; D12); hooks: PreToolUse write guard on `.jeyna/playtests/**`; SubagentStop checks that a stopping tester recorded a verdict for each case.
MCP tools (server key `mcp`, so `mcp__plugin_jeyna_mcp__<tool>`): run family (`get_context, get_flow, session_start, scenario_verdict, record_finding, update_status, validate, session_finish, save_flow`) and browser family keyed by case (`goto, click, fill, press, snapshot, screenshot`).

## Guards against agent non-determinism
1. Tool schema, not prose. 2. One door: agent allowlist + write-guard hook. 3. Shape rules refused at call time; `session_finish` refuses an invalid run; same linter runnable by hand (CI in v1). Exit hooks only nudge an agent about its own unfinished duty. 4. Viewer validates on read, "needs attention" lane, never drops a file.

## Constraints found
- Don't make the contract depend on an AST library; frontmatter is YAML, body from a template. remark / TanStack Markdown only in the viewer.
- No clips or video in v0: evidence is single screenshots (D9).
- `screenshot` always writes the PNG but returns the image only on `look: true`; each tester looks once per case. Whether MCP images reach a subagent is unverified until the first-slice probe; fallback is snapshot-only testers.
- Secrets live in the environment or a gitignored `.jeyna/.env` that only people write (D18); never in markdown or in agent context; `fill` substitutes `{{account.*}}` server-side from env, and every text result is redacted back to the placeholders on the way out.
- Evidence caps; git policy for `evidence/` is per project.
- Cost: a run is minutes and a few dollars; on demand, not per commit.
- Cowork can drive the same server (registered in the desktop app); `session_finish` already refuses an invalid run, so only the per-tester exit nudge is lost. Chat cannot (no local MCP, no subagents, no hooks).

## Not supported in v0, required in v1
- **Personas** (UX playtests: an 80-year-old and a 20-year-old use the app differently). Fan-out rule (D4): environment axes (viewport) run in sequence inside one tester; identity axes (persona) get their own tester. v1 adds `persona?` to cases, findings and the matrix under a new `schema` version.

## Stack
TypeScript / Node ≥ 20 / ESM · zod v4 · gray-matter + template · @modelcontextprotocol/sdk (stdio) · Playwright library · YAML config · POSIX sh hooks · vitest · npm + esbuild at build time only (users get a committed bundle from the GitHub plugin marketplace, no npm publish) · viewer later on TanStack Start.

## Build order
0. Walking skeleton that settles the eight unverified platform facts: see `docs/first-slice.md` (D19). 1. Schema + conventions + sample app. 2. jeyna-mcp, both tool families. 3. Skill, agents, hooks; run it; read the output in a plain markdown viewer. 4. Viewer, only once the findings are worth reading.
