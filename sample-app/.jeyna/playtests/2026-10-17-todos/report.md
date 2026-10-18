# Playtest report: sample-app

- **Run:** 2026-10-17-todos
- **Flow:** todos
- **Build:** 876da2a-dirty
- **Started:** 2026-10-17T18:02:20.119Z
- **Finished:** 2026-10-17T18:03:50.056Z
- **Elapsed:** 90 s
- **Testers:** 3

## Summary

Played the three todos scenarios at 1440x900 and 390x844. A todo saved with priority High comes back as Normal at both widths, and the Sign in button is not visible on the sign-in page at phone width. The password field on the sign-in page has no label at either width.

| Cases | Pass | Fail | Blocked | Skipped |
|---|---|---|---|---|
| 6 | 2 | 4 | 0 | 0 |

| Findings | Critical | Major | Minor | Note | Duplicates |
|---|---|---|---|---|---|
| 3 | 2 | 0 | 1 | 0 | 6 |

## Scenario matrix

| Scenario | 1440x900 | 390x844 |
|---|---|---|
| Sign-in page | fail [PT-todos-002](findings/PT-todos-002.md) | fail [PT-todos-003](findings/PT-todos-003.md) [PT-todos-004](findings/PT-todos-004.md) |
| Add a todo with a priority | fail [PT-todos-005](findings/PT-todos-005.md) (High saved as Normal.) | fail [PT-todos-008](findings/PT-todos-008.md) (Sign in button hidden (Enter worked); High saved as Normal again (same as PT-todos-005).) |
| Complete and delete a todo | pass (Completed showed done; delete removed it. Priority bug and unlabelled password recorded.) | pass (Todo showed done, then was gone after delete. Signed in via Enter because the Sign in button is not visible (PT-todos-009).) |

## Since last run

No earlier done run of this flow.

## Findings

| Severity | Kind | Finding | Title | Scenario | Viewport | Status |
|---|---|---|---|---|---|---|
| critical | bug | [PT-todos-003](findings/PT-todos-003.md) | Sign in button not visible at phone width | Sign-in page | 390x844 | open |
| critical | bug | [PT-todos-005](findings/PT-todos-005.md) | Todo added with priority High is saved as Normal | Add a todo with a priority | 1440x900 | open |
| critical | bug | [PT-todos-008](findings/PT-todos-008.md) | Sign in button not visible at phone width | Add a todo with a priority | 390x844 | duplicate of [PT-todos-003](findings/PT-todos-003.md) |
| major | bug | [PT-todos-007](findings/PT-todos-007.md) | Chosen High priority is saved as Normal | Complete and delete a todo | 1440x900 | duplicate of [PT-todos-005](findings/PT-todos-005.md) |
| major | a11y | [PT-todos-002](findings/PT-todos-002.md) | Password field has no label | Sign-in page | 1440x900 | duplicate of [PT-todos-001](findings/PT-todos-001.md) |
| major | a11y | [PT-todos-004](findings/PT-todos-004.md) | Password field has no label | Sign-in page | 390x844 | duplicate of [PT-todos-001](findings/PT-todos-001.md) |
| major | a11y | [PT-todos-009](findings/PT-todos-009.md) | Sign in button not visible at phone width | Complete and delete a todo | 390x844 | duplicate of [PT-todos-003](findings/PT-todos-003.md) |
| minor | a11y | [PT-todos-001](findings/PT-todos-001.md) | Password field has no label or visible text | Complete and delete a todo | 1440x900 | open |
| minor | a11y | [PT-todos-006](findings/PT-todos-006.md) | Password field on sign-in has no label or accessible name | Add a todo with a priority | 1440x900 | duplicate of [PT-todos-001](findings/PT-todos-001.md) |
