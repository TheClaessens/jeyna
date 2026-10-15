// click, fill, press and redaction (D9), driving the committed bundle over MCP stdio against the sample app.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, beforeAll, expect, test } from "vitest";

const PORT = 4932;
const APP = `http://localhost:${PORT}`;
let bundle: string;
let app: ChildProcess;
const clients: Client[] = [];

// Credentials from sample-app/.env.example. user_a comes from the server's env, user_b from .jeyna/.env.
const A = { user: "user_a@example.test", pass: "correct-horse-a" };
const B = { user: "user_b@example.test", pass: "correct-horse-b" };
const ENV_A = { JEYNA_USER_A_USER: A.user, JEYNA_USER_A_PASS: A.pass };

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "jeyna-bundle-"));
  cpSync("plugin/server", dir, { recursive: true });
  bundle = join(dir, "jeyna-mcp.mjs");
});
// A fresh app per test: its state (passwords, lockouts, todos) is in memory.
beforeEach(async () => {
  app = spawn("node", ["sample-app/server.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  await new Promise((r) => app.stdout!.once("data", r));
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  app.kill();
  await new Promise((r) => app.once("exit", r));
});
afterAll(() => app?.kill());

const CONFIG = `
app: { name: todo-sample, url: ${APP} }
viewports: [1440x900]
accounts:
  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }
  - { handle: user_b, user_env: JEYNA_USER_B_USER, pass_env: JEYNA_USER_B_PASS }
`;

type Result = { isError?: boolean; content: ({ type: "text"; text: string } | { type: "image"; data: string })[] };

async function start(env: Record<string, string> = ENV_A, scenarios = [SIGN_IN]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jeyna-project-")));
  mkdirSync(join(root, ".jeyna"));
  writeFileSync(join(root, ".jeyna", "jeyna.config.yaml"), CONFIG);
  writeFileSync(join(root, ".jeyna", ".env"), `JEYNA_USER_B_USER=${B.user}\nJEYNA_USER_B_PASS=${B.pass}\n`);
  const clean = { ...process.env } as Record<string, string>;
  for (const k of Object.keys(clean)) if (k.startsWith("JEYNA_USER_")) delete clean[k];
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({ command: "node", args: [bundle, "--project", root], env: { ...clean, ...env }, stderr: "ignore" }),
  );
  const seen: string[] = []; // every text the server returned, as the transcript would hold it
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    for (const c of r.content) if (c.type === "text") seen.push(c.text);
    return r;
  };
  const text = (r: Result) => (r.content[0] as { text: string }).text;
  const run = JSON.parse(text(await call("session_start", { scenarios })));
  return { root, call, text, seen, run };
}

const SIGN_IN = { name: "Sign in", description: "Sign in from the login page.", pass: "The todo list shows." };
const CASE = "t1-1440x900";

test("fill substitutes the case's account placeholders server-side and the snapshot shows placeholders, not values", async () => {
  const { call, text } = await start();
  await call("goto", { case: CASE, path: "/login" });
  const r = await call("fill", { case: CASE, selector: "#email", value: "{{account.user}}" });
  expect(r.isError).toBeFalsy();
  const snap = text(await call("snapshot", { case: CASE }));
  expect(snap).toMatch(/textbox "Email": \{\{account\.user\}\}/);
  expect(snap).not.toContain(A.user);
});

test("a missing account variable makes fill fail with 'account <handle> not configured'", async () => {
  const { call, text } = await start({ JEYNA_USER_A_USER: A.user });
  await call("goto", { case: CASE, path: "/login" });
  const r = await call("fill", { case: CASE, selector: "#email", value: "{{account.user}}" });
  expect(r.isError).toBe(true);
  expect(text(r)).toBe("account user_a not configured");
});

test("fill on a <select> chooses the option by label", async () => {
  const { call, text } = await start();
  const html = "<label>Priority <select id=p><option value=low>Low</option><option value=high>High</option></select></label>";
  await call("goto", { case: CASE, url: "data:text/html," + encodeURIComponent(html) });
  expect((await call("fill", { case: CASE, selector: "#p", value: "High" })).isError).toBeFalsy();
  expect(text(await call("snapshot", { case: CASE }))).toMatch(/option "High" \[selected\]/);
});

test("a click that misses lists the nearest candidates from the aria tree", async () => {
  const { call, text } = await start();
  await call("goto", { case: CASE, path: "/login" });
  const r = await call("click", { case: CASE, selector: "text=Sign on" });
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/Nearest candidates:\n- role=button\[name="Sign in"\]/);
  const hit = await call("click", { case: CASE, selector: 'role=link[name="Forgot password?"]' });
  expect(JSON.parse(text(hit)).url).toBe(`${APP}/reset`);
}, 15_000);

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));

