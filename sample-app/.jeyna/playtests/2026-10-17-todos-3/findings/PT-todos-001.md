---
schema: 1
id: PT-todos-001
kind: bug
severity: major
status: open
flow: todos
case: t1-1440x900
scenario: Add a todo with a priority
route: /todos
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:07:20.952Z
evidence:
  - t1-1440x900-2-added.png
---

# Todo added with High priority is saved as Normal priority

## Steps

1. Sign in
2. Type Buy milk in New todo
3. Choose High in Priority
4. Click Add

## Expected

Buy milk · High priority

## Actual

List shows 'Buy milk · Normal priority'; chosen priority ignored.

## Evidence

![t1-1440x900-2-added.png](../evidence/t1-1440x900-2-added.png)

## Suggested next step

None given.
