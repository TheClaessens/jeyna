// Repo checks no compiler or test catches. Run by `npm run check` after `npm test` has rebuilt the bundle.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const errors = [];

// The plugin ships the committed bundles (D13, D34), so they must be the ones source builds.
for (const dir of ["plugin/server", "plugin/studio"]) {
  try {
    execFileSync("git", ["diff", "--quiet", "--", dir]);
  } catch {
    errors.push(`${dir} differs from git's index after the build: stage the rebuilt bundle (git add ${dir}).`);
  }
}

// Decisions are D1, D2, … with no gap or repeat.
const ds = [...readFileSync("docs/decisions.md", "utf8").matchAll(/^## D(\d+) /gm)].map((m) => Number(m[1]));
ds.forEach((d, i) => {
  if (d !== i + 1) errors.push(`docs/decisions.md: heading ${i + 1} is D${d}, expected D${i + 1}.`);
});

// Tests start the sample app only through src/testkit.ts (port 0); a fixed port collides when test files run in parallel.
for (const f of readdirSync("src").filter((f) => f.endsWith(".test.ts"))) {
  if (readFileSync(`src/${f}`, "utf8").includes("sample-app/server.mjs")) {
    errors.push(`src/${f} starts sample-app/server.mjs itself: use startApp() from src/testkit.ts.`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
