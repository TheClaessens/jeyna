// Capturing feedback (D36): the editor that crops one frame (a snap) or every frame of a recording to one rectangle,
// takes the developer's text and saves the item through the sidecar; and the flipbook that plays a recording back.
import { Link } from "@tanstack/react-router";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import type { NewFeedback } from "../../feedback.js";
import { CopyButton, CopyIcon } from "./ui.js";

// One frame to crop: an evidence <img> or a canvas grabbed from the screen share, at its natural size.
export type Frame = { src: CanvasImageSource; w: number; h: number; ms: number };
export type Rect = { x: number; y: number; w: number; h: number };
type Origin = Pick<NewFeedback, "source" | "run" | "evidence" | "finding">;

export const captureUrl = (file: string) => `/feedback-files/${encodeURIComponent(file)}`;
export const prompt = (id?: string) => (id ? `/jeyna:feedback ${id}` : "/jeyna:feedback");

// The studio's own page is the only origin the sidecar accepts writes from; fetch sends Origin itself.
export async function feedbackApi(method: "POST" | "PATCH" | "DELETE", id: string | undefined, data?: unknown) {
  const res = await fetch(id ? `/api/feedback/${encodeURIComponent(id)}` : "/api/feedback", {
    method,
    headers: { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? res.statusText);
  return out;
}

function crop(f: Frame, r: Rect): string {
  const c = document.createElement("canvas");
  c.width = Math.round(r.w);
  c.height = Math.round(r.h);
  c.getContext("2d")!.drawImage(f.src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c.toDataURL("image/png").slice("data:image/png;base64,".length);
}

export function CaptureEditor({ frames, initial, origin, onClose }: { frames: Frame[]; initial?: Rect | null; origin: Origin; onClose: () => void }) {
  const first = frames[0];
  const dialog = useRef<HTMLDialogElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState<Rect | null>(initial ?? null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string>();

  useEffect(() => {
    dialog.current?.showModal();
    const c = view.current!;
    c.width = first.w;
    c.height = first.h;
    c.getContext("2d")!.drawImage(first.src, 0, 0);
  }, [first]);

  // Pointer position in the frame's own pixels, whatever size the canvas is drawn at.
  const at = (e: PointerEvent) => {
    const b = view.current!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    return { x: clamp(((e.clientX - b.left) * first.w) / b.width, first.w), y: clamp(((e.clientY - b.top) * first.h) / b.height, first.h) };
  };
  const down = (e: PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = at(e);
    setDrag(p);
    setRect({ ...p, w: 0, h: 0 });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const p = at(e);
    setRect({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) });
  };
  const up = () => {
    setDrag(null);
    if (rect && (rect.w < 8 || rect.h < 8)) setRect(null); // a click, not a drag: the whole frame
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = rect ?? { x: 0, y: 0, w: first.w, h: first.h };
      const capture = frames.length > 1 ? "recording" : "snap";
      const out = await feedbackApi("POST", undefined, { text, capture, frames: frames.map((f) => ({ png: crop(f, r), ms: Math.round(f.ms) })), ...origin });
      setSaved(out.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const kind = frames.length > 1 ? `recording · ${frames.length} frames` : "snap";
  return (
    <dialog ref={dialog} className="capture" onClose={onClose} aria-label="New feedback">
      {saved ? (
        <div className="saved">
          <h2>Saved {saved}</h2>
          <p className="muted">Give Claude this prompt to work on it:</p>
          <div className="row">
            <code>{prompt(saved)}</code>
            <CopyButton text={prompt(saved)} label="Copy prompt" icon={<CopyIcon />} />
          </div>
          <div className="row">
            <Link to="/feedback/$feedbackId" params={{ feedbackId: saved }} className="btn">Open {saved}</Link>
            <button type="button" className="btn primary" onClick={() => dialog.current?.close()} autoFocus>Done</button>
          </div>
        </div>
      ) : (
        <form method="dialog" onSubmit={(e) => (e.preventDefault(), save())}>
          <header>
            <h2>New feedback</h2>
            <span className="muted">{kind} · {rect ? `${Math.round(rect.w)} × ${Math.round(rect.h)} px` : `whole frame, ${first.w} × ${first.h} px`}</span>
          </header>
          <p className="muted">Drag over the image to keep only part of it{frames.length > 1 ? "; the crop applies to every frame" : ""}. A click keeps the whole frame.</p>
          <div className="stage">
            <canvas ref={view} onPointerDown={down} onPointerMove={move} onPointerUp={up} />
            {rect && rect.w > 0 && (
              <div className="sel" style={{ left: pct(rect.x, first.w), top: pct(rect.y, first.h), width: pct(rect.w, first.w), height: pct(rect.h, first.h) }} />
            )}
          </div>
          <label className="text">
            <span>What should change?</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus placeholder="The first line is the item's title in the list." />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row end">
            {rect && <button type="button" className="btn" onClick={() => setRect(null)}>Whole frame</button>}
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!text.trim() || saving}>{saving ? "Saving…" : "Save feedback"}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

// A recording played back at its real timing: each frame stays up until the next one's ms.
export function Flipbook({ frames }: { frames: { file: string; ms: number }[] }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (i >= frames.length - 1) return setPlaying(false);
    const t = setTimeout(() => setI(i + 1), frames[i + 1].ms - frames[i].ms);
    return () => clearTimeout(t);
  }, [playing, i, frames]);
  const play = () => {
    if (i >= frames.length - 1) setI(0);
    setPlaying(!playing);
  };
  return (
    <div className="flipbook">
      <img src={captureUrl(frames[i].file)} alt={`Frame ${i + 1} of ${frames.length}`} />
      {/* Every frame loaded up front, so playback does not stall on the network. */}
      <div hidden>{frames.map((f) => <img key={f.file} src={captureUrl(f.file)} alt="" />)}</div>
      <div className="row">
        <button type="button" className="btn" onClick={play}>{playing ? "Pause" : "Play"}</button>
        <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => (setPlaying(false), setI(Number(e.target.value)))} aria-label="Frame" />
        <span className="mono muted">{i + 1} / {frames.length} · {(frames[i].ms / 1000).toFixed(1)} s</span>
      </div>
    </div>
  );
}
