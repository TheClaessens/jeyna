---
schema: 1
id: PT-todos-004
kind: bug
severity: critical
status: open
flow: todos
case: t1-390x844
scenario: Sign-in page
route: /login
viewport: 390x844
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:04:45.550Z
evidence:
  - t1-390x844-1-login-phone.png
---

# Sign in button not visible at phone width

## Steps

1. Open /login at 390x844

## Expected

Sign in button visible without scrolling sideways

## Actual

Button is in the accessibility tree but not visible in the viewport (off screen to the right, it sits at x~480-576 on desktop layout), so users cannot see or tap it.

## Evidence

![t1-390x844-1-login-phone.png](../evidence/t1-390x844-1-login-phone.png)

## Suggested next step

None given.
