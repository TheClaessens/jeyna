---
schema: 1
id: PT-retest-todos-001
kind: a11y
severity: major
status: open
flow: exploratory:retest-todos
case: t1-1440x900
scenario: "Retest PT-todos-001: Password field on sign-in has no label"
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 0ebd907-dirty
author: sonnet
created: 2026-10-17T18:18:29.592Z
evidence:
  - t1-1440x900-1-login.png
---

# Password field on sign-in still has no label or accessible name

## Steps

1. Open /login
2. Read the form

## Expected

Password input has a visible label and accessible name

## Actual

Only Email has a visible label (textbox "Email"). The second textbox is still unlabelled in the snapshot (just 'textbox') and has no visible label.

## Evidence

![t1-1440x900-1-login.png](../evidence/t1-1440x900-1-login.png)

## Suggested next step

None given.
