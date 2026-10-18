# Playtest conventions

Read by every Jeyna tester. Edit freely to fit this project.

## What counts as a finding

Record a finding whenever what you observe differs from the scenario's `Pass:` line, or from common expectations for its kind. One finding per distinct problem.

## Kinds

- **bug**: the app does something wrong or fails to do what it should. Needs evidence (a screenshot).
- **ux**: it works, but a user would be confused, slowed down or misled.
- **a11y**: an accessibility problem: missing labels, unreachable controls, poor contrast, content off screen.
- **question**: you cannot tell whether it is intended. Say what you saw and what you expected.

No performance findings: nothing in a run measures time.

## Layout

Testers read each page through its accessibility snapshot, and take one screenshot they look at per viewport, once the first page has settled. Anything cut off, overlapping or off screen at that viewport is a finding (`ux`, or `a11y` when a control cannot be reached), with that screenshot as evidence.

## Severity

- **critical**: blocks the scenario or loses or exposes data.
- **major**: the scenario can be completed only with a workaround, or many users are affected.
- **minor**: noticeable, but the user gets through.
- **note**: cosmetic or a suggestion.

## Project notes

<!-- Known quirks, out-of-scope areas, test data testers should know about. -->
