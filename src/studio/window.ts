// The Live window (D37): the app in its own headed Chrome with this project's profile, the capture script injected into
// every page, and the bridge that script calls. One window per sidecar. Nothing is streamed: the developer uses the
// window directly, and a snap is CDP's screenshot of the page, at device pixels.
import { join } from "node:path";
import { type BrowserContext, chromium, type Frame, type Page } from "playwright-core";
import { z } from "zod";
import { launchChrome } from "../chrome.js";
import { createFeedback } from "../feedback.js";

export type WindowState = { open: boolean; url: string | null; openedAt: string | null; capturing: boolean };

// What the page sends. The url and viewport of an item come from the freeze, read here, never from the page.
const Msg = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello") }),
  z.strictObject({ type: z.literal("freeze") }),
  z.strictObject({ type: z.literal("save"), text: z.string(), png: z.string() }),
  z.strictObject({ type: z.literal("cancel") }),
]);
type Frozen = { url: string; viewport: { width: number; height: number; dpr: number } };

export function liveWindow(o: {
  root: string;
  app: string; // app.url
  script: string; // plugin/studio/overlay.js
  onChange: () => void;
  headless?: { width: number; height: number; dpr: number }; // tests only: a fixed viewport, no window
}) {
  const origin = new URL(o.app).origin;
  let ctx: Promise<BrowserContext> | null = null;
  let state: WindowState = { open: false, url: null, openedAt: null, capturing: false };
  const frozen = new Map<Page, Frozen>(); // per tab
  const set = (next: Partial<WindowState>) => {
    state = { ...state, ...next, capturing: frozen.size > 0 };
    o.onChange();
  };

  // A page in this window could steer Claude through what it writes, so only the app itself may call: its main frame,
  // on app.url's origin. The capture script runs everywhere and stays quiet where this refuses.
  async function bridge(source: { page: Page; frame: Frame }, raw: unknown) {
    const { page, frame } = source;
    if (frame !== page.mainFrame() || new URL(frame.url()).origin !== origin) throw new Error(`Jeyna feedback works on ${origin} only.`);
    const msg = Msg.parse(raw);
    if (msg.type === "hello") return true;
    if (msg.type === "freeze") {
      const png = await page.screenshot({ type: "png" });
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
      frozen.set(page, { url: frame.url(), viewport });
      set({});
      // A PNG's IHDR holds its width and height at bytes 16 and 20.
      return { png: png.toString("base64"), w: png.readUInt32BE(16), h: png.readUInt32BE(20), dpr: viewport.dpr };
    }
    const f = frozen.get(page);
    if (msg.type === "save") {
      if (!f) throw new Error("Nothing is frozen in this tab: snap again.");
      const item = createFeedback(o.root, { text: msg.text, capture: "snap", frames: [{ png: msg.png, ms: 0 }], source: "live", url: f.url, viewport: f.viewport });
      frozen.delete(page);
      set({});
      return { id: item.id };
    }
    frozen.delete(page);
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
      p.on("close", () => frozen.delete(p) && set({}));
    };
    c.pages().forEach(follow);
    c.on("page", follow);
    c.on("close", () => {
      ctx = null;
      frozen.clear();
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
    async close() {
      await (await ctx)?.close();
    },
  };
}
