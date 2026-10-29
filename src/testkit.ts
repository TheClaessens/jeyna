// Test helpers shared by the src/*.test.ts files (not bundled: only src/server.ts and its imports are).
import { spawn, type ChildProcess } from "node:child_process";
import { chromium } from "playwright-core";

// vitest's globalSetup (vitest.config.ts). A fresh CI runner's first Chrome launches take 5 to 30 s while the test
// files all start at once, so whichever tests launch first timed out; later launches take 1 to 3 s. Launch Chrome
// once before any file starts. No Chrome here: the tests report that themselves.
export async function setup() {
  await (await chromium.launch({ channel: "chrome" }).catch(() => undefined))?.close();
}

export type App = { url: string; proc: ChildProcess; stop: () => Promise<void> };

// The sample app on port 0: it picks a free port and prints it, so test files running in parallel never collide.
export async function startApp(): Promise<App> {
  const proc = spawn("node", ["sample-app/server.mjs"], { env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout!.on("data", (d) => {
      out += String(d);
      const m = /http:\/\/localhost:\d+/.exec(out);
      if (m) resolve(m[0]);
    });
    proc.once("exit", (code) => reject(new Error(`sample app exited (${code}) before printing its url`)));
  });
  const stop = async () => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await exited;
  };
  return { url, proc, stop };
}
