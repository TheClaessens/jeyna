---
description: Load the oldest open feedback item from Jeyna studio and work on it the way /jeyna:feedback does.
disable-model-invocation: true
---

# /jeyna:feedback-next

Call `mcp__plugin_jeyna_mcp__get_feedback` with `next: true`.

- If it says there is no open feedback, tell the developer, mention that `/jeyna:feedback` also lists processed items awaiting their check, and stop.
- Otherwise read `${CLAUDE_PLUGIN_ROOT}/skills/feedback/SKILL.md` and follow it for this one item from step 2 ("Load"), using the result you already have instead of calling `get_feedback` again. Its rules hold here too, above all: `done` only on the developer's explicit OK.
