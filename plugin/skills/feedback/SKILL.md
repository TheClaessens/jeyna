---
description: Work on the developer's feedback from Jeyna studio. With no argument, lists what is to do (open items, and processed ones awaiting their check) and lets the developer pick one, several or a sweep; with a feedback id (FB-…), loads that item. Loads one item at a time, leaves the approach to the developer, sets processed after implementing and done only on the developer's OK.
disable-model-invocation: true
argument-hint: "[FB-… id]"
---

# /jeyna:feedback

Request: $ARGUMENTS

The developer snapped or recorded part of their app in Jeyna studio and wrote what should change (D36). You bring that feedback into this conversation, one item at a time, and then follow the developer's lead. Every Jeyna tool is `mcp__plugin_jeyna_mcp__<tool>`.

Rules for the whole session:
- Read feedback only through `get_feedback`, never with your own file tools. Never write under `.jeyna/feedback/`: the studio writes items, and the write guard denies you anyway.
- Hold one item in context at a time. Load the next only when the current one is `done` or `wontfix`, or the developer says "next" or "skip".
- Status goes through `update_status`. `processed`: you implemented it and the developer still has to check it. `done`: **only** when the developer has said, in this conversation, that it is OK. Never set `done` because your own checks pass. `wontfix`: only when the developer says so.

## 1. Which item

- If the request names one id (`FB-007`, or `7`), go to step 2 with it.
- If it names several (`FB-002, FB-004`, or `2, 4, 6`), those are your queue, in that order; go to step 2 with the first.
- Otherwise call `get_feedback` with no arguments and show `todo` as a short table: id, status (processed reads "processed, awaiting your check"), title, capture (snap, or recording with its frame count) and where it was captured. If `broken` is not empty, list those ids with their first error and say the developer fixes or deletes them in the studio. If `todo` is empty, say there is nothing to do, that feedback is captured in Jeyna studio (`/jeyna:studio`, on Live or on a finding's evidence), and stop.
  Then ask which to take: one id, several ("2, 4, 6"), or a sweep (every open item, oldest first). Wait for the answer. For a processed item, the developer may just want to confirm it: ask whether it is OK, and on yes set `done`.

## 2. Load

Call `get_feedback` with `id`. Show the developer, briefly:
- the id, status and their text, word for word;
- what the capture shows, in a sentence or two: for a recording, what changes from frame to frame (the frames are in order, each with its time);
- where it was captured. For feedback on evidence the result also holds the finding (steps, expected, actual) and the whole evidence image the crop came from: say which finding.

Then ask what the developer wants to do with it, and follow their lead: build it now, talk it through first, look at the code together, or anything else. Do not start changing code before they say so.

## 3. After implementing

When you have made the change the developer asked for:
1. Run the project's own checks (typecheck, tests, linter) if it has them, and fix what you broke.
2. `update_status` with `id`, `status: processed` and a one-line `note` of what changed.
3. Tell the developer what changed and how to see it: their app, or the Live page of the studio. For feedback on evidence, mention they can replay the finding with `/jeyna:playtest PT-…` (the finding's id).
4. Ask whether it is OK. On an explicit yes, `update_status` with `status: done`. Otherwise keep working on it; it stays `processed` meanwhile, and the developer can reopen it in the studio.

## 4. The next one

With a queue or a sweep, once the item is `done` or `wontfix` (or the developer says "next" or "skip"), load the next one: the next id of the queue, or for a sweep `get_feedback` with `next: true`, which returns the oldest open item. Go to step 2. When the queue is empty or `next` says there is no open feedback, say so and stop.
