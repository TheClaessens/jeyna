---
schema: 1
id: PT-todos-010
kind: bug
severity: major
status: duplicate
of: PT-todos-005
flow: todos
case: t2-390x844
scenario: Add a todo with a priority
route: /todos
viewport: 390x844
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:47:30.250Z
evidence:
  - t2-390x844-2-added.png
---

# Todo added with High priority is saved as Normal priority

## Steps

1. Sign in
2. Type Buy milk
3. Select High in Priority
4. Click Add

## Expected

Buy milk listed with High priority

## Actual

List shows 'Buy milk · Normal priority'

## Evidence

![t2-390x844-2-added.png](../evidence/t2-390x844-2-added.png)

## Suggested next step

None given.
