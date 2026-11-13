// app.new_account (D41): an account created per tester, driven over MCP stdio against the committed bundle and the sample app.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { type App, startApp } from "./testkit.js";

let bundle: string;
let app: App;
const clients: Client[] = [];

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "jeyna-bundle-"));
  cpSync("plugin/server", dir, { recursive: true });
  bundle = join(dir, "jeyna-mcp.mjs");
  app = await startApp();
});
afterAll(() => app.stop());
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

type Result = { isError?: boolean; content: ({ type: "text"; text: string } | { type: "image"; data: string })[] };

// A project whose config sets app.new_account to `command`, plus any extra config lines.
async function start(command: string, extra = "") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jeyna-project-")));
  mkdirSync(join(root, ".jeyna"));
  writeFileSync(join(root, ".jeyna", "jeyna.config.yaml"), `app: { name: todo-sample, url: ${app.url}, new_account: ${JSON.stringify(command)} }\nviewports: [1440x900, 390x844]\n${extra}`);
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await client.connect(new StdioClientTransport({ command: "node", args: [bundle, "--project", root], env: { ...process.env } as Record<string, string>, stderr: "ignore" }));
  const seen: string[] = []; // every text the server returned, as the transcript would hold it
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    for (const c of r.content) if (c.type === "text") seen.push(c.text);
    return r;
  };
  const text = (r: Result) => (r.content[0] as { text: string }).text;
  const must = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    expect(r.isError, `${name}: ${text(r)}`).toBeFalsy();
    return r;
  };
  return { root, call, text, must, seen };
}

// A folder outside the project where the test's command notes what it was given and what it printed.
const notes = () => realpathSync(mkdtempSync(join(tmpdir(), "jeyna-notes-")));
const SIGN_IN = { name: "Sign in", description: "Sign in from the login page.", pass: "The todo list shows." };

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
const forms = (v: string) => [v, encodeURIComponent(v), new URLSearchParams({ v }).toString().slice(2)].flatMap((f) => [f, f.toUpperCase()]);

