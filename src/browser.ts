import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import pw from "playwright-core/package.json" with { type: "json" };
import { z } from "zod";
import type { Config } from "./schema.js";
import { current, fail, ok } from "./session.js";
import { accountValues, substitute } from "./accounts.js";

const log = (...a: unknown[]) => console.error(new Date().toISOString(), ...a);

// One browser per server process: the installed Chrome with a temporary profile, else Playwright's
// Chromium (D13). JEYNA_BROWSER_CHANNEL overrides the channel, which is how P4 forces the fallback.
let browser: Promise<Browser> | undefined;

function getBrowser(headed: boolean): Promise<Browser> {
  return (browser ??= launch(headed).catch((e) => {
    browser = undefined;
    throw e;
  }));
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

export async function closeContexts() {
  const all = [...pages.values()];
  pages.clear();
  shots.clear();
  await Promise.allSettled(all.map(async (p) => (await p).context().close()));
}

function page(caseId: string, config: Config): Promise<Page> {
  if (!current) throw new Error("No running session. Call session_start first; browser tools take a case id from its result.");
  const c = current.session.cases.find((c) => c.id === caseId);
  if (!c) throw new Error(`Unknown case "${caseId}". Cases in this run: ${current.session.cases.map((c) => c.id).join(", ")}.`);
  let p = pages.get(caseId);
  if (!p) {
    const [width, height] = c.viewport.split("x").map(Number);
    p = getBrowser(config.browser.headed).then(async (b) => (await b.newContext({ viewport: { width, height } })).newPage());
    p.catch(() => pages.delete(caseId));
    pages.set(caseId, p);
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

async function settled(p: Page) {
  await p.waitForLoadState("load").catch(() => {});
  return ok({ url: p.url(), title: await p.title() });
}

const SNAPSHOT_MAX =90_000; // just under Claude Code's default 25k-token MCP output cap (D14)

export function registerBrowserTools(server: McpServer, getContext: () => { root: string; config: Config }) {
  const caseId = z.string().describe("Case id from session_start, e.g. t1-390x844");

  server.registerTool(
    "goto",
    {
      description: "Open a page in this case's browser. Give `path` (relative to the app url, e.g. /login) or a full `url`. Returns the final url and title.",
      inputSchema: { case: caseId, path: z.string().optional(), url: z.string().optional() },
    },
    async (a) => {
      try {
        const { config } = getContext();
        if (!a.path === !a.url) throw new Error("Give exactly one of path or url.");
        const p = await page(a.case, config);
        await p.goto(a.url ?? new URL(a.path!, config.app.url).href, { waitUntil: "load" });
        return ok({ url: p.url(), title: await p.title() });
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
        "Click the element a Playwright selector matches. On a miss, the error lists the nearest candidates from the page's accessibility tree. Returns the url and title after the click.",
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
        return await settled(p);
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
        const handle = current!.session.testers.find((t) => t.cases.includes(a.case))?.account;
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
        return await settled(p);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "snapshot",
    {
      description:
        "The page's accessibility tree as text: roles, names, text. Your main way of reading the page. It does not show layout: use screenshot with look: true for visual questions.",
      inputSchema: { case: caseId },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        const p = await page(a.case, getContext().config);
        const snap = await p.locator("body").ariaSnapshot();
        const text =
          snap.length > SNAPSHOT_MAX
            ? `${snap.slice(0, SNAPSHOT_MAX)}\n[truncated at ${SNAPSHOT_MAX} characters, the page continues]`
            : snap;
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "screenshot",
    {
      description:
        "Save a PNG of this case's page as evidence and return its file name. Set look: true to also see the image, for visual questions (layout, overlap, cut-off or off-screen elements); otherwise prefer snapshot. Viewport only unless fullPage is true.",
      inputSchema: {
        case: caseId,
        label: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase words joined by '-'").optional(),
        fullPage: z.boolean().default(false),
        look: z.boolean().default(false),
      },
    },
    async (a) => {
      try {
        const p = await page(a.case, getContext().config);
        const png = await p.screenshot({ fullPage: a.fullPage });
        const seq = (shots.get(a.case) ?? 0) + 1;
        shots.set(a.case, seq);
        const name = `${a.case}-${seq}${a.label ? `-${a.label}` : ""}.png`;
        writeFileSync(join(current!.runDir, "evidence", name), png, { flag: "wx" });
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
