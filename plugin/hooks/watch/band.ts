// Jeyna's Watch: the band's model from a run's session.json (D35). Pure: no engine, no clock of its own.
import type { WatchBand, WatchSpan } from "../../types/index.js";

export type { WatchBand, WatchSpan };

/** The fields of session.json the band reads; anything else is ignored. */
export type WatchSession = {
  id: string;
  flow: string;
  status: "running" | "done" | "aborted";
  started: string;
  finished?: string;
  testers?: { batch: number; cases: string[] }[];
  cases: { id: string }[];
  verdicts: { case: string; result: "pass" | "fail" | "blocked" | "skipped"; findings: string[] }[];
};

/** One run folder as the watcher found it. `session` is the last text that parsed; `invalid` says the current text did not. */
export type WatchRun = { path: string; mtimeMs: number; session: WatchSession; invalid?: boolean };

/** How long the band stays after a run ends. */
export const LINGER_MS = 60_000;

// Claw'd as Jaina Proudmoore, from the design canvas: quarter-block cells, one colour each.
const FROST = "#8FD3FF", WHITE = "#F2F3F5", BROWN = "#8B5A2B", CLAY = "#D97757", BLOND = "#E3C77A", BLUE = "#2E5A8F", GOLD = "#C9A24A";
export const DIM = "#6B8199";
const AMBER = "warning";

const cells = (chars: string, colors: (string | undefined)[]): WatchSpan[] =>
  [...chars].map((text, i) => (colors[i] ? { text, color: colors[i] } : { text }));

export function crab(tip = FROST): WatchSpan[][] {
  const hair = Array(8).fill(WHITE), face = Array(7).fill(CLAY);
  return [
    cells("▘ ▗▄▄▄▄▄▄▖", [tip, undefined, ...hair]),
    cells("▌ ▐▛███▜▌▐", [BROWN, undefined, ...face, BLOND]),
    cells("▌▝▜█▌█▐█▛▘", [BROWN, CLAY, BLUE, BLUE, GOLD, BLUE, GOLD, BLUE, BLUE, GOLD]),
  ];
}

/** `t1-1440x900` reads `t1-1440` on the band: the viewport's height adds nothing a column of ids needs. */
export const abbreviate = (caseId: string) => caseId.replace(/x\d+$/, "");

const VERDICT_COLOR = { pass: "success", fail: "error", blocked: "warning", skipped: "inactive" } as const;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The run to show at `now`: a running one (newest first), else one that ended within LINGER_MS, else none. */
export function pickRun(runs: WatchRun[], now: number): WatchRun | undefined {
  const by = (r: WatchRun) => Date.parse(r.session.started) || r.mtimeMs;
  const live = runs.filter((r) => r.session.status === "running").sort((a, b) => by(b) - by(a));
  if (live[0]) return live[0];
  const endedAt = (r: WatchRun) => Date.parse(r.session.finished ?? "") || r.mtimeMs;
  return runs
    .filter((r) => r.session.status !== "running" && now - endedAt(r) < LINGER_MS)
    .sort((a, b) => endedAt(b) - endedAt(a))[0];
}

/** The band for one run at `now`. `root` makes the run path relative. */
export function band(run: WatchRun, now: number, root: string): WatchBand {
  const s = run.session;
  const verdicts = new Map(s.verdicts.map((v) => [v.case, v]));
  const findings = new Set(s.verdicts.flatMap((v) => v.findings)).size;
  const testers = s.testers ?? [];
  const batches = Math.max(1, ...testers.map((t) => t.batch));
  const current = Math.min(batches, ...testers.filter((t) => t.cases.some((c) => !verdicts.has(c))).map((t) => t.batch));
  const endedAt = Date.parse(s.finished ?? "") || run.mtimeMs;
  const elapsed = (s.status === "running" ? now : endedAt) - Date.parse(s.started);
  const rel = run.path.startsWith(root + "/") ? run.path.slice(root.length + 1) : run.path;
  const dim = (text: string): WatchSpan => ({ text, dim: true });

  const head: WatchSpan[] = [{ text: s.flow }, dim(`  ${s.id}  ${s.status}`)];
  if (s.status === "running") head.push(dim(` · batch ${current} of ${batches}`));
  const tally = [dim(`${s.verdicts.length} of ${s.cases.length} cases · ${findings} finding${findings === 1 ? "" : "s"} · ${clock(elapsed)}`)];
  const cases = s.cases.flatMap((c, i) => {
    const v = verdicts.get(c.id);
    const id: WatchSpan = { text: `${i ? "  " : ""}${abbreviate(c.id)} ` };
    return [id, v ? { text: v.result, color: VERDICT_COLOR[v.result] } : dim("…")];
  });
  const foot =
    s.status === "done"
      ? [dim(`report ${rel}/report.md`)]
      : s.status === "aborted"
        ? [dim(`aborted · ${rel}`)]
        : [dim(`last change ${Math.max(0, Math.round((now - run.mtimeMs) / 1000))}s ago · ${rel}`)];

  return { crab: crab(run.invalid ? AMBER : FROST), head, tally, cases, foot };
}

/** What the band shows at `now` for these runs: a band, or null when nothing is live. */
export const watch = (runs: WatchRun[], now: number, root: string): WatchBand | null => {
  const run = pickRun(runs, now);
  return run ? band(run, now, root) : null;
};

/** The band as plain text, three lines, for a surface or a test that wants no colour. */
export const plain = (b: WatchBand): string[] => {
  const text = (row: WatchSpan[] = []) => row.map((c) => c.text).join("");
  const [top, mid, low] = b.crab;
  return [
    `${text(top)} ${text(b.head)}  ${text(b.tally)}`,
    `${text(mid)} ${text(b.cases)}`,
    `${text(low)} ${text(b.foot)}`,
  ];
};
