# Feedback capture: critique and redesign

Status: proposal, 2026-10-28. Scope: how the developer captures a snap or a recording in Jeyna studio (D36), on Live and on evidence. No code was changed for this document.

Every factual claim carries one of these tags:

- **[code]** read in the repo at `c6116b7` (`src/studio/app/*.tsx`, `src/feedback.ts`, `src/studio/server.ts`, `src/browser.ts`, `build.mjs`).
- **[browser]** seen in the desktop browser pane (Chromium 152, DPR 2) against the running studio on :4710 and the sample app on :4173.
- **[probe]** run in a throwaway script in the session scratchpad: playwright-core from this repo, channel `chrome`, against the sample app.
- **[files]** read from the saved items in `sample-app/.jeyna/feedback/` and the developer's screenshot.
- **[docs]** from platform or vendor documentation as I know it; not re-checked today.
- **[belief]** my judgement or expectation; not verified.

---

## 0. The short answers

**"Do we have to use Chrome's share feature? What about canvas?"** No, and canvas cannot help on its own. A canvas can only read pixels the page is allowed to read: it cannot draw an iframe at all, and a cross-origin app's pixels never reach the studio's JavaScript except through the Screen Capture API. The way out is not a cleverer canvas. It is to stop framing the app: the sidecar opens the app in **its own headed Chrome window** through playwright-core (which Jeyna already needs for playtests). It captures over CDP: real compositor pixels at the screen's device pixel ratio, no permission prompt, no "Sharing this tab" bar and no iframe. This is not the remote desktop D36 rejected. Nothing is streamed or forwarded: the developer uses a real Chrome window directly.

**"The modal makes the object small. Keep the full browser experience."** Yes. Select in place, at 1:1, on a frozen frame, like a screenshot tool. Press ⌥⇧S in the app window: the page freezes under a shade, you drag a region (or click an element), and a small panel opens beside the selection for the text. Recording uses the same overlay: pick the region first, record while using the app with a ring and a timer outside the region, then review and annotate in place. Evidence images use the same overlay in a full-window lightbox at 100%.

---

## 1. Critique of the current flow

### 1.1 Live, snap: step by step

| # | What the developer does or sees | Friction |
|---|---|---|
| 1 | Opens studio → **Live**. The app shows in an iframe below the studio top bar (79 px), the live bar (53 px) and a hint line (31 px) [browser]. | The app gets the window's width but **163 CSS px less height** than the window [browser]. Breakpoints and "above the fold" are not what the developer believes they are. There is no URL bar: the app's current route is invisible, and the iframe's location cannot be read cross-origin [browser: `contentDocument` is `null`]. |
| 2 | Uses the app until something is wrong, then reaches for **Snap**, top right. | Moving the pointer to Snap ends any hover state, closes tooltips and closes menus that close on blur. Transient UI (a toast, a hover card, an open dropdown) is gone before it is captured. There is no keyboard shortcut [code]. |
| 3 | First Snap of the page: Chrome's share prompt. Click "Share"/"Allow". | One more decision, and it repeats: the stream is stopped when Live unmounts [code: the cleanup in `live.tsx` stops the tracks]. Visiting Feedback to check an item and coming back means another prompt. By the time the prompt is answered, step 2's transient UI is certainly gone. |
| 4 | Chrome adds the "Sharing this tab to http://localhost:4710 · Stop sharing" bar and a blue border around the tab [files: the screenshot]. | The bar takes height from the viewport, so the whole studio and the app **reflow at the moment of capture** [belief, consistent with the screenshot]. It stays for the session as a constant reminder that the page is being recorded. |
| 5 | The first frame is grabbed immediately after `video.play()` [code]. | The frame may be taken before or after the bar's reflow. `appRect` maps the iframe box with `videoWidth / innerWidth` [code], which is only right when the video has exactly the viewport's aspect ratio. **Observed:** `FB-006-14.png` (3600×1616) shows the studio's own hint line and a white band at the bottom [files]. The preset crop is wrong by about 50 CSS px, so studio chrome leaks into the item. |
| 6 | The `<dialog>` opens with the whole tab drawn into a canvas capped at `min(1100px, 100vw−32px)` × `55vh` [code]. In the developer's screenshot, 3600 px of capture are drawn about 930 CSS px wide. | **Scale ≈ 0.26**: one CSS pixel of drag error is about 2 CSS pixels of the app, and the app's text is about 3 px tall in the preview [files]. The developer is asked to point at the problem in a thumbnail of the thing they were just looking at full size. The studio's own chrome (top bar, live bar, hint) is in the picture too. |
| 7 | The crop is preset to the iframe area. To refine it, drag a new rectangle. | **No handles**: a rectangle cannot be moved or resized, only redrawn from scratch [code]. No nudging, no keyboard, no size readout while dragging (the header shows it) [code]. The canvas has no label and is not focusable [browser]. |
| 8 | After dragging, focus is on the `<dialog>`, not the textarea [browser]. | The developer must click back into the textarea. Worse, on a finding page the page's own j / k / Esc handlers then fire **behind the modal**: pressing `k` after a crop navigated from PT-todos-001 to PT-todos-005 with the dialog still open [browser]. `Esc` closed the dialog *and* navigated back to the run [browser]. Since `origin` is read from the current render [code], a save after that `k` would name the wrong finding [belief]. |
| 9 | Type the text; `Esc` or Cancel. | `Esc` throws the typed text away without asking [browser]. |
| 10 | Save. Then a "Saved FB-nnn" state with Copy prompt / Open / Done. | One more click (Done) before the developer is back in the app. |

### 1.2 Live, recording

