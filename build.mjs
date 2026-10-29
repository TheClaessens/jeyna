// Bundles src/server.ts into the committed plugin/server/jeyna-mcp.mjs (D13, probe P1), and the studio
// (sidecar + UI) into plugin/studio/ (D34). Developers run neither npm nor a build: the plugin ships the output.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// esbuild writes each bundled module's path into the bundle, and pnpm nests packages under
// node_modules/.pnpm/<name>@<version>/node_modules/: fold that to npm's node_modules/ so the committed
// bundles are the same from either install (D35).
const npmPaths = (f) =>
  writeFileSync(f, readFileSync(f, "utf8").replaceAll(/node_modules\/\.pnpm\/[^/]+\/node_modules\//g, "node_modules/"));

// A node bundle that carries playwright-core: the MCP server, and the studio sidecar for its Live window (D37).
const withPlaywright = (entry, outfile) => build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Optional deps that playwright-core/ws require behind try/catch or never on the Chromium path.
  external: ["chromium-bidi", "chromium-bidi/*", "electron/*", "bufferutil", "utf-8-validate"],
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __f2p } from 'node:url';",
      "import { dirname as __dn, join as __jn } from 'node:path';",
      "const require = __cr(import.meta.url);",
      "const __filename = __f2p(import.meta.url);",
      // playwright-core reads join(__dirname, '..')/{package,browsers}.json at import time.
      "const __dirname = __jn(__dn(__filename), 'pw', 'lib');",
    ].join("\n"),
  },
  logLevel: "warning",
}).then(() => {
  npmPaths(outfile);
  const pw = `${outfile.slice(0, outfile.lastIndexOf("/"))}/pw`;
  mkdirSync(pw, { recursive: true });
  for (const f of ["package.json", "browsers.json"]) cpSync(`node_modules/playwright-core/${f}`, `${pw}/${f}`);
});

await withPlaywright("src/server.ts", "plugin/server/jeyna-mcp.mjs");

// Jeyna studio (D34): the sidecar as one node bundle, the UI as one browser bundle plus its stylesheet, beside index.html
// and the mark; and the capture script the sidecar injects into the Live window (D37), its stylesheet inlined as text.
await withPlaywright("src/studio/server.ts", "plugin/studio/jeyna-studio.mjs");
await build({
  entryPoints: { app: "src/studio/app/main.tsx" },
  outdir: "plugin/studio",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
await build({
  entryPoints: ["src/studio/overlay/inject.tsx"],
  outfile: "plugin/studio/overlay.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
cpSync("src/studio/index.html", "plugin/studio/index.html");
cpSync("docs/design/jeyna-anchor.svg", "plugin/studio/anchor.svg");
