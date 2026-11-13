import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import { type Account, addCreated, createdAccounts, pruneCreated } from "./accounts.js";
import { closeContexts, launchBrowser } from "./browser.js";
import { flowSection, readFlow } from "./flows.js";
import { type Case, type Config, RESULTS, Scenario, type Session, Slug, type Verdict, VIEWPORT } from "./schema.js";
import { duplicateNames } from "./shared.js";

export type Tester = { id: string; scenario: string; account?: string; batch: number; cases: Case[] };

// The handle of a tester whose account app.new_account created for it alone (D41). Reserved: no configured account takes it.
export const NEW = "new";

// One tester per scenario, one case per viewport (D4). With `pool` "new" every tester that signs in gets an account
// created for it (D41); otherwise accounts are dealt round-robin from the pool to the testers that need one (D10).
// Each tester then takes the earliest batch with room (at most `parallel`, tester.parallel) that does not already
// hold its configured account, so a later batch reuses accounts freed by earlier ones. Consuming testers of a
// configured account are placed last, at most one per account, each after every other tester of its account: the
// account it may lock is never handed out after it. Testers are numbered from `first` (t1 unless runs were aborted).
export function planTesters(scenarios: Scenario[], pool: string[] | typeof NEW, viewports: string[], first = 1, parallel = 20): Tester[] {
  const testers: Tester[] = scenarios.map((s, i) => ({
    id: `t${first + i}`,
    scenario: s.name,
    batch: 0,
    cases: viewports.map((v) => ({ id: `t${first + i}-${v}`, scenario: s.name, viewport: v })),
  }));
  const consumes = (t: Tester) => scenarios[testers.indexOf(t)].account === "consumes";
  const order = [...testers.filter((t) => !consumes(t)), ...testers.filter(consumes)];
  const needing = order.filter((t) => scenarios[testers.indexOf(t)].account !== "none");
  if (pool === NEW) {
    for (const t of needing) t.account = NEW;
  } else {
    const consuming = needing.filter(consumes).length;
    if (needing.length && !pool.length) {
      throw new Error(
        "These scenarios need an account but jeyna.config.yaml lists none: " +
          needing.map((t) => t.scenario).join(", ") + ". Add accounts, set app.new_account, or mark a scenario `Account: none`.",
      );
    }
    if (consuming > pool.length) {
      throw new Error(`${consuming} scenarios are \`Account: consumes\` but the pool has ${pool.length} accounts; each needs its own.`);
    }
    needing.forEach((t, i) => (t.account = pool[i % pool.length]));
  }
  const batches: Tester[][] = [];
  for (const t of order) {
    const shared = t.account && t.account !== NEW ? t.account : undefined;
    let b = shared && consumes(t) ? Math.max(0, ...batches.flat().filter((o) => o.account === shared).map((o) => o.batch)) : 0;
    while (batches[b] && (batches[b].length >= parallel || (shared && batches[b].some((o) => o.account === shared)))) b++;
    (batches[b] ??= []).push(t);
    t.batch = b + 1;
  }
  return testers;
}

export type { Session, Verdict } from "./schema.js";

// The in-memory session is the only source of truth during a run (D11).
// findings: id and case of each finding recorded in this run; its length is the id counter (D11).
// created: the account app.new_account made for each tester with handle `new`, by tester id; in memory only (D41).
export type Run = { runDir: string; session: Session; findings: { id: string; case: string }[]; created: Record<string, Account> };
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

