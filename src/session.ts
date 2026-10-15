import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { closeContexts } from "./browser.js";
import { readFlow } from "./flows.js";
import { type Case, type Config, Scenario } from "./schema.js";

export type Tester = { id: string; scenario: string; account?: string; batch: number; cases: Case[] };

// One tester per scenario, one case per viewport (D4). Accounts are dealt round-robin to the testers
// that need one, in batches of pool size, so no batch holds an account twice and a later batch reuses
// accounts freed by earlier ones (D10). Consuming testers go last; at most one per account, since the
// account they may lock is never handed out again after them.
export function planTesters(scenarios: Scenario[], pool: string[], viewports: string[]): Tester[] {
  const testers: Tester[] = scenarios.map((s, i) => ({
    id: `t${i + 1}`,
    scenario: s.name,
    batch: 1,
    cases: viewports.map((v) => ({ id: `t${i + 1}-${v}`, scenario: s.name, viewport: v })),
  }));
  const needing = [
    ...testers.filter((_, i) => !scenarios[i].account),
    ...testers.filter((_, i) => scenarios[i].account === "consumes"),
  ];
  const consuming = scenarios.filter((s) => s.account === "consumes").length;
  if (needing.length && !pool.length) {
    throw new Error(
      "These scenarios need an account but jeyna.config.yaml lists none: " +
        needing.map((t) => t.scenario).join(", ") + ". Add accounts, or mark a scenario `Account: none`.",
    );
  }
  if (consuming > pool.length) {
    throw new Error(`${consuming} scenarios are \`Account: consumes\` but the pool has ${pool.length} accounts; each needs its own.`);
  }
  needing.forEach((t, i) => {
    t.account = pool[i % pool.length];
    t.batch = Math.floor(i / pool.length) + 1;
  });
  return testers;
}

export type Session = {
  schema: 1;
  id: string;
  flow: string;
  app: string;
  build: string;
  status: "running" | "done" | "aborted";
  started: string;
  finished?: string;
  mode: "guided" | "exploratory";
  scenarios: Scenario[];
  testers: (Omit<Tester, "cases"> & { model: string; cases: string[] })[];
  cases: Case[];
  verdicts: Verdict[];
  summary?: string;
};

export type Verdict = { case: string; result: "pass" | "fail" | "blocked" | "skipped"; note?: string; findings: string[] };

// The in-memory session is the only source of truth during a run (D11).
// findings: id and case of each finding recorded in this run; its length is the id counter (D11).
export let current: { runDir: string; session: Session; findings: { id: string; case: string }[] } | undefined;
export const endRun = () => (current = undefined);

// Synchronous temp + rename: writes cannot interleave and readers never see half a file (D11).
export function save(runDir: string, session: Session) {
  writeFileSync(join(runDir, "session.json.tmp"), JSON.stringify(session, null, 2) + "\n");
  renameSync(join(runDir, "session.json.tmp"), join(runDir, "session.json"));
}

function buildId(root: string, config: Config): string {
  if (config.app.build) return config.app.build;
  try {
    const args = ["describe", "--always", "--dirty"];
    return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

// Runs left `running` on disk, by this server or an earlier one.
function runningRuns(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((d) => join(dir, d))
    .filter((d) => {
      try {
        return JSON.parse(readFileSync(join(d, "session.json"), "utf8")).status === "running";
      } catch {
        return false;
      }
    });
}

export const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
export const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (e as Error).message }] });

