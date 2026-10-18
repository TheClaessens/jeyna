---
schema: 1
id: PT-todos-003
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
created: 2026-10-17T18:02:52.286Z
evidence:
  - t1-390x844-1-phone.png
---

# Sign in button not visible at phone width

## Steps

1. Open /login at 390x844
2. Look for the Sign in button

## Expected

Sign in button visible on screen without sideways scrolling

## Actual

Button is in the DOM (snapshot) but not shown in the viewport; at 1440 it sits far right of the form (x~480-576), so at 390 it is pushed off screen/clipped

## Evidence

![t1-390x844-1-phone.png](../evidence/t1-390x844-1-phone.png)

## Suggested next step

None given.
