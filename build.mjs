// Bundles src/server.ts into the committed plugin/server/jeyna-mcp.mjs (D13, probe P1).
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

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

mkdirSync("plugin/server/pw", { recursive: true });
for (const f of ["package.json", "browsers.json"]) cpSync(`node_modules/playwright-core/${f}`, `plugin/server/pw/${f}`);
