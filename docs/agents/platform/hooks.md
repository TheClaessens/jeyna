# Hooks in a plugin (write guard + tester SubagentStop)

Source: code.claude.com/docs/en/hooks.md (2026-10-15, Claude Code 2.1.299). Transcript format VERIFIED against real `~/.claude/projects/**/subagents/*.jsonl` on this machine. Hook firing inside a live session was NOT run (no auth) -> probes P6/P7 still needed.

## plugin/hooks/hooks.json (loads automatically; VERIFIED: validate + `plugin details` list both hooks)
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write|Edit|NotebookEdit",
        "hooks": [ { "type": "command", "command": "bash",
                     "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/guard-write.sh"] } ] }
    ],
    "SubagentStop": [
      { "matcher": "^jeyna:jeyna-tester$",
        "hooks": [ { "type": "command", "command": "bash",
                     "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/check-exit.sh"] } ] }
    ]
  }
}
```
- Exec form (`args` present): no shell, each arg verbatim, placeholders substituted. Shell form (`command` only) must quote: `"\"${CLAUDE_PLUGIN_ROOT}\"/hooks/x.sh"` (validate warns if unquoted).
- Hook processes get env `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`. stdin = JSON.
- Plugin hooks apply in the main session AND inside subagents.
- Default timeout 600 s (`"timeout": <seconds>` per handler). `"onFailure": "block"` (>=2.1.295) makes a crashed hook block instead of pass.

## Matcher semantics
| Matcher | Evaluated as |
|---|---|
| `*`, `""`, omitted | match all |
| only `[A-Za-z0-9_- ,|]` | exact string(s), split on `|` or `,` (so `Write|Edit|NotebookEdit` is exact, not regex) |
| any other char | JS regex, UNANCHORED (`RegExp.test`) |
- PreToolUse matches `tool_name`. SubagentStart/SubagentStop match `agent_type`.
- Plugin agent type is the scoped id `jeyna:jeyna-tester`; the `:` forces the regex path, so anchor it: `^jeyna:jeyna-tester$` (docs explicitly recommend this). P6 confirms the observed string.
- Internal agents (prompt suggestions, /btw) also fire SubagentStop with `agent_type` = session's `--agent` or `""`; a named matcher never matches `""`.

## PreToolUse input (stdin)
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/u/.claude/projects/<proj>/<session>.jsonl",
  "cwd": "/Users/u/app",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/Users/u/app/.jeyna/.env", "content": "..." },
  "tool_use_id": "toolu_01...",
  "agent_id": "only-inside-a-subagent", "agent_type": "jeyna:jeyna-tester"
}
```
- `tool_input` per tool: Write `{file_path, content}`, Edit `{file_path, old_string, new_string, replace_all}`, NotebookEdit `{notebook_path, ...}` (field name UNVERIFIED in docs; read `.file_path // .notebook_path`).
- `file_path` for Write/Edit/Read is always absolute (`~`/relative already expanded). On Windows it has backslashes; normalize before matching.
- MCP tool calls also carry `mcp_server: {name, source}` (>=2.1.274).
- Bash writes (`echo > .jeyna/.env`) are NOT covered by a Write|Edit matcher. Decide explicitly if Bash needs guarding.

## Deny with a message — two ways
1. JSON on stdout, exit 0 (preferred; reason goes to Claude):
```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Jeyna: .jeyna/playtests/** is written only by the jeyna MCP server." } }
```
2. `echo "reason" >&2; exit 2` — Claude sees `PreToolUse:Write hook error: [...]: reason`.
- Exit 1 (or any non-0/2) without valid JSON = non-blocking error, tool RUNS. Never use exit 1 for policy.
- Print nothing + exit 0 = no opinion (normal permission flow).
- `permissionDecision` values: allow | deny | ask | defer. Precedence across hooks: deny > defer > ask > allow. deny is honored in every permission mode, including bypassPermissions.
- Stdout must be exactly one JSON object (nothing else) or it's treated as text/parse error.

