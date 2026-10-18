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
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:46:54.219Z
evidence:
  - t1-390x844-1-phone.png
---

# Sign in button not visible at phone width

## Steps

1. Open /login at 390x844

## Expected

Sign in button visible on screen

## Actual

Button is in the snapshot but not on screen in the viewport (visible at 1440 wide, absent at 390); likely pushed off or hidden

## Evidence

![t1-390x844-1-phone.png](../evidence/t1-390x844-1-phone.png)

## Suggested next step

None given.
