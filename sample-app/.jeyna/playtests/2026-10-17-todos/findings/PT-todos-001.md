---
schema: 1
id: PT-todos-001
kind: a11y
severity: minor
status: open
flow: todos
case: t3-1440x900
scenario: Complete and delete a todo
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:02:50.944Z
evidence:
  - t3-1440x900-1-login.png
---

# Password field has no label or visible text

## Steps

1. Open /login
2. Read the form

## Expected

Password input has a visible label and accessible name

## Actual

Only Email is labelled; the second textbox has no label, name or placeholder

## Evidence

![t3-1440x900-1-login.png](../evidence/t3-1440x900-1-login.png)

## Suggested next step

None given.
