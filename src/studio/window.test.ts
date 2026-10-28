// The Live window (D37), headless at a 2x pixel ratio over the sample app, with the capture script the build injects:
// ⌥⇧S freezes the page, a drag selects at display px and the item holds exactly that region at device px, with the
// page's url and viewport; Jeyna's own pill is never in a capture; ⌥⇧R records a region while the app is used, across a
// navigation, and the review saves every frame; only the app's main frame may call the bridge.
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

// The overlay is up once focus is inside Jeyna's shadow root: the host is then the document's active element.
const overlayUp = () => page.waitForFunction(() => document.activeElement?.tagName === "JEYNA-CAPTURE");

// The page with Jeyna hidden, and the device pixel where the pill sits (bottom right).
async function bare() {
  await page.evaluate(() => ((document.querySelector("jeyna-capture") as HTMLElement).style.display = "none"));
  const png = await page.screenshot({ type: "png" });
  await page.evaluate(() => ((document.querySelector("jeyna-capture") as HTMLElement).style.display = ""));
  return png;
}
const pixelOf = (png: Buffer) => pixel(png, (800 - 36) * 2, (600 - 32) * 2);

async function snap(select: () => Promise<void>, text: string) {
  await page.keyboard.press("Alt+Shift+KeyS");
  await overlayUp();
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
  expect(await pixelOf(saved)).toEqual(await pixelOf(await bare()));
}, 30_000);

test("⌥⇧R records an area while the app is used, across a navigation; ⌥⇧R stops; the review saves every frame (D37)", async () => {
  await page.goto(app.url);
  await page.waitForFunction(() => !!document.querySelector("jeyna-capture"));
  await page.keyboard.press("Alt+Shift+KeyR");
  await overlayUp();
  await page.mouse.move(10, 100);
  await page.mouse.down();
  await page.mouse.move(400, 300, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Enter"); // Start recording
  await expect.poll(() => live.state().recording).toBe(true);

  await page.locator("input").first().pressSequentially("helo@example.test", { delay: 60 });
  await page.locator("input").nth(1).fill("not the password");
  const navigated = page.waitForEvent("framenavigated");
  await page.keyboard.press("Enter"); // the form posts; the app answers with a redirect: a new document
  await navigated;
  await page.waitForFunction(() => !!document.querySelector("jeyna-capture"));
  await page.waitForTimeout(1200);
  // Jeyna's pill stays hidden for the whole recording, on the new document too: where it sits, the page shows the app.
  await expect(pixelOf(await page.screenshot({ type: "png" }))).resolves.toEqual(await pixelOf(await bare()));
  await page.keyboard.press("Alt+Shift+KeyR"); // the new document picked the recording up, so this stops it
  await expect.poll(() => live.state().recording).toBe(false);
  await expect.poll(() => live.state().capturing).toBe(true); // under review
  await overlayUp(); // the review, its text box focused
  await page.keyboard.type("Typing in the email field lags");
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => live.state().capturing).toBe(false);

  const item = readFeedback(root).at(-1)!;
  expect(item).toMatchObject({ errors: [], text: "Typing in the email field lags" });
  expect(item.front).toMatchObject({ capture: "recording", source: "live", viewport: { width: 800, height: 600, dpr: 2 } });
  const frames = item.front!.frames;
  expect(frames.length).toBeGreaterThanOrEqual(4);
  expect(frames[0].ms).toBe(0);
  expect(frames.every((f, i) => i === 0 || f.ms > frames[i - 1].ms)).toBe(true);
  expect(frames.at(-1)!.ms).toBeGreaterThan(1500); // it went on after the navigation
  for (const f of frames) expect(size(f.file)).toEqual([780, 400]); // 390 × 200 CSS px at 2x
  const bytes = new Set(frames.map((f) => readFileSync(join(feedbackDir(root), f.file)).toString("base64")));
  expect(bytes.size).toBeGreaterThan(1); // the typing is in the frames
}, 60_000);

test("only the app's main frame may call the bridge: not a frame inside it, not another origin (D37)", async () => {
  await page.evaluate((src) => new Promise((r) => document.body.append(Object.assign(document.createElement("iframe"), { src, onload: r }))), page.url());
  const inner = page.frames()[1];
  await expect(inner.evaluate(() => (window as unknown as { __jeyna: (m: unknown) => Promise<unknown> }).__jeyna({ type: "freeze" }))).rejects.toThrow(/works on http:\/\/localhost:\d+ only/);
  await page.goto("about:blank");
  await expect(page.evaluate(() => (window as unknown as { __jeyna: (m: unknown) => Promise<unknown> }).__jeyna({ type: "freeze" }))).rejects.toThrow(/works on http:\/\/localhost:\d+ only/);
  expect(readFeedback(root)).toHaveLength(3);
});
