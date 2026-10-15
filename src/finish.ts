import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { closeContexts } from "./browser.js";
import { FindingInput } from "./schema.js";
import { current, endRun, fail, ok, save, type Session } from "./session.js";

const SEVERITIES = FindingInput.shape.severity.options;
const KINDS = FindingInput.shape.kind.options;
const STATUSES = ["open", "duplicate", "wontfix", "fixed"] as const;
const SECTIONS = ["Steps", "Expected", "Actual", "Evidence", "Suggested next step"];

// Finding frontmatter (§5.2). Strict, so a hand edit with a misspelt key is reported.
const FindingFront = z.strictObject({
  schema: z.literal(1),
  id: z.string(),
  kind: z.enum(KINDS),
  severity: z.enum(SEVERITIES),
  status: z.enum(STATUSES),
  of: z.string().optional(),
  note: z.string().optional(),
  flow: z.string(),
  case: z.string(),
  scenario: z.string(),
  route: z.string(),
  viewport: z.string(),
  browser: z.string(),
  build: z.string(),
  author: z.string().optional(),
  created: z.string(),
  evidence: z.array(z.string()),
});
type FindingFront = z.infer<typeof FindingFront>;

type Finding = { path: string; id: string; front?: FindingFront; title?: string; errors: string[] };

const splitFront = (md: string) => /^---\n([\s\S]*?)\n?---\n([\s\S]*)$/.exec(md);

// Every findings/*.md of a run, parsed, with its own errors (F8.1). Paths are relative to the run folder.
function readFindings(runDir: string, session: Session): Finding[] {
  const dir = join(runDir, "findings");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const f: Finding = { path: `findings/${file}`, id: file.slice(0, -3), errors: [] };
      const m = splitFront(readFileSync(join(dir, file), "utf8"));
      if (!m) return { ...f, errors: ["no YAML frontmatter between --- lines"] };
      let raw: unknown;
      try {
        raw = parse(m[1]);
      } catch (e) {
        return { ...f, errors: [`frontmatter is not valid YAML: ${(e as Error).message.split("\n")[0]}`] };
      }
      const r = FindingFront.safeParse(raw);
      if (!r.success) {
        return { ...f, errors: r.error.issues.map((i) => `frontmatter ${i.path.join(".") || "(root)"}: ${i.message}`) };
      }
      const front = (f.front = r.data);
      f.title = /^# (.+)$/m.exec(m[2])?.[1];
      if (front.id !== f.id) f.errors.push(`id ${front.id} does not match the file name`);
      if (!session.cases.some((c) => c.id === front.case)) f.errors.push(`case ${front.case} is not a case of this run`);
      if (!f.title) f.errors.push("missing the # title line");
      for (const s of SECTIONS) if (!new RegExp(`^## ${s}$`, "m").test(m[2])) f.errors.push(`missing the ## ${s} section`);
      for (const e of front.evidence) if (!existsSync(join(runDir, "evidence", e))) f.errors.push(`evidence ${e} does not exist in evidence/`);
      if (front.kind === "bug" && !front.evidence.length) f.errors.push("a bug needs evidence");
      if (front.status === "duplicate" && !front.of) f.errors.push("status duplicate needs of: PT-…");
      return f;
    });
}

function readSession(runDir: string): Session {
  if (!existsSync(join(runDir, "session.json"))) throw new Error(`${runDir} is not a run folder: it has no session.json.`);
  return JSON.parse(readFileSync(join(runDir, "session.json"), "utf8"));
}

