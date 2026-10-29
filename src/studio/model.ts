// The studio's view model: pure functions over the index, shared by the run and finding screens and
// unit-tested in node (no DOM, no node modules), so the browser bundle stays free of server code.
import type { Session } from "../schema.js";
import type { FindingFront } from "../validate.js";
import type { StudioFinding, StudioRun } from "./types.js";

// Sort orders. validate.ts owns the canonical lists (from the zod schema); model.test.ts checks these match.
export const SEVERITIES = ["critical", "major", "minor", "note"] as const;
export const KINDS = ["bug", "ux", "a11y", "question"] as const;
export const STATUSES = ["open", "duplicate", "wontfix", "fixed"] as const;
export const RESULTS = ["pass", "fail", "blocked", "skipped"] as const;

export type Parsed = StudioFinding & { front: FindingFront };
export const parsed = (f: StudioFinding): f is Parsed => !!f.front;

// One finding that stands on its own, with the findings marked duplicate of it folded under it.
export type Row = { finding: Parsed; duplicates: Parsed[] };

export const bySeverity = (a: Parsed, b: Parsed) =>
  SEVERITIES.indexOf(a.front.severity) - SEVERITIES.indexOf(b.front.severity) ||
  KINDS.indexOf(a.front.kind) - KINDS.indexOf(b.front.kind) ||
  a.id.localeCompare(b.id);

// Duplicates fold under the finding their `of` names (D11). One whose target is not in the run stands on its own,
// so it is never dropped from view.
export function rows(run: StudioRun): Row[] {
  const all = run.findings.filter(parsed).sort(bySeverity);
  const ids = new Set(all.map((f) => f.id));
  const folded = (f: Parsed) => f.front.status === "duplicate" && !!f.front.of && ids.has(f.front.of);
  return all
    .filter((f) => !folded(f))
    .map((finding) => ({ finding, duplicates: all.filter((d) => folded(d) && d.front.of === finding.id) }));
}

// A problem: a finding that stands on its own with every duplicate folded under it, one card on the run screen.
// It takes the highest severity of its members and lists the cases they were seen in, in the session's case order.
// Fixed and wontfix problems sort last; within each, severity, then the lead finding's kind and id.
export type Problem = { lead: Parsed; members: Parsed[]; severity: FindingFront["severity"]; cases: string[]; closed: boolean };
export function problems(run: StudioRun): Problem[] {
  const order = run.session?.cases.map((c) => c.id) ?? [];
  const rank = (c: string) => order.indexOf(c) + 1 || order.length + 1;
  return rows(run)
    .map(({ finding, duplicates }) => {
      const members = [finding, ...duplicates];
      return {
        lead: finding,
        members,
        severity: SEVERITIES[Math.min(...members.map((f) => SEVERITIES.indexOf(f.front.severity)))],
        cases: [...new Set(members.map((f) => f.front.case))].sort((a, b) => rank(a) - rank(b)),
        closed: finding.front.status === "fixed" || finding.front.status === "wontfix",
      };
    })
    .sort((a, b) => +a.closed - +b.closed || SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || bySeverity(a.lead, b.lead));
}
// Which problem a finding belongs to, as its lead or a member; -1 when none (a file that does not parse).
export const problemOf = (ps: Problem[], id: string) => ps.findIndex((p) => p.members.some((f) => f.id === id));

