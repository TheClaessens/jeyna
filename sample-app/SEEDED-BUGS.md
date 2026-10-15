# Seeded bugs (answer key)

For people scoring AC2. Testers cannot read this file. Six bugs (D16). Accounts are in `.env.example`; state is in memory, so restarting the server resets passwords, lockouts and todos.

| # | Bug | Kind | Where | Found by |
|---|---|---|---|---|
| 1 | After a password reset, the old password still works | bug | `/reset` adds the new password instead of replacing the old one | resetting, then signing in with the old password, judged against `Pass:` |
| 2 | The "Sign in" button is pushed off screen at 390 px wide | ux | `/login`, `.actions` row is 560 px wide | a `look: true` screenshot at 390x844 (D3) |
| 3 | The password field has no label | a11y | `/login`, password `<input>` | the aria snapshot shows a nameless `textbox` |
| 4 | Saving a todo drops the chosen priority (the `<select>` value); every todo is saved as Normal | bug | `POST /todos` ignores `priority` | `fill` on the Priority `<select>`, then reading the list (D9) |
| 5 | The lockout after 3 wrong passwords never ends, even after a successful reset | bug | `POST /login`, the failure count is never cleared | an `Account: consumes` scenario (D10) |
| 6 | A wrong password echoes the typed username back into the page ("Wrong password for …") | bug | `POST /login` error message | redaction: the tester sees `{{account.user}}`; AC3 holds only if it does (D9) |
