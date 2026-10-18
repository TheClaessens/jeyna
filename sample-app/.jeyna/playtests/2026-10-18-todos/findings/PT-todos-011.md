---
schema: 1
id: PT-todos-011
kind: bug
severity: major
status: open
flow: todos
case: t3-390x844
scenario: Complete and delete a todo
route: /todos
viewport: 390x844
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:41:10.490Z
evidence:
  - t3-390x844-3-done.png
---

# Todo saved with Normal priority after choosing Low

## Steps

1. Sign in
2. Type 'Buy milk'
3. Choose Low in Priority
4. Click Add

## Expected

The todo shows 'Low priority'.

## Actual

The item reads 'Buy milk · Normal priority'. Same as at 1440px with High.

## Evidence

![t3-390x844-3-done.png](../evidence/t3-390x844-3-done.png)

## Suggested next step

None given.
