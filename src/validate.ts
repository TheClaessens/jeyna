// The run folder read back from disk: finding frontmatter schema, per-file parse, the validate checks (F8.1)
// and the since-last-run diff (D31). Pure fs + zod, no browser: the MCP server (finish.ts) and the studio
// sidecar both import it, so the studio validates with the same rules and never duplicates them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { FindingInput, type Session, SessionFile } from "./schema.js";
import { splitFront } from "./shared.js";

export const SEVERITIES = FindingInput.shape.severity.options;
export const KINDS = FindingInput.shape.kind.options;
export const STATUSES = ["open", "duplicate", "wontfix", "fixed"] as const;
export const SECTIONS = ["Steps", "Expected", "Actual", "Evidence", "Suggested next step"];

// Finding frontmatter (§5.2). Strict, so a hand edit with a misspelt key is reported.
export const FindingFront = z.strictObject({
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
export type FindingFront = z.infer<typeof FindingFront>;

export type Finding = { path: string; id: string; front?: FindingFront; title?: string; source: string; errors: string[] };

// Every findings/*.md of a run, parsed, with its own errors (F8.1). Paths are relative to the run folder.
// source is the whole file, so a reader can still show one that does not parse.
export function readFindings(runDir: string, session: Session): Finding[] {
  const dir = join(runDir, "findings");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      const f: Finding = { path: `findings/${file}`, id: file.slice(0, -3), source: text, errors: [] };
      const m = splitFront(text);
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

// session.json of a run folder, checked against the schema. Throws with the reason: the caller decides
// whether that is an error line (validate) or a needs-attention entry (studio).
export function readSession(runDir: string): Session {
  if (!existsSync(join(runDir, "session.json"))) throw new Error(`${runDir} is not a run folder: it has no session.json.`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(runDir, "session.json"), "utf8"));
  } catch (e) {
    throw new Error(`session.json is not valid JSON: ${(e as Error).message}`);
  }
  const r = SessionFile.safeParse(raw);
  if (!r.success) throw new Error(`session.json does not match the schema: ${z.prettifyError(r.error).split("\n").slice(0, 3).join("; ")}`);
  return r.data;
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

// Run folders under .jeyna/playtests/, newest first by start time. Folders whose session.json does not read are left out.
export function runs(root: string): string[] {
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

// The latest done run of the same flow started before this one: the baseline of "Since last run" (D31).
export function previousRun(runDir: string, session: Session): Session | undefined {
  const dir = join(runDir, "..");
  return readdirSync(dir)
    .flatMap((d) => {
      try {
        return [readSession(join(dir, d))];
      } catch {
        return [];
      }
    })
    .filter((s) => s.flow === session.flow && s.status === "done" && s.started < session.started)
    .sort((a, b) => b.started.localeCompare(a.started))[0];
}

export type Change = { scenario: string; viewport: string; was: string; now: string };
export type Since = { run: string; compared: number; changed: Change[] };

// Verdicts of this run against the previous one, per (scenario, viewport) that both runs played (D31).
export function since(session: Session, prev: Session | undefined): Since | undefined {
  if (!prev) return undefined;
  const verdictOf = (s: Session, scenario: string, viewport: string) => {
    const c = s.cases.find((c) => c.scenario === scenario && c.viewport === viewport);
    return c && s.verdicts.find((v) => v.case === c.id)?.result;
  };
  const out: Since = { run: prev.id, compared: 0, changed: [] };
  for (const { scenario, viewport } of session.cases) {
    const now = verdictOf(session, scenario, viewport);
    const was = verdictOf(prev, scenario, viewport);
    if (!now || !was) continue;
    out.compared++;
    if (now !== was) out.changed.push({ scenario, viewport, was, now });
  }
  return out;
}
