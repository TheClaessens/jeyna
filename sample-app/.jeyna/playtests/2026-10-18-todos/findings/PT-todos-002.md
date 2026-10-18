---
schema: 1
id: PT-todos-002
kind: a11y
severity: major
status: open
flow: todos
case: t1-1440x900
scenario: Sign-in page
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:40:31.974Z
evidence:
  - t1-1440x900-1-desktop.png
---

# Password field has no label

## Steps

1. Open /login

## Expected

Password input has a visible label and accessible name

## Actual

Snapshot shows an unnamed textbox; no visible label above the second field

## Evidence

![t1-1440x900-1-desktop.png](../evidence/t1-1440x900-1-desktop.png)

## Suggested next step

None given.