// The pips beside a run in the sidebar: one mark per case in case order (outline when it has no verdict), thinner
// from 9 cases, and from 17 one bar split by verdict with the counts in its title.
export type Mark = "pass" | "fail" | "blocked" | "none";
export type Pips = { dense: boolean; marks: Mark[] } | { bar: Record<Mark, number>; title: string };
const MARK_WORD: Record<Mark, string> = { pass: "pass", fail: "fail", blocked: "blocked", none: "no verdict" };
export function pips(s: Session | null): Pips {
  const marks = (s?.cases ?? []).map((c): Mark => {
    const r = s!.verdicts.find((v) => v.case === c.id)?.result;
    return r === "pass" || r === "fail" || r === "blocked" ? r : "none";
  });
  if (marks.length <= 16) return { dense: marks.length > 8, marks };
  const bar: Record<Mark, number> = { pass: 0, fail: 0, blocked: 0, none: 0 };
  for (const k of marks) bar[k]++;
  const title = (Object.keys(bar) as Mark[]).filter((k) => bar[k]).map((k) => `${bar[k]} ${MARK_WORD[k]}`).join(" · ");
  return { bar, title };
}

// A run's outcome: the words under it in the sidebar and the score at the top of its page (`count` of `of` cases
// `verb`). Any fail leads; else the passes. A running run counts what it played; an aborted one scores what it judged.
export type Outcome = { tone: "pass" | "fail" | "blocked" | "running" | "aborted"; count: number; of: number; verb: "failed" | "passed" | "played"; text: string };
export function outcome(s: Session): Outcome {
  const judged = s.verdicts.length;
  const fail = s.verdicts.filter((v) => v.result === "fail").length;
  const pass = s.verdicts.filter((v) => v.result === "pass").length;
  if (s.status === "running") return { tone: "running", count: judged, of: s.cases.length, verb: "played", text: `${judged} of ${s.cases.length} played` };
  const of = s.status === "aborted" ? judged : s.cases.length;
  const score = !of ? { count: 0, of: s.cases.length, verb: "played" as const } : fail ? { count: fail, of, verb: "failed" as const } : { count: pass, of, verb: "passed" as const };
  if (s.status === "aborted") return { tone: "aborted", ...score, text: "aborted" };
  if (fail) return { tone: "fail", ...score, text: `${fail} of ${of} failed` };
  return pass === of && of ? { tone: "pass", ...score, text: "passed" } : { tone: "blocked", ...score, text: `${pass} of ${of} passed` };
}

// Evidence files are <caseId>-<n>-<label>.png; a case's last screenshot is the one with the highest n.
export function lastEvidence(files: string[], caseId: string): string | undefined {
  let best: string | undefined;
  let n = -1;
  for (const f of files) {
    const k = f.startsWith(`${caseId}-`) ? /^(\d+)-.*\.(png|jpe?g|webp)$/i.exec(f.slice(caseId.length + 1)) : null;
    if (k && Number(k[1]) > n) [best, n] = [f, Number(k[1])];
  }
  return best;
}

// Scenario × viewport matrix: one row per scenario of the run, one column per viewport the cases cover, in order.
export type Cell = { caseId?: string; verdict?: Session["verdicts"][number] };
export function matrix(session: Session): { viewports: string[]; rows: { scenario: Session["scenarios"][number]; cells: Cell[] }[] } {
  const viewports = [...new Set(session.cases.map((c) => c.viewport))];
  return {
    viewports,
    rows: session.scenarios.map((scenario) => ({
      scenario,
      cells: viewports.map((vp) => {
        const c = session.cases.find((c) => c.scenario === scenario.name && c.viewport === vp);
        return { caseId: c?.id, verdict: c && session.verdicts.find((v) => v.case === c.id) };
      }),
    })),
  };
}

// A viewport string ("390x844") as the studio names it: Phone, Tablet or Desktop by width, and taller than wide or not.
export function viewport(vp: string) {
  const [w, h] = vp.split("x").map(Number);
  return { w, h, tall: h > w, label: w < 600 ? "Phone" : w < 1024 ? "Tablet" : "Desktop", size: `${w}×${h}` };
}