// Every way a value could show up in text: as typed, URL-encoded, form-encoded, upper-cased.
const forms = (v: string) => [v, encodeURIComponent(v), new URLSearchParams({ v }).toString().slice(2)].flatMap((f) => [f, f.toUpperCase()]);

test("AC3: a scripted run over the seeded bugs leaks no account value into any tool result or text under .jeyna/", async () => {
  const { root, call, text, seen } = await start(ENV_A, [SIGN_IN, { ...SIGN_IN, name: "Reset password" }]);
  const [ta, tb] = ["t1-1440x900", "t2-1440x900"];
  const signIn = async (c: string, pass: string) => {
    await call("goto", { case: c, path: "/login" });
    await call("fill", { case: c, selector: "#email", value: "{{account.user}}" });
    await call("fill", { case: c, selector: "input[type=password]", value: pass });
    await call("snapshot", { case: c }); // the email field's value, read back
    return JSON.parse(text(await call("click", { case: c, selector: 'role=button[name="Sign in"]' })));
  };
  const signOut = (c: string) => call("click", { case: c, selector: 'role=button[name="Sign out"]' });

  // Bug 6: a wrong password echoes the username; the tester reads it as the placeholder.
  await signIn(ta, "not-the-password");
  const echoed = text(await call("snapshot", { case: ta }));
  expect(echoed).toContain("Wrong password for {{account.user}}.");
  // Typed values and miss errors go through the same exit point.
  await call("click", { case: ta, selector: `text=${A.user}` });
  await call("fill", { case: ta, selector: "#nope", value: "{{account.pass}}" });

  // Bug 4: the chosen priority is dropped on save.
  expect((await signIn(ta, "{{account.pass}}")).url).toBe(`${APP}/todos`);
  await call("fill", { case: ta, selector: "#title", value: "Buy milk" });
  await call("fill", { case: ta, selector: "#priority", value: "High" });
  await call("click", { case: ta, selector: 'role=button[name="Add"]' });
  expect(text(await call("snapshot", { case: ta }))).toMatch(/Buy milk · Normal priority/);
  await call("click", { case: ta, selector: 'role=button[name="Complete Buy milk"]' });
  await call("click", { case: ta, selector: 'role=button[name="Delete Buy milk"]' });
  await call("screenshot", { case: ta, look: true });

  // Bug 1: after a reset (user_b, from .jeyna/.env) the old password still works.
  await call("goto", { case: tb, path: "/reset" });
  await call("fill", { case: tb, selector: "#email", value: "{{account.user}}" });
  await call("fill", { case: tb, selector: "#password", value: "{{account.pass}}-2" });
  await call("click", { case: tb, selector: 'role=button[name="Reset password"]' });
  expect((await signIn(tb, "{{account.pass}}")).url).toBe(`${APP}/todos`);
  await signOut(tb);

  // Bug 5: three wrong passwords lock the account, and signing in with the new password stays locked.
  for (let i = 0; i < 3; i++) await signIn(tb, "wrong");
  expect((await signIn(tb, "{{account.pass}}-2")).url).toBe(`${APP}/login`);
  expect(text(await call("snapshot", { case: tb }))).toMatch(/locked after 3 wrong passwords/);
  await call("screenshot", { case: tb, label: "locked" });

  const secrets = [A.user, A.pass, B.user, B.pass].flatMap(forms);
  for (const t of seen) for (const s of secrets) expect(t).not.toContain(s);

  // .jeyna/.env is the secrets source itself (D18), so it is the one file allowed to hold them.
  const files = filesUnder(join(root, ".jeyna")).filter((f) => !f.endsWith(".jeyna/.env"));
  expect(files.some((f) => f.endsWith(".png"))).toBe(true);
  for (const f of files) {
    // Pixels may show a username (D9); a PNG is only checked for passwords, its text for everything.
    const body = readFileSync(f, f.endsWith(".png") ? "latin1" : "utf8");
    for (const s of f.endsWith(".png") ? [A.pass, B.pass] : secrets) expect(body, f).not.toContain(s);
  }
}, 60_000);

test("press sends a key to the focused element", async () => {
  const { call, text } = await start();
  await call("goto", { case: CASE, path: "/login" });
  await call("fill", { case: CASE, selector: "#email", value: "{{account.user}}" });
  await call("fill", { case: CASE, selector: "input[type=password]", value: "{{account.pass}}" });
  const r = await call("press", { case: CASE, key: "Enter" });
  expect(JSON.parse(text(r))).toEqual({ url: `${APP}/todos`, title: "Todos · Todo sample" });
});