// F8.1 over the files on disk only, so it also runs from a shell with no server state. One `path: message` per error.
export function validateRun(runDir: string): string[] {
  let session: Session;
  try {
    session = readSession(runDir);
  } catch (e) {
    return [`session.json: ${(e as Error).message}`];
  }
  const findings = readFindings(runDir, session);
  const ids = new Set(findings.map((f) => f.id));
  const errors = findings.flatMap((f) => {
    const of = f.front?.of;
    const dangling = of && !ids.has(of) ? [`of ${of} is not a finding of this run`] : [];
    return [...f.errors, ...dangling].map((e) => `${f.path}: ${e}`);
  });
  for (const c of session.cases) {
    const v = session.verdicts.find((v) => v.case === c.id);
    if (!v) errors.push(`session.json: case ${c.id} has no verdict`);
    for (const id of v?.findings ?? []) if (!ids.has(id)) errors.push(`session.json: verdict of ${c.id} lists ${id}, which has no file in findings/`);
  }
  if (session.status === "done" && !existsSync(join(runDir, "report.md"))) errors.push("report.md: missing, but the run is done");
  return errors;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const link = (id: string) => `[${id}](findings/${id}.md)`;

// report.md (F7.3): summary counts, scenario matrix, findings sorted by severity then kind. Plain markdown, no HTML.
function report(runDir: string, session: Session) {
  const findings = readFindings(runDir, session).filter((f) => f.front) as (Finding & { front: FindingFront })[];
  findings.sort(
    (a, b) =>
      SEVERITIES.indexOf(a.front.severity) - SEVERITIES.indexOf(b.front.severity) ||
      KINDS.indexOf(a.front.kind) - KINDS.indexOf(b.front.kind) ||
      a.id.localeCompare(b.id),
  );
  const live = findings.filter((f) => f.front.status !== "duplicate");
  const results = ["pass", "fail", "blocked", "skipped"] as const;
  const counts = {
    cases: session.cases.length,
    ...Object.fromEntries(results.map((r) => [r, session.verdicts.filter((v) => v.result === r).length])),
    findings: live.length,
    ...Object.fromEntries(SEVERITIES.map((s) => [s, live.filter((f) => f.front.severity === s).length])),
    duplicate: findings.length - live.length,
  } as Record<string, number>;

  const viewports = [...new Set(session.cases.map((c) => c.viewport))];
  const matrix = session.scenarios.map((s) => {
    const cells = viewports.map((vp) => {
      const c = session.cases.find((c) => c.scenario === s.name && c.viewport === vp);
      const v = c && session.verdicts.find((v) => v.case === c.id);
      if (!v) return c ? "no verdict" : "–";
      return [v.result, ...v.findings.map(link), ...(v.note ? [`(${v.note})`] : [])].join(" ");
    });
    return `| ${[s.name, ...cells].map(cell).join(" | ")} |`;
  });

  const row = (cols: (string | number)[]) => `| ${cols.map((c) => cell(String(c))).join(" | ")} |`;
  const table = (head: string[], rows: string[]) => [row(head), `|${head.map(() => "---").join("|")}|`, ...rows].join("\n");
  const md = [
    `# Playtest report: ${session.app}`,
    [
      `- **Run:** ${session.id}`,
      `- **Flow:** ${session.flow}`,
      `- **Build:** ${session.build}`,
      `- **Started:** ${session.started}`,
      `- **Finished:** ${session.finished}`,
    ].join("\n"),
    `## Summary\n\n${session.summary}`,
    table(
      ["Cases", ...results.map((r) => r[0].toUpperCase() + r.slice(1))],
      [row([counts.cases, ...results.map((r) => counts[r])])],
    ),
    table(
      ["Findings", ...SEVERITIES.map((s) => s[0].toUpperCase() + s.slice(1)), "Duplicates"],
      [row([counts.findings, ...SEVERITIES.map((s) => counts[s]), counts.duplicate])],
    ),
    `## Scenario matrix\n\n${table(["Scenario", ...viewports], matrix)}`,
    `## Findings\n\n` +
      (findings.length
        ? table(
            ["Severity", "Kind", "Finding", "Title", "Scenario", "Viewport", "Status"],
            findings.map((f) =>
              row([
                f.front.severity,
                f.front.kind,
                link(f.id),
                f.title ?? "",
                f.front.scenario,
                f.front.viewport,
                f.front.status === "duplicate" ? `duplicate of ${link(f.front.of!)}` : f.front.status,
              ]),
            ),
          )
        : "No findings."),
  ].join("\n\n");
  writeFileSync(join(runDir, "report.md"), md + "\n");
  return counts;
}

// Run folders under .jeyna/playtests/, newest first by start time.
function runs(root: string): string[] {
  const dir = join(root, ".jeyna", "playtests");
  if (!existsSync(dir)) return [];
  const started = (d: string) => {
    try {
      return readSession(d).started;
    } catch {
      return "";
    }
  };
  return readdirSync(dir)
    .map((d) => join(dir, d))
    .filter((d) => started(d))
    .sort((a, b) => started(b).localeCompare(started(a)));
}

// Shell entry: `node jeyna-mcp.mjs validate [runDir]`. One `path: message` line per error; exit 1 on errors (F8.2).
export function validateCli(arg: string | undefined, root: () => string): number {
  try {
    const dir = arg ? resolve(arg) : runs(root())[0];
    if (!dir) throw new Error(`No run folders in ${join(root(), ".jeyna", "playtests")}.`);
    const errors = validateRun(dir);
    for (const e of errors) console.log(relative(process.cwd(), join(dir, e.slice(0, e.indexOf(": ")))) + e.slice(e.indexOf(": ")));
    console.error(errors.length ? `${errors.length} errors in ${dir}` : `ok: ${dir}`);
    return errors.length ? 1 : 0;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

export function registerFinishTools(server: McpServer, getContext: () => { root: string }) {
  server.registerTool(
    "validate",
    {
      description:
        "Check a run folder: every finding parses with its sections, evidence exists, bugs have evidence, every case has a verdict, report.md exists when done. Returns {run, errors}; each error is `path: message`. Defaults to the running run, else the latest.",
      inputSchema: { run: z.string().optional().describe("Run id or run folder path; default: the current run") },
      annotations: { readOnlyHint: true },
    },
    async ({ run }) => {
      try {
        const root = getContext().root;
        const dir = run ? resolve(root, ".jeyna", "playtests", run) : (current?.runDir ?? runs(root)[0]);
        if (!dir) throw new Error("No run to validate: no run is running and .jeyna/playtests/ has none.");
        if (!existsSync(dir)) throw new Error(`No run folder ${dir}.`);
        return ok({ run: dir, errors: validateRun(dir) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "session_finish",
    {
      description:
        "End the running run: runs the validate checks and refuses with the error list while any remain (the run stays running); otherwise writes report.md, sets status done and closes the browser contexts. Returns {reportPath, counts}.",
      inputSchema: { summary: z.string().min(1).describe("A short summary of the run for the top of report.md") },
    },
    async ({ summary }) => {
      try {
        if (!current) throw new Error("No running session. Call session_start first.");
        const { runDir, session } = current;
        const errors = validateRun(runDir);
        if (errors.length) {
          throw new Error(`The run stays running: fix these ${errors.length} errors, then call session_finish again.\n${errors.join("\n")}`);
        }
        session.summary = summary;
        session.finished = new Date().toISOString();
        const counts = report(runDir, session);
        session.status = "done";
        save(runDir, session);
        endRun();
        await closeContexts();
        return ok({ reportPath: join(runDir, "report.md"), counts });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_status",
    {
      description:
        "Change a finding's status (the only mutable field, D11). During a run, mark a cross-scenario duplicate with status duplicate and of: the finding it repeats. wontfix and fixed are for later sessions. Looks in the current run, then the newest run holding the id.",
      inputSchema: {
        id: z.string().describe("Finding id, e.g. PT-login-003"),
        status: z.enum(STATUSES),
        of: z.string().optional().describe("Required for duplicate: the id of the finding this one repeats"),
        note: z.string().min(1).optional(),
      },
    },
    async ({ id, status, of, note }) => {
      try {
        if (status === "duplicate" && !of) throw new Error(`A duplicate needs of: the id of the finding ${id} repeats.`);
        if (status !== "duplicate" && of) throw new Error("of is only for status duplicate.");
        const dirs = [...(current ? [current.runDir] : []), ...runs(getContext().root)];
        const runDir = dirs.find((d) => existsSync(join(d, "findings", `${id}.md`)));
        if (!runDir) throw new Error(`No finding ${id} in any run under .jeyna/playtests/.`);
        if (of === id) throw new Error("A finding cannot be a duplicate of itself.");
        if (of && !existsSync(join(runDir, "findings", `${of}.md`))) throw new Error(`No finding ${of} in ${runDir}; of must name a finding of the same run.`);
        const path = join(runDir, "findings", `${id}.md`);
        const m = splitFront(readFileSync(path, "utf8"));
        const front = m && (parse(m[1]) as Record<string, unknown>);
        if (!m || !front || typeof front !== "object") throw new Error(`${path} has no readable frontmatter; fix it by hand.`);
        // Rebuild in place so of and note sit right after status.
        const next: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(front)) {
          if (k === "of" || k === "note") continue;
          next[k] = k === "status" ? status : v;
          if (k === "status") Object.assign(next, of && { of }, note && { note });
        }
        writeFileSync(path, `---\n${stringify(next)}---\n${m[2]}`);
        return ok({ id, status, ...(of && { of }), path });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
