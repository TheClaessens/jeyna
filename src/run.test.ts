// Drives the committed bundle (copied away from node_modules) over MCP stdio against the sample app.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { type App, startApp } from "./testkit.js";

let APP: string;
let bundle: string;
let app: App;
const clients: Client[] = [];

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "jeyna-bundle-"));
  cpSync("plugin/server", dir, { recursive: true });
  bundle = join(dir, "jeyna-mcp.mjs");
  app = await startApp();
  APP = app.url;
});
afterAll(() => app.stop());
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

const CONFIG = () => `
app: { name: todo-sample, url: ${APP} }
viewports: [1440x900, 390x844]
accounts:
  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }
`;

function project(config = CONFIG()): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jeyna-project-")));
  mkdirSync(join(root, ".jeyna"));
  writeFileSync(join(root, ".jeyna", "jeyna.config.yaml"), config);
  return root;
}

type Result = { isError?: boolean; content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] };

async function connect(root: string, env: Record<string, string> = {}) {
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  const transport = new StdioClientTransport({ command: "node", args: [bundle, "--project", root], env: { ...process.env, ...env } as Record<string, string>, stderr: "ignore" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;
  const text = (r: Result) => (r.content[0] as { text: string }).text;
  return { call, text, pid: transport.pid! };
}

const SIGN_IN = { name: "Sign in", description: "Sign in from the login page.", pass: "The todo list shows." };

test("session_start plans testers and cases and writes session.json", async () => {
  const root = project();
  const { call, text } = await connect(root);
  const r = await call("session_start", { scenarios: [SIGN_IN, { ...SIGN_IN, name: "Landing", account: "none" }], slug: "login" });
  expect(r.isError).toBeFalsy();
  const out = JSON.parse(text(r));
  expect(out.testers).toEqual([
    { id: "t1", scenario: "Sign in", account: "user_a", batch: 1, cases: [{ id: "t1-1440x900", viewport: "1440x900" }, { id: "t1-390x844", viewport: "390x844" }] },
    { id: "t2", scenario: "Landing", batch: 1, cases: [{ id: "t2-1440x900", viewport: "1440x900" }, { id: "t2-390x844", viewport: "390x844" }] },
  ]);
  expect(out.runDir).toMatch(/\.jeyna\/playtests\/\d{4}-\d{2}-\d{2}-login$/);
  const session = JSON.parse(readFileSync(join(out.runDir, "session.json"), "utf8"));
  expect(session).toMatchObject({ id: out.id, status: "running", flow: "exploratory:login", mode: "exploratory", build: expect.any(String) });
  expect(session.testers[0]).toMatchObject({ id: "t1", model: "sonnet" });
  expect(session.cases).toHaveLength(4);
});

test("a second session_start is refused while one runs, and force aborts it", async () => {
  const root = project();
  const { call, text } = await connect(root);
  const first = JSON.parse(text(await call("session_start", { scenarios: [SIGN_IN], slug: "login" })));
  const refused = await call("session_start", { scenarios: [SIGN_IN], slug: "login" });
  expect(refused.isError).toBe(true);
  expect(text(refused)).toMatch(/force/);
  const second = JSON.parse(text(await call("session_start", { scenarios: [SIGN_IN], slug: "login", force: true })));
  expect(second.runDir).toMatch(/-login-2$/);
  expect(JSON.parse(readFileSync(join(first.runDir, "session.json"), "utf8")).status).toBe("aborted");
});

test("two simultaneous session_start calls: one run starts, the other is refused as a second run is", async () => {
  const root = project();
  const { call, text } = await connect(root);
  const both = await Promise.all([1, 2].map(() => call("session_start", { scenarios: [SIGN_IN], slug: "login" })));
  expect(both.map((r) => !!r.isError).sort()).toEqual([false, true]);
  const winner = JSON.parse(text(both.find((r) => !r.isError)!));
  expect(text(both.find((r) => r.isError)!)).toBe(`A run is still running: ${winner.runDir}. Call session_start with force: true to abort it.`);
  const dir = join(root, ".jeyna", "playtests");
  expect(readdirSync(dir).map((d) => sessionOf(join(dir, d)).status)).toEqual(["running"]);
});

test("an exploratory run takes any well-formed viewport, so a finding seen at a flow's own viewport can be retested", async () => {
  const { call, text } = await connect(project());
  const bad = await call("session_start", { scenarios: [SIGN_IN], viewports: ["800x600", "wide"] });
  expect(text(bad)).toBe("Viewports look like 1440x900 (<width>x<height>), not: wide. Configured: 1440x900, 390x844.");
  const ok = JSON.parse(text(await call("session_start", { scenarios: [SIGN_IN], viewports: ["800x600"] })));
  expect(ok.testers[0].cases).toEqual([{ id: "t1-800x600", viewport: "800x600" }]);
});

test("accounts narrows an exploratory run's pool to the given handles; unknown handles are refused with the configured ones", async () => {
  const config = `${CONFIG()}  - { handle: user_b, user_env: JEYNA_USER_B_USER, pass_env: JEYNA_USER_B_PASS }\n`;
  const { call, text } = await connect(project(config));
  expect(text(await call("session_start", { scenarios: [SIGN_IN], accounts: ["user_c"] }))).toBe("Unknown accounts: user_c. Configured: user_a, user_b.");
  const run = JSON.parse(text(await call("session_start", { scenarios: [SIGN_IN, { ...SIGN_IN, name: "Again" }], accounts: ["user_b"] })));
  expect(run.testers.map((t: { account: string; batch: number }) => [t.account, t.batch])).toEqual([["user_b", 1], ["user_b", 2]]);
});

// A tester of an aborted run keeps calling with its case ids, which a new run would reuse (t1-…) if numbering restarted.
test("after session_start force, a tester of the aborted run is refused and told to stop; the new run numbers its testers after it", async () => {
  const { call, text } = await connect(project());
  const old = JSON.parse(text(await call("session_start", { scenarios: [SIGN_IN, { ...SIGN_IN, name: "Landing", account: "none" }] })));
  const forced = JSON.parse(text(await call("session_start", { scenarios: [SIGN_IN], force: true })));
  expect(forced.testers.map((t: { id: string; cases: { id: string }[] }) => [t.id, t.cases.map((c) => c.id)])).toEqual([["t3", ["t3-1440x900", "t3-390x844"]]]);
  for (const [tool, args] of [
    ["scenario_verdict", { result: "pass" }],
    ["record_finding", { finding: A11Y }],
    ["snapshot", {}],
  ] as const) {
    const r = await call(tool, { case: "t1-390x844", ...args });
    expect(r.isError, tool).toBe(true);
    expect(text(r)).toBe("Case t1-390x844 belongs to a run that was aborted: a new run replaced it. Stop now: make no more calls and report that your run was aborted.");
    expect(text(r)).not.toMatch(/t3-/); // never points a stale tester at the new run's cases
  }
  expect(sessionOf(forced.runDir).verdicts).toEqual([]);
  expect(sessionOf(old.runDir).status).toBe("aborted");
  // Later runs of this server keep numbering after the retired ids, forced or not.
  await call("scenario_verdict", { case: "t3-1440x900", result: "pass" });
  await call("scenario_verdict", { case: "t3-390x844", result: "pass" });
  expect((await call("session_finish", { summary: "Done." })).isError).toBeFalsy();
  const next = JSON.parse(text(await call("session_start", { scenarios: [SIGN_IN] })));
  expect(next.testers[0].id).toBe("t3");
});

async function started(env: Record<string, string> = {}) {
  const root = project();
  const c = await connect(root, env);
  const run = JSON.parse(c.text(await c.call("session_start", { scenarios: [SIGN_IN] })));
  return { ...c, runDir: run.runDir as string };
}

test("goto opens a path on the app in the case's own browser and returns final url and title", async () => {
  const { call, text } = await started();
  const r = await call("goto", { case: "t1-390x844", path: "/login" });
  expect(r.isError).toBeFalsy();
  expect(JSON.parse(text(r))).toEqual({ url: `${APP}/login`, title: "Sign in · Todo sample" });
});

test("goto resolves a path under the app url's base path", async () => {
  const c = await connect(project(CONFIG().replace(`url: ${APP} }`, `url: ${APP}/base/ }`)));
  await c.call("session_start", { scenarios: [SIGN_IN] });
  for (const [path, url] of [["/login", `${APP}/base/login`], ["todos?x=1#y", `${APP}/base/todos?x=1#y`]]) {
    const r = await c.call("goto", { case: "t1-1440x900", path });
    expect(r.isError, c.text(r)).toBeFalsy();
    expect(JSON.parse(c.text(r)).url).toBe(url); // the sample app has no /base, so a Not found page, at the right url
  }
  const full = await c.call("goto", { case: "t1-1440x900", url: `${APP}/login` });
  expect(JSON.parse(c.text(full)).url).toBe(`${APP}/login`);
});

// The browser the server launched, found as its child process (the installed Chrome or Playwright's Chromium).
// `ps -A -o pid=,ppid=,args=` reads the same on macOS (BSD ps has no --ppid) and Linux.
const browserPids = (serverPid: number) =>
  execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter(([, ppid, ...args]) => Number(ppid) === serverPid && /chrom/i.test(args.join(" ")))
    .map(([pid]) => Number(pid));

test("after the browser dies (a crash, or the headed window closed), the next call launches a new one", async () => {
  const { call, text, pid } = await started();
  expect((await call("goto", { case: "t1-1440x900", path: "/login" })).isError).toBeFalsy();
  const [chrome] = browserPids(pid);
  expect(chrome).toBeGreaterThan(0);
  process.kill(chrome, "SIGKILL");
  await new Promise((r) => setTimeout(r, 500)); // the server sees the disconnect
  const r = await call("goto", { case: "t1-1440x900", path: "/login" });
  expect(r.isError, text(r)).toBeFalsy();
  expect(JSON.parse(text(r)).url).toBe(`${APP}/login`);
  expect(browserPids(pid)).not.toContain(chrome);
  expect((await call("snapshot", { case: "t1-390x844" })).isError).toBeFalsy(); // another case gets a fresh page too
}, 30_000);

test("snapshot returns the aria tree, where the unlabelled password field shows as a nameless textbox (bug 3)", async () => {
  const { call, text } = await started();
  await call("goto", { case: "t1-1440x900", path: "/" });
  const snap = text(await call("snapshot", { case: "t1-1440x900" }));
  expect(snap).toMatch(/textbox "Email"/);
  expect(snap).toMatch(/^\s*- textbox\s*$/m);
  expect(snap).toMatch(/button "Sign in"/);
});

test("snapshot keeps its whole result, console tail included, within 90,000 characters, the page text cut with a note", async () => {
  const { call, text } = await started();
  const big = "<p>" + "a fairly long paragraph of filler text for the snapshot ".repeat(3) + "</p>";
  // 40 console errors of 400 characters, after the goto has returned, so the snapshot carries them.
  const noisy = `<script>setTimeout(() => { for (let i = 0; i < 40; i++) console.error("${"e".repeat(400)}") }, 300)</script>`;
  await call("goto", { case: "t1-1440x900", url: "data:text/html," + encodeURIComponent(big.repeat(1000)) });
  const snap = text(await call("snapshot", { case: "t1-1440x900" }));
  expect(snap.length).toBeLessThanOrEqual(90_000);
  expect(snap).toMatch(/\n\[truncated, the page continues\]$/);
  await call("goto", { case: "t1-1440x900", url: "data:text/html," + encodeURIComponent(noisy + big.repeat(1000)) });
  await new Promise((r) => setTimeout(r, 800));
  const loud = text(await call("snapshot", { case: "t1-1440x900" }));
  expect(loud.length).toBeLessThanOrEqual(90_000);
  expect(loud).toMatch(/\[truncated, the page continues\]\n\nConsole since your last call:\n/);
  expect(loud).toMatch(/- … and more; the rest is dropped until the next call$/);
});

const pngSize = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

test("screenshot writes evidence/<case>-<seq>[-label].png and returns the image only with look: true", async () => {
  const { call, text, runDir } = await started();
  await call("goto", { case: "t1-390x844", path: "/login" });
  const plain = await call("screenshot", { case: "t1-390x844" });
  expect(plain.content).toHaveLength(1);
  expect(text(plain)).toBe("t1-390x844-1.png");
  const look = await call("screenshot", { case: "t1-390x844", label: "login", look: true });
  expect(text(look)).toBe("t1-390x844-2-login.png");
  const img = look.content[1] as { type: string; data: string; mimeType: string };
  expect(img).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(pngSize(Buffer.from(img.data, "base64"))).toEqual([390, 844]);
  expect(existsSync(join(runDir, "evidence", "t1-390x844-1.png"))).toBe(true);
  writeFileSync(join(tmpdir(), "jeyna-p5-390x844.png"), Buffer.from(img.data, "base64"));
});

test("browser tools refuse an unknown case and name the valid ones", async () => {
  const { call, text } = await started();
  const r = await call("snapshot", { case: "t9-390x844" });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/t1-1440x900, t1-390x844/);
});

test("browser tools before session_start say to start a session", async () => {
  const { call, text } = await connect(project());
  const r = await call("goto", { case: "t1-390x844", path: "/" });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/session_start/);
});

