// Feedback items (D36): .jeyna/feedback/FB-<nnn>.md beside their capture files, FB-<nnn>.png for a snap and
// FB-<nnn>-<nn>.png per frame of a recording. Pure fs + zod: the studio sidecar creates, edits and deletes items,
// the MCP server reads them and sets their status. Every path is built here from a checked id or file name.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { MAX_FRAMES } from "./recording.js";
import { runDirOf, splitFront } from "./shared.js";

export const FEEDBACK_STATUSES = ["open", "processed", "done", "wontfix"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const ID = /^FB-\d{3,}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const FeedbackFront = z.strictObject({
  schema: z.literal(1),
  id: z.string(),
  status: z.enum(FEEDBACK_STATUSES),
  note: z.string().optional(),
  capture: z.enum(["snap", "recording"]),
  // ms: time since the recording started, for flipbook playback. A snap is one frame at 0.
  frames: z.array(z.strictObject({ file: z.string(), ms: z.number().int().min(0) })).min(1).max(MAX_FRAMES),
  // Where it was captured: the Live page, or an evidence image of a run (with the finding it was opened from).
  source: z.enum(["live", "evidence"]),
  run: z.string().optional(),
  evidence: z.string().optional(),
  finding: z.string().optional(),
  created: z.string(),
});
export type FeedbackFront = z.infer<typeof FeedbackFront>;

// path is relative to .jeyna/feedback/. text is the body: the developer's words. source is the whole file.
export type FeedbackItem = { path: string; id: string; front?: FeedbackFront; text: string; source: string; errors: string[] };

export const feedbackDir = (root: string) => join(root, ".jeyna", "feedback");

function itemFile(root: string, id: string): string {
  if (!ID.test(id)) throw new Error(`A feedback id looks like FB-001, not ${id || "an empty string"}.`);
  const path = join(feedbackDir(root), `${id}.md`);
  if (!existsSync(path)) throw new Error(`No feedback ${id} under .jeyna/feedback/.`);
  return path;
}

// A capture file inside .jeyna/feedback/, by bare file name only.
export function feedbackFile(root: string, file: string): string {
  if (basename(file) !== file || !/^FB-\d{3,}(-\d+)?\.png$/.test(file)) throw new Error(`not a feedback capture file: ${file}`);
  return join(feedbackDir(root), file);
}

// Every FB-*.md, oldest id first, each with its own errors; one that does not parse still lists (as findings do).
export function readFeedback(root: string): FeedbackItem[] {
  const dir = feedbackDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^FB-\d{3,}\.md$/.test(f))
    .sort((a, b) => num(a) - num(b))
    .map((file) => {
      const source = readFileSync(join(dir, file), "utf8");
      const item: FeedbackItem = { path: file, id: file.slice(0, -3), text: "", source, errors: [] };
      const m = splitFront(source);
      if (!m) return { ...item, errors: ["no YAML frontmatter between --- lines"] };
      item.text = m[2].trim();
      let raw: unknown;
      try {
        raw = parse(m[1]);
      } catch (e) {
        return { ...item, errors: [`frontmatter is not valid YAML: ${(e as Error).message.split("\n")[0]}`] };
      }
      const r = FeedbackFront.safeParse(raw);
      if (!r.success) return { ...item, errors: r.error.issues.map((i) => `frontmatter ${i.path.join(".") || "(root)"}: ${i.message}`) };
      const front = (item.front = r.data);
      if (front.id !== item.id) item.errors.push(`id ${front.id} does not match the file name`);
      if (front.capture === "snap" && front.frames.length !== 1) item.errors.push("a snap has exactly one frame");
      if (front.source === "evidence" && !(front.run && front.evidence)) item.errors.push("feedback on evidence names its run and evidence");
      for (const f of front.frames) if (!existsSync(join(dir, f.file))) item.errors.push(`capture ${f.file} does not exist in .jeyna/feedback/`);
      if (!item.text) item.errors.push("no feedback text");
      return item;
    });
}

const num = (file: string) => Number(/^FB-(\d+)/.exec(file)?.[1] ?? 0);

