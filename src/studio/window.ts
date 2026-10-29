// The Live window (D37): the app in its own headed Chrome with this project's profile, the capture script injected into
// every page, and the bridge that script calls. One window per sidecar. Nothing is streamed: the developer uses the
// window directly; a snap is CDP's screenshot of the page, and a recording a screenshot of one region every FRAME_MS,
// taken here, so it carries on while the page navigates.
import { join } from "node:path";
import { type BrowserContext, chromium, type Frame, type Page } from "playwright-core";
import { z } from "zod";
import { launchChrome } from "../chrome.js";
import { createFeedback } from "../feedback.js";
import { FRAME_MS, MAX_FRAMES } from "../recording.js";

// capturing: a frame is frozen (a snap, a region being chosen, a recording under review). recording: frames are being taken.
// draft: unsaved feedback from a tab or window that closed, offered once in the studio.
export type WindowState = {
  open: boolean;
  url: string | null;
  openedAt: string | null;
  capturing: boolean;
  recording: boolean;
  draft: { capture: "snap" | "recording"; text: string; frames: number } | null;
};

// What the page sends. The url and viewport of an item come from the freeze or the recording's start, read here, never
// from the page.
const Region = z.strictObject({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) });
const Msg = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello") }),
  z.strictObject({ type: z.literal("freeze"), for: z.enum(["snap", "record"]) }),
  z.strictObject({ type: z.literal("record"), region: Region }),
  z.strictObject({ type: z.literal("stop") }),
  z.strictObject({ type: z.literal("review") }),
  // png: the snap, cropped. pngs: a recording's frames cropped tighter; left out, the frames are saved as taken.
  z.strictObject({ type: z.literal("save"), text: z.string(), png: z.string().optional(), pngs: z.array(z.string()).optional() }),
  z.strictObject({ type: z.literal("cancel") }),
  z.strictObject({ type: z.literal("draft"), text: z.string() }), // the text as it is typed, kept here
]);
type Viewport = { width: number; height: number; dpr: number };
type Shot = { png: Buffer; ms: number };
type Frozen = { url: string; viewport: Viewport; for: "snap" | "record"; png: Buffer; text: string };
type Rec = { page: Page; region: z.infer<typeof Region>; url: string; viewport: Viewport; start: number; frames: Shot[]; reviewing: boolean; text: string; timer?: NodeJS.Timeout };
type Draft = { capture: "snap" | "recording"; frames: Shot[]; url: string; viewport: Viewport; text: string };
const size = (png: Buffer) => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) }); // a PNG's IHDR

