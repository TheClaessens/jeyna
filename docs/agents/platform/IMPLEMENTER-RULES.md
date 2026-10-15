# Implementer rules (jeyna)

Repo: /Users/thomasclaessens/Documents/git/jeyna, GitHub TheClaessens/jeyna. Integration branch: `v0-integration` (local, not pushed).

Context pointers: docs/first-slice.md, docs/jeyna-v0-functional-technical-analysis.md, docs/decisions.md (D20+ are probe/implementation entries from earlier tickets), GLOSSARY.md, and the platform notes in docs/agents/platform/ (plugin.md, hooks.md, mcp-server.md, bundling.md). Read `git log v0-integration` to see what earlier tickets built; reuse their modules and test seams (src/*.test.ts drive the bundle over MCP stdio from a folder with no node_modules; sample-app/ is the test project).

1. Confirm your worktree HEAD is the `v0-integration` tip; if not, `git reset --hard v0-integration`. Run `npm install`.
2. Invoke the Skill tool with `tdd` and build the ticket. You cannot ask the user questions; choose seams yourself, consistent with existing tests.
3. NEVER run `claude -p` or any headless/live Claude session (user forbids: cost). Verify locally: vitest, MCP stdio client against the bundle, hook scripts fed sample JSON (and sample transcript JSONL), `claude plugin validate ./plugin` and `claude plugin validate .`. Anything that truly needs a live session: record as "pending live verification" in a new docs/decisions.md entry (next free D number; dated 2026-10-15; Claude Code 2.1.299). Never fake a probe result.
4. The committed bundle plugin/server/jeyna-mcp.mjs must match source: `npm run build` as the last step before each commit; commit the bundle.
5. Other tickets run in parallel; keep shared-file edits (src/server.ts, plugin/agents/jeyna-tester.md, plugin/hooks/hooks.json, docs/decisions.md) additive. The tester allowlist lists only tester tools that exist on your branch.
6. Commit with conventional commits, `refs #<n>`, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push, don't close issues.
7. Before reporting, merge the current `v0-integration` tip into your branch; on a bundle conflict rebuild and commit the rebuilt bundle; renumber your D entry if it collides; run `npm test` and `npm run typecheck`.

Report briefly: branch, worktree path, what passed, what is unverified (pending live verification items).
