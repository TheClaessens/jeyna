---
schema: 1
id: PT-todos-009
kind: bug
severity: major
status: duplicate
of: PT-todos-003
flow: todos
case: t2-390x844
scenario: Add a todo with a priority
route: /login
viewport: 390x844
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:47:18.949Z
evidence:
  - t2-390x844-1-login.png
---

# Sign in button is not visible at phone width

## Steps

1. Open /login at 390x844

## Expected

Sign in button visible and reachable

## Actual

Button exists in the accessibility tree but is not visible in the viewport (clipped or off screen). At 1440 it sits to the right of the form, beside the Forgot password link.

## Evidence

![t2-390x844-1-login.png](../evidence/t2-390x844-1-login.png)

## Suggested next step

None given.
