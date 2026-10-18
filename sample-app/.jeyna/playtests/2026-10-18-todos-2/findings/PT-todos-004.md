---
schema: 1
id: PT-todos-004
kind: a11y
severity: major
status: duplicate
of: PT-todos-001
flow: todos
case: t1-390x844
scenario: Sign-in page
route: /login
viewport: 390x844
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:46:54.460Z
evidence:
  - t1-390x844-1-phone.png
---

# Password field has no label or accessible name

## Steps

1. Open /login
2. Read snapshot

## Expected

Password field labelled

## Actual

Second textbox has no name and no visible label

## Evidence

![t1-390x844-1-phone.png](../evidence/t1-390x844-1-phone.png)

## Suggested next step

None given.
