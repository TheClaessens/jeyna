// Feeds Claude Code's PreToolUse JSON to the plugin's write guard (AC4, D2, D18).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Feeds Claude Code's SubagentStop JSON and a tester transcript to the exit check (AC5b, D2, P6, P7).
function project(session?: { status: string; cases: string[]; verdicts: string[] }) {
  const root = mkdtempSync(join(tmpdir(), "jeyna-hook-"));
  mkdirSync(join(root, ".jeyna", "playtests"), { recursive: true });
  if (session) {
    const run = join(root, ".jeyna", "playtests", "2026-10-15-login");
    mkdirSync(run);
    writeFileSync(
      join(run, "session.json"),
      JSON.stringify({
        status: session.status,
        cases: session.cases.map((id) => ({ id })),
        verdicts: session.verdicts.map((c) => ({ case: c, result: "pass", findings: [] })),
      }),
    );
  }
  // Real transcript shape: spawn prompt first, then string system-reminders and array tool results.
  const transcript = join(root, "agent-def456.jsonl");
  writeFileSync(
    transcript,
    [
      { type: "user", isSidechain: true, message: { role: "user", content: "jeyna-tester-cases: t1-1440x900, t1-390x844\nApp: http://localhost:4931\n" } },
      { type: "attachment" },
      { type: "user", message: { role: "user", content: "<system-reminder>jeyna-tester-cases: t9-1x1</system-reminder>" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  return { root, transcript };
}

function exitCheck(root: string, transcript: string, stop_hook_active = false) {
  const out = execFileSync("sh", ["plugin/hooks/check-exit.sh"], {
    input: JSON.stringify({
      hook_event_name: "SubagentStop",
      stop_hook_active,
      agent_id: "def456",
      agent_type: "jeyna:jeyna-tester",
      agent_transcript_path: transcript,
      cwd: root,
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  return out ? JSON.parse(out) : undefined;
}

const hookLog = (root: string) => readFileSync(join(root, ".jeyna", "playtests", "2026-10-15-login", "hooks.log"), "utf8");

test("a tester stopping with a case unverdicted is blocked, told which case and to call scenario_verdict", () => {
  const { root, transcript } = project({ status: "running", cases: ["t1-1440x900", "t1-390x844", "t2-390x844"], verdicts: ["t1-1440x900"] });
  const out = exitCheck(root, transcript);
  expect(out.decision).toBe("block");
  expect(out.reason).toMatch(/scenario_verdict/);
  expect(out.reason).toMatch(/t1-390x844/);
  expect(out.reason).not.toMatch(/t2-390x844|t1-1440x900/);
  expect(hookLog(root)).toMatch(/agent_type=jeyna:jeyna-tester .*block/);
});

test("the second stop (stop_hook_active) is allowed even with a case still missing", () => {
  const { root, transcript } = project({ status: "running", cases: ["t1-1440x900", "t1-390x844"], verdicts: [] });
  expect(exitCheck(root, transcript, true)).toBeUndefined();
  expect(hookLog(root)).toMatch(/allow/);
});

test("a tester with every case verdicted may stop", () => {
  const { root, transcript } = project({ status: "running", cases: ["t1-1440x900", "t1-390x844"], verdicts: ["t1-390x844", "t1-1440x900"] });
  expect(exitCheck(root, transcript)).toBeUndefined();
});

test("with no running run the check does nothing and writes nothing", () => {
  const none = project();
  expect(exitCheck(none.root, none.transcript)).toBeUndefined();
  const done = project({ status: "done", cases: ["t1-1440x900", "t1-390x844"], verdicts: [] });
  expect(exitCheck(done.root, done.transcript)).toBeUndefined();
  expect(existsSync(join(done.root, ".jeyna", "playtests", "2026-10-15-login", "hooks.log"))).toBe(false);
});
