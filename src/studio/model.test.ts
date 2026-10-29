import { expect, test } from "vitest";
import { KINDS, SEVERITIES, STATUSES } from "../validate.js";
import * as m from "./model.js";
import type { StudioFinding, StudioRun } from "./types.js";

test("the model's sort orders are the schema's", () => {
  expect([...m.SEVERITIES]).toEqual([...SEVERITIES]);
  expect([...m.KINDS]).toEqual([...KINDS]);
  expect([...m.STATUSES]).toEqual([...STATUSES]);
});

const finding = (id: string, severity: string, kind: string, status = "open", of?: string, extra: Partial<StudioFinding> = {}): StudioFinding => ({
  id,
  path: `findings/${id}.md`,
  source: "",
  errors: [],
  sections: {},
  title: `Title ${id}`,
  front: { schema: 1, id, kind, severity, status, of, flow: "f", case: "t1-390x844", scenario: "S", route: "/x", viewport: "390x844", browser: "b", build: "0", created: "2026-10-17T18:04:45.550Z", evidence: [] } as never,
  ...extra,
});

const run: StudioRun = {
  id: "r",
  session: {
    schema: 1, id: "r", flow: "f", app: "a", build: "0", status: "done", started: "2026-10-17T18:04:10.342Z", finished: "2026-10-17T18:05:51.890Z", mode: "guided",
    scenarios: [{ name: "S", description: "d", pass: "p" }],
    testers: [], cases: [{ id: "t1-390x844", scenario: "S", viewport: "390x844" }, { id: "t1-1440x900", scenario: "S", viewport: "1440x900" }],
    verdicts: [{ case: "t1-390x844", result: "fail", findings: ["PT-f-001"] }, { case: "t1-1440x900", result: "pass", findings: [] }],
  },
  errors: [], since: null, report: true, evidence: [],
  findings: [
    finding("PT-f-001", "minor", "a11y"),
    finding("PT-f-002", "critical", "bug"),
    finding("PT-f-003", "major", "bug", "duplicate", "PT-f-002"),
    finding("PT-f-004", "major", "a11y", "duplicate", "PT-f-999"), // dangling: stands on its own
    { id: "PT-f-005", path: "findings/PT-f-005.md", source: "broken", errors: ["no YAML frontmatter between --- lines"], sections: {} },
  ],
};

test("duplicates fold under their target, a dangling one stands alone, a broken file is not a row", () => {
  const rows = m.rows(run);
  expect(rows.map((r) => r.finding.id)).toEqual(["PT-f-002", "PT-f-004", "PT-f-001"]); // severity, then kind, then id
  expect(rows[0].duplicates.map((d) => d.id)).toEqual(["PT-f-003"]);
});

// A finding seen in another case: `extra` front fields over the defaults.
const seen = (id: string, severity: string, front: Record<string, unknown>) => {
  const f = finding(id, severity, "bug");
  return { ...f, front: { ...f.front!, ...front } } as StudioFinding;
};

test("problems: one per canonical finding with its duplicates, highest severity, the cases it hit, closed ones last", () => {
  const r: StudioRun = {
    ...run,
    findings: [
      seen("PT-f-001", "minor", { case: "t1-390x844" }),
      seen("PT-f-002", "major", { case: "t1-1440x900" }),
      seen("PT-f-003", "critical", { status: "duplicate", of: "PT-f-002", case: "t1-390x844" }),
      seen("PT-f-004", "critical", { status: "fixed" }),
      seen("PT-f-005", "minor", { status: "duplicate", of: "PT-f-002", case: "t1-1440x900" }),
    ],
  };
  const ps = m.problems(r);
  expect(ps.map((p) => p.lead.id)).toEqual(["PT-f-002", "PT-f-001", "PT-f-004"]);
  expect(ps[0]).toMatchObject({ severity: "critical", closed: false });
  expect(ps[0].members.map((f) => f.id)).toEqual(["PT-f-002", "PT-f-003", "PT-f-005"]);
  expect(ps[0].cases).toEqual(["t1-390x844", "t1-1440x900"]); // session case order, once each
  expect(ps[2]).toMatchObject({ severity: "critical", closed: true });
  expect(m.problemOf(ps, "PT-f-005")).toBe(0);
  expect(m.problemOf(ps, "PT-f-001")).toBe(1);
  expect(m.problemOf(ps, "PT-f-999")).toBe(-1);
});