// A shell command of jeyna.config.yaml's `app`, run from the project root; its stdout. A failure throws with the
// tail of its output, then `then`. app.new_account's stdout carries credentials by contract: only its stderr is quoted,
// and `seen` gets the stdout first, failed or not, so its values are redacted from that stderr too.
const SHELL_TIMEOUT = 120_000;
function shell(root: string, key: "reset" | "new_account", command: string, then: string, env: Record<string, string> = {}, seen?: (stdout: string) => void): string {
  const r = spawnSync("sh", ["-c", command], {
    cwd: root,
    timeout: SHELL_TIMEOUT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  seen?.(r.stdout ?? "");
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : `exit ${r.status ?? `signal ${r.signal}`}`;
    const said = key === "reset" ? `${r.stderr ?? ""}${r.stdout ?? ""}` : (r.stderr ?? "");
    const out = said.trim().split("\n").slice(-5).join("\n");
    throw new Error(`app.${key} failed (${why}): ${command}${out ? `\n${out}` : ""}\n${then}`);
  }
  return r.stdout;
}

// app.reset, run from the project root before every run so each run starts from the same app state (D31).
// A failure refuses the run: a tester judging leftover state is worse than no run.
const NO_RUN = (key: string) => `No run was started. Fix the command in jeyna.config.yaml, or set ${key}: null.`;
const resetApp = (root: string, command: string) => shell(root, "reset", command, NO_RUN("reset"));

// One new test user from app.new_account (D41), for `account` (a tester id, or scout) of run `run`. Its values are
// registered for redaction before anything can fail (even when the command fails), and live in memory only.
export function createAccount(root: string, command: string, account: string, run: string, then: string): Account {
  let a: Account = { handle: NEW, user_env: "JEYNA_USER", pass_env: "JEYNA_PASS" };
  shell(root, "new_account", command, then, { JEYNA_ACCOUNT: account, JEYNA_RUN: run }, (stdout) => {
    const out = parseEnv(stdout);
    addCreated((a = { ...a, user: out.JEYNA_USER, pass: out.JEYNA_PASS }));
  });
  if (!a.user || !a.pass) {
    throw new Error(`app.new_account must print JEYNA_USER=<username> and JEYNA_PASS=<password> on stdout, one line each, for every new user; it printed ${a.user ? "no JEYNA_PASS" : a.pass ? "no JEYNA_USER" : "neither"}: ${command}\n${then}`);
  }
  return a;
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

// A tester's spawn prompt (D41): the marker line the exit hook reads (plugin/hooks/check-exit.sh), first and on its
// own line, then where the rest comes from. The playtest skill builds a re-spawn's prompt the same way.
export const spawnPrompt = (cases: string[]) => `jeyna-tester-cases: ${cases.join(", ")}\nCall brief with case ${cases[0]} and follow what it returns.`;

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
          .describe("Account handles an exploratory run deals from, e.g. the account a retested finding was found with; default all configured, or a new account per tester when app.new_account is set"),
        focus: z.string().min(1).optional().describe("Exploratory run: what matters most in this run, in the developer's words; every tester's brief carries it"),
        force: z.boolean().default(false),
      },
    },
    async ({ flow: flowName, scenarios: given, only, entry, slug, viewports, accounts, focus, force }) => {
      try {
        const { root, config } = getContext();
        if (flowName && given) throw new Error("session_start needs flow (guided) or scenarios (exploratory), not both.");
        if (!flowName && !given) throw new Error("session_start needs flow (guided) or scenarios (exploratory): give one of them.");
        const flow = flowName ? readFlow(root, flowName) : undefined;
        if (flow && slug) throw new Error("slug is for exploratory runs; a guided run is named after its flow.");
        if (flow && entry) throw new Error("entry is for exploratory runs; a guided run starts at its flow's entry.");
        if (flow && accounts) throw new Error("accounts is for exploratory runs; a guided run deals its flow's accounts (or all configured).");
        if (flow && focus) throw new Error("focus is for exploratory runs; a guided run takes its flow's ## What matters most here section.");
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
        // A run that names accounts deals those (a flow may need a particular seeded user); otherwise app.new_account,
        // when set, creates one per tester that signs in (D41).
        const pool = flow?.frontmatter.accounts ?? accounts ?? (config.app.new_account ? NEW : handles);
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
        const testers = planTesters(scenarios, pool, viewports ?? valid, first, config.tester.parallel);

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
        // After the reset, so it does not remove them; before the run folder, so a failure starts nothing (D41).
        // Synchronous, like the reset: nothing can start or end a run in between.
        // Then the redaction list keeps every account this start made (refused or not) and drops the oldest others.
        const made: Record<string, Account> = {};
        const before = createdAccounts().length;
        try {
          for (const t of testers.filter((t) => t.account === NEW)) {
            const a = createAccount(root, config.app.new_account!, t.id, id, NO_RUN("new_account"));
            const twin = Object.keys(made).find((k) => made[k].user!.toLowerCase() === a.user!.toLowerCase());
            if (twin) {
              throw new Error(
                `app.new_account answered the same username for ${twin} and ${t.id}: it must create a new user on every call, so no two testers share an account. ${NO_RUN("new_account")}`,
              );
            }
            made[t.id] = a;
          }
        } finally {
          if (createdAccounts().length > before) pruneCreated(createdAccounts().slice(before));
        }
        const runDir = join(dir, id);
        // What every tester's brief carries besides its scenario, fixed for the run (D41).
        const preconditions = flow && flowSection(flow.body, "Preconditions");
        const matters = flow ? flowSection(flow.body, "What matters most here") : focus;
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
          ...(preconditions && { preconditions }),
          ...(matters && { focus: matters }),
          scenarios,
          testers: testers.map((t) => ({ ...t, model: config.tester.model, cases: t.cases.map((c) => c.id) })),
          cases: testers.flatMap((t) => t.cases),
          verdicts: [],
        };
        save(runDir, session);
        current = { runDir, session, findings: [], created: made };
        return ok({
          id,
          runDir,
          testers: testers.map(({ cases, ...t }) => ({
            ...t,
            cases: cases.map(({ id, viewport }) => ({ id, viewport })),
            prompt: spawnPrompt(cases.map((c) => c.id)),
          })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // What the playtest skill's prompt template carried, rendered from the run for the tester that owns the case (D41).
  server.registerTool(
    "brief",
    {
      description:
        "Your brief as a Jeyna tester: the app url, the entry path, your cases and their viewports, your account, the scenario with its Pass: line, the preconditions, what matters most here, and the project's conventions. Call it first, with the first case id on your prompt's jeyna-tester-cases line.",
      inputSchema: { case: z.string().describe("Case id from your prompt's jeyna-tester-cases line, e.g. t1-390x844") },
      annotations: { readOnlyHint: true },
    },
    async ({ case: caseId }) => {
      try {
        const { session } = caseOf(caseId).run;
        const { root, config } = getContext();
        const t = session.testers.find((t) => t.cases.includes(caseId))!;
        const s = session.scenarios.find((s) => s.name === t.scenario)!;
        const conventions = join(root, ".jeyna", "CONVENTIONS.md");
        const signIn = "Sign in with {{account.user}} and {{account.pass}}.";
        const text = [
          `App: ${config.app.url}`,
          `Entry: ${session.entry ?? "/"}`,
          "Cases, in order:",
          ...t.cases.map((id) => `- ${id} at ${session.cases.find((c) => c.id === id)!.viewport}`),
          "Play only the cases named on your prompt's jeyna-tester-cases line, in this order.",
          !t.account ? "Account: none. Do not sign in." : `Account: ${t.account === NEW ? "a new account, made for you alone" : t.account}. ${signIn}`,
          "",
          `Scenario: ${s.name}`,
          s.description,
          `Pass: ${s.pass}`,
          "",
          "Preconditions:",
          session.preconditions ?? "None given.",
          "",
          "What matters most here:",
          session.focus ?? "Nothing given.",
          "",
          "Conventions:",
          existsSync(conventions) ? readFileSync(conventions, "utf8") : "None given.",
        ].join("\n");
        return { content: [{ type: "text" as const, text }] };
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
