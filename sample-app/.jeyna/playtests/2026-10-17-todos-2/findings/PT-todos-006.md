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
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:04:56.019Z
evidence:
  - t3-1440x900-2-prio.png
---

# Chosen priority High is saved as Normal

## Steps

1. Sign in
2. Type 'Buy milk', choose Priority High
3. Click Add

## Expected

Todo listed as 'High priority'

## Actual

Todo listed as 'Buy milk · Normal priority'

## Evidence

![t3-1440x900-2-prio.png](../evidence/t3-1440x900-2-prio.png)

## Suggested next step

None given.
