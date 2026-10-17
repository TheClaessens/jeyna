import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import pw from "playwright-core/package.json" with { type: "json" };
import { z } from "zod";
import type { Config } from "./schema.js";
import { current, fail, ok } from "./session.js";
import { accountValues, substitute } from "./accounts.js";
import { appUrl, clip } from "./shared.js";

const log = (...a: unknown[]) => console.error(new Date().toISOString(), ...a);

// One browser per server process: the installed Chrome with a temporary profile, else Playwright's
// Chromium (D13). JEYNA_BROWSER_CHANNEL overrides the channel, which is how P4 forces the fallback.
// When it goes away (a crash, or the user closes the headed window) the next call launches a new one.
let browser: Promise<Browser> | undefined;

function getBrowser(headed: boolean): Promise<Browser> {
  if (browser) return browser;
  const launching: Promise<Browser> = launch(headed).then(
    (b) => {
      b.on("disconnected", () => {
        if (browser !== launching) return;
        log("browser disconnected; the next browser call launches a new one");
        browser = undefined;
        pages.clear(); // their contexts died with it; screenshot numbering (shots) carries on
      });
      return b;
    },
    (e) => {
      if (browser === launching) browser = undefined;
      throw e;
    },
  );
  return (browser = launching);
}

async function launch(headed: boolean): Promise<Browser> {
  const channel = process.env.JEYNA_BROWSER_CHANNEL ?? "chrome";
  let why: string;
  try {
    const b = await chromium.launch({ channel, headless: !headed });
    log(`launched channel ${channel}, version ${b.version()}`);
    return b;
  } catch (e) {
    why = (e as Error).message.split("\n")[0];
    log(`${channel} launch failed:`, why);
  }
  try {
    const b = await chromium.launch({ headless: !headed });
    log("using Playwright's Chromium");
    return b;
  } catch {
    throw new Error(
      `No browser found. Google Chrome (channel "${channel}") did not launch: ${why}. ` +
        `Install Google Chrome, or install Playwright's Chromium: npx playwright install chromium ` +
        `(if it still is not found, pin the version Jeyna bundles: npx playwright@${pw.version} install chromium).`,
    );
  }
}

// One page in its own context per case, created on the case's first browser call (D4).
const pages = new Map<string, Promise<Page>>();
const shots = new Map<string, number>();

// What the app said behind the page, per case, since the tester's last call: uncaught errors, console
// errors, failed requests and 4xx/5xx responses (D31). Drained into the next goto/click/press/snapshot result.
const events = new Map<string, string[]>();
const EVENTS_MAX = 30;
function note(caseId: string, line: string) {
  const list = events.get(caseId) ?? [];
  if (list.length < EVENTS_MAX) list.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
  else if (list.length === EVENTS_MAX) list.push("… and more; the rest is dropped until the next call");
  events.set(caseId, list);
}
function drain(caseId: string): string[] | undefined {
  const list = events.get(caseId);
  events.delete(caseId);
  return list;
}
// Chrome also logs every failed request as a console error; the request events already carry it.
// A missing favicon is the browser's own request, not the app's.
const NOISE = /^Failed to load resource/;
const favicon = (url: string) => /\/favicon\.ico(\?|$)/.test(url);
function listen(caseId: string, pg: Page) {
  pg.on("pageerror", (e) => note(caseId, `page error: ${e.message}`));
  pg.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && note(caseId, `console error: ${m.text()}`));
  pg.on("requestfailed", (r) => !favicon(r.url()) && note(caseId, `${r.method()} ${r.url()} failed: ${r.failure()?.errorText ?? "unknown"}`));
  pg.on("response", (r) => r.status() >= 400 && !favicon(r.url()) && note(caseId, `${r.request().method()} ${r.url()} ${r.status()}`));
}

// "chromium 155.0.8059.41" for findings; "unknown" when no browser was launched.
export async function browserName(): Promise<string> {
  try {
    const b = await browser;
    return b ? `${b.browserType().name()} ${b.version()}` : "unknown";
  } catch {
    return "unknown";
  }
}

export async function closeContexts() {
  const all = [...pages.values()];
  pages.clear();
  shots.clear();
  events.clear();
  await Promise.allSettled(all.map(async (p) => (await p).context().close()));
}

// The reserved case for the exploratory look before a session exists (D6, F2.3): no session needed,
// the first configured viewport, the first pool account, nothing written to disk; session_start closes it.
export const SCOUT = "scout";

