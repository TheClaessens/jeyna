import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { Scenario } from "./schema.js";
import { fail, ok, type Session } from "./session.js";
import { duplicateNames, runDirOf, splitFront } from "./shared.js";

// Flow frontmatter (§5.2). The name is the file name, so it doubles as the run slug (D7).
const FlowName = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase words joined by '-', the same as the file name");
const FlowFront = z.strictObject({
  name: FlowName,
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
  const m = splitFront(md);
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
  const dupes = duplicateNames(scenarios);
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

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

// The flow file save_flow writes from a run: the run's scenarios in the format parseFlow reads (§5.2, D6).
// It is parsed back before it is written, so a scenario that would not survive the round trip is refused.
export function flowMarkdown(name: string, session: Pick<Session, "id" | "entry" | "scenarios">): string {
  const scenarios = session.scenarios.map((s) => ({ ...s, description: oneLine(s.description), pass: oneLine(s.pass) }));
  const md = [
    `---\n${stringify({ name, entry: session.entry ?? "/" })}---`,
    `Saved by save_flow from run ${session.id}. Edit it freely: \`/jeyna:playtest ${name}\` now runs these scenarios guided.`,
    "## Scenarios",
    ...scenarios.map((s) => [`### ${s.name}`, s.description, `Pass: ${s.pass}`, ...(s.account ? [`Account: ${s.account}`] : [])].join("\n")),
  ].join("\n\n") + "\n";
  let back: Scenario[];
  try {
    back = parseFlow(md, `${name}.md`).scenarios;
  } catch (e) {
    throw new Error(`The run's scenarios do not make a valid flow file: ${(e as Error).message}`);
  }
  scenarios.forEach((s, i) => {
    if (JSON.stringify(back[i]) !== JSON.stringify(s)) {
      throw new Error(`Scenario "${s.name}" does not survive as a flow file (a name on one line, no description line starting Pass: or Account:). Nothing was written.`);
    }
  });
  if (back.length !== scenarios.length) throw new Error("The run's scenarios do not survive as a flow file. Nothing was written.");
  return md;
}

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

  server.registerTool(
    "save_flow",
    {
      description:
        "Save a run's scenarios as .jeyna/flows/<name>.md, copied from that run's session.json, so the next /jeyna:playtest <name> runs them guided (F2.4). Refuses if the file exists. Offer it at the end of an exploratory run.",
      inputSchema: {
        run: z.string().min(1).describe("Run id, as session_start returned it, e.g. 2026-10-15-authentication"),
        name: FlowName.describe("Flow name and file name, e.g. authentication"),
      },
    },
    async ({ run, name }) => {
      try {
        const root = getContext().root;
        const runDir = runDirOf(root, run);
        const file = join(runDir, "session.json");
        if (!existsSync(file)) throw new Error(`No run ${run}: ${file} does not exist.`);
        const session = JSON.parse(readFileSync(file, "utf8")) as Session;
        const path = join(flowsDir(root), `${name}.md`);
        if (existsSync(path)) throw new Error(`.jeyna/flows/${name}.md already exists; save_flow never overwrites a flow. Choose another name, or edit that file.`);
        const md = flowMarkdown(name, session);
        mkdirSync(flowsDir(root), { recursive: true });
        writeFileSync(path, md, { flag: "wx" });
        return ok({ path, name, scenarios: session.scenarios.map((s) => s.name) });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