test("with Chrome forced to fail and no Playwright Chromium, session_start refuses the run, naming npx playwright install chromium (P4, F11.3)", async () => {
  const empty = mkdtempSync(join(tmpdir(), "jeyna-no-browsers-"));
  const root = project();
  const { call, text } = await connect(root, { JEYNA_BROWSER_CHANNEL: "chrome-does-not-exist", PLAYWRIGHT_BROWSERS_PATH: empty });
  const r = await call("session_start", { scenarios: [SIGN_IN] });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/^No browser found\. [\s\S]*npx playwright install chromium/);
  expect(existsSync(join(root, ".jeyna", "playtests"))).toBe(false);
});

const sessionOf = (runDir: string) => JSON.parse(readFileSync(join(runDir, "session.json"), "utf8"));

test("scenario_verdict records one verdict per case in session.json; a second one replaces it", async () => {
  const { call, runDir } = await started();
  expect((await call("scenario_verdict", { case: "t1-390x844", result: "pass" })).isError).toBeFalsy();
  expect((await call("scenario_verdict", { case: "t1-1440x900", result: "pass" })).isError).toBeFalsy();
  await call("scenario_verdict", { case: "t1-390x844", result: "skipped", note: "app down" });
  expect(sessionOf(runDir).verdicts).toEqual([
    { case: "t1-1440x900", result: "pass", findings: [] },
    { case: "t1-390x844", result: "skipped", note: "app down", findings: [] },
  ]);
});