// A session of `cases` cases with one verdict per result given, in order.
const played = (status: "running" | "done" | "aborted", results: string[], cases = results.length) =>
  ({
    ...run.session!,
    status,
    cases: Array.from({ length: cases }, (_, i) => ({ id: `c${i}`, scenario: "S", viewport: `${i}x1` })),
    verdicts: results.map((result, i) => ({ case: `c${i}`, result, findings: [] })),
  }) as never;

test("pips: one mark per case in case order, thinner past 8, one bar past 16", () => {
  expect(m.pips(played("done", ["fail", "pass", "blocked", "skipped"], 5))).toEqual({ dense: false, marks: ["fail", "pass", "blocked", "none", "none"] });
  expect(m.pips(played("done", Array(9).fill("pass")))).toMatchObject({ dense: true });
  expect(m.pips(played("done", Array(16).fill("pass")))).toMatchObject({ dense: true, marks: Array(16).fill("pass") });
  const bar = m.pips(played("done", [...Array(21).fill("pass"), ...Array(6).fill("fail"), ...Array(3).fill("blocked")], 32));
  expect(bar).toEqual({ bar: { pass: 21, fail: 6, blocked: 3, none: 2 }, title: "21 pass · 6 fail · 3 blocked · 2 no verdict" });
  expect(m.pips(null)).toEqual({ dense: false, marks: [] });
});

test("outcome: the words under a run in the sidebar and its score", () => {
  expect(m.outcome(played("done", ["fail", "pass", "fail", "blocked"]))).toEqual({ tone: "fail", count: 2, of: 4, verb: "failed", text: "2 of 4 failed" });
  expect(m.outcome(played("done", ["pass", "pass"]))).toEqual({ tone: "pass", count: 2, of: 2, verb: "passed", text: "passed" });
  expect(m.outcome(played("done", ["pass", "blocked"]))).toEqual({ tone: "blocked", count: 1, of: 2, verb: "passed", text: "1 of 2 passed" });
  expect(m.outcome(played("running", ["fail"], 6))).toEqual({ tone: "running", count: 1, of: 6, verb: "played", text: "1 of 6 played" });
  expect(m.outcome(played("aborted", ["fail", "pass"], 6))).toEqual({ tone: "aborted", count: 1, of: 2, verb: "failed", text: "aborted" });
  expect(m.outcome(played("aborted", [], 6))).toEqual({ tone: "aborted", count: 0, of: 6, verb: "played", text: "aborted" });
});

test("the last evidence of a case is its highest-numbered screenshot", () => {
  const files = ["t1-390x844-1-login.png", "t1-390x844-10-end.png", "t1-390x844-2-added.png", "t1-1440x900-3-x.png", "notes.txt"];
  expect(m.lastEvidence(files, "t1-390x844")).toBe("t1-390x844-10-end.png");
  expect(m.lastEvidence(files, "t1-1440x900")).toBe("t1-1440x900-3-x.png");
  expect(m.lastEvidence(files, "t2-390x844")).toBeUndefined();
});

test("matrix, duration, dates and viewports", () => {
  const mx = m.matrix(run.session!);
  expect(mx.viewports).toEqual(["390x844", "1440x900"]);
  expect(mx.rows[0].cells[0].verdict?.result).toBe("fail");
  expect(m.duration("2026-10-17T18:04:10.342Z", "2026-10-17T18:05:51.890Z")).toBe("1 min 42 s");
  expect(m.duration("2026-10-17T18:04:10.342Z", "2026-10-17T18:04:37.000Z")).toBe("27 s");
  expect(m.viewport("390x844")).toEqual({ w: 390, h: 844, tall: true, label: "Phone", size: "390×844" });
  expect(m.viewport("1440x900")).toMatchObject({ tall: false, label: "Desktop", size: "1440×900" });
  expect(m.viewport("768x1024").label).toBe("Tablet");
  const local = new Date(2026, 9, 17, 20, 4, 9).toISOString();
  expect(m.day(local)).toBe("17 Oct");
  expect(m.hm(local)).toBe("20:04");
  expect(m.flowName({ flow: "exploratory:retest-todos" } as never)).toBe("retest-todos");
});
