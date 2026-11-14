<p align="center">
  <img src="docs/design/jeyna-the-crab.svg" width="480" alt="Jeyna the Crab">
</p>

<h1 align="center">Jeyna</h1>

<p align="center"><strong>Agentic playtesting for Claude Code</strong></p>

<p align="center">
  <a href="https://github.com/TheClaessens/jeyna/actions/workflows/check.yml"><img src="https://github.com/TheClaessens/jeyna/actions/workflows/check.yml/badge.svg" alt="check status"></a>
  <a href="https://github.com/TheClaessens/jeyna/tags"><img src="https://img.shields.io/github/v/tag/TheClaessens/jeyna?sort=semver&label=version&color=1F5FA8" alt="latest version"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-0E1F38" alt="Node 20 or later">
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-D97757" alt="Claude Code plugin">
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#sample-app">Sample app</a> ·
  <a href="#development">Development</a>
</p>

Jeyna is a Claude Code plugin that plays your web app the way a first-time user would and records what it finds.

One command starts a run. Jeyna starts a tester subagent per scenario, each tester drives a headless browser through your app, and every problem it encounters is saved as a Markdown file with a screenshot under `.jeyna/`. Read the report yourself, or hand the folder back to Claude to fix what was found.

## Features

- **One command to run.** `/jeyna:playtest` runs a saved flow, or derives scenarios from a plain-language request and asks for confirmation before it starts.
- **Isolated testers.** One tester subagent per scenario, each in its own headless browser context, at every configured viewport.
- **Findings as files.** Each finding is a Markdown file with structured frontmatter, reproduction steps and screenshot evidence, in a format that people, the studio and Claude can all read.
- **Regression tracking.** Every report lists the verdicts that changed since the previous run of the same flow, and a single finding can be retested by id.
- **Studio.** A local viewer for runs, findings and evidence that follows a run while it is in progress.
- **Feedback capture.** Mark up the live app or a finding's screenshot, describe the change, and let Claude implement it.
- **Secrets stay out of prompts.** The configuration holds environment variable names only. Account values never appear in a prompt or a finding.
- **Nothing added to your project.** No npm package and no dependencies. The plugin is the `plugin/` folder of this repository.

## Screenshots

<p align="center">
  <img src="docs/screenshots/band-live.webp" width="900" alt="The Jeyna band above the Claude Code prompt during a run">
</p>

During a run, a status band above the prompt shows which cases have finished, the number of findings so far and where the run is stored on disk.

<p align="center">
  <img src="docs/screenshots/studio-run.jpg" width="900" alt="Jeyna studio showing a run">
</p>

`/jeyna:studio` opens the runs in your browser: the scenario × viewport matrix, every finding with its screenshot, and what changed since the last run.

## Installation

### Requirements

- Claude Code 2.1.302 or later
- Node.js 20 or later
- Google Chrome, or Playwright's Chromium (`npx playwright install chromium`)

Chrome runs headless with a temporary profile. Your own browser profile is never used.

### Install the plugin

Inside Claude Code:

```
/plugin marketplace add TheClaessens/jeyna
/plugin install jeyna@jeyna
```

Nothing is published to npm and nothing is added to your project's dependencies.

## Quick start

1. **Set up the project.** Run `/jeyna:init` once. It inspects how your app starts and asks for the app URL, the names of the environment variables that hold your test accounts (never their values), and whether screenshots are committed. It writes `.jeyna/jeyna.config.yaml` and `.jeyna/CONVENTIONS.md`.

2. **Provide the account values.** Put them in `.jeyna/.env` (gitignored), or export them before starting `claude`. Agents cannot read or write that file, and the values never appear in a prompt or a finding.

