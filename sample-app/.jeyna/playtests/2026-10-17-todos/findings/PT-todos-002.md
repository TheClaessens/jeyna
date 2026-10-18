---
schema: 1
id: PT-todos-002
kind: a11y
severity: major
status: duplicate
of: PT-todos-001
flow: todos
case: t1-1440x900
scenario: Sign-in page
route: /login
viewport: 1440x900
browser: chromium 155.0.8059.80
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:02:51.904Z
evidence:
  - t1-1440x900-1-desktop.png
---

# Password field has no label

## Steps

1. Open /login
2. Read snapshot

## Expected

Password field has a visible label and accessible name

## Actual

Snapshot shows an unnamed textbox under Email; no visible label for it in the screenshot

## Evidence

![t1-1440x900-1-desktop.png](../evidence/t1-1440x900-1-desktop.png)

## Suggested next step

None given.
