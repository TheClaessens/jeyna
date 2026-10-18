---
schema: 1
id: PT-todos-002
kind: a11y
severity: major
status: open
flow: todos
case: t1-1440x900
scenario: Add a todo with a priority
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:07:21.268Z
evidence:
  - t1-1440x900-1-login.png
---

# Password field on sign-in still has no label (retest of PT-todos-001)

## Steps

1. Open /login
2. Read the snapshot

## Expected

Password textbox has a visible label and accessible name

## Actual

Only Email is labelled; second textbox has no label or name. Still not fixed.

## Evidence

![t1-1440x900-1-login.png](../evidence/t1-1440x900-1-login.png)

## Suggested next step

None given.
