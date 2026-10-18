---
schema: 1
id: PT-todos-001
kind: a11y
severity: minor
status: open
flow: todos
case: t3-1440x900
scenario: Complete and delete a todo
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:46:51.748Z
evidence:
  - t3-1440x900-1-login.png
---

# Password field on sign-in has no label

## Steps

1. Open /login
2. Read the form

## Expected

Password input has a visible label and accessible name

## Actual

Only Email is labelled; the password textbox has no label or name

## Evidence

![t3-1440x900-1-login.png](../evidence/t3-1440x900-1-login.png)

## Suggested next step

None given.
