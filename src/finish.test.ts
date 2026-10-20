// validate, session_finish, report.md and update_status, driven over MCP stdio and from a shell, against the committed bundle.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeAll, expect, test } from "vitest";

let bundle: string;
const clients: Client[] = [];

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jeyna-bundle-"));
  cpSync("plugin/server", dir, { recursive: true });
  bundle = join(dir, "jeyna-mcp.mjs");
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

// No app runs here: these tests never open a browser, so the url is never fetched.
const CONFIG = `
app: { name: todo-sample, url: http://localhost:9 }
viewports: [1440x900, 390x844]
accounts:
  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }
`;

type Result = { isError?: boolean; content: { type: "text"; text: string }[] };

const SIGN_IN = { name: "Sign in", description: "Sign in from the login page.", pass: "The todo list shows." };
const LANDING = { name: "Landing", description: "Open the home page.", pass: "The landing page shows.", account: "none" };
const A11Y = {
  title: "Password field has no label",
  kind: "a11y",
  severity: "major",
  route: "/login",
  steps: ["Open /login", "Read the accessibility snapshot"],
  expected: "The password field is announced as Password.",
  actual: "The snapshot shows a nameless textbox after Email.",
};

async function started(scenarios: unknown[] = [SIGN_IN]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jeyna-project-")));
  mkdirSync(join(root, ".jeyna"));
  writeFileSync(join(root, ".jeyna", "jeyna.config.yaml"), CONFIG);
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await client.connect(new StdioClientTransport({ command: "node", args: [bundle, "--project", root], stderr: "ignore" }));
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;
  const text = (r: Result) => r.content[0].text;
  const run = JSON.parse(text(await call("session_start", { scenarios, slug: "login" })));
  // An evidence file the way screenshot names them, without needing a browser.
  writeFileSync(join(run.runDir, "evidence", "t1-390x844-1-login.png"), "png");
  return { root, call, text, runDir: run.runDir as string };
}

const sessionOf = (runDir: string) => JSON.parse(readFileSync(join(runDir, "session.json"), "utf8"));

test("session_finish with a missing verdict is refused with the error list and the run stays running", async () => {
  const { call, text, runDir } = await started();
  await call("scenario_verdict", { case: "t1-1440x900", result: "pass" });
  const r = await call("session_finish", { summary: "Done." });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/^session\.json: case t1-390x844 has no verdict$/m);
  expect(sessionOf(runDir).status).toBe("running");
  expect(existsSync(join(runDir, "report.md"))).toBe(false);
});

const BUG = { ...A11Y, title: "Sign in accepts an empty password", kind: "bug", severity: "critical", evidence: ["t1-390x844-1-login.png"] };
const UX = { ...A11Y, title: "Error message disappears too fast", kind: "ux", severity: "minor" };

// Two scenarios, four cases, three findings: a full run ready to finish.
async function recorded() {
  const s = await started([SIGN_IN, LANDING]);
  const id = async (c: string, finding: unknown) => JSON.parse(s.text(await s.call("record_finding", { case: c, finding }))).id as string;
  const ux = await id("t1-1440x900", UX);
  const a11y = await id("t1-390x844", A11Y);
  const bug = await id("t1-390x844", BUG);
  await s.call("scenario_verdict", { case: "t1-1440x900", result: "pass", findings: [ux] });
  await s.call("scenario_verdict", { case: "t1-390x844", result: "fail", findings: [bug, a11y] });
  await s.call("scenario_verdict", { case: "t2-1440x900", result: "pass" });
  await s.call("scenario_verdict", { case: "t2-390x844", result: "blocked", note: "home | page down" });
  return { ...s, ids: { ux, a11y, bug } };
}