test("blocked and skipped need a note; unknown cases are refused", async () => {
  const { call, text, runDir } = await started();
  for (const result of ["blocked", "skipped"]) {
    const r = await call("scenario_verdict", { case: "t1-390x844", result });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/note/);
  }
  const r = await call("scenario_verdict", { case: "t9-390x844", result: "pass" });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/t1-1440x900, t1-390x844/);
  expect(sessionOf(runDir).verdicts).toEqual([]);
});

test("parallel verdicts are all kept", async () => {
  const { call, runDir } = await started();
  await Promise.all(["t1-1440x900", "t1-390x844"].map((c) => call("scenario_verdict", { case: c, result: "pass" })));
  expect(sessionOf(runDir).verdicts.map((v: { case: string }) => v.case).sort()).toEqual(["t1-1440x900", "t1-390x844"]);
});

const A11Y = {
  title: "Password field has no label",
  kind: "a11y",
  severity: "major",
  route: "/login",
  steps: ["Open /login", "Read the accessibility snapshot"],
  expected: "The password field is announced as Password.",
  actual: "The snapshot shows a nameless textbox after Email.",
};

test("record_finding writes findings/PT-<slug>-001.md with frontmatter copied from the case and the five sections (bug 3)", async () => {
  const { call, text, runDir } = await started();
  await call("goto", { case: "t1-390x844", path: "/login" });
  const shot = text(await call("screenshot", { case: "t1-390x844", label: "login" }));
  const r = await call("record_finding", {
    case: "t1-390x844",
    finding: { ...A11Y, evidence: [shot], next: "Add a <label> to the password input." },
  });
  expect(r.isError).toBeFalsy();
  const out = JSON.parse(text(r));
  expect(out).toEqual({ id: "PT-exploratory-001", path: join(runDir, "findings", "PT-exploratory-001.md") });
  const md = readFileSync(out.path, "utf8");
  const [, front, body] = md.split(/^---$/m);
  expect(front).toMatch(/^schema: 1$/m);
  expect(front).toMatch(/^id: PT-exploratory-001$/m);
  expect(front).toMatch(/^kind: a11y$/m);
  expect(front).toMatch(/^status: open$/m);
  expect(front).toMatch(/^flow: exploratory:exploratory$/m);
  expect(front).toMatch(/^case: t1-390x844$/m);
  expect(front).toMatch(/^scenario: Sign in$/m);
  expect(front).toMatch(/^viewport: 390x844$/m);
  expect(front).toMatch(/^route: \/login$/m);
  expect(front).toMatch(/^author: sonnet$/m);
  expect(front).toMatch(/^browser: \S+/m);
  expect(front).toMatch(/^build: \S+/m);
  expect(front).toMatch(/^created: \S+/m);
  expect(front).toMatch(/^evidence:\n {2}- t1-390x844-1-login.png$/m);
  expect(body).toMatch(/^# Password field has no label$/m);
  for (const h of ["Steps", "Expected", "Actual", "Evidence", "Suggested next step"]) expect(body).toMatch(new RegExp(`^## ${h}$`, "m"));
  expect(body).toMatch(/^1\. Open \/login$/m);
  expect(body).toMatch(/!\[t1-390x844-1-login.png\]\(\.\.\/evidence\/t1-390x844-1-login.png\)/);
  expect(body).toMatch(/Add a <label> to the password input\./);
});

test("a bug with no evidence is refused, telling the tester to take a screenshot; with one it is recorded (AC5)", async () => {
  const { call, text } = await started();
  const bug = { ...A11Y, kind: "bug" };
  const r = await call("record_finding", { case: "t1-390x844", finding: bug });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/evidence/);
  expect(text(r)).toMatch(/screenshot/);
  await call("goto", { case: "t1-390x844", path: "/login" });
  const shot = text(await call("screenshot", { case: "t1-390x844" }));
  const retry = await call("record_finding", { case: "t1-390x844", finding: { ...bug, evidence: [shot] } });
  expect(retry.isError).toBeFalsy();
  expect(JSON.parse(text(retry)).id).toBe("PT-exploratory-001");
});