function viewportOf(caseId: string, config: Config): string {
  if (caseId === SCOUT) return config.viewports[0];
  if (!current) {
    throw new Error("No running session. Call session_start first; browser tools take a case id from its result (or `scout` for the look before a run).");
  }
  const c = current.session.cases.find((c) => c.id === caseId);
  if (!c) throw new Error(`Unknown case "${caseId}". Cases in this run: ${current.session.cases.map((c) => c.id).join(", ")}.`);
  return c.viewport;
}

// Drop a case's page only if the map still holds that same promise, not one created after it.
function forget(caseId: string, p: Promise<Page>) {
  if (pages.get(caseId) === p) pages.delete(caseId);
}

function page(caseId: string, config: Config): Promise<Page> {
  const viewport = viewportOf(caseId, config);
  let p = pages.get(caseId);
  if (!p) {
    const [width, height] = viewport.split("x").map(Number);
    const created: Promise<Page> = getBrowser(config.browser.headed).then(async (b) => {
      const pg = await (await b.newContext({ viewport: { width, height } })).newPage();
      // A page closed under us (its tab or window shut) is replaced on the next call, not reused.
      pg.on("close", () => forget(caseId, created));
      listen(caseId, pg);
      return pg;
    });
    created.catch(() => forget(caseId, created));
    pages.set(caseId, (p = created));
  }
  return p;
}

const ACT_TIMEOUT = 5_000; // a miss should come back fast, with candidates, not after Playwright's 30 s

const CONTROL = /^\s*- (button|link|textbox|combobox|checkbox|radio|menuitem|tab|option|searchbox|switch|slider|spinbutton) "((?:[^"\\]|\\.)*)"/gm;
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

// The controls a selector most likely meant: aria-tree controls ranked by words shared with it (F5.2).
export function nearest(selector: string, aria: string, max = 5): string[] {
  const wanted = new Set(words(selector));
  const found = [...aria.matchAll(CONTROL)].map(([, role, name], i) => ({
    sel: `role=${role}[name="${name}"]`,
    score: words(name).filter((w) => wanted.has(w)).length + (wanted.has(role) ? 0.5 : 0),
    i,
  }));
  return [...new Set(found.sort((a, b) => b.score - a.score || a.i - b.i).map((c) => c.sel))].slice(0, max);
}

// The url and title after a navigation, plus the app's console events since the case's last call (D31).
async function settled(caseId: string, p: Page) {
  await p.waitForLoadState("load").catch(() => {});
  const heard = drain(caseId);
  return ok({ url: p.url(), title: await p.title(), ...(heard && { console: heard }) });
}

const SNAPSHOT_MAX = 90_000; // just under Claude Code's default 25k-token MCP output cap (D14)

