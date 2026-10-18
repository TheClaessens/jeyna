---
schema: 1
id: PT-todos-009
kind: bug
severity: major
status: duplicate
of: PT-todos-004
flow: todos
case: t2-390x844
scenario: Add a todo with a priority
route: /login
viewport: 390x844
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:05:07.649Z
evidence:
  - t2-390x844-1-login.png
---

# Sign in button not visible at phone width

## Steps

1. Open /login at 390x844
2. Look for the Sign in button

## Expected

Sign in button visible and tappable

## Actual

Button exists in the accessibility tree but is not visible in the viewport; only fields and Forgot password link show

## Evidence

![t2-390x844-1-login.png](../evidence/t2-390x844-1-login.png)

## Suggested next step

None given.