test("each tester that signs in gets its own created account; no created value reaches a tool result or a file under .jeyna/ (AC3)", async () => {
  const dir = notes();
  const command = `echo "$JEYNA_ACCOUNT $JEYNA_RUN" >> ${dir}/calls; curl -fsS -X POST ${app.url}/__account | tee -a ${dir}/created`;
  const { root, call, text, must, seen } = await start(command);
  const signIn = async (c: string, pass = "{{account.pass}}") => {
    await must("goto", { case: c, path: "/login" });
    await must("fill", { case: c, selector: "#email", value: "{{account.user}}" });
    await must("fill", { case: c, selector: "input[type=password]", value: pass });
    return JSON.parse(text(await must("click", { case: c, selector: 'role=button[name="Sign in"]' }))).url;
  };

  // The scout has no configured account, so its first placeholder creates one.
  expect(await signIn("scout")).toBe(`${app.url}/todos`);

  const run = JSON.parse(text(await must("session_start", { scenarios: [SIGN_IN, { ...SIGN_IN, name: "Again" }, { ...SIGN_IN, name: "Landing", account: "none" }], slug: "login" })));
  expect(run.testers.map((t: { id: string; account?: string; batch: number }) => [t.id, t.account, t.batch])).toEqual([["t1", "new", 1], ["t2", "new", 1], ["t3", undefined, 1]]);
  const session = JSON.parse(readFileSync(join(run.runDir, "session.json"), "utf8"));
  expect(session.testers.map((t: { account?: string }) => t.account)).toEqual(["new", "new", undefined]);
  expect(readFileSync(join(dir, "calls"), "utf8").trim().split("\n")).toEqual([expect.stringMatching(/^scout scout-\d+$/), `t1 ${run.id}`, `t2 ${run.id}`]);
  expect(text(await must("brief", { case: "t1-390x844" }))).toContain("\nAccount: a new account, made for you alone. Sign in with {{account.user}} and {{account.pass}}.\n");

  // A wrong password echoes the username (seeded bug 6): the tester reads the placeholder.
  for (const c of ["t1-1440x900", "t2-1440x900"]) {
    expect(await signIn(c, "wrong")).toBe(`${app.url}/login`);
    expect(text(await must("snapshot", { case: c }))).toContain("Wrong password for {{account.user}}.");
    expect(await signIn(c)).toBe(`${app.url}/todos`);
    await must("screenshot", { case: c, look: true });
  }
  expect(await signIn("t1-390x844")).toBe(`${app.url}/todos`); // a tester's cases share its one account
  for (const c of run.testers.flatMap((t: { cases: { id: string }[] }) => t.cases.map((x) => x.id))) await must("scenario_verdict", { case: c, result: "pass" });
  await must("session_finish", { summary: "Every tester signed in with its own account." });

  const created = readFileSync(join(dir, "created"), "utf8").trim().split(/\n(?=JEYNA_USER=)/).map((block) => parseEnv(block));
  const users = created.map((c) => c.JEYNA_USER!);
  expect(new Set(users).size).toBe(3);
  // Created values stay redacted after the run ends: an unknown `only` name echoes any text through the exit point.
  for (const u of users) expect(text(await call("session_start", { scenarios: [SIGN_IN], only: [u] }))).toBe("Unknown scenarios: {{account.user}}. Scenarios given: Sign in.");

  const secrets = created.flatMap((c) => [c.JEYNA_USER!, c.JEYNA_PASS!]).flatMap(forms);
  for (const t of seen) for (const s of secrets) expect(t).not.toContain(s);
  const files = filesUnder(join(root, ".jeyna"));
  expect(files.some((f) => f.endsWith(".png"))).toBe(true);
  for (const f of files) {
    const body = readFileSync(f, f.endsWith(".png") ? "latin1" : "utf8");
    for (const s of f.endsWith(".png") ? created.map((c) => c.JEYNA_PASS!) : secrets) expect(body, f).not.toContain(s);
  }
}, 60_000);

test("a command that answers the same username twice, fails, or prints one line refuses the run and starts nothing", async () => {
  const runs = (root: string) => (existsSync(join(root, ".jeyna", "playtests")) ? readdirSync(join(root, ".jeyna", "playtests")) : []);
  const two = { scenarios: [SIGN_IN, { ...SIGN_IN, name: "Again" }] };

  const same = await start("printf 'JEYNA_USER=same@example.test\\nJEYNA_PASS=pw-same\\n'");
  const dupe = await same.call("session_start", two);
  expect(dupe.isError).toBe(true);
  expect(same.text(dupe)).toMatch(/same username.*must create a new user on every call/s);
  expect(same.text(dupe)).not.toMatch(/pw-same|same@example/);
  expect(runs(same.root)).toEqual([]);

  // The values on stdout are built by the shell, so the command line the refusal quotes does not hold them.
  // Its stderr echoes the username it printed: that is redacted too.
  const failing = await start("echo JEYNA_USER=u$JEYNA_ACCOUNT$JEYNA_ACCOUNT; echo JEYNA_PASS=p$JEYNA_ACCOUNT$JEYNA_ACCOUNT; echo \"no such table: users (u$JEYNA_ACCOUNT$JEYNA_ACCOUNT)\" >&2; exit 3");
  const failed = await failing.call("session_start", two);
  expect(failed.isError).toBe(true);
  expect(failing.text(failed)).toMatch(/app\.new_account failed \(exit 3\).*no such table: users \(\{\{account\.user\}\}\).*No run was started/s);
  expect(failing.text(failed)).not.toMatch(/t1t1/);
  expect(runs(failing.root)).toEqual([]);

  const half = await start("echo JEYNA_USER=only-user; echo done");
  const one = await half.call("session_start", two);
  expect(one.isError).toBe(true);
  expect(half.text(one)).toMatch(/JEYNA_USER=<username> and JEYNA_PASS=<password>/);
  expect(half.text(one)).not.toMatch(/only-user/);
  expect(runs(half.root)).toEqual([]);
});

