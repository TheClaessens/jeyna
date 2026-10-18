# Playtest report: sample-app

- **Run:** 2026-10-17-todos-2
- **Flow:** todos
- **Build:** 876da2a-dirty
- **Started:** 2026-10-17T18:04:10.342Z
- **Finished:** 2026-10-17T18:05:51.890Z
- **Elapsed:** 102 s
- **Testers:** 3

## Summary

Replayed the three todos scenarios at 1440x900 and 390x844; all three known problems persist. A todo saved with priority High comes back as Normal, the Sign in button is not visible at phone width, and the password field has no label.

| Cases | Pass | Fail | Blocked | Skipped |
|---|---|---|---|---|
| 6 | 1 | 5 | 0 | 0 |

| Findings | Critical | Major | Minor | Note | Duplicates |
|---|---|---|---|---|---|
| 3 | 1 | 1 | 1 | 0 | 7 |

## Scenario matrix

| Scenario | 1440x900 | 390x844 |
|---|---|---|
| Sign-in page | fail [PT-todos-003](findings/PT-todos-003.md) | fail [PT-todos-004](findings/PT-todos-004.md) [PT-todos-005](findings/PT-todos-005.md) |
| Add a todo with a priority | fail [PT-todos-007](findings/PT-todos-007.md) | fail [PT-todos-010](findings/PT-todos-010.md) [PT-todos-009](findings/PT-todos-009.md) |
| Complete and delete a todo | pass (Todo showed done and was removed on delete. Priority and password-label findings recorded separately.) | fail [PT-todos-008](findings/PT-todos-008.md) (Done/delete worked once signed in, but the Sign in button is not visible at phone width, so a real user could not start the scenario. I only got in because the click reaches the hidden button in the DOM.) |

## Since last run

Compared with 2026-10-17-todos: 6 cases in both runs, 1 changed.

| Scenario | Viewport | Was | Now |
|---|---|---|---|
| Complete and delete a todo | 390x844 | pass | fail |

## Findings

| Severity | Kind | Finding | Title | Scenario | Viewport | Status |
|---|---|---|---|---|---|---|
| critical | bug | [PT-todos-004](findings/PT-todos-004.md) | Sign in button not visible at phone width | Sign-in page | 390x844 | open |
| critical | bug | [PT-todos-007](findings/PT-todos-007.md) | Todo added with High priority is saved as Normal | Add a todo with a priority | 1440x900 | duplicate of [PT-todos-006](findings/PT-todos-006.md) |
| critical | bug | [PT-todos-010](findings/PT-todos-010.md) | Todo added with High priority is saved as Normal | Add a todo with a priority | 390x844 | duplicate of [PT-todos-006](findings/PT-todos-006.md) |
| major | bug | [PT-todos-006](findings/PT-todos-006.md) | Chosen priority High is saved as Normal | Complete and delete a todo | 1440x900 | open |
| major | bug | [PT-todos-009](findings/PT-todos-009.md) | Sign in button not visible at phone width | Add a todo with a priority | 390x844 | duplicate of [PT-todos-004](findings/PT-todos-004.md) |
| major | a11y | [PT-todos-003](findings/PT-todos-003.md) | Password field has no label | Sign-in page | 1440x900 | duplicate of [PT-todos-001](findings/PT-todos-001.md) |
| major | a11y | [PT-todos-005](findings/PT-todos-005.md) | Password field has no label | Sign-in page | 390x844 | duplicate of [PT-todos-001](findings/PT-todos-001.md) |
| major | a11y | [PT-todos-008](findings/PT-todos-008.md) | Sign in button not visible at phone width | Complete and delete a todo | 390x844 | duplicate of [PT-todos-004](findings/PT-todos-004.md) |
| minor | a11y | [PT-todos-001](findings/PT-todos-001.md) | Password field on sign-in has no label | Add a todo with a priority | 1440x900 | open |
| minor | a11y | [PT-todos-002](findings/PT-todos-002.md) | Password field on sign-in has no label | Complete and delete a todo | 1440x900 | duplicate of [PT-todos-001](findings/PT-todos-001.md) |
