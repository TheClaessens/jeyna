// Bundles src/server.ts into the committed plugin/server/jeyna-mcp.mjs (D13, probe P1), and the studio
// (sidecar + UI) into plugin/studio/ (D34). Developers run neither npm nor a build: the plugin ships the output.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// esbuild writes each bundled module's path into the bundle, and pnpm nests packages under
// node_modules/.pnpm/<name>@<version>/node_modules/: fold that to npm's node_modules/ so the committed
// bundles are the same from either install (D35).
const npmPaths = (f) =>
  writeFileSync(f, readFileSync(f, "utf8").replaceAll(/node_modules\/\.pnpm\/[^/]+\/node_modules\//g, "node_modules/"));

await build({
  entryPoints: ["src/server.ts"],
  outfile: "plugin/server/jeyna-mcp.mjs",
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
});
npmPaths("plugin/server/jeyna-mcp.mjs");

mkdirSync("plugin/server/pw", { recursive: true });
for (const f of ["package.json", "browsers.json"]) cpSync(`node_modules/playwright-core/${f}`, `plugin/server/pw/${f}`);

// Jeyna studio (D34): the sidecar as one node bundle, the UI as one browser bundle plus its stylesheet, beside index.html and the mark.
await build({
  entryPoints: ["src/studio/server.ts"],
  outfile: "plugin/studio/jeyna-studio.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
npmPaths("plugin/studio/jeyna-studio.mjs");
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
cpSync("src/studio/index.html", "plugin/studio/index.html");
cpSync("docs/design/jeyna-anchor.svg", "plugin/studio/anchor.svg");
