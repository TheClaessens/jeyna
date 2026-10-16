#!/bin/sh
# PreToolUse Write|Edit|NotebookEdit: deny .jeyna/playtests/** and .jeyna/.env (D2, D18).
# PreToolUse Read: deny .jeyna/.env, so account values never enter the context (D9, D32).
# node, not jq: node is already required by the MCP server. Silence + exit 0 = normal permission flow.
exec node -e '
const e = JSON.parse(require("fs").readFileSync(0, "utf8"));
const i = e.tool_input ?? {};
const p = String(i.file_path ?? i.notebook_path ?? "").replaceAll("\\", "/");
const reason = e.tool_name === "Read"
  ? p.endsWith("/.jeyna/.env")
    ? `Jeyna: ${p} holds test-account secrets; never read it. get_context reports where each account variable is found (env, .env or missing) without its value; list the names with Bash: cut -d= -f1 .jeyna/.env`
    : ""
  : p.includes("/.jeyna/playtests/")
  ? `Jeyna: ${p} is written only by the jeyna MCP server. Use its tools (record_finding, scenario_verdict, session_finish) instead.`
  : p.endsWith("/.jeyna/.env")
    ? `Jeyna: ${p} holds test-account secrets and only the developer fills it. Ask the developer to edit it by hand.`
    : "";
if (reason) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
'
