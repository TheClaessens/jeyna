// The capture overlay's geometry (D37), pure so it is tested apart from the DOM. A selection lives in display px (CSS
// px over the frozen frame or the evidence image); `ratio` is image px per display px (the window's dpr, or a fitted
// image's scale).
export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

// The selection in the image's own pixels: origin floored, far edge ceiled, so a fractional ratio never drops a row.
export function toImage(r: Rect, ratio: number, image: Size): Rect {
  const x = Math.max(0, Math.floor(r.x * ratio));
  const y = Math.max(0, Math.floor(r.y * ratio));
  const right = Math.min(image.w, Math.ceil((r.x + r.w) * ratio));
  const bottom = Math.min(image.h, Math.ceil((r.y + r.h) * ratio));
  return { x, y, w: right - x, h: bottom - y };
}

export const MIN = 8; // smallest selection side; a smaller drag is a click
export type Handle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// The selection always stays inside `limit`: the whole image, or the region a recording holds.

// A drag from one corner to the other.
export function fromPoints(a: { x: number; y: number }, b: { x: number; y: number }, limit: Rect): Rect {
  const [ax, bx] = [clamp(a.x, limit.x, limit.x + limit.w), clamp(b.x, limit.x, limit.x + limit.w)];
  const [ay, by] = [clamp(a.y, limit.y, limit.y + limit.h), clamp(b.y, limit.y, limit.y + limit.h)];
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

export function move(r: Rect, dx: number, dy: number, limit: Rect): Rect {
  return { ...r, x: clamp(r.x + dx, limit.x, limit.x + limit.w - r.w), y: clamp(r.y + dy, limit.y, limit.y + limit.h - r.h) };
}

// Moves the edges a handle holds; the opposite edges stay, and no side gets under MIN.
export function resize(r: Rect, handle: Handle, dx: number, dy: number, limit: Rect): Rect {
  let [left, top, right, bottom] = [r.x, r.y, r.x + r.w, r.y + r.h];
  if (handle.includes("w")) left = clamp(left + dx, limit.x, right - MIN);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN, limit.x + limit.w);
  if (handle.includes("n")) top = clamp(top + dy, limit.y, bottom - MIN);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN, limit.y + limit.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const GAP = 12; // between the selection and the panel
const MARGIN = 12; // between the panel and the view's edge

// Where the text panel goes: right of the selection, else below, left, above, aligned to the selection's top or left
// edge and slid to fit. When none fits (the selection fills the view) it docks, over the selection, in the view's corner
// farthest from the selection's centre; `docked` tells the UI to give it a drag grip.
export function placePanel(sel: Rect, panel: Size, view: Size): { x: number; y: number; docked: boolean } {
  const slide = (v: number, size: number, room: number) => clamp(v, MARGIN, room - MARGIN - size);
  const right = sel.x + sel.w + GAP;
  if (right + panel.w <= view.w - MARGIN) return { x: right, y: slide(sel.y, panel.h, view.h), docked: false };
  const below = sel.y + sel.h + GAP;
  if (below + panel.h <= view.h - MARGIN) return { x: slide(sel.x, panel.w, view.w), y: below, docked: false };
  const left = sel.x - GAP - panel.w;
  if (left >= MARGIN) return { x: left, y: slide(sel.y, panel.h, view.h), docked: false };
  const above = sel.y - GAP - panel.h;
  if (above >= MARGIN) return { x: slide(sel.x, panel.w, view.w), y: above, docked: false };

  const cx = sel.x + sel.w / 2;
  const cy = sel.y + sel.h / 2;
  const corners = [MARGIN, view.w - MARGIN - panel.w].flatMap((x) => [MARGIN, view.h - MARGIN - panel.h].map((y) => ({ x, y })));
  const far = (p: { x: number; y: number }) => (p.x + panel.w / 2 - cx) ** 2 + (p.y + panel.h / 2 - cy) ** 2;
  const best = corners.reduce((a, b) => (far(b) > far(a) ? b : a));
  return { ...best, docked: true };
}

// Where the recording timer goes: outside the region on the same sides as the panel, so it is never in a frame. When the
// region leaves no room (the whole window), it docks in the corner of the edge farther from the region's centre, and the
// region is trimmed to stop GAP short of it.
export function placeHud(region: Rect, hud: Size, view: Size): { x: number; y: number; region: Rect } {
  const p = placePanel(region, hud, view);
  if (!p.docked) return { x: p.x, y: p.y, region };
  const x = view.w - MARGIN - hud.w;
  if (region.y + region.h / 2 <= view.h / 2) {
    const y = view.h - MARGIN - hud.h;
    return { x, y, region: { ...region, h: Math.min(region.h, y - GAP - region.y) } };
  }
  const y = MARGIN;
  const top = Math.max(region.y, y + hud.h + GAP);
  return { x, y, region: { ...region, y: top, h: region.y + region.h - top } };
}
