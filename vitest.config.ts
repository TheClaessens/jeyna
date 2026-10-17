import { defineConfig } from "vitest/config";

// Agent worktrees under .claude/worktrees/ carry their own copies of the suite (D33).
export default defineConfig({ test: { exclude: [".claude/**", "**/node_modules/**"] } });
