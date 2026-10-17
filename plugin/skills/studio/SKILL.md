---
description: Open Jeyna studio, the read-only viewer of this project's playtest runs. Starts the studio sidecar on localhost (it watches .jeyna/playtests/ and pushes every change to the page) and gives the developer the URL.
disable-model-invocation: true
argument-hint: "[port]"
---

# /jeyna:studio

Start the studio for `${CLAUDE_PROJECT_DIR}` and hand the developer its URL. The studio ships inside the plugin as a committed bundle (D34): no install, no npm.

1. If `${CLAUDE_PROJECT_DIR}/.jeyna/` does not exist, tell the developer to run `/jeyna:init` first, and stop.
2. Start the sidecar in the background with Bash (port from `$ARGUMENTS`, default 4710):

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/studio/jeyna-studio.mjs" --project "${CLAUDE_PROJECT_DIR}" --port 4710
   ```

   Its first stdout line is `Jeyna studio: http://localhost:<port>/`. If the port is taken, start it again with another port.
3. Tell the developer the URL, that the page follows `.jeyna/playtests/` live (a running `/jeyna:playtest` shows up as it writes), and that the studio edits nothing. Leave it running; the developer stops it with the Bash task when done.

Never read, summarise or edit run files for the studio: it reads the folder itself.
