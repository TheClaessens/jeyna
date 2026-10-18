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
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:40:32.474Z
evidence:
  - t1-390x844-1-phone.png
---

# Sign in button not visible at phone width

## Steps

1. Open /login at 390x844

## Expected

Sign in button visible without scrolling sideways

## Actual

Button is absent from the viewport (on desktop it sits at x~480-576, beyond the 390px width); only the Forgot password link shows

## Evidence

![t1-390x844-1-phone.png](../evidence/t1-390x844-1-phone.png)

## Suggested next step

None given.
