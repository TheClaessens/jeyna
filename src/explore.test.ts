// Exploratory runs (F2.3, F2.4, D6): the scout case, save_flow, and an exploratory run promoted to a flow that then runs
// guided, driven over MCP stdio against the committed bundle in the order plugin/skills/playtest/SKILL.md makes the calls.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";

let bundle: string;
let app: ChildProcess;
let APP: string;
const clients: Client[] = [];

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "jeyna-bundle-"));
  cpSync("plugin/server", dir, { recursive: true });
  bundle = join(dir, "jeyna-mcp.mjs");
  // Port 0: the sample app picks a free port and prints it, so test files running in parallel never collide.
  app = spawn("node", ["sample-app/server.mjs"], { env: { ...process.env, PORT: "0" }, stdio: "pipe" });
  const line = await new Promise<string>((r) => app.stdout!.once("data", (d) => r(String(d))));
  APP = /http:\/\/localhost:\d+/.exec(line)![0];
});
afterAll(() => app.kill());
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

// The sample app's accounts, as in sample-app/.env.example.
const ENV = {
  JEYNA_USER_A_USER: "user_a@example.test",
  JEYNA_USER_A_PASS: "correct-horse-a",
  JEYNA_USER_B_USER: "user_b@example.test",
  JEYNA_USER_B_PASS: "correct-horse-b",
};

type Result = { isError?: boolean; content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] };

// A project with config and conventions but no flows: every request is exploratory.
function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jeyna-project-")));
  mkdirSync(join(root, ".jeyna"), { recursive: true });
  writeFileSync(
    join(root, ".jeyna", "jeyna.config.yaml"),
    `app: { name: todo-sample, url: ${APP} }
viewports: [1440x900, 390x844]
accounts:
  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }
  - { handle: user_b, user_env: JEYNA_USER_B_USER, pass_env: JEYNA_USER_B_PASS }
`,
  );
  writeFileSync(join(root, ".jeyna", "CONVENTIONS.md"), readFileSync("plugin/templates/CONVENTIONS.md", "utf8"));
  return root;
}

async function connect(root: string) {
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({ command: "node", args: [bundle, "--project", root], env: { ...process.env, ...ENV } as Record<string, string>, stderr: "ignore" }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;
  const text = (r: Result) => (r.content[0] as { text: string }).text;
  const must = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    expect(r.isError, `${name}: ${text(r)}`).toBeFalsy();
    return r;
  };
  const json = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(text(await must(name, args)));
  return { call, text, must, json };
}

// Every file under .jeyna/ with a hash of its content and its mtime: any write shows.
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) {
        out[`${p}/`] = String(statSync(p).mtimeMs);
        walk(p);
      } else out[p] = createHash("sha1").update(readFileSync(p)).digest("hex") + statSync(p).mtimeMs;
    }
  };
  walk(join(root, ".jeyna"));
  return out;
}

// The scout look of SKILL.md 2b on the sample app: the entry page is a login wall, so sign in with the first account.
async function scout(c: Awaited<ReturnType<typeof connect>>) {
  const landed = JSON.parse(c.text(await c.must("goto", { case: "scout", path: "/" })));
  expect(landed.url).toBe(`${APP}/`); // the login wall
  expect(c.text(await c.must("snapshot", { case: "scout" }))).toMatch(/button "Sign in"/);
  await c.must("fill", { case: "scout", selector: "#email", value: "{{account.user}}" });
  await c.must("fill", { case: "scout", selector: "input[type=password]", value: "{{account.pass}}" });
  const signedIn = JSON.parse(c.text(await c.must("click", { case: "scout", selector: 'role=button[name="Sign in"]' })));
  expect(signedIn.url).toBe(`${APP}/todos`);
  const snap = c.text(await c.must("snapshot", { case: "scout" }));
  expect(snap).toMatch(/heading "Your todos"/);
  expect(snap).toMatch(/button "Sign out"/);
}

