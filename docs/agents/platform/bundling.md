# esbuild single-file ESM bundle incl. playwright-core (probe P1) + browser launch + aria snapshot

VERIFIED 2026-10-15 on macOS arm64, node 20.12.2, esbuild 0.28.2, playwright-core 1.64.1, Google Chrome installed:
the bundle below, copied with its two sidecar JSON files into a dir with NO node_modules, launched Chrome (channel "chrome"),
returned an aria snapshot + PNG over MCP stdio. Working files: `scratchpad/exp/build.mjs`, `scratchpad/iso/`.

## P1 verdict: bundling works, but NOT as a pure single file
Three problems, each hit for real:
1. **Build error** — `Could not resolve "chromium-bidi/lib/cjs/bidiMapper/BidiMapper"` (and `.../cdp/CdpConnection`). playwright-core requires them but doesn't depend on them (BiDi protocol only). Fix: mark `chromium-bidi` external. Not needed for Chromium/CDP.
2. **Runtime crash** — `ReferenceError: __dirname is not defined in ES module scope` (from playwright-core `package.ts`). ESM output has no `__dirname`/`__filename`/`require`. Fix: banner shim.
3. **Runtime file reads** — playwright-core computes `packageRoot = join(__dirname, "..")` and at import time does `require(join(packageRoot, "package.json"))` (for `.version`) and `require(join(packageRoot, "browsers.json"))` (browser registry). These are dynamic requires esbuild can't inline. Fix: point the shimmed `__dirname` at `<bundle dir>/pw/lib` and ship `pw/package.json` + `pw/browsers.json` copied from `node_modules/playwright-core/`. (The `lib/` dir itself need not exist for launch/goto/screenshot/ariaSnapshot; it's used by codegen, trace viewer, browser download, webp/screencast — none in scope.)

Result: `plugin/server/jeyna-mcp.mjs` (~8.3 MB unminified) + `plugin/server/pw/package.json` + `plugin/server/pw/browsers.json`, all committed. `--minify` shrinks it; keep `keepNames` if stack traces matter.

## build.mjs (VERIFIED)
```js
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

await build({
  entryPoints: ["src/server.ts"],
  outfile: "plugin/server/jeyna-mcp.mjs",
  bundle: true, platform: "node", format: "esm", target: "node20",
  // optional deps playwright-core/ws require behind try/catch or never on our path:
  external: ["chromium-bidi", "chromium-bidi/*", "electron/*", "bufferutil", "utf-8-validate"],
  banner: { js: [
    "import { createRequire as __cr } from 'node:module';",
    "import { fileURLToPath as __f2p } from 'node:url';",
    "import { dirname as __dn, join as __jn } from 'node:path';",
    "const require = __cr(import.meta.url);",
    "const __filename = __f2p(import.meta.url);",
    // playwright-core reads join(__dirname,'..')/{package,browsers}.json at import time
    "const __dirname = __jn(__dn(__filename), 'pw', 'lib');",
  ].join("\n") },
  logLevel: "warning",
});
mkdirSync("plugin/server/pw", { recursive: true });
for (const f of ["package.json", "browsers.json"])
  cpSync(`node_modules/playwright-core/${f}`, `plugin/server/pw/${f}`);
```
Notes:
- The `createRequire` banner is needed because esbuild turns CJS `require("fs")` etc. into `__require(...)`, which throws "Dynamic require of X is not supported" in ESM without a real `require` in scope.
- Leftover `require("ajv/dist/runtime/...")` strings in the bundle are inside ajv's generated-code strings, not real calls; harmless.
- Prefixing banner imports (`__cr`, `__f2p`) avoids clashing with bundled identifiers.
- Run the P1 check exactly like the slice says: copy `plugin/server/` to a temp dir, no node_modules, spawn it via an MCP client (see mcp-server.md) and call a browser tool.
- Alternative not taken: Claude Code itself runs `npm ci`-style installs for a plugin whose ROOT has `package.json` + `package-lock.json` (registry deps pinned exactly) when it copies the plugin to its cache — but NOT for plugins loaded in place (`--plugin-dir`, marketplace added from a local path). Bundling avoids that split. (Source: plugins/loading.md "Node.js package dependencies".)

