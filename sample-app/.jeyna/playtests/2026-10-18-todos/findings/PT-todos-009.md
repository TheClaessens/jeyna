---
schema: 1
id: PT-todos-009
kind: bug
severity: critical
status: open
flow: todos
case: t3-390x844
scenario: Complete and delete a todo
route: /login
viewport: 390x844
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:41:00.401Z
evidence:
  - t3-390x844-1-login.png
  - t3-390x844-2-login-full.png
---

# Sign in button not visible at 390px width

## Steps

1. Open /login at 390x844
2. Look for the Sign in button

## Expected

Sign in button is visible and tappable.

## Actual

The button is in the accessibility tree but nothing is drawn where it should be (it is visible at 1440px). Only the fields and Forgot password link show.

## Evidence

![t3-390x844-1-login.png](../evidence/t3-390x844-1-login.png)
![t3-390x844-2-login-full.png](../evidence/t3-390x844-2-login-full.png)

## Suggested next step

None given.
