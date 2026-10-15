// Drives the committed bundle over MCP stdio, copied to a folder with no node_modules (P1).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function project(config?: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jeyna-project-")));
  if (config !== undefined) {
    mkdirSync(join(root, ".jeyna"));
    writeFileSync(join(root, ".jeyna", "jeyna.config.yaml"), config);
  }
  return root;
}

async function getContext(opts: { args?: string[]; cwd?: string; env?: Record<string, string> } = {}) {
  const env = { ...process.env, ...opts.env } as Record<string, string>;
  if (!opts.env?.CLAUDE_PROJECT_DIR) delete env.CLAUDE_PROJECT_DIR;
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({ command: "node", args: [bundle, ...(opts.args ?? [])], cwd: opts.cwd, env, stderr: "ignore" }),
  );
  const result = (await client.callTool({ name: "get_context", arguments: {} })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  return { isError: result.isError ?? false, text: result.content[0].text, client };
}

const VALID = `
app:
  name: todo-sample
  url: http://localhost:4173
viewports: [1440x900, 390x844]
accounts:
  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }
`;

test("get_context returns the --project root and the validated config", async () => {
  const root = project(VALID);
  const r = await getContext({ args: ["--project", root] });
  expect(r.isError).toBe(false);
  expect(JSON.parse(r.text)).toEqual({
    root,
    config: {
      app: { name: "todo-sample", url: "http://localhost:4173" },
      viewports: ["1440x900", "390x844"],
      browser: { headed: false },
      tester: { model: "sonnet", effort: "medium" },
      accounts: [{ handle: "user_a", user_env: "JEYNA_USER_A_USER", pass_env: "JEYNA_USER_A_PASS" }],
    },
    secrets: { JEYNA_USER_A_USER: "missing", JEYNA_USER_A_PASS: "missing" },
    conventions: null,
    flows: [],
  });
});

test("an unexpanded --project falls back to CLAUDE_PROJECT_DIR", async () => {
  const root = project(VALID);
  const r = await getContext({ args: ["--project", "${CLAUDE_PROJECT_DIR}"], env: { CLAUDE_PROJECT_DIR: root } });
  expect(JSON.parse(r.text).root).toBe(root);
});

test("with no --project and no CLAUDE_PROJECT_DIR, the nearest .jeyna/ above the working directory is the root", async () => {
  const root = project(VALID);
  const sub = join(root, "src", "deep");
  mkdirSync(sub, { recursive: true });
  const r = await getContext({ cwd: sub });
  expect(JSON.parse(r.text).root).toBe(root);
});

test("with no root to be found, get_context says how to fix it", async () => {
  const r = await getContext({ cwd: project() });
  expect(r.isError).toBe(true);
  expect(r.text).toMatch(/could not find the project root/);
});

test("a project without a config is told to run /jeyna:init", async () => {
  const r = await getContext({ args: ["--project", project()] });
  expect(r.isError).toBe(true);
  expect(r.text).toMatch(/Run \/jeyna:init/);
});

test("an invalid config is reported field by field and the server keeps running", async () => {
  const root = project(`
app: { name: x, url: not-a-url }
viewports: [big]
acounts: []
`);
  const r = await getContext({ args: ["--project", root] });
  expect(r.isError).toBe(true);
  expect(r.text).toMatch(/app\.url/);
  expect(r.text).toMatch(/viewports\[0\]|viewports\.0/);
  expect(r.text).toMatch(/acounts/);
  const again = await r.client.callTool({ name: "get_context", arguments: {} });
  expect(again.isError).toBe(true);
});

test("broken YAML is reported, not a crash", async () => {
  const r = await getContext({ args: ["--project", project("app: [unclosed\n")] });
  expect(r.isError).toBe(true);
  expect(r.text).toMatch(/not valid YAML/);
});

test("get_context reports where each account variable was found, never its value (P3, D18)", async () => {
  const root = project(VALID);
  writeFileSync(join(root, ".jeyna", ".env"), "JEYNA_USER_A_USER=\nJEYNA_USER_A_PASS=from-dotenv-secret\n");
  const r = await getContext({
    args: ["--project", root],
    env: { JEYNA_USER_A_USER: "from-shell-secret", JEYNA_USER_A_PASS: "" },
  });
  expect(r.isError).toBe(false);
  expect(JSON.parse(r.text).secrets).toEqual({ JEYNA_USER_A_USER: "env", JEYNA_USER_A_PASS: ".env" });
  expect(r.text).not.toMatch(/from-shell|from-dotenv/);
});

test("an account variable in neither the environment nor .jeyna/.env is reported missing", async () => {
  const r = await getContext({ args: ["--project", project(VALID)] });
  expect(JSON.parse(r.text).secrets).toEqual({ JEYNA_USER_A_USER: "missing", JEYNA_USER_A_PASS: "missing" });
});

test("the /jeyna:init config template, filled in, is a config get_context accepts (AC8)", async () => {
  const filled = readFileSync("plugin/templates/jeyna.config.yaml", "utf8")
    .replaceAll("__APP_NAME__", "todo-sample")
    .replaceAll("__APP_URL__", "http://localhost:4173")
    .replace(/^accounts: \[\]$/m, "accounts:\n  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }");
  const r = await getContext({ args: ["--project", project(filled)] });
  expect(r.isError, r.text).toBe(false);
  expect(JSON.parse(r.text).config.accounts).toHaveLength(1);
});

test("an account value in place of an env variable name is refused", async () => {
  const root = project(VALID.replace("JEYNA_USER_A_PASS", "hunter2!"));
  const r = await getContext({ args: ["--project", root] });
  expect(r.isError).toBe(true);
  expect(r.text).toMatch(/environment variable name/);
});