test("a run that names accounts deals configured ones; tester.parallel bounds the batches; no account is created for them", async () => {
  const dir = notes();
  const pool = "accounts:\n  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }\ntester: { parallel: 2 }\n";
  const { json } = await start(`echo "$JEYNA_ACCOUNT" >> ${dir}/calls; curl -fsS -X POST ${app.url}/__account`, pool).then((s) => ({
    json: async (args: Record<string, unknown>) => JSON.parse(s.text(await s.must("session_start", args))),
  }));
  const named = await json({ scenarios: [SIGN_IN, { ...SIGN_IN, name: "Again" }], accounts: ["user_a"] });
  expect(named.testers.map((t: { account: string; batch: number }) => [t.account, t.batch])).toEqual([["user_a", 1], ["user_a", 2]]);
  expect(existsSync(join(dir, "calls"))).toBe(false);
  const created = await json({ scenarios: [SIGN_IN, { ...SIGN_IN, name: "Again" }, { ...SIGN_IN, name: "Third" }], force: true });
  expect(created.testers.map((t: { account: string; batch: number }) => [t.account, t.batch])).toEqual([["new", 1], ["new", 1], ["new", 2]]);
});

// At most 50 created accounts stay registered for redaction (src/accounts.ts). The command derives the values from
// JEYNA_RUN and JEYNA_ACCOUNT, so the test knows them; an unknown `only` name echoes any text through the exit point.
const DERIVED = 'printf "JEYNA_USER=u-$JEYNA_ACCOUNT-$JEYNA_RUN@example.test\\nJEYNA_PASS=p-$JEYNA_ACCOUNT-$JEYNA_RUN-secret\\n"';
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...SIGN_IN, name: `S${i + 1}` }));

test("at the limit, a new run's created accounts are redacted from the very next message", async () => {
  const { call, text, must } = await start(DERIVED);
  const echo = async (s: string) => text(await call("session_start", { scenarios: [SIGN_IN], only: [s] }));
  const first = JSON.parse(text(await must("session_start", { scenarios: many(50), viewports: ["390x844"] })));
  expect(await echo(`u-t50-${first.id}@example.test`)).toBe("Unknown scenarios: {{account.user}}. Scenarios given: Sign in.");
  // The list stays at 50 (one new, the oldest dropped), so only a change count, not its length, tells the cache to rebuild.
  const second = JSON.parse(text(await must("session_start", { scenarios: [SIGN_IN], force: true })));
  expect(second.testers[0].account).toBe("new");
  expect(await echo(`u-t51-${second.id}@example.test`)).toBe("Unknown scenarios: {{account.user}}. Scenarios given: Sign in.");
  expect(await echo(`p-t51-${second.id}-secret`)).toBe("Unknown scenarios: {{account.pass}}. Scenarios given: Sign in.");
  expect(await echo(`u-t50-${first.id}@example.test`)).toBe("Unknown scenarios: {{account.user}}. Scenarios given: Sign in.");
}, 30_000);

test("a run with more testers than the limit keeps every one of its own accounts redacted", async () => {
  const { call, text, must } = await start(DERIVED);
  const run = JSON.parse(text(await must("session_start", { scenarios: many(55), viewports: ["390x844"] })));
  for (const t of ["t1", "t30", "t55"]) {
    expect(text(await call("session_start", { scenarios: [SIGN_IN], only: [`u-${t}-${run.id}@example.test`] }))).toBe("Unknown scenarios: {{account.user}}. Scenarios given: Sign in.");
  }
}, 30_000);

test("new is a reserved handle: a configured account may not use it", async () => {
  const { call, text } = await start("true", "accounts:\n  - { handle: new, user_env: A_USER, pass_env: A_PASS }\n");
  const r = await call("get_context");
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/new is reserved/);
});
