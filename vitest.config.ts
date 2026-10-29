import { defineConfig } from "vitest/config";

// Agent worktrees under .claude/worktrees/ carry their own copies of the suite (D33).
// Most tests start the MCP server and launch a Chrome: 1 to 2 s here, past vitest's 5 s default on a CI runner where
// every test file starts at once. Tests that play a whole run still set their own, longer timeout.
export default defineConfig({
  test: { exclude: [".claude/**", "**/node_modules/**", "plugin/**"], globalSetup: "src/testkit.ts", testTimeout: 30_000 },
});
