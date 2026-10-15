# Jeyna — first slice: walking skeleton

**Status:** agreed 2026-10-15 (D19). Nothing is built yet.

## Goal

Build the thinnest real path through every lane, so that the eight facts the docs could not settle are settled by running code. This is not a feature slice. Its output is **evidence**: each probe below is recorded in `docs/decisions.md` as verified or failed. A failed probe gets a follow-up decision before slice 2 starts.

## Scope

**In:**
- **jeyna-mcp** with six tools: `get_context`, `session_start` (explicit `scenarios` only, no flow files), `goto`, `snapshot`, `screenshot` (`look`), `scenario_verdict`.
- **The real install path:** this repo as a plugin marketplace, a committed esbuild bundle, `.mcp.json` with `--project ${CLAUDE_PROJECT_DIR}`.
- **`jeyna-tester` agent:**
  - an exact allowlist of the four tester tools that exist in this slice: `goto`, `snapshot`, `screenshot`, `scenario_verdict`. Nothing else;
  - `model: sonnet`, `effort: medium`.
- **Both hooks:** the write guard (`.jeyna/playtests/**`, `.jeyna/.env`) and the tester SubagentStop check.
- **`/jeyna:init`** with templates for config, conventions and `.env`.
- **Sample app, login page only:** seeded bug 2 (Sign in off screen at 390 px) and bug 3 (unlabelled password field). Accounts exist but are not used yet.

**Out (slice 2 and later):**
- `record_finding`, the converter, findings, `report.md`, `session_finish`, `validate`, `update_status`;
- flows, `get_flow`, `save_flow`, the scout;
- `click`, `fill`, `press`, redaction;
- the `playtest` skill. The probes spawn `jeyna:jeyna-tester` by hand from a Claude Code session;
- todo pages and seeded bugs 1, 4, 5, 6.

## Files produced

```
.claude-plugin/marketplace.json        # this repo as a marketplace; one plugin at ./plugin
package.json                           # build-time only: typescript, esbuild, zod, yaml, @modelcontextprotocol/sdk, playwright-core, vitest
tsconfig.json
src/server.ts                          # MCP stdio server: arg/root resolution, tool registration
src/schema.ts                          # zod: config, session (scenario, tester, case, verdict)
src/session.ts                         # in-memory session, case + batch planning, queued temp+rename writes
src/session.test.ts                    # vitest: batch planning never gives one account to two testers in a batch
src/browser.ts                         # Playwright: channel "chrome" with Chromium fallback, context per case
plugin/.claude-plugin/plugin.json      # name "jeyna"
plugin/.mcp.json                       # "mcp": node ${CLAUDE_PLUGIN_ROOT}/server/jeyna-mcp.mjs --project ${CLAUDE_PROJECT_DIR}
plugin/server/jeyna-mcp.mjs            # committed esbuild bundle (P1)
plugin/agents/jeyna-tester.md          # exact allowlist, model/effort, marker-line convention
plugin/skills/init/SKILL.md            # /jeyna:init, disable-model-invocation: true
plugin/templates/jeyna.config.yaml
plugin/templates/CONVENTIONS.md
plugin/templates/env                   # becomes .jeyna/.env
plugin/hooks/hooks.json                # PreToolUse Write|Edit|NotebookEdit; SubagentStop ^jeyna:jeyna-tester$
plugin/hooks/guard-write.sh
plugin/hooks/check-exit.sh
sample-app/server.mjs                  # zero-dependency Node server, login page on :4173
sample-app/.env.example
sample-app/SEEDED-BUGS.md              # bugs 2 and 3 in this slice; all six by slice 3
```

During the probes, `/jeyna:init` run in `sample-app/` creates `sample-app/.jeyna/`. The sample app is also the test project.

## Probes (definition of done)

Each probe is recorded in `docs/decisions.md` with the date, the Claude Code version, the result and what was observed.

| # | Probe | How | Pass | If it fails |
|---|---|---|---|---|
| P1 | `playwright-core` bundles | `npm run build`, then run the bundle with no `node_modules` present | the bundle launches a browser | keep `playwright-core` external, install into `${CLAUDE_PLUGIN_DATA}` on first start (D13 fallback) |
| P2 | Project root | `get_context` from a session started in `sample-app/` | the returned root is `sample-app/` | fall back to the `CLAUDE_PROJECT_DIR` env var, then the nearest `.jeyna/` (D7); record which one worked |
| P3 | Secrets source | `get_context` reports, per account variable, "env", ".env" or "missing" (never the value), once with the variable exported in the shell and once only in `.jeyna/.env` | both sources detected | `.jeyna/.env` becomes the only documented source |
| P4 | Installed Chrome | `goto` on a machine with Chrome; then with `channel` forced to fail | Chrome launches; the fallback message names `npx playwright install chromium` | Playwright's Chromium becomes the default (D13) |
| P5 | Images reach a tester | a spawned tester calls `screenshot {look: true}` at 390×844 on the login page and must say where the Sign in button is | it reports the button off screen or cut off (bug 2), which the snapshot alone cannot show | snapshot-only testers; layout findings out of scope for v0 (D3 fallback) |
| P6 | Hook matcher | a tester with no verdict ends its turn | SubagentStop fires with `agent_type` `jeyna:jeyna-tester` (logged) | correct the matcher to the observed string (D2) |
| P7 | Marker line | same run: the hook reads `jeyna-tester-cases:` from `agent_transcript_path`, blocks once, and the tester then records its verdict | blocked once, verdict recorded, second stop allowed (`stop_hook_active`) | read the case ids from the tester's tool calls instead (D2) |
| P8 | Parallel calls | spawn two testers in one message on two cases; each does `goto` + `snapshot` + `screenshot` | both finish; the server's stderr timestamps show overlapping calls; both verdicts are in `session.json` | serialise browser calls in the server and note the throughput cost (D10, D11) |

Also checked: `src/session.test.ts` passes, and `claude plugin validate ./plugin` passes.

## Acceptance criteria from §6 this slice satisfies

- **AC4** (as revised by D19): the main agent attempting `Write` into `.jeyna/playtests/` or `.jeyna/.env` is denied by the hook.
- **AC5b:** a tester that ends without a verdict is blocked once by SubagentStop and then records one (P6, P7).
- **AC8, partly:** in a project with no `.jeyna/`, `/jeyna:init` produces a config that `get_context` accepts, with no npm command on the developer's machine. The "next `/jeyna:playtest` runs" half waits for slice 3, which builds the skill.

All other criteria (AC1, 1b, 2, 3, 5, 6, 7) need findings, the report, flows and the `playtest` skill: slices 2 and 3.

## Next slices (for orientation, not agreed in detail)

- **Slice 2:** findings path: `record_finding`, converter, `validate`, `session_finish`, `report.md`, `click`/`fill`/`press` with redaction, the full sample app with all six bugs.
- **Slice 3:** the `playtest` skill end to end, flows, the scout, `save_flow`, dedupe with `update_status`, then AC1–AC8 on the sample app.