export function registerSessionTools(server: McpServer, getContext: () => { root: string; config: Config }) {
  server.registerTool(
    "session_start",
    {
      description:
        "Start a playtest run, guided from a flow in .jeyna/flows/ or exploratory from an explicit scenario list. only and viewports narrow the run; unknown names are refused with the valid ones. Plans one tester per scenario, one case per viewport, one account per tester, and the batch to spawn each tester in (no account is held by two testers in one batch). Refused while another run is running unless force is true.",
      inputSchema: {
        flow: z.string().optional().describe("Flow name from get_context (guided run)"),
        scenarios: z.array(Scenario).min(1).optional().describe("Explicit scenario list (exploratory run)"),
        only: z.array(z.string()).min(1).optional().describe("Scenario names to run; default all"),
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase words joined by '-'").optional().describe("Run folder slug of an exploratory run; default exploratory"),
        viewports: z.array(z.string()).min(1).optional(),
        force: z.boolean().default(false),
      },
    },
    async ({ flow: flowName, scenarios: given, only, slug, viewports, force }) => {
      try {
        const { root, config } = getContext();
        if (!flowName === !given) throw new Error("session_start needs flow (guided) or scenarios (exploratory), not both.");
        const flow = flowName ? readFlow(root, flowName) : undefined;
        if (flow && slug) throw new Error("slug is for exploratory runs; a guided run is named after its flow.");
        let scenarios = flow?.scenarios ?? given!;
        if (only) {
          const unknownScenarios = only.filter((n) => !scenarios.some((s) => s.name === n));
          if (unknownScenarios.length) {
            const of = flow ? `Scenarios of flow ${flowName}` : "Scenarios given";
            throw new Error(`Unknown scenarios: ${unknownScenarios.join(", ")}. ${of}: ${scenarios.map((s) => s.name).join(", ")}.`);
          }
          scenarios = scenarios.filter((s) => only.includes(s.name));
        }
        const valid = flow?.frontmatter.viewports ?? config.viewports;
        const unknown = (viewports ?? []).filter((v) => !valid.includes(v));
        if (unknown.length) {
          const where = flow?.frontmatter.viewports ? `Flow ${flowName} runs at` : "Configured";
          throw new Error(`Unknown viewports: ${unknown.join(", ")}. ${where}: ${valid.join(", ")}.`);
        }
        const handles = config.accounts.map((a) => a.handle);
        const strangers = (flow?.frontmatter.accounts ?? []).filter((h) => !handles.includes(h));
        if (strangers.length) throw new Error(`Flow ${flowName} names accounts not in jeyna.config.yaml: ${strangers.join(", ")}. Configured: ${handles.join(", ") || "none"}.`);
        const pool = flow?.frontmatter.accounts ?? handles;
        const names = scenarios.map((s) => s.name);
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        if (dupes.length) throw new Error(`Scenario names must be unique: ${dupes.join(", ")}.`);

        const dir = join(root, ".jeyna", "playtests");
        const stale = runningRuns(dir);
        if (stale.length && !force) {
          throw new Error(`A run is still running: ${stale.join(", ")}. Call session_start with force: true to abort it.`);
        }
        const testers = planTesters(scenarios, pool, viewports ?? valid);

        for (const d of stale) {
          const s = d === current?.runDir ? current.session : (JSON.parse(readFileSync(join(d, "session.json"), "utf8")) as Session);
          save(d, { ...s, status: "aborted", finished: new Date().toISOString() });
        }
        current = undefined;
        await closeContexts();

        const base = `${new Date().toLocaleDateString("sv")}-${flowName ?? slug ?? "exploratory"}`;
        let id = base;
        for (let n = 2; existsSync(join(dir, id)); n++) id = `${base}-${n}`;
        const runDir = join(dir, id);
        mkdirSync(join(runDir, "evidence"), { recursive: true });
        const session: Session = {
          schema: 1,
          id,
          flow: flowName ?? `exploratory:${slug ?? "exploratory"}`,
          app: config.app.name,
          build: buildId(root, config),
          status: "running",
          started: new Date().toISOString(),
          mode: flow ? "guided" : "exploratory",
          scenarios,
          testers: testers.map((t) => ({ ...t, model: config.tester.model, cases: t.cases.map((c) => c.id) })),
          cases: testers.flatMap((t) => t.cases),
          verdicts: [],
        };
        save(runDir, session);
        current = { runDir, session, findings: [] };
        return ok({
          id,
          runDir,
          testers: testers.map(({ cases, ...t }) => ({ ...t, cases: cases.map(({ id, viewport }) => ({ id, viewport })) })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "scenario_verdict",
    {
      description:
        "Record this case's verdict against the scenario's Pass: line. One per case; calling again replaces it. blocked (could not get far enough to judge) and skipped need a note saying why.",
      inputSchema: {
        case: z.string().describe("Case id from your prompt's jeyna-tester-cases line, e.g. t1-390x844"),
        result: z.enum(["pass", "fail", "blocked", "skipped"]),
        note: z.string().min(1).optional(),
        findings: z.array(z.string()).default([]),
      },
    },
    async ({ case: caseId, result, note, findings }) => {
      try {
        if (!current) throw new Error("No running session. Call session_start first.");
        const { runDir, session } = current;
        if (!session.cases.some((c) => c.id === caseId)) {
          throw new Error(`Unknown case "${caseId}". Cases in this run: ${session.cases.map((c) => c.id).join(", ")}.`);
        }
        if ((result === "blocked" || result === "skipped") && !note) throw new Error(`A ${result} verdict needs a note saying why.`);
        const ofCase = current.findings.filter((f) => f.case === caseId).map((f) => f.id);
        const foreign = findings.filter((id) => !ofCase.includes(id));
        if (foreign.length) {
          throw new Error(`Not findings of case ${caseId}: ${foreign.join(", ")}. Its findings: ${ofCase.join(", ") || "none"}.`);
        }
        if (result === "fail" && !findings.length) {
          throw new Error(`A fail needs at least one finding of case ${caseId}: record it with record_finding, then list its id in findings.`);
        }
        const verdict: Verdict = { case: caseId, result, ...(note && { note }), findings };
        session.verdicts = [...session.verdicts.filter((v) => v.case !== caseId), verdict];
        save(runDir, session);
        return ok({ recorded: verdict });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