export function liveWindow(o: {
  root: string;
  app: string; // app.url
  script: string; // plugin/studio/overlay.js
  onChange: () => void;
  headless?: { width: number; height: number; dpr: number }; // tests only: a fixed viewport, no window
}) {
  const origin = new URL(o.app).origin;
  let ctx: Promise<BrowserContext> | null = null;
  let state: WindowState = { open: false, url: null, openedAt: null, capturing: false, recording: false, draft: null };
  const frozen = new Map<Page, Frozen>(); // per tab
  let rec: Rec | null = null; // one recording per window
  let lastRegion: Rec["region"] | null = null; // preselected for the next recording
  let draft: Draft | null = null; // one at a time: a newer one replaces it
  const set = (next: Partial<WindowState>) => {
    state = {
      ...state,
      ...next,
      capturing: frozen.size > 0 || !!rec?.reviewing,
      recording: !!rec && !rec.reviewing,
      draft: draft && { capture: draft.capture, text: draft.text, frames: draft.frames.length },
    };
    o.onChange();
  };
  // A tab or the window closed: written feedback, and any recording, become the draft; the rest is let go.
  function keep(p: Page) {
    const f = frozen.get(p);
    if (f?.for === "snap" && f.text.trim()) draft = { capture: "snap", frames: [{ png: f.png, ms: 0 }], url: f.url, viewport: f.viewport, text: f.text };
    frozen.delete(p);
    if (rec?.page !== p) return;
    clearTimeout(rec.timer);
    if (rec.frames.length) draft = { capture: "recording", frames: rec.frames, url: rec.url, viewport: rec.viewport, text: rec.text };
    rec = null;
  }
  // Tells the page's capture script (if its document is there right now; a new document asks with hello).
  const tell = (page: Page, event: string, detail?: unknown) =>
    page.evaluate(([e, d]) => dispatchEvent(new CustomEvent(e as string, { detail: d })), [event, detail] as const).catch(() => {});

  // One frame of the region every FRAME_MS from the start, never two screenshots at once: a slow one delays the next.
  async function sample(r: Rec) {
    if (rec !== r || r.reviewing) return;
    const t = Date.now();
    try {
      const { x, y, w: width, h: height } = r.region;
      const png = await r.page.screenshot({ type: "png", clip: { x, y, width, height } });
      if (rec !== r || r.reviewing) return;
      r.frames.push({ png, ms: r.frames.length ? Math.round(t - r.start) : 0 });
      tell(r.page, "jeyna:frame", r.frames.length);
    } catch {
      // between two documents: no frame this tick
    }
    if (r.frames.length >= MAX_FRAMES) return stop();
    r.timer = setTimeout(() => sample(r), Math.max(0, FRAME_MS - (Date.now() - t)));
  }
  function stop() {
    if (!rec || rec.reviewing) return;
    clearTimeout(rec.timer);
    rec.reviewing = true;
    if (!rec.frames.length) rec = null; // stopped before the first frame: nothing to review
    else tell(rec.page, "jeyna:stopped");
    set({});
  }

  // A page in this window could steer Claude through what it writes, so only the app itself may call: its main frame,
  // on app.url's origin. The capture script runs everywhere and stays quiet where this refuses.
  async function bridge(source: { page: Page; frame: Frame }, raw: unknown) {
    const { page, frame } = source;
    if (frame !== page.mainFrame() || new URL(frame.url()).origin !== origin) throw new Error(`Jeyna feedback works on ${origin} only.`);
    const msg = Msg.parse(raw);
    const mine = rec?.page === page ? rec : null;
    if (msg.type === "hello") {
      // The tab reloaded mid-capture: a frozen snap comes back with its text; a recording with where it is.
      const snap = frozen.get(page)?.for === "snap" ? frozen.get(page)! : null;
      return {
        snap: snap && { png: snap.png.toString("base64"), ...size(snap.png), dpr: snap.viewport.dpr, text: snap.text },
        recording: mine && { region: mine.region, frames: mine.frames.length, elapsed: Date.now() - mine.start, reviewing: mine.reviewing, text: mine.text },
      };
    }
    if (msg.type === "draft") {
      const f = frozen.get(page);
      if (mine?.reviewing) mine.text = msg.text;
      else if (f) f.text = msg.text;
      return true;
    }
    if (msg.type === "freeze") {
      if (rec) throw new Error("A recording is under way in this window: stop it first.");
      const png = await page.screenshot({ type: "png" });
      const viewport: Viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
      frozen.set(page, { url: frame.url(), viewport, for: msg.for, png, text: "" });
      set({});
      return { png: png.toString("base64"), ...size(png), dpr: viewport.dpr, last: msg.for === "record" ? lastRegion : null };
    }
    const f = frozen.get(page);
    if (msg.type === "record") {
      if (f?.for !== "record") throw new Error("Choose the area to record first: ⌥⇧R.");
      const r = msg.region;
      if (r.x + r.w > f.viewport.width || r.y + r.h > f.viewport.height) throw new Error("The area to record is outside the window.");
      frozen.delete(page);
      lastRegion = r;
      rec = { page, region: r, url: f.url, viewport: f.viewport, start: Date.now(), frames: [], reviewing: false, text: "" };
      set({});
      void sample(rec);
      return true;
    }
    if (msg.type === "stop") return stop(), true;
    if (msg.type === "review") {
      if (!mine?.reviewing) throw new Error("No recording to review in this tab.");
      // The page as it is now (Jeyna's ring and timer hidden by the script), for the frames to play over, in place.
      const png = await page.screenshot({ type: "png" });
      const dpr = await page.evaluate(() => devicePixelRatio);
      return { png: png.toString("base64"), ...size(png), dpr, region: mine.region, frames: mine.frames.map((x) => ({ png: x.png.toString("base64"), ms: x.ms })) };
    }
    if (msg.type === "save") {
      let item;
      if (mine?.reviewing) {
        const pngs = msg.pngs ?? mine.frames.map((x) => x.png.toString("base64"));
        if (pngs.length !== mine.frames.length) throw new Error(`A recording of ${mine.frames.length} frames saves ${mine.frames.length} images.`);
        item = createFeedback(o.root, { text: msg.text, capture: "recording", frames: pngs.map((png, i) => ({ png, ms: mine.frames[i].ms })), source: "live", url: mine.url, viewport: mine.viewport });
        rec = null;
      } else {
        if (f?.for !== "snap" || !msg.png) throw new Error("Nothing is frozen in this tab: snap again.");
        item = createFeedback(o.root, { text: msg.text, capture: "snap", frames: [{ png: msg.png, ms: 0 }], source: "live", url: f.url, viewport: f.viewport });
        frozen.delete(page);
      }
      set({});
      return { id: item.id };
    }
    // cancel: a freeze, or a recording under review
    frozen.delete(page);
    if (mine?.reviewing) rec = null;
    set({});
    return true;
  }

  async function launch(): Promise<BrowserContext> {
    // Chrome and Playwright's Chromium each get their own profile folder: they do not share one safely.
    const c = await launchChrome((channel) =>
      chromium.launchPersistentContext(join(o.root, ".jeyna", "chrome-profile", channel ?? "chromium"), {
        channel,
        headless: !!o.headless,
        // A real window: its own size, at the screen's pixel ratio. No "controlled by automated test software" bar.
        viewport: o.headless ? { width: o.headless.width, height: o.headless.height } : null,
        ...(o.headless && { deviceScaleFactor: o.headless.dpr }),
        ignoreDefaultArgs: ["--enable-automation"],
      }),
    );
    await c.exposeBinding("__jeyna", bridge);
    await c.addInitScript({ content: o.script });
    const follow = (p: Page) => {
      p.on("framenavigated", (f) => f === p.mainFrame() && set({ url: f.url() }));
      p.on("close", () => (keep(p), set({})));
    };
    c.pages().forEach(follow);
    c.on("page", follow);
    c.on("close", () => {
      ctx = null;
      for (const p of [...frozen.keys(), ...(rec ? [rec.page] : [])]) keep(p);
      set({ open: false, url: null, openedAt: null });
    });
    set({ open: true, openedAt: new Date().toISOString() });
    return c;
  }

  return {
    state: () => state,
    // Opens the window on app.url, or brings it to the front. Resolves with the page, for tests.
    async open(): Promise<Page> {
      ctx ??= launch().catch((e) => {
        ctx = null;
        throw e;
      });
      const c = await ctx;
      const page = c.pages()[0] ?? (await c.newPage());
      if (page.url() === "about:blank") await page.goto(o.app);
      await page.bringToFront();
      return page;
    },
    // The studio's Stop recording.
    stop,
    // A draft's frames, for the studio to show; and finishing it there: saved (pngs: the frames cropped, else as they
    // are) or let go.
    draftFrame: (i: number) => draft?.frames[i]?.png ?? null,
    saveDraft(text: string, pngs?: string[]) {
      if (!draft) throw new Error("No unsaved feedback from the app window.");
      const d = draft;
      if (pngs && pngs.length !== d.frames.length) throw new Error(`This draft has ${d.frames.length} frames; send as many images.`);
      const frames = d.frames.map((f, i) => ({ png: pngs?.[i] ?? f.png.toString("base64"), ms: f.ms }));
      const item = createFeedback(o.root, { text, capture: d.capture, frames, source: "live", url: d.url, viewport: d.viewport });
      draft = null;
      set({});
      return item;
    },
    discardDraft() {
      draft = null;
      set({});
    },
    async close() {
      await (await ctx)?.close();
    },
  };
}
