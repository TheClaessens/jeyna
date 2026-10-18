---
schema: 1
id: PT-todos-008
kind: bug
severity: critical
status: duplicate
of: PT-todos-003
flow: todos
case: t3-390x844
scenario: Complete and delete a todo
route: /login
viewport: 390x844
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:47:13.387Z
evidence:
  - t3-390x844-1-login.png
---

# Sign in button not visible at phone width

## Steps

1. Open /login at 390x844

## Expected

Sign in button visible and tappable

## Actual

Button is not shown below the fields; only Forgot password link visible (it was visible at 1440 wide)

## Evidence

![t3-390x844-1-login.png](../evidence/t3-390x844-1-login.png)

## Suggested next step

None given.