## Browsers are never bundled
playwright-core ships no browser. Options at runtime:
- `channel: "chrome"` -> the user's installed Google Chrome (mac: `/Applications/Google Chrome.app/...`). Other channels: `chrome-beta`, `chrome-dev`, `chrome-canary`, `msedge`, ...
- no channel -> Playwright's own build from `~/Library/Caches/ms-playwright` (Linux `~/.cache/ms-playwright`, Windows `%LOCALAPPDATA%\ms-playwright`, override `PLAYWRIGHT_BROWSERS_PATH`). In headless mode it looks for `chromium_headless_shell-<rev>`, where `<rev>` comes from the bundled `browsers.json` (1248 for 1.64.1).

Observed error messages (VERIFIED):
- missing channel: `Chromium distribution 'chrome-canary' is not found at /Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary` (nothing else; no install hint).
- missing bundled Chromium: `browserType.launch: Executable doesn't exist at .../ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell` + box "npx playwright install".

GOTCHA: `npx playwright install chromium` installs the revision of whatever `playwright` version npx resolves (latest), which may not match the bundled 1.64.1 revision -> still "Executable doesn't exist". The fallback message should pin: `npx playwright@<bundled version> install chromium` (read version from `pw/package.json` at runtime: `createRequire(import.meta.url)("./pw/package.json").version`). Whether `install chromium` also fetches the headless shell in 1.64 is UNVERIFIED; `--only-shell` exists for shell-only.

## Launch with fallback (VERIFIED)
```ts
import { chromium, type Browser } from "playwright-core";
let browser: Promise<Browser> | undefined;           // promise cache: concurrent callers share one launch
export function getBrowser(): Promise<Browser> {
  return (browser ??= launch().catch((e) => { browser = undefined; throw e; }));
}
async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: process.env.JEYNA_BROWSER_CHANNEL ?? "chrome", headless: true });
  } catch (e) {
    log("chrome launch failed:", (e as Error).message.split("\n")[0]);
  }
  try {
    return await chromium.launch({ headless: true });
  } catch {
    throw new Error(`No browser found. Install Google Chrome, or run: npx playwright@${PW_VERSION} install chromium`);
  }
}
// one context per case: isolation of cookies/storage; viewport per case
const ctx = await (await getBrowser()).newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "load" });
const png = await page.screenshot();                 // Buffer; fullPage: true for whole page
await ctx.close();
```
Forcing the fallback for P4: an env knob like `JEYNA_BROWSER_CHANNEL=chrome-canary` (or any absent channel) is the cheapest way.
Launch cost observed ~2.4 s first call (Chrome cold start), contexts are cheap after that. Close the browser on `process.on("SIGTERM"/"SIGINT")` / stdin end, or Chrome processes may linger (UNVERIFIED whether Playwright cleans up when the parent dies).

## Aria snapshot for `snapshot` (VERIFIED, playwright-core 1.64.1)
```ts
await page.locator("body").ariaSnapshot();                     // YAML-ish string
await page.ariaSnapshot({ mode: "ai", boxes: true });         // page-level, refs + bounding boxes
```
Options (types.d.ts): `{ mode?: "default"|"ai", boxes?: boolean, depth?: number, timeout?: number, signal? }`. `page.ariaSnapshot()` and `boxes`/`mode` are recent additions — check they exist if the playwright-core version changes.

Login page with an unlabelled password field and a Sign in button at `left:500px` in a 390-wide viewport:
```
default:                         mode "ai" + boxes:
- text: Email                    - generic [active] [ref=e1] [box=8,8,374,828]:
- textbox "Email"                  - generic [ref=e2] [box=8,9,195,18]:
- textbox                            - text: Email
- button "Sign in"                   - textbox "Email" [ref=e3] [box=50,8,153,21]
                                   - textbox [ref=e4] [box=203,8,153,21]
                                   - button "Sign in" [ref=e5] [box=500,8,43,36]
```
- Bug 3 (unlabelled password) shows in both as a nameless `- textbox`.
- Bug 2 (off screen): the default snapshot cannot show it (P5's premise holds), BUT `boxes: true` exposes `x=500 >= viewport 390`. Worth noting in decisions: the screenshot isn't the only way to see layout bugs.
- `mode: "ai"` refs are clickable: `page.locator("aria-ref=e5").click()` worked (useful for slice 2 click/fill). Refs are per-snapshot; re-snapshot after navigation.
- Playwright's `click()` scrolled the off-screen button into view and clicked it — actionability checks will NOT flag bug 2.