test("evidence that does not exist is refused with the files that do", async () => {
  const { call, text } = await started();
  await call("goto", { case: "t1-390x844", path: "/login" });
  await call("screenshot", { case: "t1-390x844" });
  for (const name of ["t1-390x844-9.png", "../session.json"]) {
    const r = await call("record_finding", { case: "t1-390x844", finding: { ...A11Y, evidence: [name] } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/t1-390x844-1\.png/);
  }
});

test("kinds are bug, ux, a11y, question; perf and unknown cases are refused", async () => {
  const { call, text } = await started();
  const perf = await call("record_finding", { case: "t1-390x844", finding: { ...A11Y, kind: "perf" } });
  expect(perf.isError).toBe(true);
  for (const kind of ["ux", "a11y", "question"]) {
    expect((await call("record_finding", { case: "t1-390x844", finding: { ...A11Y, kind } })).isError).toBeFalsy();
  }
  const r = await call("record_finding", { case: "t9-390x844", finding: A11Y });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/t1-1440x900, t1-390x844/);
});

test("concurrent record_finding calls never get the same id", async () => {
  const { call, text, runDir } = await started();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => call("record_finding", { case: i % 2 ? "t1-390x844" : "t1-1440x900", finding: A11Y })),
  );
  const ids = results.map((r) => JSON.parse(text(r)).id).sort();
  expect(ids).toEqual(Array.from({ length: 8 }, (_, i) => `PT-exploratory-00${i + 1}`));
  for (const id of ids) expect(existsSync(join(runDir, "findings", `${id}.md`))).toBe(true);
});

