# Playtest report: sample-app

- **Run:** 2026-10-18-todos-2
- **Flow:** todos
- **Build:** 17d5c39-dirty
- **Started:** 2026-10-18T07:46:20.621Z
- **Finished:** 2026-10-18T07:47:55.606Z
- **Elapsed:** 95 s
- **Testers:** 3

## Summary

Played the todos flow: 3 scenarios at 1440x900 and 390x844. At phone width the Sign in button is not visible on /login (PT-todos-003). A todo's chosen priority is always saved as Normal (PT-todos-005). The password field has no label (PT-todos-001).

| Cases | Pass | Fail | Blocked | Skipped |
|---|---|---|---|---|
| 6 | 1 | 5 | 0 | 0 |

| Findings | Critical | Major | Minor | Note | Duplicates |
|---|---|---|---|---|---|
| 3 | 1 | 1 | 1 | 0 | 7 |

## Scenario matrix

| Scenario | 1440x900 | 390x844 |
|---|---|---|
| Sign-in page | fail [PT-todos-002](findings/PT-todos-002.md) | fail [PT-todos-003](findings/PT-todos-003.md) [PT-todos-004](findings/PT-todos-004.md) |
| Add a todo with a priority | fail [PT-todos-005](findings/PT-todos-005.md) (Priority saved as Normal) | fail [PT-todos-010](findings/PT-todos-010.md) [PT-todos-009](findings/PT-todos-009.md) (Priority saved as Normal; Sign in button hidden at phone width (worked around with Enter).) |
| Complete and delete a todo | pass (Todo showed done, then was gone after delete. Findings recorded on other aspects.) | fail [PT-todos-008](findings/PT-todos-008.md) (Sign in button hidden at phone width (Enter key worked as workaround); done/delete otherwise worked. Priority bug PT-todos-007 reproduced (Low saved as Normal).) |

## Since last run

Compared with 2026-10-17-todos-3: 1 cases in both runs, 0 changed.

## Findings

| Severity | Kind | Finding | Title | Scenario | Viewport | Status |
|---|---|---|---|---|---|---|
| critical | bug | [PT-todos-003](findings/PT-todos-003.md) | Sign in button not visible at phone width | Sign-in page | 390x844 | open |
| critical | bug | [PT-todos-008](findings/PT-todos-008.md) | Sign in button not visible at phone width | Complete and delete a todo | 390x844 | duplicate of [PT-todos-003](findings/PT-todos-003.md) |
| major | bug | [PT-todos-005](findings/PT-todos-005.md) | Todo added with High priority is saved as Normal priority | Add a todo with a priority | 1440x900 | open |
| major | bug | [PT-todos-007](findings/PT-todos-007.md) | Chosen priority High is saved as Normal | Complete and delete a todo | 1440x900 | duplicate of [PT-todos-005](findings/PT-todos-005.md) |
| major | bug | [PT-todos-009](findings/PT-todos-009.md) | Sign in button is not visible at phone width | Add a todo with a priority | 390x844 | duplicate of [PT-todos-003](findings/PT-todos-003.md) |
| major | bug | [PT-todos-010](findings/PT-todos-010.md) | Todo added with High priority is saved as Normal priority | Add a todo with a priority | 390x844 | duplicate of [PT-todos-005](findings/PT-todos-005.md) |
| major | a11y | [PT-todos-002](findings/PT-todos-002.md) | Password field has no label or accessible name | Sign-in page | 1440x900 | duplicate of [PT-todos-001](findings/PT-todos-001.md) |
| major | a11y | [PT-todos-004](findings/PT-todos-004.md) | Password field has no label or accessible name | Sign-in page | 390x844 | duplicate of [PT-todos-001](findings/PT-todos-001.md) |
| minor | a11y | [PT-todos-001](findings/PT-todos-001.md) | Password field on sign-in has no label | Complete and delete a todo | 1440x900 | open |
| minor | a11y | [PT-todos-006](findings/PT-todos-006.md) | Password field on sign-in has no label or accessible name | Add a todo with a priority | 1440x900 | duplicate of [PT-todos-001](findings/PT-todos-001.md) |
