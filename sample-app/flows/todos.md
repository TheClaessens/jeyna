---
name: todos
entry: /login
---

A hand-written flow for the sample app. Copy it to `.jeyna/flows/todos.md` after `/jeyna:init`, then run `/jeyna:playtest todos`.

## Preconditions

The app runs on its configured url. Each account starts with an empty todo list: set `reset: curl -fsS -X POST http://localhost:4173/__reset` under `app` in `jeyna.config.yaml`, and every run starts from a fresh state (restarting `node sample-app/server.mjs` does the same by hand).

## Scenarios

### Sign-in page
Open the sign-in page without signing in and check that every control is labelled and on screen.
Pass: the email field, the password field and the Sign in button are all labelled and visible without scrolling sideways.
Account: none

### Add a todo with a priority
Sign in, then add a todo called "Buy milk" with priority High.
Pass: "Buy milk" appears in the list with High priority.

### Complete and delete a todo
Sign in, add a todo, mark it complete, then delete it.
Pass: the todo shows as done after completing it, and is gone from the list after deleting it.

## What matters most here

Todos keep exactly what was typed and chosen. Nothing about the sign-in form may be hidden at phone width.
