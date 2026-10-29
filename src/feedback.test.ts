// Feedback items on disk (D36): create, number, read back, edit, delete, and what each refuses.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createFeedback, deleteFeedback, feedbackDir, feedbackFile, readFeedback, updateFeedback } from "./feedback.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function project() {
  const root = mkdtempSync(join(tmpdir(), "jeyna-feedback-"));
  const run = join(root, ".jeyna", "playtests", "2026-10-17-todos");
  mkdirSync(join(run, "evidence"), { recursive: true });
  mkdirSync(join(run, "findings"));
  writeFileSync(join(run, "evidence", "t1-390x844-1-login.png"), Buffer.from(PNG, "base64"));
  writeFileSync(join(run, "findings", "PT-todos-001.md"), "---\n---\n");
  return root;
}

const snap = { text: "The button is too small", capture: "snap" as const, frames: [{ png: PNG, ms: 0 }], source: "live" as const };

test("items are numbered across the project; a snap is one PNG, a recording one PNG per frame; both read back", () => {
  const root = project();
  const a = createFeedback(root, snap, new Date("2026-10-20T10:00:00Z"));
  const b = createFeedback(root, {
    text: "  Spinner flickers\n\nthen the list jumps  ", capture: "recording", source: "evidence", run: "2026-10-17-todos", evidence: "t1-390x844-1-login.png", finding: "PT-todos-001",
    frames: [{ png: PNG, ms: 0 }, { png: PNG, ms: 500 }],
  });
  expect([a.id, b.id]).toEqual(["FB-001", "FB-002"]);
  expect(readdirSync(feedbackDir(root)).sort()).toEqual(["FB-001.md", "FB-001.png", "FB-002-01.png", "FB-002-02.png", "FB-002.md"]);
  const items = readFeedback(root);
  expect(items.map((i) => [i.id, i.errors])).toEqual([["FB-001", []], ["FB-002", []]]);
  expect(items[0].front).toMatchObject({ status: "open", capture: "snap", frames: [{ file: "FB-001.png", ms: 0 }], source: "live", created: "2026-10-20T10:00:00.000Z" });
  expect(items[1].text).toBe("Spinner flickers\n\nthen the list jumps");
  expect(items[1].front).toMatchObject({ run: "2026-10-17-todos", evidence: "t1-390x844-1-login.png", finding: "PT-todos-001", frames: [{ ms: 0 }, { ms: 500 }] });
});

test("create refuses what is not a PNG, a snap of two frames, evidence that does not exist, a back-reference on live", () => {
  const root = project();
  expect(() => createFeedback(root, { ...snap, frames: [{ png: Buffer.from("<svg/>").toString("base64"), ms: 0 }] })).toThrow("frame 1 is not a PNG");
  expect(() => createFeedback(root, { ...snap, frames: [{ png: PNG, ms: 0 }, { png: PNG, ms: 1 }] })).toThrow("a snap has exactly one frame");
  expect(() => createFeedback(root, { ...snap, source: "evidence", run: "2026-10-17-todos", evidence: "../../x.png" })).toThrow("No evidence");
  expect(() => createFeedback(root, { ...snap, source: "evidence", run: "../..", evidence: "x.png" })).toThrow(/run must be a run id/);
  expect(() => createFeedback(root, { ...snap, run: "2026-10-17-todos" })).toThrow("only for feedback on evidence");
  expect(() => createFeedback(root, { ...snap, text: "   " })).toThrow();
  expect(existsSync(feedbackDir(root)) ? readdirSync(feedbackDir(root)) : []).toEqual([]);
});

test("a live item keeps the page url and viewport it was captured at; evidence items take neither (D37)", () => {
  const root = project();
  const viewport = { width: 1512, height: 860, dpr: 2 };
  createFeedback(root, { ...snap, url: "http://localhost:4173/login", viewport });
  expect(readFeedback(root)[0]).toMatchObject({ errors: [], front: { url: "http://localhost:4173/login", viewport } });
  const onEvidence = { ...snap, source: "evidence" as const, run: "2026-10-17-todos", evidence: "t1-390x844-1-login.png" };
  expect(() => createFeedback(root, { ...onEvidence, url: "http://localhost:4173/login" })).toThrow("url and viewport are only for feedback on Live");
  expect(() => createFeedback(root, { ...onEvidence, viewport })).toThrow("url and viewport are only for feedback on Live");
  expect(() => createFeedback(root, { ...snap, viewport: { width: 0, height: 860, dpr: 2 } })).toThrow();
});

test("text changes only while open; a new status drops the old note; delete removes the item and its frames", () => {
  const root = project();
  createFeedback(root, snap);
  updateFeedback(root, "FB-001", { text: "Make it 44 px" });
  updateFeedback(root, "FB-001", { status: "processed", note: "bumped to 44 px" });
  expect(readFeedback(root)[0]).toMatchObject({ text: "Make it 44 px", front: { status: "processed", note: "bumped to 44 px" } });
  expect(() => updateFeedback(root, "FB-001", { text: "x" })).toThrow("FB-001 is processed; only an open item's text can change. Reopen it first.");
  updateFeedback(root, "FB-001", { status: "done" });
  expect(readFeedback(root)[0].front?.note).toBeUndefined();
  expect(() => updateFeedback(root, "../x", { status: "done" })).toThrow("A feedback id looks like FB-001");
  expect(() => updateFeedback(root, "FB-009", { status: "done" })).toThrow("No feedback FB-009");
  deleteFeedback(root, "FB-001");
  expect(readdirSync(feedbackDir(root))).toEqual([]);
  expect(createFeedback(root, snap).id).toBe("FB-001");
});

test("a hand-broken item still lists with its errors; capture files resolve by bare name only", () => {
  const root = project();
  createFeedback(root, snap);
  const file = join(feedbackDir(root), "FB-001.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("status: open", "status: maybe"));
  writeFileSync(join(feedbackDir(root), "FB-002.md"), "no frontmatter");
  expect(readFeedback(root).map((i) => [i.id, i.errors.length > 0, !!i.front])).toEqual([["FB-001", true, false], ["FB-002", true, false]]);
  expect(feedbackFile(root, "FB-001.png")).toBe(join(feedbackDir(root), "FB-001.png"));
  for (const bad of ["../FB-001.png", "FB-001.md", "x.png"]) expect(() => feedbackFile(root, bad)).toThrow();
});
