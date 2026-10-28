// Studio · Live (D36): the app at app.url in a frame, to use by hand and capture feedback on. Its pixels are
// cross-origin, so capture goes through the Screen Capture API: one share per session, a snap grabs one frame,
// a recording keeps a frame every 500 ms. The crop starts on the frame's rectangle.
import { useEffect, useRef, useState } from "react";
import { FRAME_MS, MAX_FRAMES } from "../../recording.js";
import type { StudioIndex } from "../types.js";
import { CaptureEditor, type Frame, type Rect } from "./capture.js";

export function LiveScreen({ index }: { index: StudioIndex }) {
  const app = index.app;
  const frame = useRef<HTMLIFrameElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<{ timer: number; frames: Frame[] } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [otherTab, setOtherTab] = useState(false);
  const [recording, setRecording] = useState(0); // frames kept so far; 0 when not recording
  const [editor, setEditor] = useState<{ frames: Frame[]; initial: Rect | null } | null>(null);
  const [up, setUp] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  // Does anything answer at app.url? An opaque response is enough; only a network error means it is down.
  const probe = () => {
    if (!app) return;
    setUp(null);
    fetch(app.url, { mode: "no-cors", cache: "no-store" }).then(() => setUp(true), () => setUp(false));
  };
  useEffect(probe, [app?.url]);
  useEffect(() => () => {
    if (rec.current) clearInterval(rec.current.timer);
    for (const t of stream.current?.getTracks() ?? []) t.stop();
  }, []);

  async function share(): Promise<HTMLVideoElement> {
    const v = video.current!;
    if (stream.current?.active) return v;
    // preferCurrentTab and selfBrowserSurface are Chromium's; other browsers ignore them and ask which surface to share.
    const options = { video: true, audio: false, preferCurrentTab: !otherTab, selfBrowserSurface: otherTab ? "exclude" : "include" };
    const s = await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
    s.getVideoTracks()[0].addEventListener("ended", () => {
      stream.current = null;
      setSharing(false);
      if (rec.current) stop();
    });
    stream.current = s;
    v.srcObject = s;
    await v.play();
    setSharing(true);
    return v;
  }

  const grab = (v: HTMLVideoElement): Frame => {
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    return { src: c, w: c.width, h: c.height, ms: 0 };
  };

  // Sharing this tab, the frame's box scaled to the captured size is where the app is. Sharing another tab, nothing is known.
  const appRect = (w: number, h: number): Rect | null => {
    const b = frame.current?.getBoundingClientRect();
    if (otherTab || !b) return null;
    const sx = w / window.innerWidth;
    const sy = h / window.innerHeight;
    return { x: b.left * sx, y: b.top * sy, w: Math.min(b.width * sx, w - b.left * sx), h: Math.min(b.height * sy, h - b.top * sy) };
  };

  const run = (f: () => Promise<void>) => () => {
    setError("");
    f().catch((e) => setError((e as Error).name === "NotAllowedError" ? "Screen sharing was not allowed, so nothing was captured." : (e as Error).message));
  };

  const snap = run(async () => {
    const f = grab(await share());
    setEditor({ frames: [f], initial: appRect(f.w, f.h) });
  });

  const record = run(async () => {
    const v = await share();
    const start = performance.now();
    const r = { timer: 0, frames: [grab(v)] };
    r.timer = window.setInterval(() => {
      r.frames.push({ ...grab(v), ms: performance.now() - start });
      setRecording(r.frames.length);
      if (r.frames.length >= MAX_FRAMES) stop();
    }, FRAME_MS);
    rec.current = r;
    setRecording(1);
  });

  function stop() {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    rec.current = null;
    setRecording(0);
    setEditor({ frames: r.frames, initial: appRect(r.frames[0].w, r.frames[0].h) });
  }

  const endShare = () => {
    for (const t of stream.current?.getTracks() ?? []) t.stop();
    stream.current = null;
    setSharing(false);
  };

  if (!app) return <p className="empty-state">No app.url: .jeyna/jeyna.config.yaml is missing or does not parse.</p>;
  return (
    <main className="live">
      <div className="livebar">
        <a href={app.url} target="_blank" rel="noreferrer" className="mono">{app.url}</a>
        <div className="actions">
          {recording ? (
            <button type="button" className="btn rec" onClick={stop}>
              <span className="dot" aria-hidden="true" />Stop · {recording} / {MAX_FRAMES} frames
            </button>
          ) : (
            <>
              <button type="button" className="btn primary" onClick={snap}>Snap</button>
              <button type="button" className="btn" onClick={record}>Record</button>
            </>
          )}
          {sharing ? (
            <button type="button" className="btn" onClick={endShare} disabled={!!recording}>Stop sharing</button>
          ) : (
            <label className="check" title="For an app that refuses to be framed: open it in its own tab and capture that tab.">
              <input type="checkbox" checked={otherTab} onChange={(e) => setOtherTab(e.target.checked)} />
              capture another tab
            </label>
          )}
        </div>
      </div>
      {error && <p className="error livemsg" role="alert">{error}</p>}
      {up === false ? (
        <div className="livemsg">
          <p>Nothing answers at <span className="mono">{app.url}</span>. Start your app, then reload.</p>
          <button type="button" className="btn" onClick={probe}>Reload</button>
        </div>
      ) : (
        <iframe ref={frame} src={app.url} title={`${app.name} at ${app.url}`} />
      )}
      <p className="livehint muted">A blank frame? Your app may refuse to be framed: open it in its own tab, tick “capture another tab” and pick that tab.</p>
      <video ref={video} muted playsInline hidden />
      {editor && <CaptureEditor frames={editor.frames} initial={editor.initial} origin={{ source: "live" }} onClose={() => setEditor(null)} />}
    </main>
  );
}
