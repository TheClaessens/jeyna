import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { parse } from "yaml";
import { z } from "zod";
import { Config } from "./schema.js";

// stdout is the JSON-RPC channel: log to stderr only.
const log = (...a: unknown[]) => console.error(new Date().toISOString(), ...a);
process.on("unhandledRejection", (e) => log("unhandledRejection", e));

const { values } = parseArgs({ options: { project: { type: "string" } }, strict: false });

// An unset variable reaches us as its literal "${...}" text, so treat that as absent.
const given = (v: unknown) => (typeof v === "string" && v !== "" && !v.includes("${") ? v : undefined);

// Project root: --project, then CLAUDE_PROJECT_DIR, then the nearest folder with .jeyna/ (D7, D13).
function projectRoot(): string {
  const root = given(values.project) ?? given(process.env.CLAUDE_PROJECT_DIR);
  if (root) return resolve(root);
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".jeyna"))) return dir;
    if (dirname(dir) === dir) break;
  }
  throw new Error(
    "Jeyna could not find the project root: no --project argument, no CLAUDE_PROJECT_DIR, and no .jeyna/ folder above " +
      process.cwd() + ". Start Claude Code in your project folder.",
  );
}

function getContext() {
  const root = projectRoot();
  const file = join(root, ".jeyna", "jeyna.config.yaml");
  if (!existsSync(file)) throw new Error(`No ${file}. Run /jeyna:init in ${root} to create it.`);
  let raw: unknown;
  try {
    raw = parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`.jeyna/jeyna.config.yaml is not valid YAML: ${(e as Error).message}`);
  }
  const parsed = Config.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new Error(`.jeyna/jeyna.config.yaml is invalid. Fix these fields:\n${z.prettifyError(parsed.error)}`);
  }
  return { root, config: parsed.data, secrets: secretSources(root, parsed.data) };
}

// Where each account variable is set: shell env first, then .jeyna/.env. Never the value (D18, P3).
function secretSources(root: string, config: Config): Record<string, "env" | ".env" | "missing"> {
  const file = join(root, ".jeyna", ".env");
  const dotenv = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const names = config.accounts.flatMap((a) => [a.user_env, a.pass_env]);
  return Object.fromEntries(names.map((n) => [n, process.env[n] ? "env" : dotenv[n] ? ".env" : "missing"]));
}

const server = new McpServer({ name: "jeyna", version: "0.0.1" });

server.registerTool(
  "get_context",
  {
    description: "Jeyna project root and validated .jeyna/jeyna.config.yaml (account env variable names only, never values).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(getContext()) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
    }
  },
);

await server.connect(new StdioServerTransport());
log("jeyna-mcp ready", process.argv.slice(2).join(" "));
