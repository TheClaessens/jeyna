---
schema: 1
id: PT-todos-006
kind: a11y
severity: minor
status: duplicate
of: PT-todos-001
flow: todos
case: t2-1440x900
scenario: Add a todo with a priority
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:03:03.486Z
evidence:
  - t2-1440x900-1-login.png
---

# Password field on sign-in has no label or accessible name

## Steps

1. Open /login
2. Read the snapshot

## Expected

Password input labelled

## Actual

Only Email has a label; the second textbox is unnamed (screenshot shows no Password label)

## Evidence

![t2-1440x900-1-login.png](../evidence/t2-1440x900-1-login.png)

## Suggested next step

None given.
