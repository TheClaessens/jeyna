// Flows: parsing, get_flow, get_context's flow list and guided session_start, driven over MCP stdio against the committed bundle.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";

const PORT = 4933;
let bundle: string;
let app: ChildProcess;
const clients: Client[] = [];

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "jeyna-bundle-"));
  cpSync("plugin/server", dir, { recursive: true });
  bundle = join(dir, "jeyna-mcp.mjs");
  app = spawn("node", ["sample-app/server.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  await new Promise((r) => app.stdout!.once("data", r));
});
afterAll(() => app.kill());
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

const CONFIG = `
app: { name: todo-sample, url: http://localhost:${PORT} }
viewports: [1440x900, 390x844]
accounts:
  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }
  - { handle: user_b, user_env: JEYNA_USER_B_USER, pass_env: JEYNA_USER_B_PASS }
`;

type Result = { isError?: boolean; content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] };

// A project with the sample app's hand-written flow, plus any extra flow files.
function project(flows: Record<string, string> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jeyna-project-")));
  mkdirSync(join(root, ".jeyna", "flows"), { recursive: true });
  writeFileSync(join(root, ".jeyna", "jeyna.config.yaml"), CONFIG);
  cpSync("sample-app/flows/todos.md", join(root, ".jeyna", "flows", "todos.md"));
  for (const [name, md] of Object.entries(flows)) writeFileSync(join(root, ".jeyna", "flows", `${name}.md`), md);
  return root;
}