test("fail needs a finding of the tester's own cases: one recorded at its other viewport is cited; another tester's or an unknown id is refused", async () => {
  const root = project();
  const { call, text } = await connect(root);
  const { runDir } = JSON.parse(text(await call("session_start", { scenarios: [SIGN_IN, { ...SIGN_IN, name: "Landing", account: "none" }] })));
  const none = await call("scenario_verdict", { case: "t1-390x844", result: "fail" });
  expect(none.isError).toBe(true);
  expect(text(none)).toMatch(/record_finding/);
  const id = JSON.parse(text(await call("record_finding", { case: "t1-1440x900", finding: A11Y }))).id;
  const theirs = JSON.parse(text(await call("record_finding", { case: "t2-390x844", finding: A11Y }))).id;
  const other = await call("scenario_verdict", { case: "t1-390x844", result: "fail", findings: [theirs] });
  expect(text(other)).toBe(`Not findings of your cases (t1-1440x900, t1-390x844): ${theirs}. Their findings: ${id}.`);
  expect((await call("scenario_verdict", { case: "t1-390x844", result: "pass", findings: ["PT-nope-001"] })).isError).toBe(true);
  expect((await call("scenario_verdict", { case: "t1-1440x900", result: "fail", findings: [id] })).isError).toBeFalsy();
  expect((await call("scenario_verdict", { case: "t1-390x844", result: "fail", findings: [id] })).isError).toBeFalsy();
  expect(sessionOf(runDir).verdicts).toEqual([
    { case: "t1-1440x900", result: "fail", findings: [id] },
    { case: "t1-390x844", result: "fail", findings: [id] },
  ]);
});

