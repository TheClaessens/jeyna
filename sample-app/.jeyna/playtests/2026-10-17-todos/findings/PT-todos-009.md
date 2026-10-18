---
schema: 1
id: PT-todos-009
kind: a11y
severity: major
status: duplicate
of: PT-todos-003
flow: todos
case: t3-390x844
scenario: Complete and delete a todo
route: /login
viewport: 390x844
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:03:16.522Z
evidence:
  - t3-390x844-1-login.png
---

# Sign in button not visible at phone width

## Steps

1. Open /login at 390x844

## Expected

Sign in button visible on screen

## Actual

Button exists in the DOM but is not visible in the viewport (off screen at 1440 it sits right of the link)

## Evidence

![t3-390x844-1-login.png](../evidence/t3-390x844-1-login.png)

## Suggested next step

None given.
