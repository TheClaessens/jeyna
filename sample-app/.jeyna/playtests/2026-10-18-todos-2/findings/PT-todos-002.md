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
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:46:53.976Z
evidence:
  - t1-1440x900-1-desk.png
---

# Password field has no label or accessible name

## Steps

1. Open /login
2. Read snapshot

## Expected

Password field has a visible label and accessible name

## Actual

Second textbox has no name and no visible label (Email has one)

## Evidence

![t1-1440x900-1-desk.png](../evidence/t1-1440x900-1-desk.png)

## Suggested next step

None given.