test("scout works before any session, at the first viewport, signed in with the first account, and writes nothing to disk", async () => {
  const root = project();
  const before = tree(root);
  const c = await connect(root);
  await scout(c);
  const shot = await c.must("screenshot", { case: "scout", look: false, label: "x" });
  expect(shot.content.map((p) => p.type)).toEqual(["text", "image"]); // the image only, whatever look says
  expect(c.text(shot)).toMatch(/not saved/);
  const png = Buffer.from((shot.content[1] as { data: string }).data, "base64");
  expect(png.readUInt32BE(16)).toBe(1440); // PNG width: the first configured viewport
  expect(tree(root)).toEqual(before);
  expect(existsSync(join(root, ".jeyna", "playtests"))).toBe(false);

  // scout is a look, never a case of a run: nothing to record against it.
  expect((await c.call("record_finding", { case: "scout", finding: { title: "Anything at all", kind: "ux", severity: "minor", route: "/", steps: ["x"], expected: "x", actual: "y" } })).isError).toBe(true);
  expect((await c.call("scenario_verdict", { case: "scout", result: "pass" })).isError).toBe(true);
  expect(tree(root)).toEqual(before);
}, 30_000);

const SCENARIOS = [
  {
    name: "Sign-in page",
    description: "Open the sign-in page without signing in and check that every control is labelled and on screen.",
    pass: "the email field, the password field and the Sign in button are all labelled and visible without scrolling sideways.",
    account: "none",
  },
  {
    name: "Sign in and sign out",
    description: "Sign in with the account, check the todo list opens, then sign out.",
    pass: "signing in opens the todo list, and Sign out returns to the sign-in page.",
  },
  {
    name: "Reset password",
    description: "From the sign-in page, follow Forgot password?, set a new password for the account, then sign in with the old password.",
    pass: "the new password works and the old password is refused.",
    account: "consumes",
  },
];

test("session_start closes the scout: its next call starts a fresh, signed-out browser", async () => {
  const c = await connect(project());
  await scout(c);
  expect(JSON.parse(c.text(await c.must("goto", { case: "scout", path: "/todos" }))).url).toBe(`${APP}/todos`);
  const run = await c.json("session_start", { scenarios: SCENARIOS.slice(0, 1), slug: "authentication", entry: "/login" });
  expect(readdirSync(join(run.runDir, "evidence"))).toEqual([]);
  expect(JSON.parse(c.text(await c.must("goto", { case: "scout", path: "/todos" }))).url).toBe(`${APP}/login`);
}, 30_000);

test("save_flow writes the run's scenarios as a flow that get_flow reads back the same; it refuses an existing file and bad names", async () => {
  const root = project();
  const c = await connect(root);
  const multiline = [{ ...SCENARIOS[1], description: "Sign in with the account,\n  check the todo list opens,\nthen sign out." }, SCENARIOS[2], SCENARIOS[0]];
  const run = await c.json("session_start", { scenarios: multiline, slug: "auth", entry: "/login" });
  expect(JSON.parse(readFileSync(join(run.runDir, "session.json"), "utf8"))).toMatchObject({ mode: "exploratory", flow: "exploratory:auth", entry: "/login" });

  const saved = await c.json("save_flow", { run: run.id, name: "authentication" });
  expect(saved.path).toBe(join(root, ".jeyna", "flows", "authentication.md"));
  const flow = await c.json("get_flow", { name: "authentication" });
  expect(flow.frontmatter).toEqual({ name: "authentication", entry: "/login" });
  expect(flow.scenarios).toEqual([SCENARIOS[1], SCENARIOS[2], SCENARIOS[0]]);
  expect((await c.json("get_context")).flows).toEqual([{ name: "authentication", scenarios: ["Sign in and sign out", "Reset password", "Sign-in page"] }]);

  const file = readFileSync(saved.path, "utf8");
  const again = await c.call("save_flow", { run: run.id, name: "authentication" });
  expect(again.isError).toBe(true);
  expect(c.text(again)).toMatch(/authentication\.md already exists/);
  expect(readFileSync(saved.path, "utf8")).toBe(file);

  for (const name of ["Auth Flow", "../evil", "auth.md", ""]) expect((await c.call("save_flow", { run: run.id, name })).isError, name).toBe(true);
  for (const bad of ["2020-01-01-nope", "../../..", "/etc"]) expect((await c.call("save_flow", { run: bad, name: "other" })).isError, bad).toBe(true);
  expect(readdirSync(join(root, ".jeyna", "flows"))).toEqual(["authentication.md"]);

  // A scenario that cannot survive as a flow file is refused before anything is written.
  const odd = await c.json("session_start", { scenarios: [{ name: "Odd", description: "Pass: looks like a pass line.", pass: "ok" }], slug: "odd", force: true });
  const refused = await c.call("save_flow", { run: odd.id, name: "odd" });
  expect(refused.isError).toBe(true);
  expect(c.text(refused)).toMatch(/Nothing was written|not make a valid flow/);
  expect(readdirSync(join(root, ".jeyna", "flows"))).toEqual(["authentication.md"]);
}, 30_000);

