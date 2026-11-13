#!/bin/sh
# PreToolUse Write|Edit|NotebookEdit: deny .jeyna/playtests/**, .jeyna/feedback/** and .jeyna/.env (D2, D18, D36).
# PreToolUse Read: deny .jeyna/.env only; its values never enter agent context (D18).
# The path is resolved against the payload's cwd, . and .. collapsed, and compared ignoring case (a
# case-insensitive filesystem opens .JEYNA/.env too). node, not jq: node is already required by the MCP server.
# Silence + exit 0 = normal permission flow.
exec node -e '
const { tool_name, tool_input: i = {}, cwd = "" } = JSON.parse(require("fs").readFileSync(0, "utf8"));
const raw = String(i.file_path ?? i.notebook_path ?? "");
if (!raw) process.exit(0);
const slash = (s) => s.replaceAll("\\", "/");
const abs = /^([a-z]:)?\//i.test(slash(raw)) ? slash(raw) : `${slash(cwd)}/${slash(raw)}`;
const p = require("path").posix.normalize(abs).toLowerCase();
const env = p.endsWith("/.jeyna/.env");
const reason = tool_name === "Read"
  ? env ? `Jeyna: ${raw} holds test-account secrets, which never enter agent context. get_context says where each account variable is set (env, .env or missing).` : ""
  : p.includes("/.jeyna/playtests/")
    ? `Jeyna: ${raw} is written only by the jeyna MCP server. Use its tools (record_finding, scenario_verdict, session_finish) instead.`
  : p.includes("/.jeyna/feedback/")
    ? `Jeyna: ${raw} is written by the Jeyna studio. Set its status with update_status; the developer edits its text in the studio.`
  : env
    ? `Jeyna: ${raw} holds test-account secrets and only the developer fills it. Ask the developer to edit it by hand.`
    : "";
if (reason) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
'
