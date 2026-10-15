# Seeded bugs (answer key)

For people scoring AC2. Testers cannot read this file. Six bugs by slice 3 (D16); the login page carries two so far.

| # | Bug | Kind | Where | Found by |
|---|---|---|---|---|
| 2 | The "Sign in" button is pushed off screen at 390 px wide | ux | `/login`, `.actions` row is 560 px wide | a `look: true` screenshot at 390x844 (D3) |
| 3 | The password field has no label | a11y | `/login`, password `<input>` | the aria snapshot shows a nameless `textbox` |

Not built yet: 1 (old password works after reset), 4 (priority dropped on save), 5 (lockout never ends), 6 (login error echoes the username).