type Tester = { id: string; scenario: string; account?: string; batch: number; cases: { id: string; viewport: string }[] };

// A scripted tester for the authentication scenarios (agents/jeyna-tester.md): per case, goto the entry, snapshot,
// one look: true screenshot, play, record, verdict.
function tester(c: Awaited<ReturnType<typeof connect>>, entry: string) {
  const finding = async (caseId: string, f: Record<string, unknown>) =>
    JSON.parse(c.text(await c.must("record_finding", { case: caseId, finding: { route: "/login", steps: ["Open /login", "Read the page"], ...f } }))).id as string;
  const signIn = async (caseId: string, pass = "{{account.pass}}") => {
    await c.must("fill", { case: caseId, selector: "#email", value: "{{account.user}}" });
    await c.must("fill", { case: caseId, selector: "input[type=password]", value: pass });
    return JSON.parse(c.text(await c.must("click", { case: caseId, selector: 'role=button[name="Sign in"]' }))).url as string;
  };
  return async (t: Tester) => {
    for (const { id, viewport } of t.cases) {
      await c.must("goto", { case: id, path: entry });
      const snap = c.text(await c.must("snapshot", { case: id }));
      const shot = c.text(await c.must("screenshot", { case: id, look: true }));
      if (t.scenario === "Sign-in page") {
        expect(snap).toMatch(/^\s*- textbox\s*$/m); // bug 3
        const found = [await finding(id, { title: "Password field has no label", kind: "a11y", severity: "major", expected: "Announced as Password.", actual: "A nameless textbox.", evidence: [shot] })];
        if (viewport === "390x844") {
          found.push(await finding(id, { title: "Sign in button is off screen at phone width", kind: "ux", severity: "major", expected: "Visible.", actual: "Past the right edge.", evidence: [shot] })); // bug 2
        }
        await c.must("scenario_verdict", { case: id, result: "fail", findings: found });
      } else if (t.scenario === "Sign in and sign out") {
        expect(await signIn(id)).toBe(`${APP}/todos`);
        const out = JSON.parse(c.text(await c.must("click", { case: id, selector: 'role=button[name="Sign out"]' })));
        expect(out.url).toBe(`${APP}/login`);
        await c.must("scenario_verdict", { case: id, result: "pass" });
      } else {
        await c.must("click", { case: id, selector: "text=Forgot password?" });
        await c.must("fill", { case: id, selector: "#email", value: "{{account.user}}" });
        await c.must("fill", { case: id, selector: "#password", value: `new-${id}` });
        await c.must("click", { case: id, selector: 'role=button[name="Reset password"]' });
        await c.must("goto", { case: id, path: "/login" });
        expect(await signIn(id)).toBe(`${APP}/todos`); // bug 1: the old password still works
        const evidence = [c.text(await c.must("screenshot", { case: id, label: "old-password" }))];
        const f = await finding(id, { title: "Old password still works after a reset", kind: "bug", severity: "critical", route: "/reset", expected: "The old password is refused.", actual: "It signs in.", evidence });
        await c.must("scenario_verdict", { case: id, result: "fail", findings: [f] });
      }
    }
  };
}

