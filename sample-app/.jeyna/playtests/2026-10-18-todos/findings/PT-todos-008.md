---
schema: 1
id: PT-todos-008
kind: bug
severity: major
status: open
flow: todos
case: t2-390x844
scenario: Add a todo with a priority
route: /login
viewport: 390x844
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:40:55.228Z
evidence:
  - t2-390x844-1-login.png
---

# Sign in button not visible at phone width

## Steps

1. Open /login at 390x844
2. Look for the Sign in button

## Expected

Sign in button visible and reachable

## Actual

Button is in the accessibility tree but not visible; the screenshot shows only the fields and Forgot password link (at 1440 it sits right of the link, x~480-576, so it is likely pushed off screen)

## Evidence

![t2-390x844-1-login.png](../evidence/t2-390x844-1-login.png)

## Suggested next step

None given.
