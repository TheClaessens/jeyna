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

// A table row: one finding that stands on its own, with the findings marked duplicate of it folded under it.
export type Row = { finding: Parsed; duplicates: Parsed[] };

export const bySeverity = (a: Parsed, b: Parsed) =>
  SEVERITIES.indexOf(a.front.severity) - SEVERITIES.indexOf(b.front.severity) ||
  KINDS.indexOf(a.front.kind) - KINDS.indexOf(b.front.kind) ||
  a.id.localeCompare(b.id);

// Duplicates fold under the finding their `of` names and leave the counts (D11). One whose target is not in
// the run stands on its own, so it is never dropped from view.
export function rows(run: StudioRun): Row[] {
  const all = run.findings.filter(parsed).sort(bySeverity);
  const ids = new Set(all.map((f) => f.id));
  const folded = (f: Parsed) => f.front.status === "duplicate" && !!f.front.of && ids.has(f.front.of);
  return all
    .filter((f) => !folded(f))
    .map((finding) => ({ finding, duplicates: all.filter((d) => folded(d) && d.front.of === finding.id) }));
}

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
export function duration(fromIso: string, toIso: string | number): string {
  const s = Math.max(0, Math.round(((typeof toIso === "number" ? toIso : Date.parse(toIso)) - Date.parse(fromIso)) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h && `${h} h`, (h || m) && `${m} min`, !h && `${r} s`].filter(Boolean).join(" ");
}
export const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
};
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Thumbnail width for a 56 px tall crop of a screenshot, from the viewport's aspect ratio; never under 24 px (tokens).
export function thumbWidth(viewport: string): number {
  const [w, h] = viewport.split("x").map(Number);
  return w && h ? Math.max(24, Math.round((56 * w) / h)) : 56;
}

// Flow name for the big title and the rail: "exploratory:retest-todos" reads as retest-todos; retests are flagged.
export const flowName = (s: Session) => s.flow.replace(/^exploratory:/, "");
export const isRetest = (s: Session) => /^(exploratory:)?retest-/.test(s.flow);