3. **Run a playtest.** Run `/jeyna:playtest todos` with a flow name, or describe what you want tested. Without a flow, Jeyna takes a short look at the app, proposes scenarios and waits for your confirmation. When the run is done, it offers to save the scenarios as a flow so they can be run again.

   ```
   3 testers, 1 batch (2 accounts): Sign-in page, Add a todo with a priority, Complete and delete a todo.

   Sign-in page: t1-1440x900 fail, t1-390x844 fail; 3 findings.
   Add a todo with a priority: t2-1440x900 fail, t2-390x844 fail; 4 findings.
   Complete and delete a todo: t3-1440x900 pass, t3-390x844 fail; 3 findings.

   Replayed the three todos scenarios at 1440x900 and 390x844; all three known problems
   persist. A todo saved with priority High comes back as Normal, the Sign in button is
   not visible at phone width, and the password field has no label.

   Cases: 1 passed, 5 failed, 0 blocked, 0 skipped.
   Findings: 1 critical, 1 major, 1 minor, 0 notes; 7 marked duplicate.
     PT-todos-004  critical  bug   Sign in button not visible at phone width
     PT-todos-006  major     bug   Chosen priority High is saved as Normal
     PT-todos-001  minor     a11y  Password field on sign-in has no label
   Since 2026-10-17-todos: Complete and delete a todo at 390x844: pass -> fail.
   Report: .jeyna/playtests/2026-10-17-todos-2/report.md
   1 min 42 s, 3 testers.
   ```

4. **Review the results.** Run `/jeyna:studio` to browse the run. After a fix, `/jeyna:playtest PT-todos-004` retests that one finding and marks it fixed if it passes.

## Commands

| Command | Description |
|---|---|
| `/jeyna:init` | Sets up `.jeyna/` in the project: configuration, conventions and the `.gitignore` entries. |
| `/jeyna:playtest [request]` | Runs a flow by name, or derives scenarios from a free-text request. |
| `/jeyna:playtest PT-…` | Retests a single finding and marks it fixed when it passes. |
| `/jeyna:studio [port]` | Opens Jeyna studio on localhost (default port 4710). |
| `/jeyna:feedback [FB-…]` | Lists the open feedback items, or loads one, for Claude to implement. |
| `/jeyna:feedback-next` | Loads the oldest open feedback item. |

## Flows

A flow is a Markdown file in `.jeyna/flows/` that defines a set of scenarios. Each scenario has a description and a `Pass:` line. The `Pass:` line is the only criterion a tester judges the case against. Anything else the tester notices is recorded as a finding, but does not fail the case.

```markdown
---
name: todos
entry: /login
---

## Preconditions

The app runs on its configured url. Each account starts with an empty todo list.

## Scenarios

### Sign-in page
Open the sign-in page without signing in and check that every control is labelled and on screen.
Pass: the email field, the password field and the Sign in button are all labelled and visible without scrolling sideways.
Account: none

### Add a todo with a priority
Sign in, then add a todo called "Buy milk" with priority High.
Pass: "Buy milk" appears in the list with High priority.

### Complete and delete a todo
Sign in, add a todo, mark it complete, then delete it.
Pass: the todo shows as done after completing it, and is gone from the list after deleting it.

## What matters most here

Todos keep exactly what was typed and chosen. Nothing about the sign-in form may be hidden at phone width.
```

The optional `Account:` line controls sign-in:

| Value | Meaning |
|---|---|
| *(omitted)* | The scenario signs in with the account assigned to its tester. |
| `none` | The scenario does not sign in. |
| `consumes` | The scenario may lock or change its account (wrong passwords, a password reset), so it runs last. |

## Findings

Each finding is a single file under `.jeyna/playtests/<run>/findings/`, with its screenshot under `evidence/` in the same run folder:

```markdown
---
schema: 1
id: PT-todos-001
kind: a11y
severity: minor
status: open
flow: todos
case: t2-1440x900
scenario: Add a todo with a priority
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:04:42.836Z
evidence:
  - t2-1440x900-1-login.png
---

# Password field on sign-in has no label

## Steps

1. Open /login
2. Read the form

## Expected

Password input has a visible label and accessible name

## Actual

Only Email is labelled; the second textbox has no label or name

## Evidence

![t2-1440x900-1-login.png](../evidence/t2-1440x900-1-login.png)
```

| Field | Values |
|---|---|
| `kind` | `bug`, `ux`, `a11y`, `question` |
| `severity` | `critical`, `major`, `minor`, `note` |
| `status` | `open`, `duplicate`, `wontfix`, `fixed` |

