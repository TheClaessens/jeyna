---
schema: 1
id: PT-todos-002
kind: a11y
severity: minor
status: duplicate
of: PT-todos-001
flow: todos
case: t3-1440x900
scenario: Complete and delete a todo
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:04:42.982Z
evidence:
  - t3-1440x900-1-login.png
---

# Password field on sign-in has no label

## Steps

1. Open /login
2. Read the form

## Expected

Password input has a visible label and accessible name

## Actual

Only Email is labelled; the password textbox is unnamed in the accessibility tree and has no visible label or placeholder.

## Evidence

![t3-1440x900-1-login.png](../evidence/t3-1440x900-1-login.png)

## Suggested next step

None given.
