---
schema: 1
id: PT-todos-003
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
created: 2026-10-17T18:04:45.252Z
evidence:
  - t1-1440x900-1-login-desktop.png
---

# Password field has no label

## Steps

1. Open /login

## Expected

Password field has a visible label and accessible name

## Actual

Snapshot shows an unnamed textbox; no visible label above it (Email has one).

## Evidence

![t1-1440x900-1-login-desktop.png](../evidence/t1-1440x900-1-login-desktop.png)

## Suggested next step

None given.