| # | What happens | Friction |
|---|---|---|
| 1 | Record → the share prompt (if no stream) → recording starts at once [code]. | No moment to get into position: the first seconds are always the developer moving to where the problem is. No trim afterwards. |
| 2 | While recording, the only signal is the Stop button: "Stop · n / 40 frames" at the top right [code]. | No elapsed time and no warning before the 40-frame cap. The region being recorded is not shown: the whole tab is recorded and cropped later. |
| 3 | Every 500 ms, `grab` creates a **new full-tab canvas** [code]. | At 3600×1600 that is about 23 MB of backing store per frame, **about 920 MB for 40 frames** [code + arithmetic]. Expect memory pressure and jank in the very app being recorded [belief]. |
| 4 | "Capture another tab" mode: the studio tab is in the background while the developer uses the app tab. | Chrome throttles background-tab timers to about once a second, so "every 500 ms" can silently become every 1000 ms [docs/belief]. No `CaptureController` is used, so Chrome's focus behaviour is left to its default [code]. The editor then opens in a tab the developer is not looking at. |
| 5 | Stop → the same modal, now with every frame cropped to one rectangle. | The crop is picked on frame 1 only; the developer cannot see whether frame 23 still has the thing inside the rectangle. There is no playback until after saving (the Flipbook lives on the item page) [code]. |
| 6 | Save → 40 × `toDataURL` PNG encodes on the main thread, then one JSON body of base64 (cap 200 MB) [code]. | The UI freezes for the encode [belief: seconds at retina size]. |
| 7 | Saved frames are whole-tab size (3600×1616 for FB-004/5/6) unless cropped [files]. | See §1.5: Claude sees them downscaled. |

### 1.3 Evidence, "Give feedback"

No prompt, which is good: the evidence PNG is same-origin and the crop is exact at full resolution [code]. The same modal problems apply. A 1440×900 evidence image is drawn about 675 CSS px wide (scale 0.47) in a 1024 px window [browser]. My test drag cut through the "Email" label [browser]. Focus, Esc, j/k and the lost text behave as in §1.1 steps 8 and 9 [browser].

### 1.4 Limits of Live as an iframe

