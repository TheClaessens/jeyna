# Implementer rules (jeyna)

The orchestrator names the **integration branch** and gives you a worktree of this repo. Every path below is relative to the repo root.

Context pointers: docs/first-slice.md, docs/jeyna-v0-functional-technical-analysis.md, docs/decisions.md (D20+ are probe/implementation entries from earlier tickets), GLOSSARY.md, and the platform notes in docs/agents/platform/ (plugin.md, hooks.md, mcp-server.md, bundling.md). Read `git log <integration branch>` to see what earlier tickets built; reuse their modules and test seams (src/*.test.ts drive the bundle over MCP stdio from a folder with no node_modules; src/testkit.ts starts sample-app/ on a free port; src/shared.ts holds frontmatter, run and URL resolution).

1. Confirm your worktree HEAD is the integration branch tip; if not, `git reset --hard <integration branch>`. Run `npm install`.
2. Invoke the Skill tool with `tdd` and build the ticket. You cannot ask the user questions; choose seams yourself, consistent with existing tests.
3. Verify locally: vitest, MCP stdio client against the bundle, hook scripts fed sample JSON (and sample transcript JSONL), `claude plugin validate ./plugin` and `claude plugin validate .`. Live Claude sessions (`claude -p`, headless or not) are the developer's to run, never yours: each one is billed. Anything that truly needs a live session: record it as "pending live verification" in a new docs/decisions.md entry (next free D number, today's date, the Claude Code version from `claude --version`). Never fake a probe result. A ticket that says "verify in a headless Claude Code" means this step.
4. `npm run check` is green before each commit: it rebuilds the bundle and fails when the committed plugin/server/jeyna-mcp.mjs differs from source, then runs typecheck, the tests, and the D-number check. Commit the rebuilt bundle with the source.
5. Other tickets run in parallel; keep shared-file edits (src/server.ts, plugin/agents/jeyna-tester.md, plugin/hooks/hooks.json, docs/decisions.md) additive. The tester allowlist lists only tester tools that exist on your branch.
6. Commit with conventional commits, `refs #<n>`, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push, don't close issues.
7. Before reporting, merge the current integration branch tip into your branch; on a bundle conflict rebuild and commit the rebuilt bundle; renumber your D entry if it collides; `npm run check` green.

Report briefly: branch, worktree path, what passed, what is unverified (pending live verification items).
