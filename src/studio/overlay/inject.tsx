// The capture script the studio injects into every page of the Live window (D37): the pill, ⌥⇧S and ⌥⇧R, the overlay on
// a frozen frame, the ring and timer of a recording and its review, and the toast a save leaves. All in a closed shadow
// root and the top layer, so the app's CSS and z-index never reach them. It talks to the sidecar only through the
// __jeyna binding, which answers on the app's origin, in the main frame; anywhere else this script stays out of the way.
// The sidecar holds a recording, so after a navigation the new document picks it up where it is.
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MAX_FRAMES } from "../../recording.js";
import { placeHud, type Rect, toImage } from "./geometry.js";
import { cropPng, Overlay } from "./Overlay.js";
import overlayCss from "./overlay.css";
import windowCss from "./window.css";

type Shot = { png: string; w: number; h: number; dpr: number };
type Review = Shot & { region: Rect; frames: { png: string; ms: number }[] };
// What the sidecar holds for this tab when the document loads: a frozen snap or a recording, each with its text so far.
type Hello = { snap: (Shot & { text: string }) | null; recording: { region: Rect; frames: number; elapsed: number; reviewing: boolean; text: string } | null };
type Mode =
  | { kind: "snap"; shot: Shot; text?: string }
  | { kind: "region"; shot: Shot; last: Rect | null }
  | { kind: "recording"; region: Rect; hud: { x: number; y: number }; frames: number; since: number }
  | { kind: "review"; review: Review; text?: string };
type Toast = { id: string } | { error: string };

const bridge = (window as unknown as { __jeyna?: (msg: unknown) => Promise<never> }).__jeyna;
const call = <T,>(msg: unknown) => bridge!(msg) as Promise<T>;
// The text as it is typed goes to the sidecar, so a reload brings it back and a closed window leaves it as a draft.
const keepText = (text: string) => void call({ type: "draft", text }).catch(() => {});
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const keys = (k: string) => (mac ? `⌥⇧${k}` : `Alt+Shift+${k}`);
const HUD = { w: 240, h: 36 };
const png = (b64: string) => `data:image/png;base64,${b64}`;
const show = (el: HTMLElement | null) => el && !el.matches(":popover-open") && el.showPopover();
const frames = (n: number) => new Promise<void>((r) => (n ? requestAnimationFrame(() => frames(n - 1).then(r)) : r()));
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
// Where the timer goes for a region (outside it), and the region trimmed if the timer had to dock over it.
const hudFor = (r: Rect) => placeHud(r, HUD, { w: innerWidth, h: innerHeight });

