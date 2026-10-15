# Claude Code plugin + marketplace (for jeyna slice 1)

Sources: code.claude.com/docs/en/{plugins-reference,plugin-marketplaces,plugins/components,plugins/loading,plugins/cli-reference,mcp,sub-agents,skills,headless,permissions}.md (fetched 2026-10-15, Claude Code 2.1.299).
"VERIFIED" = run locally in scratchpad on 2.1.299. Live `claude -p` sessions could NOT be run (OAuth expired, no API key), so anything about runtime behaviour inside a session is doc-sourced.

## Layout

```
.claude-plugin/marketplace.json     # repo root = marketplace
plugin/.claude-plugin/plugin.json   # manifest (optional, but set name)
plugin/.mcp.json                    # MCP servers, loaded automatically
plugin/agents/jeyna-tester.md       # -> agent "jeyna:jeyna-tester"
plugin/skills/init/SKILL.md         # -> "/jeyna:init"
plugin/hooks/hooks.json             # loaded automatically
```
Do NOT put a CLAUDE.md in the plugin root (not loaded; validate warns). All component paths must stay inside the plugin dir (no `..`, no symlinks out).

## marketplace.json (VERIFIED: validates)
```json
{
  "name": "jeyna",
  "description": "Jeyna playtesting",
  "owner": { "name": "Faktion" },
  "plugins": [
    { "name": "jeyna", "source": "./plugin", "description": "Playtesting agents" }
  ]
}
```
Required: `name`, `owner`, `plugins[]` with `name` + `source`. `source` is relative to the dir containing `.claude-plugin/`. Missing `description`/`author` only warn.

## plugin.json (VERIFIED)
```json
{ "name": "jeyna", "version": "0.0.1", "description": "Playtesting agents",
  "author": { "name": "Faktion" } }
```
- Plugin name = prefix for skills/agents/MCP tool names.
- `version` pinned => `claude plugin update` won't pick up new commits until bumped (version names the cache dir). Plugins loaded via `--plugin-dir` or from a marketplace added from a *local path* load in place; edits apply at next session start / `/reload-plugins`.
- Marketplace installed from GitHub: plugin is *copied* to `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`; `${CLAUDE_PLUGIN_ROOT}` points there. Only files inside `plugin/` are copied -> the committed bundle must live under `plugin/`.

## .mcp.json in a plugin
```json
{
  "mcpServers": {
    "mcp": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/jeyna-mcp.mjs", "--project", "${CLAUDE_PROJECT_DIR}"]
    }
  }
}
```
Variable substitution (docs):
| Var | Where substituted in plugin MCP stdio config | In server process env |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | command, args, env | yes |
| `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`, survives updates, created on first reference) | command, args, env | yes |
| `${CLAUDE_PROJECT_DIR}` | command, args, env ("Plugin-provided MCP configurations substitute `${CLAUDE_PROJECT_DIR}` directly and don't need the default") | CONFLICTING DOCS: mcp.md says Claude Code sets `CLAUDE_PROJECT_DIR` in every spawned stdio server's env; plugins-reference table lists only PLUGIN_ROOT/PLUGIN_DATA as exported to MCP stdio. UNVERIFIED -> that is exactly probe P2; read `--project` first, then `process.env.CLAUDE_PROJECT_DIR`. |
- `${VAR:-default}` supported. Unset var without default: server still starts with literal `${VAR}` text (warn in `/mcp`).
- Server's `cwd` is not documented as the project dir; don't rely on `process.cwd()`.
- Optional per-server `"timeout": <ms>` (tool call wall clock). Startup timeout: env `MCP_TIMEOUT`.
- `/mcp` lists the server as `plugin:jeyna:mcp`.

## MCP tool names
`mcp__plugin_<plugin>_<server>__<tool>`; chars outside `[A-Za-z0-9_-]` become `_`. For jeyna:
```
mcp__plugin_jeyna_mcp__goto
mcp__plugin_jeyna_mcp__snapshot
mcp__plugin_jeyna_mcp__screenshot
mcp__plugin_jeyna_mcp__scenario_verdict
mcp__plugin_jeyna_mcp__get_context
mcp__plugin_jeyna_mcp__session_start
```
VERIFIED pattern from real transcripts on this machine (e.g. `mcp__plugin_faktion-pm-skills_atlassian__getJiraIssue`). Use the full name in agent `tools:`, `--allowedTools`, permission rules and hook matchers; `mcp__mcp__*` never matches. Full name must be <=128 chars.

