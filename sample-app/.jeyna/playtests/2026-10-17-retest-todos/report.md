# Playtest report: sample-app

- **Run:** 2026-10-17-retest-todos
- **Flow:** exploratory:retest-todos
- **Build:** 0ebd907-dirty
- **Started:** 2026-10-17T18:18:13.628Z
- **Finished:** 2026-10-17T18:18:40.657Z
- **Elapsed:** 27 s
- **Testers:** 1

## Summary

Retest of PT-todos-001 from run 2026-10-17-todos-2 at 1440x900. The password field on /login still has no visible label or accessible name, so the finding persists (PT-retest-todos-001).

| Cases | Pass | Fail | Blocked | Skipped |
|---|---|---|---|---|
| 1 | 0 | 1 | 0 | 0 |

| Findings | Critical | Major | Minor | Note | Duplicates |
|---|---|---|---|---|---|
| 1 | 0 | 1 | 0 | 0 | 0 |

## Scenario matrix

| Scenario | 1440x900 |
|---|---|
| Retest PT-todos-001: Password field on sign-in has no label | fail [PT-retest-todos-001](findings/PT-retest-todos-001.md) |

## Since last run

No earlier done run of this flow.

## Findings

| Severity | Kind | Finding | Title | Scenario | Viewport | Status |
|---|---|---|---|---|---|---|
| major | a11y | [PT-retest-todos-001](findings/PT-retest-todos-001.md) | Password field on sign-in still has no label or accessible name | Retest PT-todos-001: Password field on sign-in has no label | 1440x900 | open |
