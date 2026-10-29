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

test("counts follow the report: live findings per severity, duplicates apart, verdicts per result", () => {
  expect(m.counts(run)).toMatchObject({ cases: 2, pass: 1, fail: 1, blocked: 0, skipped: 0, findings: 2, critical: 1, minor: 1, major: 0, duplicates: 2 });
});

test("filters: lists, verdict through folded duplicates, search, toggling", () => {
  const rows = m.rows(run);
  expect(m.filterRows(rows, run.session, { severity: "critical" }).map((r) => r.finding.id)).toEqual(["PT-f-002"]);
  expect(m.filterRows(rows, run.session, { kind: "a11y,bug" })).toHaveLength(3);
  expect(m.filterRows(rows, run.session, { verdict: "fail" }).map((r) => r.finding.id)).toEqual(["PT-f-002", "PT-f-004", "PT-f-001"]);
  expect(m.filterRows(rows, run.session, { verdict: "pass" })).toHaveLength(0);
  expect(m.filterRows(rows, run.session, { q: "f-004" }).map((r) => r.finding.id)).toEqual(["PT-f-004"]);
  expect(m.toggled("critical", "major")).toBe("critical,major");
  expect(m.toggled("critical,major", "major")).toBe("critical");
  expect(m.toggled("major", "major")).toBeUndefined();
  expect(m.showDuplicates({})).toBe(true);
  expect(m.showDuplicates({ dups: "0" })).toBe(false);
});

test("matrix, duration and thumbnails", () => {
  const mx = m.matrix(run.session!);
  expect(mx.viewports).toEqual(["390x844", "1440x900"]);
  expect(mx.rows[0].cells[0].verdict?.result).toBe("fail");
  expect(m.duration("2026-10-17T18:04:10.342Z", "2026-10-17T18:05:51.890Z")).toBe("1 min 42 s");
  expect(m.duration("2026-10-17T18:04:10.342Z", "2026-10-17T18:04:37.000Z")).toBe("27 s");
  expect(m.thumbWidth("1440x900")).toBe(90);
  expect(m.thumbWidth("390x844")).toBe(26);
  expect(m.flowName({ flow: "exploratory:retest-todos" } as never)).toBe("retest-todos");
});