export const NewFeedback = z.strictObject({
  text: z.string().trim().min(1, "write what should change"),
  capture: z.enum(["snap", "recording"]),
  // PNG bytes as base64, in order.
  frames: z.array(z.strictObject({ png: z.string().min(1), ms: z.number().int().min(0) })).min(1).max(MAX_FRAMES),
  source: z.enum(["live", "evidence"]),
  run: z.string().optional(),
  evidence: z.string().optional(),
  finding: z.string().optional(),
});
export type NewFeedback = z.infer<typeof NewFeedback>;

// Writes the capture files, then the item (so a reader never sees an item whose frames are missing). Numbered across
// the project. Synchronous on purpose: the sidecar is the only creator, so the next id cannot be taken in between.
export function createFeedback(root: string, input: NewFeedback, now = new Date()): FeedbackFront {
  const n = NewFeedback.parse(input);
  if (n.capture === "snap" && n.frames.length !== 1) throw new Error("a snap has exactly one frame");
  if (n.source === "evidence") {
    if (!n.run || !n.evidence) throw new Error("feedback on evidence names its run and evidence");
    if (basename(n.evidence) !== n.evidence || !existsSync(join(runDirOf(root, n.run), "evidence", n.evidence))) {
      throw new Error(`No evidence ${n.evidence} in run ${n.run}.`);
    }
    if (n.finding && !existsSync(join(runDirOf(root, n.run), "findings", `${basename(n.finding)}.md`))) throw new Error(`No finding ${n.finding} in run ${n.run}.`);
  } else if (n.run || n.evidence || n.finding) {
    throw new Error("run, evidence and finding are only for feedback on evidence");
  }
  const pngs = n.frames.map((f, i) => {
    const b = Buffer.from(f.png, "base64");
    if (!b.subarray(0, 8).equals(PNG)) throw new Error(`frame ${i + 1} is not a PNG`);
    return b;
  });

  const dir = feedbackDir(root);
  mkdirSync(dir, { recursive: true });
  const next = Math.max(0, ...readdirSync(dir).filter((f) => /^FB-\d{3,}\.md$/.test(f)).map(num)) + 1;
  const id = `FB-${String(next).padStart(3, "0")}`;
  const frames = pngs.map((b, i) => {
    const file = n.capture === "snap" ? `${id}.png` : `${id}-${String(i + 1).padStart(2, "0")}.png`;
    writeFileSync(join(dir, file), b);
    return { file, ms: n.frames[i].ms };
  });
  const front: FeedbackFront = {
    schema: 1, id, status: "open", capture: n.capture, frames, source: n.source,
    ...(n.run && { run: n.run }), ...(n.evidence && { evidence: n.evidence }), ...(n.finding && { finding: n.finding }),
    created: now.toISOString(),
  };
  writeFileSync(join(dir, `${id}.md`), `---\n${stringify(front)}---\n\n${n.text.trim()}\n`, { flag: "wx" });
  return front;
}

// Status (any of the four, by the studio or update_status) and the text (only while open; the capture never changes).
export function updateFeedback(root: string, id: string, change: { status?: FeedbackStatus; note?: string; text?: string }): FeedbackFront {
  const path = itemFile(root, id);
  const m = splitFront(readFileSync(path, "utf8"));
  const r = m ? FeedbackFront.safeParse(parse(m[1])) : undefined;
  if (!m || !r?.success) throw new Error(`.jeyna/feedback/${id}.md has no readable frontmatter; fix it by hand.`);
  const front = r.data;
  let text = m[2].trim();
  if (change.text !== undefined) {
    if (front.status !== "open") throw new Error(`${id} is ${front.status}; only an open item's text can change. Reopen it first.`);
    text = change.text.trim();
    if (!text) throw new Error("write what should change");
  }
  // Rebuild in place so note sits right after status, as update_status does for findings. A new status drops the old note.
  const note = change.status ? change.note : front.note;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(front)) {
    if (k === "note") continue;
    next[k] = k === "status" ? (change.status ?? v) : v;
    if (k === "status" && note) next.note = note;
  }
  writeFileSync(path, `---\n${stringify(next)}---\n\n${text}\n`);
  return next as FeedbackFront;
}

// The item and its capture files. The files are found by name, so a hand-broken item still deletes cleanly.
export function deleteFeedback(root: string, id: string) {
  itemFile(root, id);
  const dir = feedbackDir(root);
  for (const f of readdirSync(dir)) if (f === `${id}.md` || new RegExp(`^${id}(-\\d+)?\\.png$`).test(f)) rmSync(join(dir, f));
}
