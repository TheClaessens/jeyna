// Capturing feedback (D36, D37): the full-window lightbox that captures feedback on an evidence image with the overlay,
// the toast a save leaves, and the flipbook that plays a recording back. Live captures happen in the Live window.
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Rect } from "../overlay/geometry.js";
import { cropPng, Overlay } from "../overlay/Overlay.js";
import { evidenceUrl } from "./run.js";
import { CopyButton, CopyIcon } from "./ui.js";

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
  // Room around the image for the hint bar (top) and a margin; never enlarged past 100 %.
  const ratio = img ? Math.max(1, img.naturalWidth / (innerWidth - 48), img.naturalHeight / (innerHeight - 120)) : 1;
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
      <CopyButton text={prompt(id)} label="Copy prompt" icon={<CopyIcon />} />
      <button type="button" className="btn icon" aria-label="Dismiss" onClick={onDone}>×</button>
    </div>
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
