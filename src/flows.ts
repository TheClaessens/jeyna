import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { Scenario } from "./schema.js";
import { fail, ok } from "./session.js";

// Flow frontmatter (§5.2). The name is the file name, so it doubles as the run slug (D7).
const FlowFront = z.strictObject({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase words joined by '-', the same as the file name"),
  entry: z.string().min(1),
  viewports: z.array(z.string().regex(/^\d+x\d+$/, "must look like 1440x900")).min(1).optional(),
  accounts: z.array(z.string().min(1)).min(1).optional(),
});
export type Flow = { frontmatter: z.infer<typeof FlowFront>; body: string; scenarios: Scenario[] };

const flowsDir = (root: string) => join(root, ".jeyna", "flows");
export const flowNames = (root: string) =>
  existsSync(flowsDir(root)) ? readdirSync(flowsDir(root)).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort() : [];

// Under `## Scenarios`: `### <name>`, a description paragraph, one `Pass:` line, an optional `Account:` line (D6, D10).
export function parseFlow(md: string, file: string): Flow {
  const m = /^---\n([\s\S]*?)\n?---\n([\s\S]*)$/.exec(md);
  if (!m) throw new Error(`${file}: no YAML frontmatter between --- lines.`);
  const front = FlowFront.safeParse(parse(m[1]) ?? {});
  if (!front.success) throw new Error(`${file}: frontmatter is invalid:\n${z.prettifyError(front.error)}`);
  if (`${front.data.name}.md` !== file) throw new Error(`${file}: frontmatter name ${front.data.name} does not match the file name.`);
  const body = m[2];
  const section = /^## Scenarios[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body)?.[1];
  if (!section) throw new Error(`${file}: no ## Scenarios section.`);
  const scenarios = section
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [name, ...lines] = block.trim().split("\n").map((l) => l.trim());
      const at = (key: string) => lines.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).trim();
      const description = lines.filter((l) => l && !/^(Pass|Account):/.test(l)).join(" ");
      const pass = at("Pass");
      const account = at("Account");
      if (!description) throw new Error(`${file}: scenario "${name}" has no description paragraph.`);
      if (!pass) throw new Error(`${file}: scenario "${name}" has no Pass: line.`);
      if (account !== undefined && account !== "none" && account !== "consumes") {
        throw new Error(`${file}: scenario "${name}" has Account: ${account}; use none or consumes.`);
      }
      return { name, description, pass, ...(account && { account }) } as Scenario;
    });
  if (!scenarios.length) throw new Error(`${file}: ## Scenarios has no ### scenario.`);
  const names = scenarios.map((s) => s.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length) throw new Error(`${file}: scenario names must be unique: ${dupes.join(", ")}.`);
  return { frontmatter: front.data, body, scenarios };
}

export function readFlow(root: string, name: string): Flow {
  const names = flowNames(root);
  if (!names.includes(name)) throw new Error(`No flow "${name}". Flows in .jeyna/flows/: ${names.join(", ") || "none"}.`);
  return parseFlow(readFileSync(join(flowsDir(root), `${name}.md`), "utf8"), `${name}.md`);
}

// For get_context: each flow with its scenario names, or the error that keeps it from parsing (D5).
export const listFlows = (root: string) =>
  flowNames(root).map((name) => {
    try {
      return { name, scenarios: readFlow(root, name).scenarios.map((s) => s.name) };
    } catch (e) {
      return { name, error: (e as Error).message };
    }
  });

export function registerFlowTools(server: McpServer, getContext: () => { root: string }) {
  server.registerTool(
    "get_flow",
    {
      description: "A flow file from .jeyna/flows/: frontmatter (name, entry, viewports?, accounts?), the markdown body, and its parsed scenarios.",
      inputSchema: { name: z.string().describe("Flow name, as get_context lists it") },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      try {
        return ok(readFlow(getContext().root, name));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
