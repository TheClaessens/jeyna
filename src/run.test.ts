// Drives the committed bundle (copied away from node_modules) over MCP stdio against the sample app.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";

const PORT = 4931;
const APP = `http://localhost:${PORT}`;
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
app: { name: todo-sample, url: ${APP} }
viewports: [1440x900, 390x844]
accounts:
  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }
`;

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jeyna-project-")));
  mkdirSync(join(root, ".jeyna"));
  writeFileSync(join(root, ".jeyna", "jeyna.config.yaml"), CONFIG);
  return root;
}

type Result = { isError?: boolean; content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] };

async function connect(root: string, env: Record<string, string> = {}) {
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({ command: "node", args: [bundle, "--project", root], env: { ...process.env, ...env } as Record<string, string>, stderr: "ignore" }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;
  const text = (r: Result) => (r.content[0] as { text: string }).text;
  return { call, text };
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
