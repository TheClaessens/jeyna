---
description: Set up Jeyna in this project. Writes .jeyna/ (config, conventions, .env) and the .gitignore lines, then checks the result with get_context.
disable-model-invocation: true
---

# /jeyna:init

Set up `.jeyna/` in `${CLAUDE_PROJECT_DIR}`. Templates are in `${CLAUDE_PLUGIN_ROOT}/templates/`.

Write only the files listed below. Never copy a skill, agent or hook into the project: the plugin is the distribution.

## 1. Check

If `${CLAUDE_PROJECT_DIR}/.jeyna/jeyna.config.yaml` already exists, say so and stop. Do not overwrite it.

## 2. Inspect the project

Look for how the app starts and on which port: `package.json` scripts, framework config (vite, next, …), `.env.example`, a README. Propose an app name (the folder or package name) and an app URL such as `http://localhost:<port>`.

## 3. Ask the developer

Ask in one round:

1. **App URL**: confirm or correct your proposal.
2. **Test accounts**: a handle for each (e.g. `user_a`) and the names of the two environment variables holding its username and password. Propose `JEYNA_<HANDLE>_USER` and `JEYNA_<HANDLE>_PASS`. None is a valid answer. Ask for variable **names only**; never ask for, accept or write a username or password.
3. **Evidence in git**: commit screenshots under `.jeyna/playtests/*/evidence/`, or gitignore them.

## 4. Write the files

1. `mkdir -p .jeyna`.
2. `.jeyna/jeyna.config.yaml`: copy the template, replace `__APP_NAME__` and `__APP_URL__`, and replace `accounts: []` with one line per account, e.g. `  - { handle: user_a, user_env: JEYNA_USER_A_USER, pass_env: JEYNA_USER_A_PASS }` under `accounts:`. Keep the comments.
3. `.jeyna/CONVENTIONS.md`: copy the template as is.
4. `.jeyna/.env`: create it **with Bash** (the write guard denies `Write`/`Edit` on this file): `cp` the `env` template, then append one empty line per variable, e.g. `printf 'JEYNA_USER_A_USER=\nJEYNA_USER_A_PASS=\n' >> .jeyna/.env`. Leave the values empty. If `.jeyna/.env` already exists, only append the variables it lacks.
5. `.gitignore` at the project root (create it if missing), adding only lines not already there:
   - always `.jeyna/.env`, `.jeyna/index.json` (the studio's derived cache, D34) and `.jeyna/chrome-profile/` (the Live window's browser profile, with its logins, D37);
   - if evidence is gitignored, also `.jeyna/playtests/*/evidence/`.

## 5. Validate

Call `get_context` (`mcp__plugin_jeyna_mcp__get_context`).

- On an error, fix the config it names and call it again.
- On success, show the developer the project root, the files written, and for each account variable where it was found (`env`, `.env` or `missing`). For each `missing` one, say: fill it in `.jeyna/.env`, or export it in the shell before starting `claude`. Never print a value.
