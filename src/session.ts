import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { closeContexts, launchBrowser } from "./browser.js";
import { readFlow } from "./flows.js";
import { type Case, type Config, RESULTS, Scenario, type Session, Slug, type Verdict, VIEWPORT } from "./schema.js";
import { duplicateNames } from "./shared.js";

export type Tester = { id: string; scenario: string; account?: string; batch: number; cases: Case[] };

// One tester per scenario, one case per viewport (D4). Accounts are dealt round-robin to the testers
// that need one, in batches of pool size, so no batch holds an account twice and a later batch reuses
// accounts freed by earlier ones (D10). Consuming testers go last; at most one per account, since the
// account they may lock is never handed out again after them. Testers are numbered from `first` (t1 unless runs were aborted).
export function planTesters(scenarios: Scenario[], pool: string[], viewports: string[], first = 1): Tester[] {
  const testers: Tester[] = scenarios.map((s, i) => ({
    id: `t${first + i}`,
    scenario: s.name,
    batch: 1,
    cases: viewports.map((v) => ({ id: `t${first + i}-${v}`, scenario: s.name, viewport: v })),
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

export type { Session, Verdict } from "./schema.js";

// The in-memory session is the only source of truth during a run (D11).
// findings: id and case of each finding recorded in this run; its length is the id counter (D11).
export type Run = { runDir: string; session: Session; findings: { id: string; case: string }[] };
export let current: Run | undefined;
export const endRun = () => (current = undefined);

// A tool that read the current run and awaited re-checks this before it writes: `run` is still the current run and
// still running (or, for undefined, there is still no run). session_start (force) or session_finish may have ended it.
export const stillCurrent = (run: Run | undefined) => current === run && (!run || run.session.status === "running");

// Case ids of runs aborted by session_start (force) in this server process. Case ids restart per run, so a tester of an
// aborted run could otherwise land its calls in the new run; a forced start numbers its testers after them instead.
const retired = new Set<string>();
const testerNo = (caseId: string) => Number(/^t(\d+)-/.exec(caseId)?.[1] ?? 0);

// The case `caseId` of the current run, for every tool that takes a case (browser tools, record_finding, scenario_verdict).
export function caseOf(caseId: string): { run: Run; c: Case } {
  if (retired.has(caseId)) {
    throw new Error(`Case ${caseId} belongs to a run that was aborted: a new run replaced it. Stop now: make no more calls and report that your run was aborted.`);
  }
  if (!current) {
    throw new Error("No running session. Call session_start first and use the case ids it returns (browser tools also take `scout`, for the look before a run).");
  }
  const c = current.session.cases.find((c) => c.id === caseId);
  if (!c) throw new Error(`Unknown case "${caseId}". Cases in this run: ${current.session.cases.map((c) => c.id).join(", ")}.`);
  return { run: current, c };
}

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

// app.reset, run from the project root before every run so each run starts from the same app state (D31).
// A failure refuses the run: a tester judging leftover state is worse than no run.
const RESET_TIMEOUT = 120_000;
function resetApp(root: string, command: string) {
  const r = spawnSync("sh", ["-c", command], { cwd: root, timeout: RESET_TIMEOUT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : `exit ${r.status ?? `signal ${r.signal}`}`;
    const out = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim().split("\n").slice(-5).join("\n");
    throw new Error(`app.reset failed (${why}): ${command}${out ? `\n${out}` : ""}\nNo run was started. Fix the command in jeyna.config.yaml, or set reset: null.`);
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

// redact: the transport's account-value redactor (D9), run over the verdict note before it is written (AC3).
export function registerSessionTools(server: McpServer, getContext: () => { root: string; config: Config }, redact: (text: string) => string) {
  server.registerTool(
    "session_start",
    {
      description:
        "Start a playtest run, guided from a flow in .jeyna/flows/ or exploratory from an explicit scenario list (with its slug and entry path). Launches the browser first and refuses the run when there is none. Closes the scout look. only and viewports narrow the run; unknown names are refused with the valid ones. Runs app.reset from jeyna.config.yaml first, if set, and refuses the run when it fails. Plans one tester per scenario, one case per viewport, one account per tester, and the batch to spawn each tester in (no account is held by two testers in one batch). Refused while another run is running unless force is true.",
      inputSchema: {
        flow: z.string().optional().describe("Flow name from get_context (guided run)"),
        scenarios: z.array(Scenario).min(1).optional().describe("Explicit scenario list (exploratory run)"),
        only: z.array(z.string()).min(1).optional().describe("Scenario names to run; default all"),
        entry: z.string().min(1).optional().describe("Entry path of an exploratory run, e.g. /login; save_flow writes it to the flow. Default /"),
        slug: Slug.optional().describe("Run folder slug of an exploratory run; default exploratory"),
        viewports: z
          .array(z.string())
          .min(1)
          .optional()
          .describe("Viewports to run, e.g. 390x844. A guided run takes its flow's (else the configured ones); an exploratory run any <width>x<height>. Default all of those"),
        accounts: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .describe("Account handles an exploratory run deals from, e.g. the account a retested finding was found with; default all configured"),
        force: z.boolean().default(false),
      },
    },
    async ({ flow: flowName, scenarios: given, only, entry, slug, viewports, accounts, force }) => {
      try {
        const { root, config } = getContext();
        if (flowName && given) throw new Error("session_start needs flow (guided) or scenarios (exploratory), not both.");
        if (!flowName && !given) throw new Error("session_start needs flow (guided) or scenarios (exploratory): give one of them.");
        const flow = flowName ? readFlow(root, flowName) : undefined;
        if (flow && slug) throw new Error("slug is for exploratory runs; a guided run is named after its flow.");
        if (flow && entry) throw new Error("entry is for exploratory runs; a guided run starts at its flow's entry.");
        if (flow && accounts) throw new Error("accounts is for exploratory runs; a guided run deals its flow's accounts (or all configured).");
        let scenarios = flow?.scenarios ?? given!;
        if (only) {
          const unknownScenarios = only.filter((n) => !scenarios.some((s) => s.name === n));
          if (unknownScenarios.length) {
            const of = flow ? `Scenarios of flow ${flowName}` : "Scenarios given";
            throw new Error(`Unknown scenarios: ${unknownScenarios.join(", ")}. ${of}: ${scenarios.map((s) => s.name).join(", ")}.`);
          }
          scenarios = scenarios.filter((s) => only.includes(s.name));
        }
        // A guided run plays at its flow's viewports (else the configured ones). An exploratory run, such as the retest
        // of a finding seen at a viewport only its flow defines, takes any well-formed size.
        const valid = flow?.frontmatter.viewports ?? config.viewports;
        const unknown = (viewports ?? []).filter((v) => (flow ? !valid.includes(v) : !VIEWPORT.test(v)));
        if (unknown.length && !flow) throw new Error(`Viewports look like 1440x900 (<width>x<height>), not: ${unknown.join(", ")}. Configured: ${valid.join(", ")}.`);
        if (unknown.length) {
          const where = flow?.frontmatter.viewports ? `Flow ${flowName} runs at` : "Configured";
          throw new Error(`Unknown viewports: ${unknown.join(", ")}. ${where}: ${valid.join(", ")}.`);
        }
        const handles = config.accounts.map((a) => a.handle);
        const strangers = (flow?.frontmatter.accounts ?? accounts ?? []).filter((h) => !handles.includes(h));
        if (strangers.length) {
          const who = flow ? `Flow ${flowName} names accounts not in jeyna.config.yaml` : "Unknown accounts";
          throw new Error(`${who}: ${strangers.join(", ")}. Configured: ${handles.join(", ") || "none"}.`);
        }
        const pool = flow?.frontmatter.accounts ?? accounts ?? handles;
        const dupes = duplicateNames(scenarios);
        if (dupes.length) throw new Error(`Scenario names must be unique: ${dupes.join(", ")}.`);

        const dir = join(root, ".jeyna", "playtests");
        const busy = (runDir: string) => `A run is still running: ${runDir}. Call session_start with force: true to abort it.`;
        const stale = runningRuns(dir);
        if (stale.length && !force) throw new Error(busy(stale.join(", ")));
        const aborted = stale.map((d) => ({ d, s: d === current?.runDir ? current.session : (JSON.parse(readFileSync(join(d, "session.json"), "utf8")) as Session) }));
        const abortedCases = aborted.flatMap(({ s }) => (s.cases ?? []).map((c) => c.id));
        // After every case id this process retired or is about to retire, so no tester of an aborted run matches a new case.
        const first = Math.max(0, ...[...retired, ...abortedCases].map(testerNo)) + 1;
        const testers = planTesters(scenarios, pool, viewports ?? valid, first);

        // No browser refuses the run before any run is aborted or created (F11.3). Another session_start may finish
        // while this one waits: the loser is refused, as a second run is.
        const seen = current;
        await launchBrowser(config.browser.headed);
        if (!stillCurrent(seen)) throw new Error(current ? busy(current.runDir) : "The running run ended while this run was starting; call session_start again.");
        for (const { d, s } of aborted) save(d, { ...s, status: "aborted", finished: new Date().toISOString() });
        for (const id of abortedCases) retired.add(id);
        current = undefined;
        await closeContexts();
        if (!stillCurrent(undefined)) throw new Error(busy(current!.runDir));
        if (config.app.reset) resetApp(root, config.app.reset);

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
          entry: flow?.frontmatter.entry ?? entry ?? "/",
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
        "Record this case's verdict against the scenario's Pass: line. One per case; calling again replaces it. blocked (could not get far enough to judge) and skipped need a note saying why. findings lists ids recorded by any of your own cases: a problem already recorded at another of your viewports is cited, not recorded again.",
      inputSchema: {
        case: z.string().describe("Case id from your prompt's jeyna-tester-cases line, e.g. t1-390x844"),
        result: z.enum(RESULTS),
        note: z.string().min(1).optional(),
        findings: z.array(z.string()).default([]),
      },
    },
    async ({ case: caseId, result, note, findings }) => {
      try {
        const { run } = caseOf(caseId);
        const { runDir, session } = run;
        if ((result === "blocked" || result === "skipped") && !note) throw new Error(`A ${result} verdict needs a note saying why.`);
        // Findings of this tester: any of its cases, so one problem seen at two viewports is recorded once.
        const own = session.testers.find((t) => t.cases.includes(caseId))?.cases ?? [caseId];
        const mine = run.findings.filter((f) => own.includes(f.case)).map((f) => f.id);
        const foreign = findings.filter((id) => !mine.includes(id));
        if (foreign.length) {
          throw new Error(`Not findings of your cases (${own.join(", ")}): ${foreign.join(", ")}. Their findings: ${mine.join(", ") || "none"}.`);
        }
        if (result === "fail" && !findings.length) {
          throw new Error(`A fail needs at least one finding: record it with record_finding (or cite one your other cases recorded), then list its id in findings.`);
        }
        const verdict: Verdict = { case: caseId, result, ...(note && { note: redact(note) }), findings };
        session.verdicts = [...session.verdicts.filter((v) => v.case !== caseId), verdict];
        save(runDir, session);
        return ok({ recorded: verdict });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
