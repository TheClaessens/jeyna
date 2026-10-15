#!/bin/sh
# Cloud sessions have no Google Chrome, and the proxy blocks `npx playwright install`.
# The browser tests launch channel "chrome", so point Chrome's path at the image's preinstalled Chromium.
[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
[ -x /opt/google/chrome/chrome ] && exit 0
chromium=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)
[ -n "$chromium" ] || exit 0
mkdir -p /opt/google/chrome && ln -sf "$chromium" /opt/google/chrome/chrome
