// Jeyna's Watch: the band from session.json fixtures (D34). The hooks module is glue over these functions.
import { describe, expect, it } from "vitest";
import { abbreviate, band, LINGER_MS, pickRun, plain, watch, type WatchRun, type WatchSession } from "../plugin/hooks/watch/band.js";

const ROOT = "/p";
const T0 = Date.parse("2026-10-17T18:02:20.000Z");

const session = (over: Partial<WatchSession> = {}): WatchSession => ({
  id: "2026-10-17-todos",
  flow: "todos",
  status: "running",
  started: new Date(T0).toISOString(),
  testers: [
    { batch: 1, cases: ["t1-1440x900", "t1-390x844"] },
    { batch: 1, cases: ["t2-1440x900", "t2-390x844"] },
    { batch: 2, cases: ["t3-1440x900", "t3-390x844"] },
  ],
  cases: ["t1-1440x900", "t1-390x844", "t2-1440x900", "t2-390x844", "t3-1440x900", "t3-390x844"].map((id) => ({ id })),
  verdicts: [],
  ...over,
});
const run = (s: WatchSession, mtimeMs = T0, invalid?: boolean): WatchRun => ({ path: `${ROOT}/.jeyna/playtests/${s.id}`, mtimeMs, session: s, invalid });

describe("case ids", () => {
  it("drops the viewport height", () => {
    expect(abbreviate("t1-1440x900")).toBe("t1-1440");
    expect(abbreviate("t12-390x844")).toBe("t12-390");
    expect(abbreviate("scout")).toBe("scout");
  });
});

describe("a running run", () => {
  it("shows flow, id, batch, tally, every case pending and the run path", () => {
    const b = band(run(session(), T0 + 4_000), T0 + 65_000, ROOT);
    expect(plain(b)).toEqual([
      "▘ ▗▄▄▄▄▄▄▖ todos  2026-10-17-todos  running · batch 1 of 2  0 of 6 cases · 0 findings · 1:05",
      "▌ ▐▛███▜▌▐ t1-1440 …  t1-390 …  t2-1440 …  t2-390 …  t3-1440 …  t3-390 …",
      "▌▝▜█▌█▐█▛▘ last change 61s ago · .jeyna/playtests/2026-10-17-todos",
    ]);
    expect(b.crab[0][0]).toEqual({ text: "▘", color: "#8FD3FF" });
    expect(b.crab[2].map((c) => c.color)).toEqual(["#8B5A2B", "#D97757", "#2E5A8F", "#2E5A8F", "#C9A24A", "#2E5A8F", "#C9A24A", "#2E5A8F", "#2E5A8F", "#C9A24A"]);
    expect(b.cases.filter((c) => c.text === "…").every((c) => c.dim)).toBe(true);
  });

  it("colours verdicts and moves to the next batch once batch 1 is judged", () => {
    const s = session({
      verdicts: [
        { case: "t1-1440x900", result: "fail", findings: ["PT-todos-001"] },
        { case: "t1-390x844", result: "fail", findings: ["PT-todos-001", "PT-todos-002"] },
        { case: "t2-1440x900", result: "pass", findings: [] },
        { case: "t2-390x844", result: "blocked", findings: [] },
      ],
    });
    const b = band(run(s), T0 + 90_000, ROOT);
    expect(plain(b)[0]).toContain("running · batch 2 of 2  4 of 6 cases · 2 findings · 1:30");
    expect(plain(b)[1]).toBe("▌ ▐▛███▜▌▐ t1-1440 fail  t1-390 fail  t2-1440 pass  t2-390 blocked  t3-1440 …  t3-390 …");
    const colour = (word: string) => b.cases.find((c) => c.text === word)?.color;
    expect([colour("fail"), colour("pass"), colour("blocked")]).toEqual(["error", "success", "warning"]);
  });

  it("turns the staff tip amber while session.json does not parse", () => {
    expect(band(run(session(), T0, true), T0, ROOT).crab[0][0].color).toBe("warning");
  });
});

describe("a finished run", () => {
  const done = session({
    status: "done",
    finished: new Date(T0 + 90_000).toISOString(),
    verdicts: [
      { case: "t1-1440x900", result: "pass", findings: [] },
      { case: "t1-390x844", result: "skipped", findings: [] },
      { case: "t2-1440x900", result: "pass", findings: [] },
      { case: "t2-390x844", result: "pass", findings: [] },
      { case: "t3-1440x900", result: "fail", findings: ["PT-todos-001"] },
      { case: "t3-390x844", result: "pass", findings: [] },
    ],
  });

  it("done: line 1 says done, the clock stops at finished, line 3 is the report path", () => {
    const lines = plain(band(run(done, T0 + 90_000), T0 + 120_000, ROOT));
    expect(lines[0]).toBe("▘ ▗▄▄▄▄▄▄▖ todos  2026-10-17-todos  done  6 of 6 cases · 1 finding · 1:30");
    expect(lines[2]).toBe("▌▝▜█▌█▐█▛▘ report .jeyna/playtests/2026-10-17-todos/report.md");
  });

  it("aborted: says so with the run path", () => {
    const aborted = session({ status: "aborted", finished: new Date(T0 + 30_000).toISOString() });
    const lines = plain(band(run(aborted), T0 + 40_000, ROOT));
    expect(lines[0]).toContain("aborted  0 of 6 cases · 0 findings · 0:30");
    expect(lines[2]).toBe("▌▝▜█▌█▐█▛▘ aborted · .jeyna/playtests/2026-10-17-todos");
  });

  it("lingers a minute after the end, then the band is gone", () => {
    const r = run(done, T0 + 90_000);
    expect(pickRun([r], T0 + 90_000 + LINGER_MS - 1)).toBe(r);
    expect(watch([r], T0 + 90_000 + LINGER_MS, ROOT)).toBeNull();
  });
});

describe("which run", () => {
  it("prefers the newest running run over an older one and over anything finished", () => {
    const old = run(session({ id: "2026-10-16-auth", started: new Date(T0 - 3_600_000).toISOString() }));
    const fresh = run(session({ id: "2026-10-17-todos-2", started: new Date(T0 + 1000).toISOString() }));
    const finished = run(session({ id: "2026-10-17-todos", status: "done", finished: new Date(T0 + 2000).toISOString() }));
    expect(pickRun([finished, old, fresh], T0 + 5000)?.session.id).toBe("2026-10-17-todos-2");
  });

  it("renders nothing with no runs or only old finished runs", () => {
    expect(watch([], T0, ROOT)).toBeNull();
    const stale = run(session({ status: "done", finished: new Date(T0).toISOString() }));
    expect(watch([stale], T0 + 3_600_000, ROOT)).toBeNull();
  });

  it("appears, fills and disappears across one run's life", () => {
    const s = session();
    const judged = { ...s, verdicts: [{ case: "t1-1440x900", result: "pass" as const, findings: [] }] };
    const frames = [
      watch([], T0, ROOT),
      watch([run(s, T0)], T0 + 1000, ROOT),
      watch([run(judged, T0 + 20_000)], T0 + 21_000, ROOT),
      watch([run({ ...judged, status: "done", finished: new Date(T0 + 60_000).toISOString() }, T0 + 60_000)], T0 + 61_000, ROOT),
      watch([run({ ...judged, status: "done", finished: new Date(T0 + 60_000).toISOString() }, T0 + 60_000)], T0 + 60_000 + LINGER_MS + 1, ROOT),
    ];
    expect(frames.map((f) => (f ? plain(f)[1].includes("pass") : null))).toEqual([null, false, true, true, null]);
  });
});
