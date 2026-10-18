---
schema: 1
id: PT-todos-001
kind: a11y
severity: minor
status: open
flow: todos
case: t2-1440x900
scenario: Add a todo with a priority
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:04:42.836Z
evidence:
  - t2-1440x900-1-login.png
---

# Password field on sign-in has no label

## Steps

1. Open /login
2. Read the form

## Expected

Password input has a visible label and accessible name

## Actual

Only Email is labelled; the second textbox has no label or name

## Evidence

![t2-1440x900-1-login.png](../evidence/t2-1440x900-1-login.png)

## Suggested next step

None given.