// Registered before the app's own scripts run, so the shortcuts reach Jeyna first and the app never sees them.
const on: { S?: () => void; R?: () => void } = {};
let hello: Hello | null = null;
if (bridge && window.top === window) {
  addEventListener(
    "keydown",
    (e) => {
      const k = e.code === "KeyS" ? "S" : e.code === "KeyR" ? "R" : null;
      if (!k || !on[k] || !e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      on[k]!();
    },
    true,
  );
  call<Hello>({ type: "hello" }).then((h) => ((hello = h), mount()), () => {}); // refused off the app's origin
}

function mount() {
  const host = document.createElement("jeyna-capture");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = overlayCss + windowCss;
  const root = document.createElement("div");
  shadow.append(style, root);
  // The app may replace what is under <html> (a framework hydrating it): put Jeyna back.
  const attach = () => host.isConnected || document.documentElement.append(host);
  attach();
  new MutationObserver(attach).observe(document.documentElement, { childList: true });
  createRoot(root).render(<Capture />);
}

function Capture() {
  const pill = useRef<HTMLDivElement>(null);
  const toastEl = useRef<HTMLDivElement>(null);
  // What the sidecar held when this document loaded (the app navigated or reloaded) is picked up from the first render,
  // so the pill never shows over it.
  const [mode, setMode] = useState<Mode | null>(() => {
    const r = hello?.recording;
    if (hello?.snap) return { kind: "snap", shot: hello.snap, text: hello.snap.text };
    return r && !r.reviewing ? { kind: "recording", region: r.region, hud: hudFor(r.region), frames: r.frames, since: Date.now() - r.elapsed } : null;
  });
  const [busy, setBusy] = useState(!!hello?.recording?.reviewing); // busy: between two modes, Jeyna's UI stays hidden
  const [small, setSmall] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [copied, setCopied] = useState(false);
  const fail = (e: unknown) => setToast({ error: (e as Error).message });

  // Jeyna's UI is never in a capture: the pill and toast are hidden and two frames drawn before any screenshot.
  const hide = async () => {
    setBusy(true);
    setToast(null);
    pill.current?.hidePopover();
    toastEl.current?.hidePopover();
    await frames(2);
  };
  const freeze = async (kind: "snap" | "region") => {
    if (mode || busy) return;
    await hide();
    try {
      const shot = await call<Shot & { last: Rect | null }>({ type: "freeze", for: kind === "snap" ? "snap" : "record" });
      setMode(kind === "snap" ? { kind, shot } : { kind, shot, last: shot.last });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const review = async () => {
    setBusy(true);
    setMode(null); // the ring and timer go before the page is shot again
    await frames(2);
    try {
      setMode({ kind: "review", review: await call<Review>({ type: "review" }), text: hello?.recording?.text });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  on.S = () => void freeze("snap");
  on.R = () => (mode?.kind === "recording" ? void call({ type: "stop" }).catch(fail) : void freeze("region"));

  useEffect(() => {
    if (hello?.recording?.reviewing) void review();
    const frame = (e: Event) => setMode((m) => (m?.kind === "recording" ? { ...m, frames: (e as CustomEvent<number>).detail } : m));
    const stopped = () => void review();
    addEventListener("jeyna:frame", frame);
    addEventListener("jeyna:stopped", stopped);
    return () => (removeEventListener("jeyna:frame", frame), removeEventListener("jeyna:stopped", stopped));
  }, []);
  useEffect(() => {
    if (!mode && !busy) show(pill.current);
    else pill.current?.hidePopover();
  }, [mode, busy]);
  useEffect(() => {
    if (!toast) return;
    show(toastEl.current);
    setCopied(false);
    const t = setTimeout(() => setToast(null), "id" in toast ? 8000 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const saved = (id: string) => (setMode(null), setToast({ id }));
  const cancel = () => (call({ type: "cancel" }).catch(() => {}), setMode(null));
  const saveSnap = (shot: Shot) => async (text: string, crop: Rect) => {
    const img = new Image();
    img.src = png(shot.png);
    await img.decode();
    saved((await call<{ id: string }>({ type: "save", text, png: cropPng(img, crop) })).id);
  };
  // The region in whole CSS px, inside the window, trimmed if the timer has to dock over it; then the frames start.
  const start = async (sel: Rect) => {
    const { region, x, y } = hudFor(toImage(sel, 1, { w: innerWidth, h: innerHeight }));
    setBusy(true);
    setMode(null);
    await frames(2);
    try {
      await call({ type: "record", region });
      setMode({ kind: "recording", region, hud: { x, y }, frames: 0, since: Date.now() });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const prompt = toast && "id" in toast ? `/jeyna:feedback ${toast.id}` : "";

  return (
    <>
      <div ref={pill} popover="manual" className={`jw-pill ${small ? "small" : ""}`} role="toolbar" aria-label="Jeyna feedback">
        <button type="button" className="jw-mark" aria-label={small ? "Show Jeyna's feedback tools" : "Fold Jeyna's feedback tools"} aria-expanded={!small} onClick={() => setSmall(!small)}>⚓</button>
        {!small && (
          <>
            <button type="button" onClick={() => void freeze("snap")} title={`Snap (${keys("S")})`} aria-keyshortcuts="Alt+Shift+S">Snap</button>
            <button type="button" onClick={() => void freeze("region")} title={`Record (${keys("R")})`} aria-keyshortcuts="Alt+Shift+R">Record</button>
          </>
        )}
      </div>
      {mode?.kind === "snap" && (
        <Frozen>
          <Overlay
            image={{ src: png(mode.shot.png), w: mode.shot.w, h: mode.shot.h }}
            ratio={mode.shot.dpr}
            title={location.host + location.pathname}
            whole="window"
            initialText={mode.text}
            onText={keepText}
            onSave={saveSnap(mode.shot)}
            onCancel={cancel}
          />
        </Frozen>
      )}
      {mode?.kind === "region" && (
        <Frozen>
          <Overlay
            image={{ src: png(mode.shot.png), w: mode.shot.w, h: mode.shot.h }}
            ratio={mode.shot.dpr}
            title={`Record · ${location.host}${location.pathname}`}
            whole="window"
            initial={mode.last ?? undefined}
            onStart={start}
            onSave={async () => {}}
            onCancel={cancel}
          />
        </Frozen>
      )}
      {mode?.kind === "recording" && <Recording mode={mode} onStop={() => void call({ type: "stop" }).catch(fail)} />}
      {mode?.kind === "review" && <ReviewOverlay review={mode.review} text={mode.text} onSaved={saved} onCancel={cancel} />}
      {toast && (
        <div ref={toastEl} popover="manual" className="jw-toast" role={"id" in toast ? "status" : "alert"}>
          {"id" in toast ? (
            <>
              <span>Saved {toast.id}</span>
              <code>{prompt}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(prompt).then(() => setCopied(true))}>{copied ? "Copied" : "Copy prompt"}</button>
            </>
          ) : (
            <span className="jw-error">{toast.error}</span>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </>
  );
}

// The frozen frame, modal over the app: the app is inert and gets no keys while it is up. The overlay mounts once the
// dialog is open, so it measures, places and focuses its panel in the same task: mounted in a closed dialog, its panel
// measured nothing, showed a frame later, and keys typed in that frame were lost.
function Frozen({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    dialog.current?.showModal();
    setOpen(true);
  }, []);
  return (
    <dialog ref={dialog} className="jw-freeze" aria-label="New feedback" onCancel={(e) => e.preventDefault()}>
      {open && children}
    </dialog>
  );
}

// While recording: a ring just outside the region and the timer with Stop, both outside it, so never in a frame.
function Recording({ mode, onStop }: { mode: Extract<Mode, { kind: "recording" }>; onStop: () => void }) {
  const ring = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    show(ring.current);
    show(hud.current);
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const { region: r } = mode;
  const left = MAX_FRAMES - mode.frames;
  return (
    <>
      <div ref={ring} popover="manual" className="jw-ring" aria-hidden="true" style={{ left: r.x - 3, top: r.y - 3, width: r.w + 6, height: r.h + 6 }} />
      <div ref={hud} popover="manual" className={`jw-hud ${left <= 5 ? "low" : ""}`} role="status" style={{ left: mode.hud.x, top: mode.hud.y }}>
        <span className="jw-dot" aria-hidden="true" />
        <span>{clock(now - mode.since)} · {left <= 5 ? `${left} left` : `${mode.frames} / ${MAX_FRAMES}`}</span>
        <button type="button" onClick={onStop} aria-keyshortcuts="Alt+Shift+R">Stop {keys("R")}</button>
      </div>
    </>
  );
}

// The recording plays in place over the page as it is now, with a scrubber; the selection can only tighten inside the
// region, and that crop applies to every frame.
function ReviewOverlay({ review, text, onSaved, onCancel }: { review: Review; text?: string; onSaved: (id: string) => void; onCancel: () => void }) {
  const { region, frames: list } = review;
  const [i, setI] = useState(list.length - 1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (i >= list.length - 1) return setPlaying(false);
    const t = setTimeout(() => setI(i + 1), list[i + 1].ms - list[i].ms);
    return () => clearTimeout(t);
  }, [playing, i, list]);
  const play = () => {
    if (!playing && i >= list.length - 1) setI(0);
    setPlaying(!playing);
  };

  const save = async (text: string, _crop: Rect, sel: Rect) => {
    let pngs: string[] | undefined;
    if (sel.x !== region.x || sel.y !== region.y || sel.w !== region.w || sel.h !== region.h) {
      const imgs = await Promise.all(
        list.map(async (f) => {
          const img = new Image();
          img.src = png(f.png);
          await img.decode();
          return img;
        }),
      );
      const ratio = imgs[0].naturalWidth / region.w;
      const rel = toImage({ x: sel.x - region.x, y: sel.y - region.y, w: sel.w, h: sel.h }, ratio, { w: imgs[0].naturalWidth, h: imgs[0].naturalHeight });
      pngs = imgs.map((img) => cropPng(img, rel));
    }
    onSaved((await call<{ id: string }>({ type: "save", text, ...(pngs && { pngs }) })).id);
  };

  return (
    <Frozen>
      <Overlay
        image={{ src: png(review.png), w: review.w, h: review.h }}
        ratio={review.dpr}
        title={`Recording · ${list.length} frames · ${(list[list.length - 1].ms / 1000).toFixed(1)} s`}
        whole="recording"
        limit={region}
        initial={region}
        initialText={text}
        onText={keepText}
        layer={<img className="jo-layer" src={png(list[i].png)} alt="" style={{ left: region.x, top: region.y, width: region.w, height: region.h }} />}
        extra={
          <div className="jo-scrub">
            <button type="button" onClick={play}>{playing ? "Pause" : "Play"}</button>
            <input type="range" min={0} max={list.length - 1} value={i} onChange={(e) => (setPlaying(false), setI(Number(e.target.value)))} aria-label="Frame" />
            <span>{i + 1} / {list.length} · {(list[i].ms / 1000).toFixed(1)} s</span>
          </div>
        }
        onSave={save}
        onCancel={onCancel}
      />
    </Frozen>
  );
}
