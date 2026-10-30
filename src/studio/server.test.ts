// The studio sidecar, driven over HTTP against the committed bundle plugin/studio/jeyna-studio.mjs: the index, a
// finding written mid-run arriving over SSE, a hand-broken file kept in the needs-attention lane, evidence served.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StudioIndex } from "./types.js";

let root: string;
let runDir: string;
let proc: ChildProcess;
let url: string;

// A 1x1 PNG, so evidence exists and a bug validates.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const finding = (id: string, kind: string, severity: string, status = "open", of?: string) => `---
schema: 1
id: ${id}
kind: ${kind}
severity: ${severity}
status: ${status}
${of ? `of: ${of}\n` : ""}flow: todos
case: t1-390x844
scenario: Sign-in page
route: /login
viewport: 390x844
browser: chromium 1
build: abc
created: 2026-10-17T18:04:45.550Z
evidence:
  - t1-390x844-1-login.png
---

# Title of ${id}

## Steps

1. Open /login

## Expected

A label

## Actual

No label

## Evidence

![t1-390x844-1-login.png](../evidence/t1-390x844-1-login.png)

## Suggested next step

None given.
`;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "jeyna-studio-"));
  runDir = join(root, ".jeyna", "playtests", "2026-10-17-todos");
  mkdirSync(join(runDir, "findings"), { recursive: true });
  mkdirSync(join(runDir, "evidence"));
  writeFileSync(join(root, ".jeyna", "jeyna.config.yaml"), "app: { name: sample, url: http://localhost:9 }\nviewports: [390x844]\n");
  writeFileSync(join(runDir, "evidence", "t1-390x844-1-login.png"), PNG);
  writeFileSync(
    join(runDir, "session.json"),
    JSON.stringify({
      schema: 1, id: "2026-10-17-todos", flow: "todos", app: "sample", build: "abc", status: "running", started: "2026-10-17T18:04:10.342Z", mode: "guided",
      scenarios: [{ name: "Sign-in page", description: "Open it.", pass: "Labelled." }],
      testers: [{ id: "t1", scenario: "Sign-in page", batch: 1, model: "sonnet", cases: ["t1-390x844"] }],
      cases: [{ id: "t1-390x844", scenario: "Sign-in page", viewport: "390x844" }],
      verdicts: [],
    }),
  );
  writeFileSync(join(runDir, "findings", "PT-todos-001.md"), finding("PT-todos-001", "a11y", "minor"));
  writeFileSync(join(runDir, "findings", "PT-todos-002.md"), finding("PT-todos-002", "a11y", "major", "duplicate", "PT-todos-001"));

  proc = spawn("node", ["plugin/studio/jeyna-studio.mjs", "--project", root, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  url = await new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout!.on("data", (d) => {
      out += String(d);
      const m = /http:\/\/localhost:\d+/.exec(out);
      if (m) resolve(m[0]);
    });
    proc.stderr!.on("data", (d) => (out += String(d)));
    proc.once("exit", (code) => reject(new Error(`studio exited (${code}) before printing its url\n${out}`)));
  });
});
afterAll(async () => {
  if (proc && proc.exitCode === null) {
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await exited;
  }
  rmSync(root, { recursive: true, force: true });
});

const index = async () => (await (await fetch(`${url}/api/index`)).json()) as StudioIndex;

// One SSE connection; resolves with the first index event whose run satisfies `until`.
function nextIndex(until: (i: StudioIndex) => boolean, ms = 5000): Promise<StudioIndex> {
  return new Promise((resolve, reject) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => (ctl.abort(), reject(new Error("no matching index event"))), ms);
    fetch(`${url}/api/events`, { signal: ctl.signal }).then(async (res) => {
      const reader = res.body!.getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        for (const chunk of buf.split("\n\n").slice(0, -1)) {
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (data && until(JSON.parse(data))) {
            clearTimeout(timer);
            ctl.abort();
            return resolve(JSON.parse(data));
          }
        }
        buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      }
    }).catch(() => {});
  });
}

test("the index reads the run with the server's validation, sections rendered, app from the config", async () => {
  const i = await index();
  expect(i.root).toBe(root);
  expect(i.app).toEqual({ name: "sample", url: "http://localhost:9" });
  const run = i.runs[0];
  expect(run.id).toBe("2026-10-17-todos");
  expect(run.session?.status).toBe("running");
  expect(run.errors).toEqual(["session.json: case t1-390x844 has no verdict"]);
  expect(run.findings.map((f) => f.id)).toEqual(["PT-todos-001", "PT-todos-002"]);
  expect(run.findings[0].title).toBe("Title of PT-todos-001");
  expect(run.findings[0].sections.Steps).toBe("<ol>\n<li>Open /login</li>\n</ol>");
  expect(run.findings[0].sections.Evidence).toContain('src="/runs/2026-10-17-todos/evidence/t1-390x844-1-login.png"');
  expect(run.since).toBeNull();
  expect(run.evidence).toEqual(["t1-390x844-1-login.png"]); // the contact sheet picks each case's last screenshot
  expect(run.report).toBe(false);
});

test("a finding written mid-run arrives over SSE; a hand-broken file is kept with its errors, not dropped", async () => {
  const seen = nextIndex((i) => i.runs[0].findings.length === 4);
  writeFileSync(join(runDir, "findings", "PT-todos-003.md"), finding("PT-todos-003", "bug", "critical"));
  writeFileSync(join(runDir, "findings", "PT-todos-004.md"), "---\nschema: 1\nid: PT-todos-004\nkind: bugg\n---\n\n# Broken\n");
  const i = await seen;
  const run = i.runs[0];
  const broken = run.findings.find((f) => f.id === "PT-todos-004")!;
  expect(broken.front).toBeUndefined();
  expect(broken.source).toContain("kind: bugg");
  expect(broken.errors[0]).toMatch(/^frontmatter kind: /);
  expect(run.errors.some((e) => e.startsWith("findings/PT-todos-004.md: "))).toBe(true);
  expect(run.findings.find((f) => f.id === "PT-todos-003")?.front?.severity).toBe("critical");
});

test("evidence is served from the run folder and nothing outside it", async () => {
  const ok = await fetch(`${url}/runs/2026-10-17-todos/evidence/t1-390x844-1-login.png`);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await ok.arrayBuffer()).equals(PNG)).toBe(true);
  expect((await fetch(`${url}/runs/2026-10-17-todos/evidence/missing.png`)).status).toBe(404);
  expect((await fetch(`${url}/runs/${encodeURIComponent("../../")}/evidence/x.png`)).status).toBe(404);
  expect((await fetch(`${url}/runs/2026-10-17-todos/evidence/${encodeURIComponent("../session.json")}`)).status).toBe(404);
  // Any other path is the UI, which routes /runs/… itself.
  const page = await fetch(`${url}/runs/2026-10-17-todos/findings/PT-todos-001`);
  expect(page.headers.get("content-type")).toContain("text/html");
  expect(await page.text()).toContain('<script type="module" src="/app.js">');
  // The crab ships beside the mark (empty and idle moments).
  const crab = await fetch(`${url}/crab.svg`);
  expect(crab.headers.get("content-type")).toBe("image/svg+xml");
  expect(await crab.text()).toContain("Jeyna the Crab");
  // report.md, when the run has one, as text; none is a 404, not the page.
  expect((await fetch(`${url}/runs/2026-10-17-todos/report.md`)).status).toBe(404);
  writeFileSync(join(runDir, "report.md"), "# Report\n");
  const report = await fetch(`${url}/runs/2026-10-17-todos/report.md`);
  expect(report.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await report.text()).toBe("# Report\n");
  rmSync(join(runDir, "report.md"));
});

test("feedback: the studio page creates, edits and deletes items; the index carries them; other origins are refused (D36)", async () => {
  const send = (method: string, path: string, data?: unknown, origin = url) =>
    fetch(`${url}${path}`, { method, headers: { origin, "content-type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  const snap = { text: "Make the button bigger", capture: "snap", frames: [{ png: PNG.toString("base64"), ms: 0 }], source: "evidence", run: "2026-10-17-todos", evidence: "t1-390x844-1-login.png", finding: "PT-todos-001" };

  expect((await send("POST", "/api/feedback", snap, "http://evil.example")).status).toBe(403);
  expect((await fetch(`${url}/api/feedback`, { method: "POST", body: JSON.stringify(snap) })).status).toBe(403);
  const bad = await send("POST", "/api/feedback", { ...snap, evidence: "missing.png" });
  expect([bad.status, (await bad.json()).error]).toEqual([400, "No evidence missing.png in run 2026-10-17-todos."]);

  const seen = nextIndex((i) => i.feedback.length === 1);
  const created = await send("POST", "/api/feedback", snap);
  expect(await created.json()).toMatchObject({ id: "FB-001", status: "open", frames: [{ file: "FB-001.png", ms: 0 }] });
  expect((await seen).feedback[0]).toMatchObject({ id: "FB-001", text: "Make the button bigger", errors: [] });

  const img = await fetch(`${url}/feedback-files/FB-001.png`);
  expect([img.status, img.headers.get("content-type")]).toEqual([200, "image/png"]);
  expect((await fetch(`${url}/feedback-files/${encodeURIComponent("../jeyna.config.yaml")}`)).status).toBe(404);

  expect((await send("PATCH", "/api/feedback/FB-001", { text: "Bigger, 44 px" })).status).toBe(200);
  expect((await send("PATCH", "/api/feedback/FB-001", { status: "wontfix" })).status).toBe(200);
  const locked = await send("PATCH", "/api/feedback/FB-001", { text: "x" });
  expect([locked.status, (await locked.json()).error]).toEqual([400, "FB-001 is wontfix; only an open item's text can change. Reopen it first."]);
  expect((await index()).feedback[0]).toMatchObject({ text: "Bigger, 44 px", front: { status: "wontfix" } });

  expect((await send("DELETE", "/api/feedback/FB-001", undefined, "http://evil.example")).status).toBe(403);
  expect((await send("DELETE", "/api/feedback/FB-001")).status).toBe(200);
  expect((await index()).feedback).toEqual([]);
});

test("the Live window opens and closes from the studio page only; the index says whether it is open; no draft, nothing to finish (D37)", async () => {
  const post = (data: unknown, origin = url) =>
    fetch(`${url}/api/window`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(data) });
  expect((await index()).window).toEqual({ open: false, url: null, openedAt: null, capturing: false, recording: false, draft: null });
  expect((await post({ action: "open" }, "http://evil.example")).status).toBe(403);
  const bad = await post({ action: "launch" });
  expect([bad.status, (await bad.json()).error]).toEqual([400, "send { action: open | close | stop | discard-draft }, or { action: save-draft, text, pngs? }"]);
  const none = await post({ action: "save-draft", text: "x" });
  expect([none.status, (await none.json()).error]).toEqual([400, "No unsaved feedback from the app window."]);
  expect((await fetch(`${url}/api/window/draft/0.png`)).status).toBe(404);
  const closed = await post({ action: "close" });
  expect([closed.status, (await closed.json()).window.open]).toEqual([200, false]);
});
