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
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:03:05.276Z
evidence:
  - t3-1440x900-2-done.png
---

# Chosen High priority is saved as Normal

## Steps

1. Sign in
2. Type 'Buy milk & eggs'
3. Set Priority to High
4. Click Add

## Expected

Todo shows High priority

## Actual

Todo listed as 'Buy milk & eggs · Normal priority'

## Evidence

![t3-1440x900-2-done.png](../evidence/t3-1440x900-2-done.png)

## Suggested next step

None given.
