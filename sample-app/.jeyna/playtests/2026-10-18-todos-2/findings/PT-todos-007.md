---
schema: 1
id: PT-todos-007
kind: bug
severity: major
status: duplicate
of: PT-todos-005
flow: todos
case: t3-1440x900
scenario: Complete and delete a todo
route: /todos
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:47:03.612Z
evidence:
  - t3-1440x900-2-priority.png
---

# Chosen priority High is saved as Normal

## Steps

1. Sign in
2. Type 'Buy milk & eggs'
3. Select Priority High
4. Click Add

## Expected

Todo shows 'High priority'

## Actual

Todo shows 'Normal priority'

## Evidence

![t3-1440x900-2-priority.png](../evidence/t3-1440x900-2-priority.png)

## Suggested next step

None given.