## agents/jeyna-tester.md
```markdown
---
name: jeyna-tester
description: Runs one Jeyna playtest case. Spawned by the playtest skill only.
tools: mcp__plugin_jeyna_mcp__goto, mcp__plugin_jeyna_mcp__snapshot, mcp__plugin_jeyna_mcp__screenshot, mcp__plugin_jeyna_mcp__scenario_verdict
model: sonnet
effort: medium
---
System prompt body here. `${CLAUDE_PLUGIN_ROOT}` is substituted in the body.
```
- Scoped name = `<plugin>:<frontmatter name>` (file name if `name` missing; subfolders add segments). `name` must not contain `:`.
- `tools`: comma string or YAML list; exact allowlist. If nothing resolves (e.g. MCP server failed to start) the agent "fails to launch" with zero tools.
- `model`: `sonnet|opus|haiku|fable|inherit|<full id>`. `effort`: `low|medium|high|xhigh|max` (model-dependent).
- Plugin agents support: name, description, model, effort, maxTurns, autoCompactWindow, tools, disallowedTools, skills, memory, background, omitClaudeMd, isolation(worktree), color, experimental.cacheTtl.
- IGNORED in plugin agents: `hooks`, `mcpServers`, `permissionMode`, `initialPrompt`. -> hooks go in `hooks/hooks.json`.
- Subagents inherit MCP tools; always-removed: AskUserQuestion, EnterPlanMode, etc. Background subagents keep all MCP tools.
- Explicit invocation: `@agent-jeyna:jeyna-tester`, or ask Claude "use the jeyna:jeyna-tester agent". Up to 20 concurrent subagents by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`).
- Plugin subagent permission prompts: MCP calls still go through the session's permission mode/rules. Allow them via `--allowedTools` or settings `permissions.allow` (e.g. `"mcp__plugin_jeyna_mcp"` = every tool of that server).

## skills/init/SKILL.md
```markdown
---
description: Set up .jeyna/ (config, conventions, .env) in the current project.
disable-model-invocation: true
argument-hint: "[--force]"
---
Copy ${CLAUDE_PLUGIN_ROOT}/templates/jeyna.config.yaml to ${CLAUDE_PROJECT_DIR}/.jeyna/jeyna.config.yaml ...
Arguments: $ARGUMENTS
```
- Command name = `/<plugin>:<skill dir>` -> `skills/init/` => `/jeyna:init` (VERIFIED: `claude plugin details` lists skill `init`). Frontmatter `name` would replace only the last segment.
- `disable-model-invocation: true`: only the user can run it (Claude never auto-loads it; also can't be preloaded into subagents).
- Substituted in body + `allowed-tools`: `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `$ARGUMENTS`, `$0`/`$ARGUMENTS[0]`.
- `allowed-tools: Bash(cp ${CLAUDE_PLUGIN_ROOT}/templates/* *) Write` pre-approves tools for that turn only.
- Templates dir `plugin/templates/` is not a component; any extra dir is fine.

## Validate / inspect (VERIFIED)
```bash
claude plugin validate ./plugin      # plugin manifest + agents/skills/hooks frontmatter
claude plugin validate .             # marketplace.json + each entry
claude --plugin-dir ./plugin plugin details jeyna   # inventory: skills, agents, hooks, MCP servers
claude --plugin-dir ./plugin plugin list
```
Note `--plugin-dir` is a global flag: it must come BEFORE the subcommand (`claude plugin details jeyna --plugin-dir ...` errors "unknown option"). Exit line `✔ Validation passed` (or `... with warnings`). `--strict` fails on warnings.

## Install for real
```bash
claude plugin marketplace add ./            # or owner/repo on GitHub
claude plugin install jeyna@jeyna --scope project   # writes enabledPlugins in .claude/settings.json
```

## Live verification by the developer (doc-sourced)
These commands are for the developer to run by hand: each one is a billed Claude session. Agents verify locally (IMPLEMENTER-RULES step 3) and put anything that needs a live session on the live-verification checklist.
```bash
cd sample-app
claude -p "/jeyna:init" --plugin-dir ../plugin --permission-mode acceptEdits
claude -p "Use the jeyna:jeyna-tester agent on case X" \
  --plugin-dir ../plugin \
  --allowedTools "mcp__plugin_jeyna_mcp" \
  --permission-prompts none \
  --output-format stream-json --verbose > run.jsonl
```
- `-p` expands user-invoked skills: put `/jeyna:init args` in the prompt string.
- `-p` has no permission host: anything that would prompt is denied (with `--permission-prompts none` Claude is also told not to retry; requires >=2.1.259). Denials show as `permission_denied` system messages and in the final `permission_denials` list (stream-json).
- Permission options: `--allowedTools "A,B"` (rule syntax; `mcp__plugin_jeyna_mcp` or `mcp__plugin_jeyna_mcp__*` allows all server tools; unanchored `mcp__*` allow is ignored), `--permission-mode acceptEdits|dontAsk|auto|bypassPermissions`, or `--dangerously-skip-permissions` (sandbox/CI only). Hook `deny` still wins in every mode.
- Don't use `--bare` for plugin probes unless you pass `--plugin-dir` (bare skips installed plugins, hooks, MCP; also needs ANTHROPIC_API_KEY).
- `-p` runs project hooks/.mcp.json without a trust dialog.
- Debug: `claude --debug-file /tmp/cc.log ...` logs hook runs (documented). Whether MCP server stderr lands there is UNVERIFIED; for P8 timestamps have the server also append to its own log file (e.g. under `${CLAUDE_PLUGIN_DATA}` or `.jeyna/`). `/mcp` prints a text status summary in `-p`.