guard-write.sh (VERIFIED with synthetic stdin):
```bash
#!/bin/bash
input=$(cat)
p=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
p="${p//\\//}"
case "$p" in
  */.jeyna/playtests/*|*/.jeyna/.env)
    jq -n --arg r "Jeyna: $p is managed by the jeyna MCP server; do not write it directly." \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
    ;;
esac
exit 0
```
`jq` dependency: not guaranteed on developer machines. Lazy alternative: `node -e` (node is already required for the MCP server).

## SubagentStop input
```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/<proj>/<session>.jsonl",
  "cwd": "/Users/u/app",
  "permission_mode": "default",
  "hook_event_name": "SubagentStop",
  "stop_hook_active": false,
  "agent_id": "def456",
  "agent_type": "jeyna:jeyna-tester",
  "agent_transcript_path": "~/.claude/projects/<proj>/<session>/subagents/agent-def456.jsonl",
  "last_assistant_message": "final text of the subagent",
  "background_tasks": [], "session_crons": []
}
```
- `transcript_path` = MAIN session; `agent_transcript_path` = the subagent's own JSONL.
- `stop_hook_active: true` when the subagent is already continuing because a stop hook blocked it. Use it to block only once (P7).
- Global cap: after 8 consecutive stop-hook continuations Claude Code forces the stop (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).
- If the subagent uses the `SubagentHandback` tool (>=2.1.271), `last_assistant_message` is NOT the report; the report is that tool call's `tool_input.message`.
- Transcript file is written async and may lag; for the final text use `last_assistant_message`. The first prompt (written at spawn) is safe to read.

## Block a subagent from stopping
stdout, exit 0:
```json
{ "decision": "block", "reason": "You have not called scenario_verdict for case c1. Call it now, then stop." }
```
`reason` is delivered to the subagent as its next instruction. Or `echo reason >&2; exit 2` (same routing). Gotcha: exit 2 with empty stdout whose stderr says a file is missing ("No such file or directory") is downgraded to non-blocking.
Softer variant (no "hook error" label): `{"hookSpecificOutput":{"hookEventName":"SubagentStop","additionalContext":"..."}}`.

check-exit.sh skeleton:
```bash
#!/bin/bash
input=$(cat)
[ "$(jq -r .stop_hook_active <<<"$input")" = "true" ] && exit 0      # block once only
t=$(jq -r .agent_transcript_path <<<"$input"); t="${t/#\~/$HOME}"
cases=$(jq -rs '[.[]|select(.type=="user" and (.message.content|type)=="string")][0].message.content' "$t" \
        | grep -o 'jeyna-tester-cases:.*' | head -n1)
# ...compare against session.json verdicts; if missing:
jq -n --arg r "Record scenario_verdict for: $cases" '{decision:"block",reason:$r}'
```
(Paths in docs examples start with `~`; real values are probably absolute — UNVERIFIED, the `${t/#\~/$HOME}` handles both.)

## Transcript JSONL (VERIFIED on 40 real subagent transcripts, v2.1.29x)
One JSON object per line. Subagent dir: `<session>/subagents/agent-<id>.jsonl` plus `agent-<id>.meta.json` (`{"agentType":"...","description":"...","toolUseId":"..."}`).
Record shapes:
```json
{"type":"user","isSidechain":true,"agentId":"a52...","message":{"role":"user","content":"<the spawn prompt text>"}, "uuid":"...","parentUuid":null,"timestamp":"..."}
{"type":"attachment", ...}
{"type":"user","message":{"role":"user","content":"<system-reminder>..."}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking"},{"type":"text","text":"..."},{"type":"tool_use","id":"toolu_..","name":"mcp__plugin_jeyna_mcp__goto","input":{}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_..","content":[...]}]}}
```
- First user prompt = first line with `type=="user"` and `message.content` a STRING (in all 40 samples it was line 1). Later string user records can be `<system-reminder>` injections; tool results are arrays.
- `jq -r 'select(.type=="user" and (.message.content|type)=="string") | .message.content' | head -1` — but content is multi-line text, so `head -1` takes its first LINE; to get the whole first prompt use `jq -rs '[.[]|select(.type=="user" and (.message.content|type)=="string")][0].message.content'`.
- Tool calls by the tester: `select(.type=="assistant") | .message.content[] | select(.type=="tool_use") | {name, input}` (fallback for P7).
- Format is internal/undocumented; keep the parser tolerant.
