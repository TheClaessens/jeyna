// Studio · Live (D37): the launcher of the Live window, the app in its own Chrome where the developer snaps and records
// feedback in place. Open or bring it to the front, stop a recording, close it, the keys that work in it, and what was
// captured since it opened.
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as m from "../model.js";
import type { StudioIndex } from "../types.js";
import { DraftLightbox, SavedToast, windowApi } from "./capture.js";
import { Card } from "./ui.js";

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k: string) => (mac ? `⌥⇧${k}` : `Alt+Shift+${k}`);

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

  if (!app) return <p className="empty-state">No app.url: .jeyna/jeyna.config.yaml is missing or does not parse.</p>;
  const page = w.url ? (w.url.startsWith(app.url) ? w.url.slice(app.url.replace(/\/$/, "").length) || "/" : w.url) : null;
  const captured = w.openedAt ? index.feedback.filter((i) => i.front?.source === "live" && i.front.created >= w.openedAt!).reverse() : [];

  return (
    <div className="center">
      <main className="feedback live">
        <section className="head">
          <div className="title"><h1>Live</h1></div>
          <p className="summary">Use {app.name} in its own Chrome window and snap or record feedback right where you see it. It lands in <Link to="/feedback">Feedback</Link>.</p>
        </section>

        {w.draft && (
          <Card className="launcher draft">
            <div className="row">
              <span>
                The app window closed with unsaved feedback: {w.draft.capture === "snap" ? "a snap" : `a recording of ${w.draft.frames} frames`}
                {w.draft.text.trim() && <>, “<b>{w.draft.text.trim().split("\n")[0]}</b>”</>}.
              </span>
              <span className="grow" />
              <button type="button" className="btn primary" onClick={() => setFinishing(true)}>Finish it here</button>
              <button type="button" className="btn" onClick={act("discard-draft")} disabled={busy}>Discard</button>
            </div>
          </Card>
        )}
        {finishing && w.draft && <DraftLightbox draft={w.draft} onClose={() => setFinishing(false)} onSaved={setSaved} />}
        {saved && <SavedToast id={saved} onDone={() => setSaved(undefined)} />}

        <Card className="launcher">
          {w.open ? (
            <div className="row">
              <span className={`dot ${w.recording ? "rec" : "on"}`} aria-hidden="true" />
              <span>
                {w.recording ? "Recording in the app window" : "App window open"}{page && <> · <span className="mono">{page}</span></>}
                {w.capturing && <span className="muted"> · capturing</span>}
              </span>
              <span className="grow" />
              {w.recording && <button type="button" className="btn primary" onClick={act("stop")} disabled={busy}>Stop recording</button>}
              <button type="button" className="btn" onClick={act("open")} disabled={busy}>Bring to front</button>
              <button type="button" className="btn" onClick={act("close")} disabled={busy}>Close</button>
            </div>
          ) : up === false ? (
            <div className="row">
              <span>Nothing answers at <span className="mono">{app.url}</span>. Start your app, then try again.</span>
              <span className="grow" />
              <button type="button" className="btn" onClick={probe}>Try again</button>
              <button type="button" className="btn" onClick={act("open")} disabled={busy}>Open anyway</button>
            </div>
          ) : (
            <div className="row">
              <button type="button" className="btn primary" onClick={act("open")} disabled={busy || up === null}>{busy ? "Opening…" : "Open app window"}</button>
              <span className="mono">{app.url}</span>
            </div>
          )}
          <p className="muted">Chrome, with this project's own profile in <span className="mono">.jeyna/chrome-profile/</span>, so logins are kept between sessions.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </Card>

        <Card title="In the app window">
          <dl className="keys">
            <dt><kbd>{key("S")}</kbd></dt><dd>Snap: freeze the window, select what matters, write what should change. Or <b>Snap</b> on Jeyna's pill, bottom right.</dd>
            <dt><kbd>{key("R")}</kbd></dt><dd>Record: choose an area, then use the app; a frame every half second, up to 20 s. {key("R")} again or Stop ends it, and you review it in place before saving. Or <b>Record</b> on the pill.</dd>
            <dt><kbd>A</kbd></dt><dd>Select the whole window</dd>
            <dt><kbd>{mac ? "⌘↩" : "Ctrl+↩"}</kbd></dt><dd>Save</dd>
            <dt><kbd>Esc</kbd></dt><dd>Cancel; it asks first if you wrote something</dd>
          </dl>
        </Card>

        {!!captured.length && (
          <Card title="Captured in this window" pad={false} className="fblist">
            {captured.map((i) => (
              <Link key={i.id} to="/feedback/$feedbackId" params={{ feedbackId: i.id }} className="row">
                <span className="id">{i.id}</span>
                <span className="ttl">
                  <span className="t">{i.text.split("\n")[0]}</span>
                  <span className="where">{i.front!.url ?? "Live"} · {m.dateTime(i.front!.created)}</span>
                </span>
              </Link>
            ))}
          </Card>
        )}
      </main>
    </div>
  );
}
