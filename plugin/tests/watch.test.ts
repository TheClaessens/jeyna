// Jeyna's Watch under `claude plugin test ./plugin`: the tick reads session.json through the engine's fs
// events and the band draws on the terminal surface, fills, swaps to the report, then goes (D34).
import { expect, mock, test } from "claude-code/testing";

const T0 = Date.parse("2026-10-17T18:02:20.000Z");
const ROOT = "/p";
const DIR = `${ROOT}/.jeyna/playtests`;
const session = (over: Record<string, unknown> = {}) => ({
  id: "2026-10-17-todos",
  flow: "todos",
  status: "running",
  started: new Date(T0).toISOString(),
  testers: [{ batch: 1, cases: ["t1-1440x900", "t1-390x844"] }],
  cases: [{ id: "t1-1440x900" }, { id: "t1-390x844" }],
  verdicts: [],
  ...over,
});
/** What the engine draws beneath the plugin when it passes: the kit has no engine band, so the test answers an empty Box. */
const EMPTY = { type: "Box" as const, props: {}, children: [] };
const PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} };

test("the band appears, fills, shows the report and goes", async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  let text = JSON.stringify(session());
  let mtimeMs = T0;
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("session.root", () => ({ value: ROOT }));
  on("ui.render", { component: "AbovePrompt" }, () => EMPTY);
  on("fs.list", (_, e) => ({ value: e.path === DIR ? [{ name: "2026-10-17-todos", kind: "dir" as const, size: 0, mtimeMs, isLink: false }] : [] }));
  on("fs.stat", () => ({ value: { kind: "file" as const, size: text.length, mtimeMs, isLink: false } }));
  on("fs.read", () => ({ value: text }));

  await $.session.start({ cwd: ROOT, surface: "terminal", isInteractive: true });
  await clock.advance(1000);
  const ui = await $.ui.mount({ plugin: "jeyna", surface: "terminal", component: "AbovePrompt", props: PROPS });
  expect(await ui.find({ type: "Text", text: /running · batch 1 of 1/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "▘" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "…" })).toBeDefined();

  text = JSON.stringify(session({ verdicts: [{ case: "t1-1440x900", result: "fail", findings: ["PT-todos-001"] }] }));
  mtimeMs = T0 + 5000;
  await clock.advance(5000);
  const word = (await ui.findAll({ type: "Text", text: "fail" })).find((el) => el.text === "fail");
  expect(word?.props.color).toBe("error");
  expect(await ui.find({ type: "Text", text: /1 of 2 cases · 1 finding/ })).toBeDefined();

  text = JSON.stringify(
    session({
      status: "done",
      finished: new Date(T0 + 10_000).toISOString(),
      verdicts: [
        { case: "t1-1440x900", result: "fail", findings: ["PT-todos-001"] },
        { case: "t1-390x844", result: "pass", findings: [] },
      ],
    }),
  );
  mtimeMs = T0 + 10_000;
  await clock.advance(5000);
  expect(await ui.find({ type: "Text", text: /report \.jeyna\/playtests\/2026-10-17-todos\/report\.md/ })).toBeDefined();

  await clock.advance(61_000);
  expect(await ui.find({ type: "Text", text: /todos/ })).toBeUndefined();
  expect(await ui.drawn()).toMatchObject(EMPTY);
  await ui.unmount();
});

test("nothing is drawn while no run is live", async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("session.root", () => ({ value: ROOT }));
  on("ui.render", { component: "AbovePrompt" }, () => EMPTY);
  on("fs.list", () => ({ value: [] }));
  await $.session.start({ cwd: ROOT, surface: "terminal", isInteractive: true });
  await clock.advance(2000);
  const ui = await $.ui.mount({ plugin: "jeyna", surface: "terminal", component: "AbovePrompt", props: PROPS });
  expect(await ui.drawn()).toMatchObject(EMPTY);
  await ui.unmount();
});
