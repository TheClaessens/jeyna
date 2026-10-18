---
schema: 1
id: PT-todos-006
kind: bug
severity: major
status: open
flow: todos
case: t3-1440x900
scenario: Complete and delete a todo
route: /todos
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:40:48.550Z
evidence:
  - t3-1440x900-2-priority.png
---

# Todo saved with Normal priority after choosing High

## Steps

1. Sign in
2. Type 'Buy milk' in New todo
3. Choose High in Priority
4. Click Add

## Expected

The todo shows 'High priority', as chosen.

## Actual

The list item reads 'Buy milk · Normal priority'.

## Evidence

![t3-1440x900-2-priority.png](../evidence/t3-1440x900-2-priority.png)

## Suggested next step

None given.
