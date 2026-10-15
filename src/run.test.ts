// Drives the committed bundle (copied away from node_modules) over MCP stdio against the sample app.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

test("viewports narrows the cases and unknown names are refused with the valid ones", async () => {
  const { call, text } = await connect(project());
  const bad = await call("session_start", { scenarios: [SIGN_IN], viewports: ["800x600"] });
  expect(bad.isError).toBe(true);
  expect(text(bad)).toMatch(/1440x900, 390x844/);
  const ok = JSON.parse(text(await call("session_start", { scenarios: [SIGN_IN], viewports: ["390x844"] })));
  expect(ok.testers[0].cases).toEqual([{ id: "t1-390x844", viewport: "390x844" }]);
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
const browserPids = (serverPid: number) =>
  execFileSync("ps", ["-o", "pid=,args=", "--ppid", String(serverPid)], { encoding: "utf8" })
    .split("\n")
    .filter((l) => /chrom/i.test(l))
    .map((l) => Number(l.trim().split(/\s+/)[0]));

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

test("snapshot truncates above 90,000 characters with a note", async () => {
  const { call, text } = await started();
  const big = "<p>" + "a fairly long paragraph of filler text for the snapshot ".repeat(3) + "</p>";
  await call("goto", { case: "t1-1440x900", url: "data:text/html," + encodeURIComponent(big.repeat(1000)) });
  const snap = text(await call("snapshot", { case: "t1-1440x900" }));
  expect(snap.length).toBeLessThan(90_200);
  expect(snap).toMatch(/truncated at 90000 characters, the page continues/);
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

test("with Chrome forced to fail and no Playwright Chromium, the error names npx playwright install chromium (P4)", async () => {
  const empty = mkdtempSync(join(tmpdir(), "jeyna-no-browsers-"));
  const { call, text } = await started({ JEYNA_BROWSER_CHANNEL: "chrome-does-not-exist", PLAYWRIGHT_BROWSERS_PATH: empty });
  const r = await call("goto", { case: "t1-390x844", path: "/" });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/npx playwright install chromium/);
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

test("fail needs a finding of that case; findings of another case or unknown ids are refused", async () => {
  const { call, text, runDir } = await started();
  const none = await call("scenario_verdict", { case: "t1-390x844", result: "fail" });
  expect(none.isError).toBe(true);
  expect(text(none)).toMatch(/record_finding/);
  const id = JSON.parse(text(await call("record_finding", { case: "t1-1440x900", finding: A11Y }))).id;
  const other = await call("scenario_verdict", { case: "t1-390x844", result: "fail", findings: [id] });
  expect(other.isError).toBe(true);
  expect(text(other)).toMatch(id);
  expect((await call("scenario_verdict", { case: "t1-390x844", result: "pass", findings: ["PT-nope-001"] })).isError).toBe(true);
  expect((await call("scenario_verdict", { case: "t1-1440x900", result: "fail", findings: [id] })).isError).toBeFalsy();
  expect(sessionOf(runDir).verdicts).toEqual([{ case: "t1-1440x900", result: "fail", findings: [id] }]);
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
