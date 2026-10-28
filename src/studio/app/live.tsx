// Studio · Live (D37): the launcher of the Live window, the app in its own Chrome where the developer snaps feedback in
// place. Open or bring it to the front, close it, the keys that work in it, and what was captured since it opened.
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as m from "../model.js";
import type { StudioIndex } from "../types.js";
import { Card } from "./ui.js";

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k: string) => (mac ? `⌥⇧${k}` : `Alt+Shift+${k}`);

async function windowApi(action: "open" | "close") {
  const res = await fetch("/api/window", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? res.statusText);
}

export function LiveScreen({ index }: { index: StudioIndex }) {
  const app = index.app;
  const w = index.window;
  const [up, setUp] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Does anything answer at app.url? An opaque response is enough; only a network error means it is down.
  const probe = () => {
    if (!app) return;
    setUp(null);
    fetch(app.url, { mode: "no-cors", cache: "no-store" }).then(() => setUp(true), () => setUp(false));
  };
  useEffect(probe, [app?.url]);

  const act = (action: "open" | "close") => async () => {
    setBusy(true);
    setError("");
    try {
      await windowApi(action);
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
          <p className="summary">Use {app.name} in its own Chrome window and snap feedback right where you see it. It lands in <Link to="/feedback">Feedback</Link>.</p>
        </section>

        <Card className="launcher">
          {w.open ? (
            <div className="row">
              <span className="dot on" aria-hidden="true" />
              <span>
                App window open{page && <> · <span className="mono">{page}</span></>}
                {w.capturing && <span className="muted"> · capturing</span>}
              </span>
              <span className="grow" />
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
