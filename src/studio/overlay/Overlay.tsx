// The capture overlay (D37): select a region of an image at full size, in place, and write what should change. One
// component for the studio's evidence lightbox and the app window's frozen frame. It works in display px over the image
// and hands the host the selection in the image's own pixels; the host crops and saves, and brings overlay.css.
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FRAME_MS, MAX_FRAMES } from "../../recording.js";
import { fromPoints, type Handle, MIN, move, placePanel, type Rect, resize, type Size, toImage } from "./geometry.js";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CLICK = 4; // display px a pointer may travel and still be a click

// PNG bytes (base64) of one region of an image, at the image's own pixels.
export function cropPng(src: CanvasImageSource, r: Rect): string {
  const c = document.createElement("canvas");
  c.width = r.w;
  c.height = r.h;
  c.getContext("2d")!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c.toDataURL("image/png").slice("data:image/png;base64,".length);
}

type Drag = { kind: "new" | "move" | Handle; from: { x: number; y: number }; orig: Rect | null; moved: boolean };

export function Overlay({ image, ratio, title, whole, limit, initial, initialText = "", layer, extra, onStart, onText, onSave, onCancel }: {
  image: { src: string; w: number; h: number }; // the image at its own pixels
  ratio: number; // image px per display px
  title: string;
  whole: "image" | "window" | "recording"; // what a click or A selects
  limit?: Rect; // display px the selection stays in, and what "whole" means; a recording's region. Default: the image.
  initial?: Rect; // a preselected region
  initialText?: string; // a draft brought back
  layer?: ReactNode; // drawn over the image, under the shade: a recording's frame, in place
  extra?: ReactNode; // at the top of the panel: a recording's scrubber
  onText?: (text: string) => void; // every change, so the host can keep the draft
  onStart?: (sel: Rect) => void; // choosing a region to record: no text, Start recording instead of Save
  onSave: (text: string, crop: Rect, sel: Rect) => Promise<void>; // crop in image px, sel in display px; a rejection's message shows in the panel
  onCancel: () => void;
}) {
  const view = { w: image.w / ratio, h: image.h / ratio };
  const bounds = limit ?? { x: 0, y: 0, ...view };
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLFormElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const [sel, setSel] = useState<Rect | null>(initial ?? null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [place, setPlace] = useState<{ x: number; y: number; docked: boolean } | null>(null);
  const [panelSize, setPanelSize] = useState<Size | null>(null);
  const [panelAt, setPanelAt] = useState<{ x: number; y: number } | null>(null); // where the developer dragged a docked panel
  const [grip, setGrip] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState(initialText);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const crop = sel && toImage(sel, ratio, image);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => root.current?.focus(), []);

  // The panel's real size: none while its dialog is still closed (a selection given up front is there before the
  // dialog opens), and it grows when a warning or an error shows. Placing it with a stale size put it out of view.
  const hasPanel = !!sel;
  useLayoutEffect(() => {
    const p = panel.current;
    if (!p) return setPanelSize(null);
    const measure = () => {
      const [w, h] = [p.offsetWidth, p.offsetHeight];
      setPanelSize((old) => (!w || !h ? null : old?.w === w && old.h === h ? old : { w, h }));
    };
    measure(); // now, when the panel already shows: the textarea is focused before the next key arrives
    const ro = new ResizeObserver(measure); // and whenever it changes: its dialog opening, a warning showing
    ro.observe(p);
    return () => ro.disconnect();
  }, [hasPanel]);
  // The panel is placed once a selection settles (not during a drag, which would make it jitter), and again when its
  // size changes.
  useLayoutEffect(() => {
    if (!sel || drag || !panelSize) return;
    const s = stage.current!.getBoundingClientRect();
    setPlace(placePanel({ x: s.left + sel.x, y: s.top + sel.y, w: sel.w, h: sel.h }, panelSize, { w: innerWidth, h: innerHeight }));
  }, [sel, drag, panelSize]);
  // The textarea takes focus when the panel first shows; dragging the selection afterwards never takes it away.
  const shown = !!place;
  useEffect(() => {
    if (shown) (onStart ? startButton : textarea).current?.focus();
  }, [shown]);

  const at = (e: PointerEvent) => {
    const s = stage.current!.getBoundingClientRect();
    return { x: e.clientX - s.left, y: e.clientY - s.top };
  };
  const all = () => setSel(bounds);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no focus change: typing goes on in the textarea
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = e.target as HTMLElement;
    const handle = t.dataset.handle as Handle | undefined;
    const kind = handle ?? (sel && t.closest(".jo-sel") ? "move" : "new");
    setDrag({ kind, from: at(e), orig: sel, moved: false });
  };
  const moveTo = (e: PointerEvent) => {
    if (!drag) return;
    const p = at(e);
    const [dx, dy] = [p.x - drag.from.x, p.y - drag.from.y];
    const moved = drag.moved || Math.hypot(dx, dy) >= CLICK;
    if (moved !== drag.moved) setDrag({ ...drag, moved });
    if (!moved) return;
    if (drag.kind === "new") setSel(fromPoints(drag.from, p, bounds));
    else if (drag.kind === "move") setSel(move(drag.orig!, dx, dy, bounds));
    else setSel(resize(drag.orig!, drag.kind, dx, dy, bounds));
  };
  const up = () => {
    if (!drag) return;
    // A click, or a drag too small to mean anything, takes the whole image.
    if (drag.kind === "new" && (!drag.moved || !sel || sel.w < MIN || sel.h < MIN)) all();
    setDrag(null);
  };

  const cancel = () => {
    if (text.trim() && !confirming) return setConfirming(true);
    onCancel();
  };
  const save = async () => {
    if (!crop || !text.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(text, crop, sel!);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the page or app behind never sees a key meant for the overlay
    const typing = (e.target as HTMLElement).tagName === "TEXTAREA";
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      e.preventDefault();
      return cancel();
    }
    if (confirming) setConfirming(false);
    if (e.key === "Enter" && mod) {
      e.preventDefault();
      return void save();
    }
    if (typing) return;
    if (e.key === "Enter" && onStart && sel) {
      e.preventDefault();
      return onStart(sel);
    }
    if (e.key.toLowerCase() === "a" && !e.altKey) {
      e.preventDefault();
      return all();
    }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (arrow && sel && (e.target as HTMLElement).classList.contains("jo-sel")) {
      e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      const [dx, dy] = [arrow[0] * n, arrow[1] * n];
      setSel(e.altKey ? resize(sel, dx ? "e" : "s", dx, dy, bounds) : move(sel, dx, dy, bounds));
    } else if (e.key === "Enter" && sel && (e.target as HTMLElement).classList.contains("jo-sel")) {
      e.preventDefault();
      textarea.current?.focus();
    }
  };

  const gripDown = (e: PointerEvent<HTMLElement>) => {
    if (!place?.docked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = panelAt ?? place;
    setGrip({ x: e.clientX - at.x, y: e.clientY - at.y });
  };
  const gripMove = (e: PointerEvent) => grip && setPanelAt({ x: e.clientX - grip.x, y: e.clientY - grip.y });

  const pos = panelAt ?? place;
  const size = crop ? `${crop.w} × ${crop.h} px` : "";
  return (
    <div className="jo" ref={root} tabIndex={-1} onKeyDown={key}>
      <div className="jo-hint" role="toolbar" aria-label={title}>
        <span className="jo-title">{title}</span>
        <span>Drag to select · click or <kbd>A</kbd> for the whole {whole} · <kbd>Esc</kbd> to cancel</span>
        <button type="button" onClick={cancel}>Cancel</button>
      </div>
      <div
        className={`jo-stage ${sel ? "" : "empty"}`}
        ref={stage}
        style={{ width: view.w, height: view.h }}
        onPointerDown={down}
        onPointerMove={moveTo}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <img src={image.src} alt="" draggable={false} width={view.w} height={view.h} />
        {layer}
        {sel && (
          <div
            className="jo-sel"
            tabIndex={0}
            role="group"
            aria-roledescription="selection"
            aria-label={`Selection, ${crop!.w} by ${crop!.h} pixels, at ${crop!.x}, ${crop!.y}. Arrows move it, Option or Alt with arrows resizes it, Shift for 10.`}
            style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }}
          >
            {HANDLES.map((h) => <span key={h} className={`jo-h ${h}`} data-handle={h} aria-hidden="true" />)}
            <span className={`jo-size ${sel.y < 24 ? "inside" : ""}`} aria-hidden="true">{size}</span>
          </div>
        )}
      </div>
      {sel && (
        <form
          className={`jo-panel ${place?.docked ? "docked" : ""}`}
          ref={panel}
          style={pos ? { left: pos.x, top: pos.y } : { visibility: "hidden" }}
          aria-label={onStart ? "Record this area" : "New feedback"}
          onSubmit={(e) => (e.preventDefault(), onStart ? onStart(sel) : void save())}
        >
          <header onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={() => setGrip(null)}>
            <h2>{onStart ? "Record this area" : "New feedback"}</h2>
            <span className="jo-muted">{size}</span>
          </header>
          {extra}
          {onStart ? (
            <>
              <p className="jo-note">Up to {(MAX_FRAMES * FRAME_MS) / 1000} s, a frame every {FRAME_MS / 1000} s. Use the app as you go; {mac ? "⌥⇧R" : "Alt+Shift+R"} or Stop ends it.</p>
              <div className="jo-row">
                <button type="button" onClick={all}>Whole {whole}</button>
                <span className="jo-grow" />
                <button type="button" onClick={cancel}>Cancel</button>
                <button type="submit" className="primary" ref={startButton}>Start recording <kbd>↩</kbd></button>
              </div>
            </>
          ) : (
            <>
              <label>
                <span>What should change?</span>
                <textarea ref={textarea} value={text} rows={4} placeholder="First line is the title in the list." onChange={(e) => (setText(e.target.value), onText?.(e.target.value), setConfirming(false))} />
              </label>
              {confirming && <p className="jo-warn" role="alert">Discard this feedback? Esc or Cancel again to discard; keep typing to keep it.</p>}
              {error && <p className="jo-error" role="alert">{error}</p>}
              <div className="jo-row">
                <button type="button" onClick={all}>Whole {whole}</button>
                <span className="jo-grow" />
                <button type="button" onClick={cancel}>Cancel</button>
                <button type="submit" className="primary" disabled={!text.trim() || saving} aria-keyshortcuts={mac ? "Meta+Enter" : "Control+Enter"}>
                  {saving ? "Saving…" : "Save"} <kbd>{mac ? "⌘↩" : "Ctrl+↩"}</kbd>
                </button>
              </div>
            </>
          )}
        </form>
      )}
      <div className="jo-sr" aria-live="polite">{sel && !drag ? size : ""}</div>
    </div>
  );
}
