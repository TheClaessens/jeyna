// The capture script the studio injects into every page of the Live window (D37): the pill, ⌥⇧S, the overlay on a frozen
// frame, and the toast a save leaves. All in a closed shadow root and the top layer, so the app's CSS and z-index never
// reach them. It talks to the sidecar only through the __jeyna binding, which answers on the app's origin, in the main
// frame; anywhere else this script stays out of the way.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { cropPng, Overlay } from "./Overlay.js";
import overlayCss from "./overlay.css";
import windowCss from "./window.css";

type Frozen = { png: string; w: number; h: number; dpr: number };
type Toast = { id: string } | { error: string };
const bridge = (window as unknown as { __jeyna?: (msg: unknown) => Promise<never> }).__jeyna;
const call = <T,>(msg: unknown) => bridge!(msg) as Promise<T>;
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const SNAP_KEY = mac ? "⌥⇧S" : "Alt+Shift+S";
const show = (el: HTMLElement | null) => el && !el.matches(":popover-open") && el.showPopover();
const frames = (n: number) => new Promise<void>((r) => (n ? requestAnimationFrame(() => frames(n - 1).then(r)) : r()));

// Registered before the app's own scripts run, so the shortcut reaches Jeyna first and the app never sees it.
let snap: (() => void) | undefined;
if (bridge && window.top === window) {
  addEventListener(
    "keydown",
    (e) => {
      if (!snap || !e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey || e.code !== "KeyS") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      snap();
    },
    true,
  );
  call({ type: "hello" }).then(mount, () => {}); // refused off the app's origin: nothing to do
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
  const dialog = useRef<HTMLDialogElement>(null);
  const toastEl = useRef<HTMLDivElement>(null);
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [busy, setBusy] = useState(false);
  const [small, setSmall] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [copied, setCopied] = useState(false);

  // Jeyna's UI is never in a capture: the pill and toast are hidden and two frames drawn before the screenshot.
  snap = async () => {
    if (frozen || busy) return;
    setBusy(true);
    setToast(null);
    pill.current?.hidePopover();
    toastEl.current?.hidePopover();
    await frames(2);
    try {
      setFrozen(await call<Frozen>({ type: "freeze" }));
    } catch (e) {
      setToast({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!frozen && !busy) show(pill.current);
  }, [frozen, busy]);
  useEffect(() => {
    if (frozen) dialog.current?.showModal();
  }, [frozen]);
  useEffect(() => {
    if (!toast) return;
    show(toastEl.current);
    setCopied(false);
    const t = setTimeout(() => setToast(null), "id" in toast ? 8000 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const src = frozen && `data:image/png;base64,${frozen.png}`;
  const save = async (text: string, crop: { x: number; y: number; w: number; h: number }) => {
    const img = new Image();
    img.src = src!;
    await img.decode();
    const { id } = await call<{ id: string }>({ type: "save", text, png: cropPng(img, crop) });
    setFrozen(null);
    setToast({ id });
  };
  const cancel = () => {
    call({ type: "cancel" }).catch(() => {});
    setFrozen(null);
  };
  const prompt = toast && "id" in toast ? `/jeyna:feedback ${toast.id}` : "";

  return (
    <>
      <div ref={pill} popover="manual" className={`jw-pill ${small ? "small" : ""}`} role="toolbar" aria-label="Jeyna feedback">
        <button type="button" className="jw-mark" aria-label={small ? "Show Jeyna's feedback tools" : "Fold Jeyna's feedback tools"} aria-expanded={!small} onClick={() => setSmall(!small)}>⚓</button>
        {!small && <button type="button" onClick={snap} title={`Snap (${SNAP_KEY})`} aria-keyshortcuts="Alt+Shift+S">Snap</button>}
      </div>
      {src && (
        <dialog ref={dialog} className="jw-freeze" aria-label="New feedback" onCancel={(e) => e.preventDefault()} onClose={() => setFrozen(null)}>
          <Overlay image={{ src, w: frozen.w, h: frozen.h }} ratio={frozen.dpr} title={location.host + location.pathname} whole="window" onSave={save} onCancel={cancel} />
        </dialog>
      )}
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
