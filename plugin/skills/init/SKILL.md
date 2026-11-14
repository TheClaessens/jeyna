---
description: Set up Jeyna in this project. Writes .jeyna/ (config, conventions, .env) and the .gitignore lines, then checks the result with get_context.
disable-model-invocation: true
---

# /jeyna:init

Set up `.jeyna/` in `${CLAUDE_PROJECT_DIR}`. Templates are in `${CLAUDE_PLUGIN_ROOT}/templates/`.

Write only the files listed below. Never copy a skill, agent or hook into the project; they stay in the plugin.

## 1. Check

If `${CLAUDE_PROJECT_DIR}/.jeyna/jeyna.config.yaml` already exists, say so and stop. Do not overwrite it.

## 2. Inspect the project

Look for how the app starts and on which port: `package.json` scripts, framework config (vite, next, …), `.env.example`, a README. Propose an app name (the folder or package name) and an app URL such as `http://localhost:<port>`.

## 3. Ask the developer

Ask in one round:

1. **App URL**: confirm or correct your proposal.
2. **Test accounts**: a handle for each (e.g. `user_a`) and the names of the two environment variables holding its username and password. Propose `JEYNA_<HANDLE>_USER` and `JEYNA_<HANDLE>_PASS`. None is a valid answer. Ask for variable **names only**; never ask for, accept or write a username or password.
   Offer the alternative: a shell command that creates a new test user on every call and prints `JEYNA_USER=<username>` and `JEYNA_PASS=<password>` on stdout (it may use `$JEYNA_ACCOUNT` and `$JEYNA_RUN` to build a unique name). With it, every tester gets its own account and all testers run at once. The command must contain no password itself. Both together are fine: a flow that needs a particular seeded user names its handle in `accounts`.
3. **Evidence in git**: commit screenshots under `.jeyna/playtests/*/evidence/`, or gitignore them.

## 4. Write the files

1. `mkdir -p .jeyna`.
2. `.jeyna/jeyna.config.yaml`: copy the template, replace `__APP_NAME__` and `__APP_URL__`, and replace `accounts: []` with one line per account, e.g. `  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }` under `accounts:`. With a command that creates users, put it in place of `null` in `new_account: null`. Keep the comments.
3. `.jeyna/CONVENTIONS.md`: copy the template as is.
4. `.jeyna/.env`: it holds the accounts' secrets, so handle it **with Bash** and print nothing from it (the write guard denies `Read`, `Write` and `Edit` on this file). If it does not exist, `cp` the `env` template to it. Then, for each variable name, append an empty line only when the file lacks that name, a command that prints no value:
   `grep -q '^JEYNA_USER_A_USER=' .jeyna/.env || printf 'JEYNA_USER_A_USER=\n' >> .jeyna/.env`
   Leave the values empty; the developer fills them in.
5. `.gitignore` at the project root (create it if missing), adding only lines not already there:
   - always `.jeyna/.env`, `.jeyna/index.json` (the studio's derived cache) and `.jeyna/chrome-profile/` (the Live window's browser profile, with its logins);
   - if evidence is gitignored, also `.jeyna/playtests/*/evidence/`.

## 5. Validate

Call `get_context` (`mcp__plugin_jeyna_mcp__get_context`).

- On an error, fix the config it names and call it again.
- On success, show the developer the project root, the files written, and for each account variable where it was found (`env`, `.env` or `missing`). For each `missing` one, say: fill it in `.jeyna/.env`, or export it in the shell before starting `claude`. Never print a value.
