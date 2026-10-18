---
schema: 1
id: PT-todos-003
kind: a11y
severity: major
status: open
flow: todos
case: t1-390x844
scenario: Sign-in page
route: /login
viewport: 390x844
browser: chromium 155.0.8059.80
build: 17d5c39-dirty
author: sonnet
created: 2026-10-18T07:40:32.220Z
evidence:
  - t1-390x844-1-phone.png
---

# Password field has no label

## Steps

1. Open /login at 390x844

## Expected

Password input has a visible label and accessible name

## Actual

Unnamed textbox, no visible label

## Evidence

![t1-390x844-1-phone.png](../evidence/t1-390x844-1-phone.png)

## Suggested next step

None given.
