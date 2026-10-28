// The Live window (D37), headless at a 2x pixel ratio over the sample app, with the capture script the build injects:
// ⌥⇧S freezes the page, a drag selects at display px and the item holds exactly that region at device px, with the
// page's url and viewport; Jeyna's own pill is never in a capture; only the app's main frame may call the bridge.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { feedbackDir, readFeedback } from "../feedback.js";
import { type App, startApp } from "../testkit.js";
import { liveWindow } from "./window.js";

let app: App;
let root: string;
let live: ReturnType<typeof liveWindow>;
let page: Page;

beforeAll(async () => {
  app = await startApp();
  root = mkdtempSync(join(tmpdir(), "jeyna-live-"));
  mkdirSync(join(root, ".jeyna"));
  live = liveWindow({ root, app: app.url, script: readFileSync("plugin/studio/overlay.js", "utf8"), onChange: () => {}, headless: { width: 800, height: 600, dpr: 2 } });
  page = await live.open();
  await page.waitForFunction(() => !!document.querySelector("jeyna-capture"));
}, 30_000);

afterAll(async () => {
  await live?.close();
  await app?.stop();
});

const size = (file: string) => {
  const b = readFileSync(join(feedbackDir(root), file));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
// One pixel of a PNG, read in the page's own canvas: the test needs no PNG decoder.
const pixel = (png: Buffer, x: number, y: number) =>
  page.evaluate(async ([b64, x, y]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    return [...g.getImageData(x as number, y as number, 1, 1).data];
  }, [png.toString("base64"), x, y] as const);

async function snap(select: () => Promise<void>, text: string) {
  await page.keyboard.press("Alt+Shift+KeyS");
  await expect.poll(() => live.state().capturing).toBe(true);
  await select();
  await page.keyboard.type(text);
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => live.state().capturing).toBe(false);
}

test("⌥⇧S freezes the window; a dragged region saves at device pixels with the page's url and viewport (D37)", async () => {
  await snap(async () => {
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(300, 180, { steps: 5 });
    await page.mouse.up();
  }, "The password field needs a visible label");
  const [item] = readFeedback(root);
  expect(item).toMatchObject({ errors: [], text: "The password field needs a visible label" });
  expect(item.front).toMatchObject({ capture: "snap", source: "live", url: page.url(), viewport: { width: 800, height: 600, dpr: 2 } });
  expect(size(item.front!.frames[0].file)).toEqual([400, 160]); // 200 × 80 CSS px at 2x
}, 30_000);

test("the whole window at device pixels, without Jeyna's pill in it (D37)", async () => {
  await snap(() => page.keyboard.press("a"), "Whole window");
  const item = readFeedback(root).at(-1)!;
  expect(size(item.front!.frames[0].file)).toEqual([1600, 1200]);
  // Where the pill sits (bottom right), the capture shows the app, as a screenshot with Jeyna hidden does.
  const saved = readFileSync(join(feedbackDir(root), item.front!.frames[0].file));
  await page.evaluate(() => ((document.querySelector("jeyna-capture") as HTMLElement).style.display = "none"));
  const bare = await page.screenshot({ type: "png" });
  await page.evaluate(() => ((document.querySelector("jeyna-capture") as HTMLElement).style.display = ""));
  const at = [(800 - 36) * 2, (600 - 32) * 2] as const;
  expect(await pixel(saved, ...at)).toEqual(await pixel(bare, ...at));
}, 30_000);

test("only the app's main frame may call the bridge: not a frame inside it, not another origin (D37)", async () => {
  await page.evaluate((src) => new Promise((r) => document.body.append(Object.assign(document.createElement("iframe"), { src, onload: r }))), page.url());
  const inner = page.frames()[1];
  await expect(inner.evaluate(() => (window as unknown as { __jeyna: (m: unknown) => Promise<unknown> }).__jeyna({ type: "freeze" }))).rejects.toThrow(/works on http:\/\/localhost:\d+ only/);
  await page.goto("about:blank");
  await expect(page.evaluate(() => (window as unknown as { __jeyna: (m: unknown) => Promise<unknown> }).__jeyna({ type: "freeze" }))).rejects.toThrow(/works on http:\/\/localhost:\d+ only/);
  expect(readFeedback(root)).toHaveLength(2);
});