- **Apps that refuse to be framed.** `X-Frame-Options` or `frame-ancestors`. Rails sends `X-Frame-Options: SAMEORIGIN` by default and Django's default middleware sends `DENY` [docs]. `localhost:4710` and `localhost:3000` are different origins, so **a stock Rails or Django app is blank in Live**. The workaround (tick "capture another tab", open the app yourself, pick the tab in the prompt) removes everything Live adds.
- **Sign-in flows.** Google, GitHub and Microsoft sign-in pages refuse framing [docs]; an OAuth round trip breaks inside Live.
- **Cookies and storage.** On localhost the studio and the app are same-site, so `SameSite=Lax` works (the sample app's `sid` cookie does) [code + browser]. An app on any other host, such as a staging URL, is third-party inside the frame: blocked cookies in Safari and Firefox, partitioned storage in Chrome [docs].
- **Frame-aware code.** `window.top !== window` checks, frame-busting, `target=_top` links and `window.open` popups all behave differently from the real app [belief].
- **DevTools.** They work, but the console and network panels mix the studio (its SSE stream, its React) with the app; the developer has to pick the frame context [belief].
- **Size.** The app never gets the real window (see §1.1 step 1) [browser].

### 1.5 What Claude finally receives

`get_feedback` sends each frame as a base64 PNG, unchanged [code]. The API scales an image down when its long edge is over about 1568 px [docs]. A whole-tab 3600×1616 frame becomes about 1568×704: **0.87 image px per CSS px of the app**. Small text sits at the edge of legible, and each frame costs about 1.5k tokens. A 40-frame whole-tab recording is about 60k tokens [docs + arithmetic]. A tight 600×240 crop costs about 200 tokens per frame at full detail. **For Claude, the crop is more than a pointer: it is what keeps the pixels legible and the item affordable.** So the selection has to be easy enough that the developer always makes one.

---

## 2. Capture mechanisms

### 2.1 What canvas can and cannot do

- `drawImage` takes images, videos, canvases, `ImageBitmap`s, `VideoFrame`s and SVG images. **There is no way to draw an `<iframe>` or any DOM element into a canvas** [docs]. A same-origin iframe could be re-rendered through DOM-to-image (2.2 C); a cross-origin one cannot even be read (`contentDocument === null` [browser]).
- **Tainting** is about images: a cross-origin image without CORS can be drawn, but then `getImageData` and `toDataURL` throw [docs]. It does not apply to iframes, because they cannot be drawn in the first place.
- The only browser APIs that yield another origin's rendered pixels to page JavaScript are **getDisplayMedia** (with a user prompt) and its refinements. `getViewportMedia` (no picker, needs cross-origin isolation) is a proposal, not shipped [docs].
- So "canvas instead of share" is only possible if the app's pixels **stop being cross-origin** (proxy) or are **produced by something other than the page** (CDP, an extension, the OS).

### 2.2 The options, for this setup

The setup: studio on `http://localhost:4710`, the app on another localhost port, the developer's own Chrome. Playwright-core is already a dependency and Jeyna already requires Chrome or Playwright's Chromium for playtests (D13, `src/browser.ts`) [code].

#### A. getDisplayMedia, as today, improved with Region Capture and Element Capture

- `CropTarget.fromElement(iframe)` + `track.cropTo()` crops a self-capture track to the iframe's box in the browser, at native pixels. That removes `appRect` and its letterbox error. `RestrictionTarget.fromElement()` + `track.restrictTo()` (Element Capture) captures only that element's subtree, **even when studio UI is drawn on top of it**, so a selection overlay or a recording timer over the iframe would never land in the frames. Both exist in the pane's Chromium 152 and `fromElement(iframe)` resolves [browser]. Chrome-only: Region Capture since about 104, Element Capture since about 132 [docs].
- **Prompts:** still one per stream, and the stream dies when Live unmounts [code]. The "Sharing this tab" bar and its reflow stay. Safari and Firefox: the full picker, no `preferCurrentTab`, no crop or restrict [docs].
- **Fidelity:** real composited pixels; resolution follows the tab's device pixels (3600 wide at DPR 2 [files]). The cursor is not in tab capture [belief].
- **Framing limits (§1.4):** all remain.
- **Cost:** small (about 40 lines in `live.tsx`).
- **Verdict:** the best version of the current architecture. It fixes the accuracy bug and enables in-place UI, but it keeps the prompt, the bar and the iframe, which are the developer's first complaint.

#### B. Proxy the app through the sidecar, then DOM-to-image (re-examined)

To make the app same-origin, the sidecar reverse-proxies `:4173` under `:4710/app/`. Then html2canvas or html-to-image renders the DOM into a canvas.

- **The proxy breaks things before any capture happens** [belief, from how these break in practice]:
  - absolute URLs and `<base>`;
  - cookies scoped to a path or domain;
  - OAuth redirect URIs registered for `:4173`;
  - HMR WebSockets (Vite, webpack), which need proxying too;
  - service worker scope;
  - `Location` headers;
  - CSP `connect-src` naming the real origin.

  A proxy that works on "most apps" is a product of its own.
- **html2canvas** reimplements CSS painting in JavaScript. It does not support, or only partly supports, `filter`, `backdrop-filter`, `mix-blend-mode`, many `clip-path`s, `object-fit` edge cases, some writing modes, and newer colour and gradient functions [docs/belief]. It is a different renderer.
- **html-to-image** clones the DOM into an SVG `<foreignObject>` and lets the browser paint it. CSS fidelity is much better, but [docs/belief]:
  - web fonts must be fetched and inlined (cross-origin font CSS without CORS fails);
  - images need CORS;
  - **`<canvas>` content is copied only if readable**, and WebGL canvases come back blank unless created with `preserveDrawingBuffer`;
  - `<video>` shows a poster or blank;
  - **nested cross-origin iframes** (Stripe Elements, maps, YouTube, reCAPTCHA) are blank;
  - closed shadow roots are skipped;
  - scroll offsets of inner scroll containers are lost unless patched;
  - the caret, text selection, `:hover`, `:focus-visible` and in-flight transitions are not reproduced;
  - Safari has known `foreignObject` bugs.
- **Speed:** cloning, inlining and serialising a real app's DOM takes hundreds of ms to seconds on the main thread [belief]. A 500 ms recording would stall the app it records.
- **Verdict:** D36 was right: these are not the pixels the developer saw, and the gaps fall exactly where UI bugs live (fonts, overlays, canvas, embedded widgets, focus states). Rejected again, for stronger reasons than "not real pixels".

#### C. A headed Chrome window launched by the sidecar, captured over CDP (recommended)

The sidecar calls `chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: false, viewport: null })` and opens `app.url`. The developer uses that window like any Chrome window. Capture is `page.screenshot({ clip })` (CDP `Page.captureScreenshot`). The capture UI is injected into the app page with `context.addInitScript` and talks to the sidecar through `context.exposeBinding`.

- **Prompts: none.** No share prompt, no sharing bar, no border, no reflow.
- **Fidelity: real compositor pixels.** A `clip` in CSS px returns device px: 300×120 came back as 600×240 at DPR 2, and a full viewport 2560×1600 [probe]. Canvas, WebGL, video and cross-origin sub-iframes are all composited in [belief, strong: it is the compositor's output]. With `viewport: null` the window has the screen's real DPR and is freely resizable [docs].
- **Speed:** about 50 ms for a full retina viewport and 36 ms for a clip [probe, headless]. Comfortably inside 500 ms, and the frames are encoded off the app's main thread.
- **Injection works:** an init script attached a closed shadow root with a top-layer popover on the sample app, and the binding reported the calling frame's URL and that it was the main frame [probe].
- **No framing limits:** the app is the top-level page, so `X-Frame-Options`, OAuth, cookies and `window.top` behave as for real, and the URL bar shows the route.
- **DevTools:** the normal F12, for the app alone [belief: works in a Playwright-launched headed Chrome].
- **What the window lacks:**
  - **The developer's own profile:** no saved logins and no extensions. Playwright passes `--disable-extensions`, and Chrome 136+ refuses remote debugging on the default profile [docs], so attaching to the developer's everyday Chrome is off the table by design. Mitigation: a persistent per-project profile (`.jeyna/chrome-profile/`, gitignored). Log in to the app once and it stays logged in across sessions.
  - **The "Chrome is being controlled by automated test software" infobar**, unless the launch adds `ignoreDefaultArgs: ["--enable-automation"]` [docs/belief].
- **Cross-browser:** Chrome or Chromium only. That is no new requirement: playtests already require it (D13). Safari and Firefox users still get a Chrome window for Live; they do not need to *use* Chrome day to day.
- **Security:** a page in that window can call the binding. Feedback text becomes instructions to Claude, so a page that could write items could steer Claude. The binding must accept calls only from the **main frame whose origin is `app.url`'s origin**. The init script does nothing on other origins. This is the same trust Jeyna already gives the app under test.
- **Setup cost:** none for the developer (Chrome is already there).
- **Build cost:** the sidecar bundle gains playwright-core. The MCP bundle with it is about 9 MB [code: `plugin/server/jeyna-mcp.mjs`], so expect `plugin/studio/` to grow by a similar amount, built the same way, with the `pw/` json files copied.
- **Is this D36's rejected option?** D36 rejected "a Playwright browser in the sidecar **streaming frames**": a headless browser shown inside the studio by streaming its pixels and forwarding input, which is indeed a remote desktop. A **headed** window streams nothing and forwards nothing. The developer's mouse and keyboard go to a real Chrome window. The rejection's reason does not apply.

#### D. A browser extension, `chrome.tabs.captureVisibleTab`

- **Pros:** no prompt after install, real pixels, works in the developer's **own** profile with their logins and extensions [docs].
- **Limits:**
  - visible area only;
  - throttled to about 2 calls per second (exactly the 500 ms cadence, no headroom) [docs];
  - the extension has to message the sidecar (localhost fetch with host permission).
- **Install:** "Load unpacked" in developer mode (D13: no store, no npm), with a scary warning on every Chrome start in some channels [belief], or Chrome Web Store review plus MV3 upkeep.
- **Cost:** a second shipped artifact with its own permissions and release cycle. Firefox has a similar API; Safari needs an Xcode-wrapped extension.
- **Verdict:** the right answer if "capture in my everyday browser" becomes a requirement. Defer.

#### E. Inject a capture script into the developer's app

The developer adds `<script src="http://localhost:4710/capture.js">` in dev. In-page code then has the same choices as above: DOM-to-image (B's fidelity problems) or getDisplayMedia (A's prompt). It needs an app change, can collide with CSP, and adds nothing C does not give for free (C injects without touching the app). **Rejected.**

#### F. OS screenshots from the sidecar (`screencapture -R`)

Needs macOS Screen Recording permission for the terminal, is per-OS, captures whatever window is on top, and has no notion of the app's viewport. **Rejected.**

### 2.3 Recommendation

**C, the headed Jeyna window, replaces the iframe and getDisplayMedia.** It is the only option that removes the prompt and the bar, gives exact device pixels of exactly the selected region, and keeps "the full browser experience" literally: a real window at a real size with the URL bar and DevTools. It also lets the capture UI live **in the app window itself**, where the problem is.

Delete the getDisplayMedia path rather than keep it as a fallback: every Jeyna user already has the Chrome that C needs. Two capture paths would double the UX to get right. Evidence capture stays in the studio (a same-origin PNG; no mechanism question). A (Region/Element Capture) is the fallback plan only if C proves unworkable in the live check.

---

## 3. The interaction design

### 3.1 Principles

1. **Capture where you look.** Select on the real pixels, in place, at 1:1. Never in a thumbnail.
2. **Freeze first, think later.** The shortcut grabs the frame *before* any UI appears, so hover states, open menus and toasts survive.
3. **The selection is the pointer**, and it is also what keeps Claude's pixels sharp (§1.5). Make a tight selection the path of least effort.
4. **Keyboard-complete.** Every step works without the mouse.
5. **Never lose words.** Text survives a stray Esc, a navigation and a failed save.
6. **The studio is the record, the app window is the workbench.** Capture happens in the app window; items appear in the studio by themselves (the SSE index already does this [code]).

### 3.2 Live becomes a launcher: the studio page

```
┌ ⚓ Jeyna studio   Playtests   [Live]   Feedback ⑥            sample-app / live ┐
│                                                                               │
│  Live                                                                         │
│  Use sample-app in its own Chrome window. Snap or record feedback right       │
│  where you see it; it lands here.                                             │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  [ Open app window ]   http://localhost:4173                              │ │
│  │  Chrome, profile .jeyna/chrome-profile (logins are kept)                  │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  In the app window                                                            │
│    ⌥⇧S   Snap: freeze the window, select, write                               │
│    ⌥⇧R   Record: select an area, record, ⌥⇧R again to stop                    │
│    Esc   Cancel (asks first if you wrote something)                           │
│                                                                               │
│  Captured in this window                                                      │
│    FB-007  Sign in button is misaligned       snap · 2 min ago        open    │
│    FB-008  Typing lags in the email field     rec 12 frames · now     open    │
└───────────────────────────────────────────────────────────────────────────────┘
```

With the window open, the card reads:

```
│  ● App window open · /todos · 1512 × 860 @2x      [ Bring to front ] [ Close ] │
```

While recording:

```
│  ● Recording in the app window · 0:07 · 14 / 40          [ Stop recording ]   │
```

- The labels are exactly as drawn. On Windows and Linux, `⌥⇧` reads `Alt+Shift`.
- "Open app window" also runs the existing reachability probe [code: `probe`]. If nothing answers: "Nothing answers at http://localhost:4173. Start your app, then try again." with **Open anyway** (Chrome's own error page then shows, and a reload in that window works once the app is up).
- One window per sidecar. A second "Open" brings it to the front.
- The "Captured in this window" list is the index's feedback filtered to items created since the window opened. No new state.

### 3.3 States (app window)

```
           ⌥⇧S                         save ok
 idle ───────────► frozen·snap ───────────────► idle (+ toast "Saved FB-nnn")
  │                 │  ▲ select / adjust / write
  │                 └──┘            Esc (confirm if text) ─► idle
  │
  │  ⌥⇧R                     Enter / "Record this area"           ⌥⇧R / Stop / 40 frames
  └──────► frozen·region ───────────────────────────► recording ───────────────────► review
                 │ Esc ─► idle                            │ window closed ─► review   │ save ─► idle
                                                          │ (frames kept)             │ Esc (confirm) ─► idle
```

The capture state lives **in the sidecar**: mode, frozen PNG, region, frames, and draft text mirrored on every input. The injected script only draws it. A full navigation (the sample app's login is a form POST with a 303 redirect [code]) re-runs the init script, which asks the sidecar for the current state and redraws. A recording carries on across navigations, and a draft survives a reload.

### 3.4 Idle: the app window

```
┌ Chrome ─ localhost:4173/todos ──────────────────────────────────────────────┐
│                                                                             │
│                         the app, full window                                │
│                                                                             │
│                                                                             │
│                                                       ┌──────────────────┐  │
│                                                       │ ⚓  Snap  Record │  │
│                                                       └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **The pill.** A 32 px pill, bottom-right with 16 px insets. It is draggable by the ⚓, and its position is kept in the sidecar per window. Clicking ⚓ collapses it to a 24 px dot, and clicking again expands it.
  - Tooltips: "Snap (⌥⇧S)" and "Record (⌥⇧R)".
  - It is a `popover="manual"` element in a **closed shadow root** on `<html>`: it sits in the top layer above any app `z-index` [probe], and app CSS cannot reach it.
  - It uses `system-ui` fonts (an `@font-face` inside a shadow root is not applied), with the studio's tokens as literal values.
- **The shortcuts.** ⌥⇧S and ⌥⇧R are caught in a `keydown` listener on `window` in the **capture phase**, matched on `e.code` (`KeyS`, `KeyR`) so macOS's ⌥ characters do not matter. Then `preventDefault()` and `stopPropagation()`: no character lands in a focused input, and the app never sees the key.
- **Not in the pixels.** On a snap, the script hides the pill, waits two animation frames, asks the sidecar to shoot, then draws the overlay. The pill is never in a capture. A single flicker on capture is the expected screenshot-tool feel.

### 3.5 Snap: freeze, select, write

```
┌ Chrome ─ localhost:4173/login ──────────────────────────────────────────────┐
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░ Sign in to your todos ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓░░┌─ New feedback ─────── 342 × 96 · @2x ─┐░░│
│░░■ Email                     ■░░│ What should change?                   │░░│
│░░┃ [helo worl              ] ┃░░│ ┌───────────────────────────────────┐ │░░│
│░░┃ [                       ] ┃░░│ │The password field has no label.   │ │░░│
│░░┗━━━━━━━━━━━━━■━━━━━━━━━━━━━┛░░│ │                                   │ │░░│
│░░ Forgot password?    [Sign in] ░│ └───────────────────────────────────┘ │░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ First line is the title in the list.  │░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ [Whole window]   [Cancel] [Save ⌘↩]   │░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░└───────────────────────────────────────┘░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└─────────────────────────────────────────────────────────────────────────────┘
 ░ = the frozen frame under a 45 % navy shade     ━ = 2 px tide outline     ■ = handle
```

**The freeze.** The overlay is a `<dialog>` in the shadow root, opened with `showModal()`. That puts it in the top layer, makes the app inert, traps focus, and on close Chrome returns focus to the app element that had it. Inside, an `<img>` of the frozen PNG is sized to `innerWidth × innerHeight` CSS px: device pixels on device pixels, visually identical to the live page. The page keeps running underneath, hidden.

**Before the first selection.**
- Crosshair cursor. A one-line hint centred near the top: "Drag to select · click an element · A for the whole window · Esc to cancel".
- **Hover highlights the element under the pointer** (a thin tide outline with its `tag.class` in mono, like DevTools' inspector). The element is found with `document.elementsFromPoint`, skipping Jeyna's host.

**Making a selection.**
- **Drag**: a free rectangle. A drag starts after 4 CSS px of movement.
- **Click** (less than 4 px): select the hovered element's border box, clamped to the viewport. This is the fastest accurate selection there is: one click on the broken component.
- **A** or **⌘A / Ctrl+A**, or the **Whole window** button: the whole viewport.

**Adjusting it** (always, even while typing in the panel):
- 8 handles, 10 px hit area, drawn 6 px. Drag a handle to resize. Drag inside to move. Drag outside to start a new selection.
- With focus on the selection: arrows move 1 px, ⇧+arrows 10 px; ⌥+arrows grow or shrink the right or bottom edge by 1 px, ⌥⇧+arrows by 10 px.
- A **size readout** sits on the outline's top-left outside corner: "342 × 96" plus "· @2x" when DPR ≠ 1. It moves inside when there is no room.

**The edges.**
- The selection is clamped to the viewport.
- A handle on a viewport edge is drawn inside the selection so it stays grabbable.
- Minimum size 8×8 CSS px; anything smaller on pointerup counts as a click.
- No scrolling while frozen: this captures the viewport, and a selection beyond it is out of scope (§4.4).

**Device pixel ratio.** The selection is kept in CSS px and converted at save with `x·dpr`, `y·dpr`, `w·dpr` and `h·dpr`, expanded outward to whole device pixels (floor the origin, ceil the far edge), so a fractional DPR (1.25, 1.5) never drops a row. The crop comes from the frozen full-resolution PNG in the sidecar. A selection of exactly the frame's size saves the frame unchanged.

**The panel.** 320 CSS px wide, about 200 px tall.
- **Placement, recomputed on each pointerup** (not during a drag, which would jitter):
  1. to the **right** of the selection with a 12 px gap;
  2. else **below**;
  3. else **left**;
  4. else **above**.

  Each candidate must fit inside the viewport with 12 px margins, aligned to the selection's top or left edge and slid to fit.
- If none fits (the selection fills the window), the panel docks in the viewport corner farthest from the selection's centre, over the selection, with a 1 px tide outline and a drag grip in its header so the developer can move it off what they are writing about. A panel the developer has moved stays there for this capture.
- **Contents, in tab order:**
  1. heading "New feedback" with the size readout;
  2. textarea, labelled "What should change?", hint "First line is the title in the list.";
  3. **Whole window**;
  4. **Cancel**;
  5. **Save** (primary, shows ⌘↩ / Ctrl+↩).

  Save is disabled until the text is non-blank (as today [code]).
- **Focus:** the textarea is focused when the panel first appears. Dragging handles never moves focus out of the textarea, because handles take `pointerdown` without focusing (`preventDefault` on `mousedown`). That fixes §1.1 step 8.

**Saving.**
- ⌘↩ / Ctrl+↩ or Save. The panel shows "Saving…", the binding sends `{ text, rect }`, and the sidecar crops, writes through `createFeedback` and replies with the id.
- On success the overlay closes at once and a toast appears bottom-right for 5 s: "Saved FB-009 · /jeyna:feedback FB-009 [Copy]" (`role="status"`). The app has focus back where it was. No "Done" click.
- On failure the panel stays with the text intact and shows the error inline (`role="alert"`) with Save enabled to retry.

**Cancelling.** Esc with no text: close. Esc with text: the panel shows "Discard this feedback? Esc again to discard, any other key to keep writing." A second Esc discards.

### 3.6 Recording, end to end

**1. Choose the area (frozen·region).** ⌥⇧R or the pill's Record: the same freeze and selection as a snap.
- The panel shows no textarea. It shows:
  - "Record this area";
  - the region's size;
  - "Up to 20 s (40 frames, one every 0.5 s)";
  - **Whole window**, **Cancel**, **Start recording ↩**.
- Enter with no selection records the whole window.
- The last region used in this window is preselected, so repeated recordings of the same widget are one keystroke.

**2. Recording.** The overlay disappears and the app is live and fully usable.

```
┌ Chrome ─ ● localhost:4173/login ────────────────────────────────────────────┐
│ Sign in to your todos                                                       │
│ ╔═══════════════════════════╗  ┌──────────────────────────────┐             │
│ ║ Email                     ║  │ ● 0:07 · 14 / 40   ■ Stop ⌥⇧R │             │
│ ║ [helo wor|              ] ║  └──────────────────────────────┘             │
│ ║ [                       ] ║                                               │
│ ╚═══════════════════════════╝                                               │
│ Forgot password?    [Sign in]                                               │
└─────────────────────────────────────────────────────────────────────────────┘
 ═ = 2 px fail-red ring drawn OUTSIDE the region (pointer-events: none)
```

- **The ring** sits outside the region, so it is never in a frame.
- **The HUD** is placed with the same algorithm as the panel, but it must lie fully **outside** the region. It shows a red dot, elapsed time, frames and a Stop button. Only the Stop button takes pointer events.
- **When nothing fits outside**, the HUD docks as a 28 px bar on the viewport edge farthest from the region's centre, and **the region is trimmed by that bar**. This is shown in step 1 before recording starts: a hatched strip and the note "Bottom 28 px are kept for the recording bar". Frames never contain Jeyna UI, and nothing flickers.
- Chrome's tab title gets a "● " prefix for the duration, so the recording is visible from the tab strip and the studio's Live card.
- **Frames:** the sidecar shoots `clip = region` every 500 ms, measured from the start, with the real `ms` recorded (D36 unchanged). A screenshot that overruns a tick is never stacked: the next one starts after it.
- **Stopping:** ⌥⇧R, the HUD's Stop, the studio's Stop recording, or 40 frames.
  - Esc does **not** stop: closing an app modal with Esc is a thing worth recording.
  - At 35 frames the HUD turns amber and reads "5 left".
  - At 40 it stops itself and the review says "Stopped at 40 frames (20 s)".
- **Interruptions:** a navigation keeps recording (sidecar-owned state; the ring and HUD redraw on the new document). Closing the window stops the recording and keeps the frames: the review then opens in the studio's lightbox (§3.7) instead.

**3. Review and write.** The page freezes again, showing the last frame. The region plays the recording **in place**, at 1:1, where it happened.

```
│░░╔═══════════════════════════╗░┌─ New feedback · recording ──────────────┐░│
│░░║ (frame 9 of 14, in place) ║░│ ▶  ├──[════════●══════════]──┤   9 / 14 │░│
│░░║                           ║░│      [ start            end ]    4.0 s  │░│
│░░╚═══════════════════════════╝░│ What should change?                     │░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ ┌─────────────────────────────────────┐ │░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ │Typing in Email drops the last char. │ │░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ └─────────────────────────────────────┘ │░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ 342 × 96 · @2x · 14 frames · 6.5 s      │░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ [Discard]                [Save ⌘↩]      │░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░└─────────────────────────────────────────┘░│
```

- **Playback:** ▶/❚❚ (Space when focus is not in the textarea) plays at real timing, as the Flipbook does today [code].
- **Scrubber:** ← / → step one frame; frame ticks; "9 / 14 · 4.0 s".
- **Trim:** two handles on the scrubber; `[` and `]` set start or end at the current frame. Saved `ms` are rebased so the first kept frame is 0.
- **Crop tighter:** the region's handles work, but only inside the recorded region (frames hold only that area). The crop applies to every frame; scrub to check frame 23 still holds the thing.
- **Discard** asks as in §3.5 when there is text. Save as in §3.5.

### 3.7 Feedback on an evidence image

**Give feedback** on a finding's evidence opens a full-window lightbox in the studio: a `<dialog>` with `showModal()`, full bleed, `--navy` at 92 %.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ t3-1440x900-1-login.png · 1440 × 900          [Fit] [100%]     [× Close Esc] │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Sign in to your todos                                                   │ │
│ │ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  ┌─ New feedback ─────── 330 × 92 ─┐      │ │
│ │ ┃ Email                     ┃  │ What should change? …            │      │ │
│ │ ┃ [user_b@example.test    ] ┃  │ [Whole image]  [Cancel] [Save ⌘↩]│      │ │
│ │ ┃ [•••••••••••••          ] ┃  └──────────────────────────────────┘      │ │
│ │ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛                                            │ │
│ │                    (image at 100 %, scrolls if larger)                  │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Zoom:** the image opens at **100 %** (one image px per CSS px; evidence is shot at DPR 1, for example 1440×900 for a 1440×900 viewport [browser]) when it fits; otherwise at **Fit**. The **100%** and **Fit** toggles use the keys `1` and `0`. At 100 % a larger image pans by scrolling or Space+drag.
- **Selection** is the same component and keys as §3.5. A click without a drag does nothing, since there is no DOM; **A** selects the whole image.
- **The panel** uses the same placement, relative to the visible part of the stage.
- **Saving** goes through `POST /api/feedback` as today; the crop is exact from the same-origin PNG [code].
- **The page behind is inert** (modal), so j / k / Esc no longer reach the finding page (fixes §1.1 step 8). The back-reference is captured **when the lightbox opens**, not re-read on render.
- No recording on evidence (D36 unchanged).

### 3.8 Errors and empty states

| Situation | What the developer sees |
|---|---|
| No `app.url` | Live: "No app.url: .jeyna/jeyna.config.yaml is missing or does not parse." (as today [code]). |
| Chrome and Chromium both missing | Live card: the same message `browser.ts` gives today: install Chrome, or `npx playwright install chromium` [code]. |
| App not answering | "Nothing answers at …. Start your app, then try again." with **Try again** and **Open anyway**. |
| Window closed by the developer | The card returns to "Open app window". An unsaved snap draft is offered in the studio lightbox: "You closed the app window with unsaved feedback. [Finish it here] [Discard]". |
| Overlay asked for on another origin (the developer browsed away) | ⌥⇧S does nothing. The pill shows "Feedback works on http://localhost:4173 only" for 3 s. |
| Page still loading or blank | The snap proceeds: what you see is what you get. |
| Save fails (disk, validation) | The panel keeps the text and selection and shows the error inline; retry. |
| Sidecar stopped mid-capture | The binding call rejects. The panel reads "Jeyna studio stopped. Start it with /jeyna:studio, then save again." The text stays in the panel. |
| Profile in use (a second sidecar on the same project) | "Another Jeyna window already uses .jeyna/chrome-profile. Close it first." (the persistent profile is single-process [docs]). |

### 3.9 Keyboard map

| Where | Key | Action |
|---|---|---|
| App window, idle | ⌥⇧S / Alt+Shift+S | Snap (freeze, select) |
| App window, idle or recording | ⌥⇧R / Alt+Shift+R | Record (choose area) / stop |
| Frozen | Drag · click · A / ⌘A | Free selection · element · whole |
| Frozen, selection focused | ← ↑ → ↓ (⇧ ×10) | Move |
| Frozen, selection focused | ⌥ + arrows (⇧ ×10) | Resize right or bottom edge |
| Frozen | Tab / ⇧Tab | Selection → textarea → buttons |
| Frozen | Enter (selection focused) | Go to the textarea (snap) / Start recording (region) |
| Frozen | ⌘↩ / Ctrl+↩ | Save |
| Frozen | Esc | Cancel (twice if there is text) |
| Review | Space · ← → · [ ] | Play/pause · frame · trim start/end |
| Evidence lightbox | 1 · 0 | 100 % · Fit |

### 3.10 Accessibility

- The overlay and lightbox are modal `<dialog>`s: focus is trapped, the page behind is inert, and focus returns to its origin on close.
- The selection is one focusable element with `role="group"`, `aria-roledescription="selection"` and `aria-label="Selection, 342 by 96 pixels, at 12, 40"`. A polite live region announces the size after each move (debounced 300 ms).
- Each handle has `aria-hidden="true"`; the keyboard path is the arrows on the selection.
- Every button has a visible text label. Shortcuts are in `aria-keyshortcuts` and in tooltips.
- The textarea has a real `<label>`.
- Focus rings use the studio's tide colour, 2 px, offset 2 px. The shade, outline and HUD meet 3:1 against both light and dark apps: the outline is tide with a 1 px white inner line.
- `prefers-reduced-motion`: no pulsing record dot (solid), no toast slide, no fade on the freeze.
- Pointer-only parts (handles) all have keyboard equivalents; nothing needs a precise drag.

### 3.11 What is saved, and what Claude receives

The item format of D36 stays. A **snap** is one PNG of **exactly the selected region at device resolution**, cut from a full-resolution CDP frame: no scaling, no studio chrome, no letterbox. A **recording** is region-clipped PNG frames with real `ms`, after any trim. Three optional frontmatter fields are added; the first two are cheap and always known in the Jeyna window:

```yaml
url: http://localhost:4173/login          # the page's URL at the freeze (live only)
viewport: { width: 1512, height: 860, dpr: 2 }  # CSS px and ratio at the freeze (live only)
target: "form#login > input[name=email]"  # only when the selection came from an element click
```

`get_feedback` prints them in its text before the frames: "Captured at http://localhost:4173/login, viewport 1512×860 @2x, element form#login > input[name=email]". Claude then knows the route and the component to look for, not only how they look. Tighter crops also mean fewer tokens and less downscaling (§1.5).

---

## 4. What changes

### 4.1 Decisions

A new **D37** amends D36's "On Live" bullet and its "Rejected" line:
- Live is a **Jeyna window**: a headed Chrome or Chromium launched by the sidecar with a persistent per-project profile, captured over CDP.
- getDisplayMedia and the iframe go.
- The "streaming frames" rejection is kept and explicitly distinguished.
- The in-place overlay replaces the modal for every capture.
- The three optional item fields are added.

GLOSSARY:
- **Live** gets the new definition.
- Add **App window** (or fold it into Live).
- `/jeyna:init` adds `.jeyna/chrome-profile/` to `.gitignore`.

### 4.2 Code, by module (sizes are rough, lines changed)

| Module | Change | Size |
|---|---|---|
| `src/chrome.ts` (new, moved) | `launch()`'s channel-then-Chromium fallback and its error text, moved out of `browser.ts` so the MCP server and the sidecar share one launcher. `browser.ts` imports it. | ~40 moved |
| `src/studio/window.ts` (new) | Open, close and front for the Jeyna window (`launchPersistentContext`, `viewport: null`, `ignoreDefaultArgs: ["--enable-automation"]`); `addInitScript` of the overlay bundle; `exposeBinding("__jeyna")` with the main-frame + app-origin check; the capture state (mode, frozen PNG, region, frames, draft); the snap and record sampler via `page.screenshot({ clip })`; the crop of the frozen PNG (Playwright's clip on the frozen frame, or a PNG crop without a new dependency); save through `createFeedback`; state changes pushed into the index. | ~250 new |
| `src/studio/overlay/` (new) | One UI module for selection, handles, element pick, panel placement, HUD, review scrubber and toast. Rendered into a closed shadow root. Used **injected** in the app window and **mounted** in the studio's evidence lightbox. `geometry.ts` (pure: normalise, clamp, CSS→device rounding, panel/HUD placement, region-minus-HUD) with `geometry.test.ts`. | ~500 TSX + ~150 CSS + ~120 pure + ~80 test |
| `src/studio/app/live.tsx` | Rewritten as the launcher of §3.2; all of getDisplayMedia, `grab`, `appRect` and the iframe go. | −147, +~80 |
| `src/studio/app/capture.tsx` | `CaptureEditor` goes (replaced by the overlay in a lightbox). `Flipbook`, `feedbackApi`, `captureUrl` and `prompt` stay. | −110, +~40 (lightbox wrapper) |
| `src/studio/app/finding.tsx` | Open the lightbox; capture origin at open. | ~10 |
| `src/studio/server.ts` | `POST /api/window` (`open` / `close` / `front` / `stop`) behind the existing `fromStudio` check; `window` state in the index. | ~50 |
| `src/feedback.ts` | Optional `url`, `viewport` and `target` in `FeedbackFront` and `NewFeedback`. Schema stays 1 (additive). | ~15 + tests |
| `src/finish.ts` (`get_feedback`) | Print the three fields. | ~8 |
| `build.mjs`, `scripts/check.mjs` | Sidecar bundle with playwright-core (the MCP bundle's `external` and `banner`, and its `pw/*.json` copy into `plugin/studio/pw/`); a new IIFE entry `plugin/studio/overlay.js`. | ~30; **plugin/studio grows by about 9 MB** |
| `src/studio/app/studio.css` | Drop `dialog.capture`, `.stage` and the `.live` iframe rules; add the lightbox and launcher. | ±80 |
| `plugin/skills/init/SKILL.md` | One `.gitignore` line. | 1 |
| Tests | `geometry.test.ts`; one sidecar test that opens the window **headless** against a static page, snaps a clip and checks the PNG's device dimensions and the item (the D36 verification pattern). | ~120 |

### 4.3 What stays

- The item model and file layout, the statuses, PNG frames at 500 ms with at most 40, and "no video".
- The list and item pages, the Flipbook, the write API and its Origin check.
- Evidence crop through a same-origin canvas, `get_feedback`, the skills and `update_status`.

### 4.4 Deferred, on purpose

- **An event log in recordings** (clicks with the element, a typed-text summary with password fields masked, as D9 redacts). It would tell Claude what the developer did between frames, and CDP frames have no cursor. Add it when a real recording's frames prove ambiguous.
- **A capture extension** (2.2 D) for capturing in the developer's everyday profile.
- **Full-page (beyond the viewport) snaps** (`captureBeyondViewport`).
- **Drawing on captures** (D36 already defers it).
- **A delayed snap** ("in 3 s"): the freeze-first shortcut covers transient UI.
- **Window size presets from `viewports:`** with mobile emulation.
- **Several captures per item.**

---

## 5. Open questions for the developer

1. **Drop the iframe and getDisplayMedia entirely, or keep them as a fallback?** *Default: drop.* Jeyna already requires Chrome for playtests, and two capture paths double what has to be right. 2.2 A stays the documented fallback plan.
2. **Where does the Jeyna window's profile live?** Per project (`.jeyna/chrome-profile/`) or one per user (`~/.jeyna/chrome-profile/`)? *Default: per project, gitignored*, so each app's logins and storage stay apart and deleting the folder resets it.
3. **Window size:** a real, freely resizable window (`viewport: null`), or the config's first viewport? *Default: the real window.* Feedback is about what the developer sees; presets later (§4.4).
4. **Shortcuts ⌥⇧S / ⌥⇧R:** fine, or do they clash with something in your apps? *Default: keep, not configurable* until a clash is reported.
5. **Element click-to-select and the `target` field:** in? *Default: yes.* One click is the most accurate selection, and a selector tells Claude where to look in the code.
6. **Trim in review:** start and end handles? *Default: yes, start and end only*, no cutting from the middle.
7. **+9 MB for playwright-core in `plugin/studio/`:** acceptable, or worth a shared chunk with the MCP bundle? *Default: accept the duplicate*, and revisit if plugin size becomes a complaint.
8. **The "automated test software" infobar:** drop it with `ignoreDefaultArgs`? *Default: yes.* It is noise in a window the developer works in; the window's dedicated profile and the ⚓ pill already say whose window it is.
9. **Unsaved draft after the window closes:** offer it in the studio, or just drop it? *Default: offer it once* (§3.8). Losing written feedback is the one thing this flow must never do.
