// Capturing feedback (D36, D37): the full-window lightboxes that capture feedback with the overlay, on an evidence image
// or on what a closed Live window left unsaved; the toast a save leaves; and the flipbook that plays a recording back.
// Live captures happen in the Live window.
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Rect } from "../overlay/geometry.js";
import { cropPng, Overlay } from "../overlay/Overlay.js";
import type { WindowState } from "../window.js";
import { evidenceUrl } from "./run.js";
import { CopyButton } from "./ui.js";

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

// The Live window, through the sidecar: open, close, stop a recording, finish or let go of a draft.
export async function windowApi(body: { action: string; text?: string; pngs?: string[] }): Promise<{ id?: string }> {
  const res = await fetch("/api/window", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? res.statusText);
  return out;
}

// Room around an image for the hint bar (top) and a margin; never enlarged past 100 %.
const fit = (w: number, h: number) => Math.max(1, w / (innerWidth - 48), h / (innerHeight - 120));
const decoded = async (src: string) => {
  const i = new Image();
  i.src = src;
  await i.decode();
  return i;
};

// Feedback on an evidence image: the image at 100 % (fitted when larger than the window) under the overlay, in a modal
// dialog so the finding page behind takes no keys. The back-reference is fixed when it opens.
export function EvidenceLightbox({ run, evidence, finding, onClose, onSaved }: { run: string; evidence: string; finding: string; onClose: () => void; onSaved: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [img, setImg] = useState<HTMLImageElement>();
  useEffect(() => {
    dialog.current?.showModal();
    const i = new Image(); // same-origin, so the crop canvas is not tainted
    i.src = evidenceUrl(run, evidence);
    i.decode().then(() => setImg(i), () => dialog.current?.close());
  }, [run, evidence]);
  const ratio = img ? fit(img.naturalWidth, img.naturalHeight) : 1;
  const save = async (text: string, r: Rect) => {
    const out = await feedbackApi("POST", undefined, { text, capture: "snap", frames: [{ png: cropPng(img!, r), ms: 0 }], source: "evidence", run, evidence, finding });
    onSaved(out.id);
    dialog.current?.close();
  };
  return (
    <dialog ref={dialog} className="lightbox" aria-label={`Feedback on ${evidence}`} onCancel={(e) => e.preventDefault()} onClose={onClose}>
      {img && (
        <Overlay
          image={{ src: img.src, w: img.naturalWidth, h: img.naturalHeight }}
          ratio={ratio}
          title={`${evidence} · ${img.naturalWidth} × ${img.naturalHeight}${ratio > 1 ? ` · ${Math.round(100 / ratio)} %` : ""}`}
          whole="image"
          onSave={save}
          onCancel={() => dialog.current?.close()}
        />
      )}
    </dialog>
  );
}

// What a closed Live window left unsaved, finished here: its frozen frame, or its recording with a scrubber, under the
// overlay with the text it had. Cancel keeps the draft on offer; the Live page's Discard lets it go.
export function DraftLightbox({ draft, onClose, onSaved }: { draft: NonNullable<WindowState["draft"]>; onClose: () => void; onSaved: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [imgs, setImgs] = useState<HTMLImageElement[]>();
  const [i, setI] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
    Promise.all(Array.from({ length: draft.frames }, (_, n) => decoded(`/api/window/draft/${n}.png`))).then(setImgs, () => dialog.current?.close());
  }, [draft.frames]);
  const first = imgs?.[0];
  const ratio = first ? fit(first.naturalWidth, first.naturalHeight) : 1;
  const save = async (text: string, r: Rect) => {
    const whole = r.x === 0 && r.y === 0 && r.w === first!.naturalWidth && r.h === first!.naturalHeight;
    const out = await windowApi({ action: "save-draft", text, ...(!whole && { pngs: imgs!.map((img) => cropPng(img, r)) }) });
    onSaved(out.id!);
    dialog.current?.close();
  };
  const recording = draft.capture === "recording" && imgs;
  return (
    <dialog ref={dialog} className="lightbox" aria-label="Unsaved feedback" onCancel={(e) => e.preventDefault()} onClose={onClose}>
      {first && (
        <Overlay
          image={{ src: first.src, w: first.naturalWidth, h: first.naturalHeight }}
          ratio={ratio}
          title={`Unsaved ${draft.capture === "snap" ? "snap" : `recording · ${draft.frames} frames`} · ${first.naturalWidth} × ${first.naturalHeight}`}
          whole={draft.capture === "snap" ? "image" : "recording"}
          initialText={draft.text}
          layer={recording && <img className="jo-layer" src={imgs[i].src} alt="" style={{ left: 0, top: 0, width: first.naturalWidth / ratio, height: first.naturalHeight / ratio }} />}
          extra={
            recording && (
              <div className="jo-scrub">
                <input type="range" min={0} max={imgs.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Frame" />
                <span>{i + 1} / {imgs.length}</span>
              </div>
            )
          }
          onSave={save}
          onCancel={() => dialog.current?.close()}
        />
      )}
    </dialog>
  );
}

// What a save leaves behind: the id and the prompt to give Claude, for a few seconds.
export function SavedToast({ id, onDone }: { id: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 8000);
    return () => clearTimeout(t);
  }, [id, onDone]);
  return (
    <div className="toast" role="status">
      <span>Saved <Link to="/feedback/$feedbackId" params={{ feedbackId: id }}>{id}</Link></span>
      <code>{prompt(id)}</code>
      <CopyButton text={prompt(id)} label="Copy prompt" />
      <button type="button" className="btn ghost" aria-label="Dismiss" onClick={onDone}>×</button>
    </div>
  );
}

// A recording played back at its real timing on the item's stage: each frame stays up until the next one's ms.
// Play, the time, the frame number, and a strip with one mark per frame (the current one in frost); the strip is a
// slider for the keyboard (arrow keys, Home, End).
export function Flipbook({ frames, alt }: { frames: { file: string; ms: number }[]; alt: string }) {
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
  const to = (n: number) => (setPlaying(false), setI(Math.max(0, Math.min(frames.length - 1, n))));
  const keys: Record<string, number> = { ArrowLeft: i - 1, ArrowDown: i - 1, ArrowRight: i + 1, ArrowUp: i + 1, Home: 0, End: frames.length - 1 };
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  return (
    <>
      <img src={captureUrl(frames[i].file)} alt={`Frame ${i + 1} of ${frames.length} of ${alt}`} />
      {/* Every frame loaded up front, so playback does not stall on the network. */}
      <div hidden>{frames.map((f) => <img key={f.file} src={captureUrl(f.file)} alt="" />)}</div>
      <div className="scrub">
        <button type="button" className="btn" onClick={play} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
        <span>{s(frames[i].ms)} / {s(frames[frames.length - 1].ms)}</span>
        <span className="grow" />
        <span>frame {i + 1} of {frames.length}</span>
      </div>
      <div
        className="film"
        role="slider"
        tabIndex={0}
        aria-label="Frame"
        aria-valuemin={1}
        aria-valuemax={frames.length}
        aria-valuenow={i + 1}
        onKeyDown={(e) => e.key in keys && (e.preventDefault(), to(keys[e.key]))}
      >
        {frames.map((f, n) => <i key={f.file} className={n === i ? "on" : ""} onClick={() => to(n)} />)}
      </div>
    </>
  );
}