test("session_finish writes report.md with counts, a verdict in every matrix cell, findings by severity then kind; the run is done (AC6)", async () => {
  const { call, text, runDir, ids } = await recorded();
  const r = await call("session_finish", { summary: "Sign in is broken on mobile." });
  expect(r.isError).toBeFalsy();
  const out = JSON.parse(text(r));
  expect(out.reportPath).toBe(join(runDir, "report.md"));
  expect(out.counts).toEqual({ cases: 4, pass: 2, fail: 1, blocked: 1, skipped: 0, findings: 3, critical: 1, major: 1, minor: 1, note: 0, duplicate: 0 });
  expect(sessionOf(runDir)).toMatchObject({ status: "done", summary: "Sign in is broken on mobile.", finished: expect.any(String) });
  const { started, finished, testers } = sessionOf(runDir);
  expect(out.elapsedSeconds).toBe(Math.round((Date.parse(finished) - Date.parse(started)) / 1000));
  expect(out.testers).toBe(testers.length);

  const md = readFileSync(out.reportPath, "utf8");
  expect(md).toMatch(/^## Summary\n\nSign in is broken on mobile\.$/m);
  expect(md).toContain(`- **Elapsed:** ${out.elapsedSeconds} s\n- **Testers:** ${out.testers}\n`);
  expect(md).toContain("| Scenario | 1440x900 | 390x844 |");
  expect(md).toContain(`| Sign in | pass [${ids.ux}](findings/${ids.ux}.md) | fail [${ids.bug}](findings/${ids.bug}.md) [${ids.a11y}](findings/${ids.a11y}.md) |`);
  expect(md).toContain("| Landing | pass | blocked (home \\| page down) |");
  const order = [ids.bug, ids.a11y, ids.ux].map((id) => md.indexOf(`| [${id}](findings/${id}.md) |`));
  expect(order[0]).toBeGreaterThan(0);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(md).toContain(`| critical | bug | [${ids.bug}](findings/${ids.bug}.md) | Sign in accepts an empty password | Sign in | 390x844 | open |`);
  expect(md).not.toMatch(/<[a-z]/i); // plain markdown, no HTML (AC7)
  cpSync(runDir, join(tmpdir(), "jeyna-ac7-run"), { recursive: true }); // kept for reading in a markdown viewer (AC7)

  expect(JSON.parse(text(await call("validate"))).errors).toEqual([]);
  const again = await call("session_finish", { summary: "x" });
  expect(again.isError).toBe(true);
  expect(text(again)).toMatch(/session_start/);
});

test("update_status to duplicate without of is refused; with of it sets status and of, and the report counts it as a duplicate", async () => {
  const { call, text, runDir, ids } = await recorded();
  const r = await call("update_status", { id: ids.a11y, status: "duplicate" });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/needs of/);
  expect(readFileSync(join(runDir, "findings", `${ids.a11y}.md`), "utf8")).toMatch(/^status: open$/m);

  expect((await call("update_status", { id: ids.a11y, status: "duplicate", of: "PT-login-099" })).isError).toBe(true);
  const ok = await call("update_status", { id: ids.a11y, status: "duplicate", of: ids.ux, note: "same label bug" });
  expect(ok.isError).toBeFalsy();
  const md = readFileSync(join(runDir, "findings", `${ids.a11y}.md`), "utf8");
  expect(md).toMatch(new RegExp(`^status: duplicate\\nof: ${ids.ux}\\nnote: same label bug\\nflow:`, "m"));
  expect(md).toMatch(/^## Suggested next step$/m);

  const out = JSON.parse(text(await call("session_finish", { summary: "Done." })));
  expect(out.counts).toMatchObject({ findings: 2, major: 0, duplicate: 1 });
  expect(readFileSync(out.reportPath, "utf8")).toContain(`| duplicate of [${ids.ux}](findings/${ids.ux}.md) |`);
});

test("after the run, wontfix and fixed can be set on its findings", async () => {
  const { call, runDir, ids } = await recorded();
  await call("session_finish", { summary: "Done." });
  expect((await call("update_status", { id: ids.ux, status: "wontfix", note: "by design" })).isError).toBeFalsy();
  expect((await call("update_status", { id: ids.bug, status: "fixed" })).isError).toBeFalsy();
  expect(readFileSync(join(runDir, "findings", `${ids.ux}.md`), "utf8")).toMatch(/^status: wontfix\nnote: by design$/m);
  expect(readFileSync(join(runDir, "findings", `${ids.bug}.md`), "utf8")).toMatch(/^status: fixed$/m);
  expect((await call("update_status", { id: "PT-login-099", status: "fixed" })).isError).toBe(true);
});

// Finding ids restart in every run of a flow, so after the run an id alone can be ambiguous (D30).
test("with no run running, update_status refuses an id two runs hold and lists them; run picks one", async () => {
  const { root, call, text, runDir, ids } = await recorded();
  await call("session_finish", { summary: "Done." });
  const first = sessionOf(runDir);
  const secondId = `${first.id}-2`;
  const second = join(root, ".jeyna", "playtests", secondId);
  cpSync(runDir, second, { recursive: true });
  writeFileSync(join(second, "session.json"), JSON.stringify({ ...first, id: secondId, started: new Date(Date.parse(first.started) + 1000).toISOString() }));

  const r = await call("update_status", { id: ids.ux, status: "wontfix" });
  expect(r.isError).toBe(true);
  expect(text(r)).toBe(`2 runs hold a finding ${ids.ux}: ${secondId}, ${first.id} (newest first). Call update_status again with run set to one of them.`);
  for (const d of [runDir, second]) expect(readFileSync(join(d, "findings", `${ids.ux}.md`), "utf8")).toMatch(/^status: open$/m);

  expect((await call("update_status", { id: ids.ux, status: "wontfix", run: first.id })).isError).toBeFalsy();
  expect(readFileSync(join(runDir, "findings", `${ids.ux}.md`), "utf8")).toMatch(/^status: wontfix$/m);
  expect(readFileSync(join(second, "findings", `${ids.ux}.md`), "utf8")).toMatch(/^status: open$/m);

  expect(text(await call("update_status", { id: "PT-login-099", status: "fixed", run: secondId }))).toBe(`No finding PT-login-099 in run ${secondId}.`);
  const outside = await call("update_status", { id: ids.ux, status: "fixed", run: "../.." });
  expect(outside.isError).toBe(true);
  expect(text(outside)).toMatch(/^run must be a run id under \.jeyna\/playtests\//);
});

test("validate refuses a run outside .jeyna/playtests/", async () => {
  const { call, text } = await started();
  for (const run of ["..", "../../..", "/etc", "x/../../flows"]) {
    const r = await call("validate", { run });
    expect(r.isError, run).toBe(true);
    expect(text(r)).toMatch(/^run must be a run id under \.jeyna\/playtests\//);
  }
});

test("validate reports broken findings, missing evidence and a missing report, one path: message each", async () => {
  const { call, text, runDir, ids } = await recorded();
  const file = (id: string) => join(runDir, "findings", `${id}.md`);
  writeFileSync(file(ids.ux), readFileSync(file(ids.ux), "utf8").replace("## Expected", "## Expectation"));
  writeFileSync(file(ids.a11y), readFileSync(file(ids.a11y), "utf8").replace("severity: major", "severity: huge"));
  rmSync(join(runDir, "evidence", "t1-390x844-1-login.png"));
  writeFileSync(join(runDir, "findings", "PT-login-009.md"), "# no frontmatter\n");
  const { errors } = JSON.parse(text(await call("validate", { run: sessionOf(runDir).id })));
  expect(errors).toEqual([
    `findings/${ids.ux}.md: missing the ## Expected section`,
    expect.stringMatching(new RegExp(`^findings/${ids.a11y}\\.md: frontmatter severity: .*critical`)),
    `findings/${ids.bug}.md: evidence t1-390x844-1-login.png does not exist in evidence/`,
    "findings/PT-login-009.md: no YAML frontmatter between --- lines",
  ]);
  writeFileSync(join(runDir, "session.json"), JSON.stringify({ ...sessionOf(runDir), status: "done" }));
  expect(JSON.parse(text(await call("validate"))).errors).toContain("report.md: missing, but the run is done");
});

test("a bug finding edited to have no evidence fails validate", async () => {
  const { call, text, runDir, ids } = await recorded();
  const f = join(runDir, "findings", `${ids.bug}.md`);
  writeFileSync(f, readFileSync(f, "utf8").replace("evidence:\n  - t1-390x844-1-login.png", "evidence: []"));
  expect(JSON.parse(text(await call("validate"))).errors).toEqual([`findings/${ids.bug}.md: a bug needs evidence`]);
});

const shell = (args: string[], cwd: string) => {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync("node", [bundle, ...args], { cwd, encoding: "utf8", env });
};

test("validate runs from a shell via the bundle: one path: message line per error and exit 1, exit 0 when clean", async () => {
  const { root, call, runDir } = await started();
  const rel = runDir.slice(root.length + 1);
  const bad = shell(["validate", runDir], root);
  expect(bad.status).toBe(1);
  expect(bad.stdout).toBe(`${rel}/session.json: case t1-1440x900 has no verdict\n${rel}/session.json: case t1-390x844 has no verdict\n`);
  for (const c of ["t1-1440x900", "t1-390x844"]) await call("scenario_verdict", { case: c, result: "pass" });
  await call("session_finish", { summary: "Done." });
  const good = shell(["validate"], root); // no argument: the latest run of the project found from cwd
  expect(good.stdout).toBe("");
  expect(good.stderr).toContain(`ok: ${runDir}`);
  expect(good.status).toBe(0);
  rmSync(join(runDir, "report.md"));
  const gone = shell(["validate", rel], root);
  expect(gone.status).toBe(1);
  expect(gone.stdout).toBe(`${rel}/report.md: missing, but the run is done\n`);
}, 20_000); // three bundle starts from a shell: slow when test files run in parallel

test("report.md compares verdicts with the latest done run of the same flow, and session_finish returns the changes (D31)", async () => {
  const s = await started([SIGN_IN]);
  await s.call("scenario_verdict", { case: "t1-1440x900", result: "pass" });
  await s.call("scenario_verdict", { case: "t1-390x844", result: "pass" });
  const first = JSON.parse(s.text(await s.call("session_finish", { summary: "First." })));
  expect(first.since).toBeNull();
  expect(readFileSync(first.reportPath, "utf8")).toContain("## Since last run\n\nNo earlier done run of this flow.");

  const run2 = JSON.parse(s.text(await s.call("session_start", { scenarios: [SIGN_IN], slug: "login" })));
  writeFileSync(join(run2.runDir, "evidence", "t1-390x844-1-login.png"), "png");
  const bug = JSON.parse(s.text(await s.call("record_finding", { case: "t1-390x844", finding: BUG }))).id;
  await s.call("scenario_verdict", { case: "t1-1440x900", result: "pass" });
  await s.call("scenario_verdict", { case: "t1-390x844", result: "fail", findings: [bug] });
  const second = JSON.parse(s.text(await s.call("session_finish", { summary: "Second." })));
  const firstId = basename(s.runDir);
  expect(second.since).toEqual({ run: firstId, compared: 2, changed: [{ scenario: "Sign in", viewport: "390x844", was: "pass", now: "fail" }] });
  const md = readFileSync(second.reportPath, "utf8");
  expect(md).toContain(`## Since last run\n\nCompared with ${firstId}: 2 cases in both runs, 1 changed.\n\n| Scenario | Viewport | Was | Now |\n|---|---|---|---|\n| Sign in | 390x844 | pass | fail |`);
});

test("update_status sets a feedback item's status; finding-only statuses and arguments are refused for it (D36)", async () => {
  const { root, call, text } = await started();
  mkdirSync(join(root, ".jeyna", "feedback"));
  writeFileSync(join(root, ".jeyna", "feedback", "FB-001.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
  writeFileSync(join(root, ".jeyna", "feedback", "FB-001.md"), "---\nschema: 1\nid: FB-001\nstatus: open\ncapture: snap\nframes:\n  - file: FB-001.png\n    ms: 0\nsource: live\ncreated: 2026-10-20T10:00:00.000Z\n---\n\nBigger button\n");
  expect(JSON.parse(text(await call("update_status", { id: "FB-001", status: "processed", note: "44 px" })))).toEqual({ id: "FB-001", status: "processed", path: ".jeyna/feedback/FB-001.md" });
  expect(readFileSync(join(root, ".jeyna", "feedback", "FB-001.md"), "utf8")).toMatch(/^status: processed\nnote: 44 px$/m);
  expect(text(await call("update_status", { id: "FB-001", status: "fixed" }))).toBe("A feedback item's status is one of open, processed, done, wontfix, not fixed.");
  expect(text(await call("update_status", { id: "PT-login-001", status: "processed" }))).toBe("A finding's status is one of open, duplicate, wontfix, fixed, not processed.");
  expect((await call("update_status", { id: "FB-001", status: "done", run: "x" })).isError).toBe(true);
  expect(text(await call("update_status", { id: "FB-002", status: "done" }))).toBe("No feedback FB-002 under .jeyna/feedback/.");
});
