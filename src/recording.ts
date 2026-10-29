// Recording limits (D36), shared by the studio page that samples frames and feedback.ts that checks them.
// No imports, so the browser bundle can load it without pulling in node:fs.
export const FRAME_MS = 500;
// ponytail: 40 frames at 500 ms covers a 20 s recording; raise it if that proves coarse.
export const MAX_FRAMES = 40;
