---
schema: 1
id: PT-todos-005
kind: bug
severity: critical
status: open
flow: todos
case: t2-1440x900
scenario: Add a todo with a priority
route: /todos
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:03:03.134Z
evidence:
  - t2-1440x900-2-list.png
---

# Todo added with priority High is saved as Normal

## Steps

1. Sign in
2. Type Buy milk in New todo
3. Choose High in Priority
4. Click Add

## Expected

Buy milk listed with High priority

## Actual

List shows 'Buy milk · Normal priority'

## Evidence

![t2-1440x900-2-list.png](../evidence/t2-1440x900-2-list.png)

## Suggested next step

None given.
