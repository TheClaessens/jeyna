// Studio · Live (D37): the launcher of the Live window, the app in its own Chrome where the developer snaps and records
// feedback in place. One card holds every state (closed, opening, app down, open, recording, an unsaved draft), then
// the keys that work in the window, and what was captured since it opened.
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as m from "../model.js";
import type { StudioIndex } from "../types.js";
import { captureUrl, DraftLightbox, SavedToast, windowApi } from "./capture.js";
import { Crab, Vacant } from "./ui.js";

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const caps = (k: string) => (mac ? ["⌥", "⇧", k] : ["Alt", "Shift", k]);

export function LiveScreen({ index }: { index: StudioIndex }) {
  const app = index.app;
  const w = index.window;
  const [up, setUp] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [saved, setSaved] = useState<string>();

  // Does anything answer at app.url? An opaque response is enough; only a network error means it is down.
  const probe = () => {
    if (!app) return;
    setUp(null);
    fetch(app.url, { mode: "no-cors", cache: "no-store" }).then(() => setUp(true), () => setUp(false));
  };
  useEffect(probe, [app?.url]);

  const act = (action: "open" | "close" | "stop" | "discard-draft") => async () => {
    setBusy(true);
    setError("");
    try {
      await windowApi({ action });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!app) return <Vacant title="No app to open">No app.url: .jeyna/jeyna.config.yaml is missing or does not parse.</Vacant>;
  const page = w.url ? (w.url.startsWith(app.url) ? w.url.slice(app.url.replace(/\/$/, "").length) || "/" : w.url) : null;
  const captured = w.openedAt ? index.feedback.filter((i) => i.front?.source === "live" && i.front.created >= w.openedAt!).reverse() : [];

  return (
    <>
      <section className="launch">
        <Crab />
        <div className="words">
          <h1 className="h1" style={{ fontSize: 52 }}>Take the helm.</h1>
          <p className="lead">Open {app.name} in its own Chrome window. Snap or record right where you see something; it lands in <Link to="/feedback">Feedback</Link>.</p>
          {w.draft && (
            <div className="draft">
              <span>
                The app window closed with unsaved feedback: {w.draft.capture === "snap" ? "a snap" : `a recording of ${w.draft.frames} frames`}
                {w.draft.text.trim() && <>, “<b>{w.draft.text.trim().split("\n")[0]}</b>”</>}.
              </span>
              <div className="acts">
                <button type="button" className="btn primary" onClick={() => setFinishing(true)}>Finish it here</button>
                <button type="button" className="btn" onClick={act("discard-draft")} disabled={busy}>Discard</button>
              </div>
            </div>
          )}
          {w.open ? (
            <div className="acts">
              <span className="state">
                <span className={`lamp ${w.recording ? "rec" : ""}`} aria-hidden="true" />
                {w.recording ? "Recording in the app window" : "App window open"}{page && <> · <span className="mono">{page}</span></>}
                {w.capturing && <span className="meta"> · capturing</span>}
              </span>
              <span className="grow" />
              {w.recording && <button type="button" className="btn primary" onClick={act("stop")} disabled={busy}>Stop recording</button>}
              <button type="button" className="btn" onClick={act("open")} disabled={busy}>Bring to front</button>
              <button type="button" className="btn" onClick={act("close")} disabled={busy}>Close</button>
            </div>
          ) : up === false ? (
            <div className="acts">
              <span>Nothing answers at <span className="mono">{app.url}</span>. Start your app, then try again.</span>
              <button type="button" className="btn primary big" onClick={probe}>Try again</button>
              <button type="button" className="btn big" onClick={act("open")} disabled={busy}>Open anyway</button>
            </div>
          ) : (
            <div className="acts">
              <button type="button" className="btn primary big" onClick={act("open")} disabled={busy || up === null}>{busy ? "Opening…" : "Open app window"}</button>
              <span className="mono meta">{app.url}</span>
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </section>
      {finishing && w.draft && <DraftLightbox draft={w.draft} onClose={() => setFinishing(false)} onSaved={setSaved} />}
      {saved && <SavedToast id={saved} onDone={() => setSaved(undefined)} />}

      <section aria-labelledby="keys-h">
        <h2 className="h2" id="keys-h">In the app window</h2>
        <div className="keys">
          <div className="key"><span className="cap">{caps("S").map((k) => <span key={k}>{k}</span>)}</span><b>Snap</b><small>Freeze, select, write what should change</small></div>
          <div className="key"><span className="cap">{caps("R").map((k) => <span key={k}>{k}</span>)}</span><b>Record</b><small>A frame every half second, up to 20 s</small></div>
          <div className="key">
            <span className="cap">{(mac ? ["⌘", "↩"] : ["Ctrl", "↩"]).map((k) => <span key={k}>{k}</span>)}</span>
            <b>Save</b>
            <small>Lands in Feedback · <kbd>A</kbd> selects the whole window · <kbd>Esc</kbd> cancels</small>
          </div>
        </div>
      </section>

      {!!captured.length && (
        <section aria-labelledby="captured-h">
          <h2 className="h2" id="captured-h"><span className="px">{captured.length}</span>captured in this window</h2>
          <div className="rows">
            {captured.map((i) => (
              <Link key={i.id} to="/feedback/$feedbackId" params={{ feedbackId: i.id }} className="fb row">
                <span className="shot"><img src={captureUrl(i.front!.frames[0].file)} alt="" /></span>
                <span className="body">
                  <span className="t">{i.text.split("\n")[0]}</span>
                  <span className="m"><span className="mono">{i.id}</span><span>{i.front!.url ?? "Live"}</span><span>{m.hm(i.front!.created)}</span></span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <p className="meta">Chrome uses this project’s own profile in <span className="mono">.jeyna/chrome-profile/</span>, so logins stay between sessions.</p>
    </>
  );
}
