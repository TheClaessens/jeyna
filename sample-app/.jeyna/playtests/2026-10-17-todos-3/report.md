# Playtest report: sample-app

- **Run:** 2026-10-17-todos-3
- **Flow:** todos
- **Build:** 876da2a-dirty
- **Started:** 2026-10-17T18:06:53.341Z
- **Finished:** 2026-10-17T18:07:34.195Z
- **Elapsed:** 41 s
- **Testers:** 1

## Summary

Retest of PT-todos-001 (password field on sign-in has no label) by replaying Add a todo with a priority at 1440x900. The password field still has no label (PT-todos-002), and a todo saved with priority High still comes back as Normal (PT-todos-001), which fails the case.

| Cases | Pass | Fail | Blocked | Skipped |
|---|---|---|---|---|
| 1 | 0 | 1 | 0 | 0 |

| Findings | Critical | Major | Minor | Note | Duplicates |
|---|---|---|---|---|---|
| 2 | 0 | 2 | 0 | 0 | 0 |

## Scenario matrix

| Scenario | 1440x900 |
|---|---|
| Add a todo with a priority | fail [PT-todos-001](findings/PT-todos-001.md) (Buy milk listed as Normal priority, not High.) |

## Since last run

Compared with 2026-10-17-todos-2: 1 cases in both runs, 0 changed.

## Findings

| Severity | Kind | Finding | Title | Scenario | Viewport | Status |
|---|---|---|---|---|---|---|
| major | bug | [PT-todos-001](findings/PT-todos-001.md) | Todo added with High priority is saved as Normal priority | Add a todo with a priority | 1440x900 | open |
| major | a11y | [PT-todos-002](findings/PT-todos-002.md) | Password field on sign-in still has no label (retest of PT-todos-001) | Add a todo with a priority | 1440x900 | open |