async function play(c: Awaited<ReturnType<typeof connect>>, run: { testers: Tester[] }, entry: string) {
  const one = tester(c, entry);
  for (const batch of [...new Set(run.testers.map((t) => t.batch))].sort()) await Promise.all(run.testers.filter((t) => t.batch === batch).map(one));
}

const matrixRows = (runDir: string) =>
  /## Scenario matrix\n\n([\s\S]*?)\n\n/
    .exec(readFileSync(join(runDir, "report.md"), "utf8"))![1]
    .split("\n")
    .slice(2)
    .map((r) => r.split(" | ")[0].replace(/^\| /, ""));

function shellValidate(root: string, runDir: string) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync("node", [bundle, "validate", runDir], { cwd: root, encoding: "utf8", env });
}

// AC1 and AC1b with scripted testers and a scripted proposal; the live skill run is pending (decisions.md D29).
test("an exploratory run on the sample app passes validate, save_flow promotes it, and the same request then runs guided with the same scenario rows", async () => {
  const root = project();
  const c = await connect(root);

  // SKILL.md 1–2: no flow matches "let's test the authentication flow".
  expect((await c.json("get_context")).flows).toEqual([]);

  // 2b: scout look, then the confirmed proposal starts the run.
  const before = tree(root);
  await scout(c);
  expect(tree(root)).toEqual(before);
  const explore = await c.json("session_start", { scenarios: SCENARIOS, slug: "authentication", entry: "/login" });
  expect(explore.runDir).toMatch(/\.jeyna\/playtests\/\d{4}-\d{2}-\d{2}-authentication$/);
  expect(explore.testers.map((t: Tester) => [t.scenario, t.account, t.batch])).toEqual([
    ["Sign-in page", undefined, 1],
    ["Sign in and sign out", "user_a", 1],
    ["Reset password", "user_b", 1],
  ]);

  // 4–7: testers, validate, finish.
  await play(c, explore, "/login");
  expect((await c.json("validate")).errors).toEqual([]);
  await c.must("session_finish", { summary: "The old password survives a reset; the sign-in page has an unlabelled field and an off-screen button on phones." });
  const shell = shellValidate(root, explore.runDir);
  expect(shell.stdout).toBe("");
  expect(shell.status).toBe(0);

  // 8: save the run as a flow.
  await c.must("save_flow", { run: explore.id, name: "authentication" });

  // The same request now matches a flow by name: a guided run of the same scenarios.
  const ctx = await c.json("get_context");
  expect(ctx.flows).toEqual([{ name: "authentication", scenarios: SCENARIOS.map((s) => s.name) }]);
  const flow = await c.json("get_flow", { name: "authentication" });
  expect(flow.scenarios).toEqual(SCENARIOS);
  const guided = await c.json("session_start", { flow: "authentication" });
  expect(guided.runDir).toBe(`${explore.runDir}-2`);
  const [a, b] = [explore, guided].map((r) => JSON.parse(readFileSync(join(r.runDir, "session.json"), "utf8")));
  expect(b).toMatchObject({ mode: "guided", flow: "authentication", entry: "/login" });
  expect(b.scenarios).toEqual(a.scenarios);
  expect(b.cases).toEqual(a.cases);
  expect(guided.testers).toEqual(explore.testers);

  await play(c, guided, flow.frontmatter.entry);
  await c.must("session_finish", { summary: "Guided rerun of the saved authentication flow." });
  expect(shellValidate(root, guided.runDir).status).toBe(0);
  expect(matrixRows(guided.runDir)).toEqual(matrixRows(explore.runDir));
  expect(matrixRows(guided.runDir)).toEqual(SCENARIOS.map((s) => s.name));
}, 90_000);
