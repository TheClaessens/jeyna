---
schema: 1
id: PT-todos-005
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
build: 876da2a-dirty
author: sonnet
created: 2026-10-17T18:04:45.781Z
evidence:
  - t1-390x844-1-login-phone.png
---

# Password field has no label

## Steps

1. Open /login at 390x844

## Expected

Password field has a visible label and accessible name

## Actual

Unnamed textbox, no visible label.

## Evidence

![t1-390x844-1-login-phone.png](../evidence/t1-390x844-1-login-phone.png)

## Suggested next step

None given.
