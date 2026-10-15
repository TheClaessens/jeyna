#!/bin/sh
# PreToolUse Write|Edit|NotebookEdit: deny .jeyna/playtests/** and .jeyna/.env (D2, D18).
# node, not jq: node is already required by the MCP server. Silence + exit 0 = normal permission flow.
exec node -e '
const i = JSON.parse(require("fs").readFileSync(0, "utf8")).tool_input ?? {};
const p = String(i.file_path ?? i.notebook_path ?? "").replaceAll("\\", "/");
const reason = p.includes("/.jeyna/playtests/")
  ? `Jeyna: ${p} is written only by the jeyna MCP server. Use its tools (record_finding, scenario_verdict, session_finish) instead.`
  : p.endsWith("/.jeyna/.env")
    ? `Jeyna: ${p} holds test-account secrets and only the developer fills it. Ask the developer to edit it by hand.`
    : "";
if (reason) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
'