// P8: two cases driven concurrently over one connection, as two testers in one batch would be.
test("two cases run interleaved: per-call stderr logs overlap and both verdicts land in session.json (P8)", async () => {
  const root = project();
  const transport = new StdioClientTransport({ command: "node", args: [bundle, "--project", root], stderr: "pipe" });
  let stderr = "";
  transport.stderr!.on("data", (d) => (stderr += d));
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Result;
  const started = await call("session_start", { scenarios: [SIGN_IN, { ...SIGN_IN, name: "Landing", account: "none" }] });
  const run = JSON.parse((started.content[0] as { text: string }).text);
  const steps = [["goto", { path: "/login" }], ["snapshot", {}], ["screenshot", {}], ["scenario_verdict", { result: "pass" }]] as const;
  const tester = async (c: string) => {
    for (const [tool, args] of steps) expect((await call(tool, { case: c, ...args })).isError).toBeFalsy();
  };
  await Promise.all([tester("t1-1440x900"), tester("t2-390x844")]);

  // Lines: "<iso> call <n> <tool> <case> start" and "<iso> call <n> <tool> <case> end <ms>ms".
  const spans = new Map<string, { c: string; start: number; end: number }>();
  for (const m of stderr.matchAll(/^(\S+) call (\d+) \S+ (\S+) (start|end)/gm)) {
    const t = Date.parse(m[1]);
    if (m[4] === "start") spans.set(m[2], { c: m[3], start: t, end: NaN });
    else spans.get(m[2])!.end = t;
  }
  const of = (c: string) => [...spans.values()].filter((s) => s.c === c);
  expect(of("t1-1440x900")).toHaveLength(4);
  expect(of("t2-390x844")).toHaveLength(4);
  expect(of("t1-1440x900").some((a) => of("t2-390x844").some((b) => a.start < b.end && b.start < a.end))).toBe(true);
  expect(sessionOf(run.runDir).verdicts.map((v: { case: string }) => v.case).sort()).toEqual(["t1-1440x900", "t2-390x844"]);
});