// redact: the transport's account-value redactor (D9), applied to a snapshot before it is cut (D30).
export function registerBrowserTools(
  server: McpServer,
  getContext: () => { root: string; config: Config },
  redact: (text: string) => string,
) {
  const caseId = z.string().describe("Case id from session_start, e.g. t1-390x844; or scout for the look before a run");

  server.registerTool(
    "goto",
    {
      description:
        "Open a page in this case's browser. Give `path` (relative to the app url, including its base path: /login on http://host/app/ opens http://host/app/login) or a full `url`. Returns the final url and title, and `console`: page errors, console errors, failed requests and 4xx/5xx responses since your last call, when there were any.",
      inputSchema: { case: caseId, path: z.string().optional(), url: z.string().optional() },
    },
    async (a) => {
      try {
        const { config } = getContext();
        if (!a.path === !a.url) throw new Error("Give exactly one of path or url.");
        const p = await page(a.case, config);
        await p.goto(a.url ?? appUrl(a.path!, config.app.url), { waitUntil: "load" });
        return await settled(a.case, p);
      } catch (e) {
        return fail(e);
      }
    },
  );

  const selector = z.string().describe('Playwright selector, e.g. role=button[name="Sign in"], #email, text=Forgot password?');

  server.registerTool(
    "click",
    {
      description:
        "Click the element a Playwright selector matches. On a miss, the error lists the nearest candidates from the page's accessibility tree. Returns the url and title after the click, and `console` (errors and failed or 4xx/5xx requests since your last call) when there were any.",
      inputSchema: { case: caseId, selector },
    },
    async (a) => {
      try {
        const p = await page(a.case, getContext().config);
        try {
          await p.locator(a.selector).click({ timeout: ACT_TIMEOUT });
        } catch (e) {
          const near = nearest(a.selector, await p.locator("body").ariaSnapshot().catch(() => ""));
          throw new Error(
            `Could not click ${a.selector}: ${(e as Error).message.split("\n")[0]}\n` +
              (near.length ? `Nearest candidates:\n${near.map((n) => `- ${n}`).join("\n")}` : "The page has no clickable controls."),
          );
        }
        return await settled(a.case, p);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "fill",
    {
      description:
        "Type a value into an input, or choose an option (by value or label) in a <select>. Write account credentials as {{account.user}} and {{account.pass}}: the server fills in your case's account and you never see the values.",
      inputSchema: { case: caseId, selector, value: z.string() },
    },
    async (a) => {
      try {
        const { root, config } = getContext();
        const p = await page(a.case, config);
        const handle = a.case === SCOUT ? config.accounts[0]?.handle : current!.session.testers.find((t) => t.cases.includes(a.case))?.account;
        if (a.case === SCOUT && !handle && /\{\{account\./.test(a.value)) throw new Error("jeyna.config.yaml lists no accounts, so scout cannot sign in.");
        const value = substitute(a.value, accountValues(root, config).find((x) => x.handle === handle), a.case);
        const el = p.locator(a.selector);
        const tag = await el.evaluate((e) => e.tagName, undefined, { timeout: ACT_TIMEOUT });
        if (tag === "SELECT") await el.selectOption(value, { timeout: ACT_TIMEOUT });
        else await el.fill(value, { timeout: ACT_TIMEOUT });
        return ok({ filled: a.selector });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "press",
    {
      description:
        "Press a key or combination (Enter, Tab, Escape, Shift+Tab...) on the focused element. Returns the url and title after.",
      inputSchema: { case: caseId, key: z.string() },
    },
    async (a) => {
      try {
        const p = await page(a.case, getContext().config);
        // Through a locator, so a navigation the key starts (Enter in a form) is waited for, as with click.
        const focused = p.locator("*:focus");
        if (await focused.count()) await focused.press(a.key, { timeout: ACT_TIMEOUT });
        else await p.keyboard.press(a.key);
        return await settled(a.case, p);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "snapshot",
    {
      description:
        "The page's accessibility tree as text: roles, names, text. Your main way of reading the page. It does not show layout: use screenshot with look: true for visual questions. Ends with the app's console events since your last call (errors, failed or 4xx/5xx requests), when there were any.",
      inputSchema: { case: caseId },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        const p = await page(a.case, getContext().config);
        const text = clip(await p.locator("body").ariaSnapshot(), SNAPSHOT_MAX, redact);
        const heard = drain(a.case);
        return { content: [{ type: "text", text: heard ? `${text}\n\nConsole since your last call:\n${heard.map((l) => `- ${l}`).join("\n")}` : text }] };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "screenshot",
    {
      description:
        "Save a PNG of this case's page as evidence and return its file name. Set look: true to also see the image, for visual questions (layout, overlap, cut-off or off-screen elements); otherwise prefer snapshot. Viewport only unless fullPage is true. For case scout nothing is saved: it returns the image only.",
      inputSchema: {
        case: caseId,
        label: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase words joined by '-'").optional(),
        fullPage: z.boolean().default(false),
        look: z.boolean().default(false),
      },
    },
    async (a) => {
      try {
        const run = current;
        const p = await page(a.case, getContext().config);
        const png = await p.screenshot({ fullPage: a.fullPage });
        if (a.case !== SCOUT && (current !== run || run?.session.status !== "running")) {
          throw new Error("The run ended or was replaced while the screenshot was taken; nothing was saved.");
        }
        if (a.case === SCOUT) {
          return {
            content: [
              { type: "text" as const, text: "scout: not saved (the look before a run writes nothing)" },
              { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" },
            ],
          };
        }
        const seq = (shots.get(a.case) ?? 0) + 1;
        shots.set(a.case, seq);
        const name = `${a.case}-${seq}${a.label ? `-${a.label}` : ""}.png`;
        writeFileSync(join(run!.runDir, "evidence", name), png, { flag: "wx" });
        return {
          content: [
            { type: "text", text: name },
            ...(a.look ? [{ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }] : []),
          ],
        };
      } catch (e) {
        return fail(e);
      }
    },
  );
}

// Close Chrome with the server, so no browser outlives the session.
async function shutdown() {
  await Promise.race([browser?.then((b) => b.close()).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  process.exit(0);
}
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
