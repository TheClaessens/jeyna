// Feeds Claude Code's PreToolUse JSON to the plugin's write guard (AC4, D2, D18).
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

function guard(tool_name: string, tool_input: Record<string, string>) {
  const out = execFileSync("sh", ["plugin/hooks/guard-write.sh"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name, tool_input }),
    encoding: "utf8",
  });
  return out ? JSON.parse(out).hookSpecificOutput : undefined;
}

test("Write into .jeyna/playtests/ is denied and points to the jeyna tools", () => {
  const d = guard("Write", { file_path: "/app/.jeyna/playtests/2026-10-15-login/session.json", content: "{}" });
  expect(d).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
  expect(d.permissionDecisionReason).toMatch(/record_finding/);
});

test("Edit on .jeyna/.env is denied and tells the agent the developer fills it", () => {
  const d = guard("Edit", { file_path: "/app/.jeyna/.env", old_string: "A=", new_string: "A=x" });
  expect(d.permissionDecision).toBe("deny");
  expect(d.permissionDecisionReason).toMatch(/developer/);
});

test("NotebookEdit and Windows paths are guarded too", () => {
  expect(guard("NotebookEdit", { notebook_path: "/app/.jeyna/playtests/x.ipynb" }).permissionDecision).toBe("deny");
  expect(guard("Write", { file_path: "C:\\app\\.jeyna\\.env" }).permissionDecision).toBe("deny");
});

test("other files, including the config and conventions, are left to the normal permission flow", () => {
  expect(guard("Write", { file_path: "/app/.jeyna/jeyna.config.yaml" })).toBeUndefined();
  expect(guard("Edit", { file_path: "/app/.jeyna/CONVENTIONS.md" })).toBeUndefined();
  expect(guard("Write", { file_path: "/app/.env" })).toBeUndefined();
});