// --- Small formatters, local time (the ISO value stays in a title attribute where it matters).
const pad = (n: number) => String(n).padStart(2, "0");
export function clock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(iso)}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const day = (iso: string) => `${new Date(iso).getDate()} ${MONTHS[new Date(iso).getMonth()]}`;
export const hm = (iso: string) => clock(iso).slice(0, 5);
export function duration(fromIso: string, toIso: string | number): string {
  const s = Math.max(0, Math.round(((typeof toIso === "number" ? toIso : Date.parse(toIso)) - Date.parse(fromIso)) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h && `${h} h`, (h || m) && `${m} min`, !h && `${r} s`].filter(Boolean).join(" ");
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Flow name for the eyebrow and the sidebar: "exploratory:retest-todos" reads as retest-todos.
export const flowName = (s: Session) => s.flow.replace(/^exploratory:/, "");

// --- The old run screen's helpers, until the redesigned screens replace it.
export type Counts = { cases: number; findings: number; duplicates: number } & Record<(typeof RESULTS)[number] | (typeof SEVERITIES)[number], number>;

// The report's two count rows (finish.ts): verdicts per result; live findings (status not duplicate) per severity.
export function counts(run: StudioRun): Counts {
  const all = run.findings.filter(parsed);
  const live = all.filter((f) => f.front.status !== "duplicate");
  const verdicts = run.session?.verdicts ?? [];
  return {
    cases: run.session?.cases.length ?? 0,
    ...(Object.fromEntries(RESULTS.map((r) => [r, verdicts.filter((v) => v.result === r).length])) as Record<(typeof RESULTS)[number], number>),
    findings: live.length,
    ...(Object.fromEntries(SEVERITIES.map((s) => [s, live.filter((f) => f.front.severity === s).length])) as Record<(typeof SEVERITIES)[number], number>),
    duplicates: all.length - live.length,
  };
}

// Filters live in the URL as plain strings; list-valued ones are comma-joined (?severity=critical,major).
export type Filters = {
  verdict?: string;
  severity?: string;
  kind?: string;
  status?: string;
  scenario?: string;
  viewport?: string;
  q?: string;
  dups?: string; // "0" hides the folded duplicates; anything else shows them
};
export const FILTER_KEYS = ["verdict", "severity", "kind", "status", "scenario", "viewport", "q", "dups"] as const;

export const list = (s: string | undefined) => (s ? s.split(",").filter(Boolean) : []);
export const toggled = (s: string | undefined, v: string) => {
  const l = list(s);
  const next = l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
  return next.length ? next.join(",") : undefined;
};
export const showDuplicates = (f: Filters) => f.dups !== "0";

// Rows that pass every active filter. A list filter with nothing selected passes everything.
// The verdict filter keeps rows whose finding, or a folded duplicate of it, was seen in a case with that verdict.
export function filterRows(all: Row[], session: Session | null, f: Filters): Row[] {
  const has = (sel: string | undefined, v: string) => !list(sel).length || list(sel).includes(v);
  const cases = f.verdict ? new Set(session?.verdicts.filter((v) => v.result === f.verdict).map((v) => v.case)) : null;
  const q = f.q?.trim().toLowerCase();
  return all.filter(({ finding, duplicates }) => {
    const fr = finding.front;
    if (cases && ![finding, ...duplicates].some((d) => cases.has(d.front.case))) return false;
    if (!has(f.severity, fr.severity) || !has(f.kind, fr.kind) || !has(f.status, fr.status)) return false;
    if (!has(f.scenario, fr.scenario) || !has(f.viewport, fr.viewport)) return false;
    if (q && ![finding.title ?? "", finding.id, fr.route].some((t) => t.toLowerCase().includes(q))) return false;
    return true;
  });
}

export const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
};
// Thumbnail width for a 56 px tall crop of a screenshot, from the viewport's aspect ratio; never under 24 px (tokens).
export function thumbWidth(viewport: string): number {
  const [w, h] = viewport.split("x").map(Number);
  return w && h ? Math.max(24, Math.round((56 * w) / h)) : 56;
}

export const isRetest = (s: Session) => /^(exploratory:)?retest-/.test(s.flow);