async function connect(root: string, env: Record<string, string> = {}) {
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({ command: "node", args: [bundle, "--project", root], env: { ...process.env, ...env } as Record<string, string>, stderr: "ignore" }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;
  const text = (r: Result) => (r.content[0] as { text: string }).text;
  const json = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(text(await call(name, args)));
  return { call, text, json };
}

test("get_flow parses the sample app's hand-written flow: frontmatter, body and scenarios", async () => {
  const { json } = await connect(project());
  const flow = await json("get_flow", { name: "todos" });
  expect(flow.frontmatter).toEqual({ name: "todos", entry: "/login" });
  expect(flow.body).toMatch(/^## Preconditions$/m);
  expect(flow.scenarios).toEqual([
    {
      name: "Sign-in page",
      description: "Open the sign-in page without signing in and check that every control is labelled and on screen.",
      pass: "the email field, the password field and the Sign in button are all labelled and visible without scrolling sideways.",
      account: "none",
    },
    { name: "Add a todo with a priority", description: 'Sign in, then add a todo called "Buy milk" with priority High.', pass: '"Buy milk" appears in the list with High priority.' },
    {
      name: "Complete and delete a todo",
      description: "Sign in, add a todo, mark it complete, then delete it.",
      pass: "the todo shows as done after completing it, and is gone from the list after deleting it.",
    },
  ]);
});

const BROKEN = `---
name: broken
entry: /
---
## Scenarios
### No pass line
Just a description.
`;

test("get_context lists each flow with its scenario names, or the error that keeps it from parsing, and the conventions text", async () => {
  const root = project({ broken: BROKEN });
  writeFileSync(join(root, ".jeyna", "CONVENTIONS.md"), "# Playtest conventions\n");
  const { json } = await connect(root);
  const ctx = await json("get_context");
  expect(ctx.flows).toEqual([
    { name: "broken", error: 'broken.md: scenario "No pass line" has no Pass: line.' },
    { name: "todos", scenarios: ["Sign-in page", "Add a todo with a priority", "Complete and delete a todo"] },
  ]);
  expect(ctx.conventions).toBe("# Playtest conventions\n");
});

test("get_flow refuses an unknown name with the valid ones, and a malformed flow with what is wrong", async () => {
  const badAccount = BROKEN.replace("broken", "badaccount").replace("description.", "description.\nPass: ok.\nAccount: shared");
  const { call, text } = await connect(project({ broken: BROKEN, badaccount: badAccount }));
  const unknown = await call("get_flow", { name: "authentication" });
  expect(unknown.isError).toBe(true);
  expect(text(unknown)).toBe('No flow "authentication". Flows in .jeyna/flows/: badaccount, broken, todos.');
  expect(text(await call("get_flow", { name: "broken" }))).toMatch(/has no Pass: line/);
  expect(text(await call("get_flow", { name: "badaccount" }))).toMatch(/Account: shared; use none or consumes/);
});

const sessionOf = (runDir: string) => JSON.parse(readFileSync(join(runDir, "session.json"), "utf8"));

test("session_start with a flow runs guided: the flow's scenarios, its name as slug, testers planned by batch", async () => {
  const { json } = await connect(project());
  const run = await json("session_start", { flow: "todos" });
  expect(run.runDir).toMatch(/\.jeyna\/playtests\/\d{4}-\d{2}-\d{2}-todos$/);
  expect(run.testers.map((t: { id: string; scenario: string; account?: string; batch: number }) => [t.id, t.scenario, t.account, t.batch])).toEqual([
    ["t1", "Sign-in page", undefined, 1],
    ["t2", "Add a todo with a priority", "user_a", 1],
    ["t3", "Complete and delete a todo", "user_b", 1],
  ]);
  expect(run.testers[1].cases).toEqual([{ id: "t2-1440x900", viewport: "1440x900" }, { id: "t2-390x844", viewport: "390x844" }]);
  const session = sessionOf(run.runDir);
  expect(session).toMatchObject({ flow: "todos", mode: "guided", status: "running" });
  expect(session.scenarios.map((s: { name: string }) => s.name)).toEqual(["Sign-in page", "Add a todo with a priority", "Complete and delete a todo"]);
});

test("only and viewports narrow a guided run; unknown names are refused with the valid ones", async () => {
  const { call, text, json } = await connect(project());
  const badOnly = await call("session_start", { flow: "todos", only: ["Reset password"] });
  expect(badOnly.isError).toBe(true);
  expect(text(badOnly)).toBe("Unknown scenarios: Reset password. Scenarios of flow todos: Sign-in page, Add a todo with a priority, Complete and delete a todo.");
  const badViewport = await call("session_start", { flow: "todos", viewports: ["800x600"] });
  expect(text(badViewport)).toBe("Unknown viewports: 800x600. Configured: 1440x900, 390x844.");
  const badFlow = await call("session_start", { flow: "authentication" });
  expect(text(badFlow)).toBe('No flow "authentication". Flows in .jeyna/flows/: todos.');

  const run = await json("session_start", { flow: "todos", only: ["Complete and delete a todo"], viewports: ["390x844"] });
  expect(run.testers).toEqual([{ id: "t1", scenario: "Complete and delete a todo", account: "user_a", batch: 1, cases: [{ id: "t1-390x844", viewport: "390x844" }] }]);
  expect(sessionOf(run.runDir).scenarios.map((s: { name: string }) => s.name)).toEqual(["Complete and delete a todo"]);
});

test("session_start needs exactly one of flow and scenarios", async () => {
  const { call, text } = await connect(project());
  expect(text(await call("session_start", {}))).toMatch(/flow \(guided\) or scenarios \(exploratory\)/);
  const both = await call("session_start", { flow: "todos", scenarios: [{ name: "x", description: "d", pass: "p" }] });
  expect(both.isError).toBe(true);
  expect(text(both)).toMatch(/not both/);
});

test("a flow's own viewports and accounts restrict the run", async () => {
  const narrow = readFileSync("sample-app/flows/todos.md", "utf8")
    .replace("name: todos", "name: phone")
    .replace("entry: /login", "entry: /login\nviewports: [390x844]\naccounts: [user_b]");
  const { call, text, json } = await connect(project({ phone: narrow }));
  const run = await json("session_start", { flow: "phone" });
  expect(run.testers.map((t: { account?: string; batch: number; cases: { id: string }[] }) => [t.account, t.batch, t.cases.map((c) => c.id)])).toEqual([
    [undefined, 1, ["t1-390x844"]],
    ["user_b", 1, ["t2-390x844"]],
    ["user_b", 2, ["t3-390x844"]],
  ]);
  const wide = await call("session_start", { flow: "phone", viewports: ["1440x900"], force: true });
  expect(text(wide)).toBe("Unknown viewports: 1440x900. Flow phone runs at: 390x844.");
});

// The sample app's accounts, as in sample-app/.env.example.
const ENV = {
  JEYNA_USER_A_USER: "user_a@example.test",
  JEYNA_USER_A_PASS: "correct-horse-a",
  JEYNA_USER_B_USER: "user_b@example.test",
  JEYNA_USER_B_PASS: "correct-horse-b",
};

type Tester = { id: string; scenario: string; account?: string; batch: number; cases: { id: string; viewport: string }[] };

// The tester prompt template of skills/playtest/SKILL.md step 4, filled in the way the skill says.
const TEMPLATE = /`prompt`: exactly this template[^\n]*\n\n```\n([\s\S]*?)\n```/.exec(readFileSync("plugin/skills/playtest/SKILL.md", "utf8"))![1];
const section = (body: string, heading: string) => [...body.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].find((m) => m[1] === heading)?.[2].trim();
function testerPrompt(t: Tester, ctx: { config: { app: { url: string } }; conventions: string | null }, flow: { frontmatter: { entry: string }; body: string; scenarios: { name: string; description: string; pass: string }[] }) {
  const s = flow.scenarios.find((x) => x.name === t.scenario)!;
  return [
    `jeyna-tester-cases: ${t.cases.map((c) => c.id).join(", ")}`,
    `App: ${ctx.config.app.url}`,
    `Entry: ${flow.frontmatter.entry}`,
    "Cases, in order:",
    ...t.cases.map((c) => `- ${c.id} at ${c.viewport}`),
    t.account ? `Account: ${t.account}. Sign in with {{account.user}} and {{account.pass}}.` : "Account: none. Do not sign in.",
    "",
    `Scenario: ${s.name}`,
    s.description,
    `Pass: ${s.pass}`,
    "",
    "Preconditions:",
    section(flow.body, "Preconditions") ?? "None given.",
    "",
    "What matters most here:",
    section(flow.body, "What matters most here") ?? "Nothing given.",
    "",
    "Conventions:",
    ctx.conventions ?? "",
  ].join("\n");
}

// The tester SubagentStop check (plugin/hooks/check-exit.sh) fed a transcript that opens with this prompt.
function exitCheck(root: string, prompt: string) {
  const transcript = join(root, `agent-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(transcript, JSON.stringify({ type: "user", isSidechain: true, message: { role: "user", content: prompt } }) + "\n");
  const out = execFileSync("sh", ["plugin/hooks/check-exit.sh"], {
    input: JSON.stringify({ hook_event_name: "SubagentStop", stop_hook_active: false, agent_type: "jeyna:jeyna-tester", agent_transcript_path: transcript, cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  return out ? JSON.parse(out) : undefined;
}

test("the skill's tester prompt template has the marker line first and the fields the tester agent expects", () => {
  const labels = TEMPLATE.split("\n").map((l) => /^([A-Za-z ,]+):/.exec(l)?.[1]).filter(Boolean);
  expect(TEMPLATE.split("\n")[0]).toMatch(/^jeyna-tester-cases: </);
  expect(labels).toEqual(["App", "Entry", "Cases, in order", "Account", "Scenario", "Pass", "Preconditions", "What matters most here", "Conventions"]);
});

// The tool calls /jeyna:playtest todos makes, in the skill's order, with scripted testers in place of
// spawned ones. The live skill run is pending (decisions.md).
test("a guided run on the sample app, driven the way the skill drives it, produces a folder that passes the shell validate", async () => {
  const root = project();
  writeFileSync(join(root, ".jeyna", "CONVENTIONS.md"), readFileSync("plugin/templates/CONVENTIONS.md", "utf8"));
  const { call, text, json } = await connect(root, ENV);
  const must = async (name: string, args: Record<string, unknown>) => {
    const r = await call(name, args);
    expect(r.isError, `${name}: ${text(r)}`).toBeFalsy();
    return r;
  };

  // Skill steps 1–3: context, the flow the request names, the run.
  const ctx = await json("get_context");
  expect(ctx.flows).toEqual([{ name: "todos", scenarios: expect.any(Array) }]);
  const flow = await json("get_flow", { name: "todos" });
  const run = await json("session_start", { flow: "todos" });
  const testers: Tester[] = run.testers;

  const finding = async (c: string, f: Record<string, unknown>) =>
    JSON.parse(text(await must("record_finding", { case: c, finding: { route: "/login", steps: ["Open /login", "Read the page"], ...f } }))).id as string;
  const NO_LABEL = { title: "Password field has no label", kind: "a11y", severity: "major", expected: "The password field is announced as Password.", actual: "A nameless textbox follows Email." };
  const ids: Record<string, string> = {};

  // A tester (agents/jeyna-tester.md): per case, goto the entry, snapshot, one look: true screenshot (F4.7), play, record, verdict.
  const play = async (t: Tester) => {
    const prompt = testerPrompt(t, ctx, flow);
    for (const { id: c, viewport } of t.cases) {
      await must("goto", { case: c, path: flow.frontmatter.entry });
      const snap = text(await must("snapshot", { case: c }));
      const look = await must("screenshot", { case: c, look: true });
      expect(look.content.map((p) => p.type)).toEqual(["text", "image"]);
      const shot = text(look);

      if (t.scenario === "Sign-in page" && viewport === "1440x900") {
        expect(snap).toMatch(/^\s*- textbox\s*$/m); // bug 3
        ids.label = await finding(c, NO_LABEL);
        await must("scenario_verdict", { case: c, result: "fail", findings: [ids.label] });
      } else if (t.scenario === "Sign-in page") {
        ids.offscreen = await finding(c, { title: "Sign in button is off screen at phone width", kind: "ux", severity: "major", expected: "Sign in is visible.", actual: "Sign in is past the right edge.", evidence: [shot] }); // bug 2
        await must("scenario_verdict", { case: c, result: "fail", findings: [ids.offscreen] });
      } else {
        await must("fill", { case: c, selector: "#email", value: "{{account.user}}" });
        await must("fill", { case: c, selector: "input[type=password]", value: "{{account.pass}}" });
        await must("click", { case: c, selector: 'role=button[name="Sign in"]' });
        await must("fill", { case: c, selector: "#title", value: "Buy milk" });
        await must("fill", { case: c, selector: "#priority", value: "High" });
        await must("click", { case: c, selector: 'role=button[name="Add"]' });
        if (t.scenario === "Add a todo with a priority") {
          expect(text(await must("snapshot", { case: c }))).toMatch(/Buy milk · Normal priority/); // bug 4
          const evidence = [text(await must("screenshot", { case: c, label: "priority" }))];
          const found = [await finding(c, { title: "Chosen priority is dropped on save", kind: "bug", severity: "major", route: "/todos", expected: "Buy milk · High priority.", actual: "Buy milk · Normal priority.", evidence })];
          if (viewport === "1440x900") found.push((ids.labelAgain = await finding(c, NO_LABEL))); // the same bug 3, seen by a second scenario
          await must("scenario_verdict", { case: c, result: "fail", findings: found });
        } else {
          await must("click", { case: c, selector: 'role=button[name="Complete Buy milk"]' });
          expect(text(await must("snapshot", { case: c }))).toMatch(/Buy milk · Normal priority · done/);
          await must("click", { case: c, selector: 'role=button[name="Delete Buy milk"]' });
          expect(text(await must("snapshot", { case: c }))).not.toMatch(/Buy milk/);
          await must("scenario_verdict", { case: c, result: "pass" });
        }
      }
      // Mid-run, the exit check finds this tester's later cases unverdicted from the marker line alone.
      const rest = t.cases.slice(t.cases.findIndex((x) => x.id === c) + 1).map((x) => x.id);
      const stop = exitCheck(root, prompt);
      if (rest.length) expect(stop.reason).toContain(rest.join(", "));
      else expect(stop).toBeUndefined();
    }
  };
  expect(testers.map((t) => testerPrompt(t, ctx, flow).split("\n")[0])).toEqual(
    testers.map((t) => `jeyna-tester-cases: ${t.cases.map((c) => c.id).join(", ")}`),
  );
  expect(testerPrompt(testers[0], ctx, flow)).toContain("Account: none. Do not sign in.");

  // Skill step 4: batch by batch, the testers of a batch in parallel (P8).
  for (const batch of [...new Set(testers.map((t) => t.batch))].sort()) await Promise.all(testers.filter((t) => t.batch === batch).map(play));

  // Skill steps 5–7: validate, read the findings, mark the cross-scenario duplicate, finish.
  expect((await json("validate")).errors).toEqual([]);
  const files = readdirSync(join(run.runDir, "findings"));
  expect(files).toHaveLength(5);
  const read = Object.fromEntries(files.map((f) => [f.slice(0, -3), readFileSync(join(run.runDir, "findings", f), "utf8")]));
  expect(read[ids.labelAgain]).toMatch(/^# Password field has no label$/m);
  const [kept, dupe] = [ids.label, ids.labelAgain].sort(); // the skill keeps the lowest number
  await must("update_status", { id: dupe, status: "duplicate", of: kept });
  const done = JSON.parse(text(await must("session_finish", { summary: "Priority is dropped on save; the sign-in page has an unlabelled field and an off-screen button on phones." })));
  expect(done.counts).toMatchObject({ cases: 6, pass: 2, fail: 4, findings: 4, duplicate: 1 });
  expect(done.elapsedSeconds).toEqual(expect.any(Number));
  expect(done.testers).toBe(testers.length);

  // Skill step 7 promises a folder the shell validate accepts.
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const shell = spawnSync("node", [bundle, "validate", run.runDir], { cwd: root, encoding: "utf8", env });
  expect(shell.stdout).toBe("");
  expect(shell.status).toBe(0);
}, 60_000);