Findings are written by the server, never by an agent, so their structure is always consistent. The `.jeyna/` folder is designed to be committed: it is readable by people, by the studio, and by Claude in a later session.

## Feedback

The studio also works in the other direction: you show Claude what should change.

- **Live** opens your app in a dedicated Chrome window with its own profile, so sign-ins persist between sessions.
- <kbd>⌥</kbd><kbd>⇧</kbd><kbd>S</kbd> freezes the page. Drag over the area concerned, describe what should change, and save with <kbd>⌘</kbd><kbd>↩</kbd>.
- <kbd>⌥</kbd><kbd>⇧</kbd><kbd>R</kbd> records a short clip of an area while you use the app.
- **Give feedback** on a finding does the same over its screenshot.

Each item is saved to `.jeyna/feedback/` with exactly the pixels you selected. `/jeyna:feedback` has Claude pick the items up and make the changes. An item is marked done only after you approve the result.

## Configuration

`/jeyna:init` writes `.jeyna/jeyna.config.yaml`. Edit it by hand afterwards as needed.

| Key | Description | Default |
|---|---|---|
| `app.name` | Name of the app under test | asked at init |
| `app.url` | Base URL of the app under test | asked at init |
| `app.build` | Fixed build id for reports. `null` uses `git describe --always --dirty` | `null` |
| `app.reset` | Shell command run before every run, so that each run starts from the same state. A failing command refuses the run | `null` |
| `app.new_account` | Shell command that creates a new test user on every call and prints `JEYNA_USER=<username>` and `JEYNA_PASS=<password>`. When set, each tester that signs in gets its own account, so all testers can run at once | `null` |
| `viewports` | Viewport sizes. Every scenario runs once per viewport | `[1440x900, 390x844]` |
| `browser.headed` | Shows the browser, for tuning a run | `false` |
| `tester.model`, `tester.effort` | Model and effort used for the testers | `sonnet`, `medium` |
| `tester.parallel` | Maximum number of testers running at once | `20` |
| `accounts` | Test accounts as `{ handle, user_env, pass_env }`. Environment variable names, never values. No two testers hold the same account at once, so a small pool runs testers in batches | `[]` |

`.jeyna/CONVENTIONS.md` defines what counts as a bug, a UX issue or an accessibility issue, and how severity is graded. It is included in every tester prompt, so adapt it to your app.

## Sample app

`sample-app/` is a small todo app with a sign-in page and six seeded bugs, listed in [`SEEDED-BUGS.md`](sample-app/SEEDED-BUGS.md). It ships with a configuration, a flow and several real runs in `sample-app/.jeyna/`.

```sh
node sample-app/server.mjs            # http://localhost:4173
cd sample-app
cp .env.example .jeyna/.env           # the two test accounts
claude --plugin-dir ../plugin         # or use the installed plugin
```

Then run `/jeyna:playtest todos`, and `/jeyna:studio` to review the runs.

## Development

```sh
npm install
npm run build         # bundles plugin/server and plugin/studio
npm test
npm run check         # tests, typecheck and bundle check; required before every commit
npm run studio        # the studio against sample-app/
```

The bundles under `plugin/server/` and `plugin/studio/` are committed. Rebuild and commit them with every source change; `npm run check` fails when they are out of date.

### Repository layout

| Path | Contents |
|---|---|
| `src/` | The MCP server and the studio, with tests next to the code |
| `plugin/` | What gets installed: skills, the tester agent, hooks, templates and the committed bundles |
| `docs/` | Concept, architecture and decisions |
| `sample-app/` | The todo app with the seeded bugs |

### Documentation

- [`GLOSSARY.md`](GLOSSARY.md): the project's terminology
- [`docs/jeyna-concept.md`](docs/jeyna-concept.md): the concept
- [`docs/jeyna-architecture.md`](docs/jeyna-architecture.md): the architecture
- [`docs/decisions.md`](docs/decisions.md): the decision log
- [`CODING_STANDARDS.md`](CODING_STANDARDS.md): the coding standards

### Issues

Bugs and feature requests are tracked in [GitHub Issues](https://github.com/TheClaessens/jeyna/issues).

## License

No license has been selected yet.