test("app.reset runs from the project root before a run; a failing one refuses the run and starts nothing (D31)", async () => {
  const withReset = (cmd: string) => CONFIG().replace(`url: ${APP} }`, `url: ${APP}, reset: "${cmd}" }`);
  const root = project(withReset("touch reset-ran"));
  const ran = await connect(root);
  const r = await ran.call("session_start", { scenarios: [SIGN_IN] });
  expect(r.isError, ran.text(r)).toBeFalsy();
  expect(existsSync(join(root, "reset-ran"))).toBe(true);

  const broken = project(withReset("echo seed is missing >&2; exit 3"));
  const c = await connect(broken);
  const refused = await c.call("session_start", { scenarios: [SIGN_IN] });
  expect(refused.isError).toBe(true);
  expect(c.text(refused)).toMatch(/app\.reset failed \(exit 3\): echo seed is missing[\s\S]*seed is missing/);
  expect(existsSync(join(broken, ".jeyna", "playtests"))).toBe(false);
});

test("POST /__reset returns the sample app to its seeded state: sessions, todos and passwords (D31)", async () => {
  const signIn = async () => {
    const r = await fetch(`${APP}/login`, { method: "POST", body: new URLSearchParams({ email: "user_a@example.test", password: "correct-horse-a" }), redirect: "manual" });
    expect(r.status).toBe(303);
    return r.headers.get("set-cookie")!.split(";")[0];
  };
  const cookie = await signIn();
  await fetch(`${APP}/todos`, { method: "POST", headers: { cookie }, body: new URLSearchParams({ title: "Leftover", priority: "High" }), redirect: "manual" });
  expect(await (await fetch(`${APP}/todos`, { headers: { cookie } })).text()).toContain("Leftover");

  expect((await fetch(`${APP}/__reset`, { method: "POST" })).status).toBe(204);
  expect((await fetch(`${APP}/todos`, { headers: { cookie }, redirect: "manual" })).status).toBe(303); // the session is gone
  expect(await (await fetch(`${APP}/todos`, { headers: { cookie: await signIn() } })).text()).not.toContain("Leftover");
});

test("goto, click, press and snapshot carry the app's console since the case's last call: page errors, console errors, 4xx/5xx and failed requests (D31)", async () => {
  const { call, text, runDir } = await started();
  const page = (html: string) => `data:text/html,${encodeURIComponent(html)}`;
  const r = await call("goto", { case: "t1-1440x900", url: page(`<script>console.error("boom"); throw new Error("bang")</script>`) });
  expect(r.isError, text(r)).toBeFalsy();
  expect(JSON.parse(text(r)).console).toEqual(["console error: boom", "page error: bang"]);
  // A 4xx response, once: Chrome's own "Failed to load resource" console line for it is dropped.
  expect(JSON.parse(text(await call("goto", { case: "t1-1440x900", path: "/nope" }))).console).toEqual([`GET ${APP}/nope 404`]);
  // Drained: the next call carries nothing, and a quiet page has no console key at all.
  const quiet = JSON.parse(text(await call("goto", { case: "t1-1440x900", path: "/login" })));
  expect(quiet.console).toBeUndefined();
  expect(text(await call("snapshot", { case: "t1-1440x900" }))).not.toContain("Console since");
  // A failed request lands in the snapshot's tail, so the tester sees it where it reads the page.
  await call("goto", { case: "t1-1440x900", url: page(`<script>fetch("http://localhost:1/x").catch(() => {})</script>`) });
  await new Promise((r) => setTimeout(r, 500));
  const snap = text(await call("snapshot", { case: "t1-1440x900" }));
  expect(snap).toMatch(/Console since your last call:\n- GET http:\/\/localhost:1\/x failed: /);
  // The run's server.log records each call with how many console lines its result carried (D33).
  const serverLog = readFileSync(join(runDir, "server.log"), "utf8");
  expect(serverLog).toMatch(/^\S+ call \d+ goto t1-1440x900 start\n\S+ call \d+ goto t1-1440x900 end \d+ms console=2$/m);
  expect(serverLog).toMatch(/ call \d+ snapshot t1-1440x900 end \d+ms console$/m);
  expect(serverLog).toMatch(/ call \d+ goto t1-1440x900 end \d+ms$/m); // the quiet /login
});
