// The capture overlay's geometry (D37): the selection in display px, what it becomes in the image's own pixels,
// and where the text panel goes. Expected values are worked by hand.
import { expect, test } from "vitest";
import { fromPoints, move, placeHud, placePanel, resize, toImage } from "./geometry.js";

test("a selection becomes whole image pixels rounded outward, so a fractional ratio never drops a row; clamped to the image", () => {
  // 10.3 × 1.5 = 15.45 → 15; 5.5 × 1.5 = 8.25 → 8; right (10.3 + 100.2) × 1.5 = 165.75 → 166; bottom 25.5 × 1.5 = 38.25 → 39.
  expect(toImage({ x: 10.3, y: 5.5, w: 100.2, h: 20 }, 1.5, { w: 400, h: 300 })).toEqual({ x: 15, y: 8, w: 151, h: 31 });
  expect(toImage({ x: 10.3, y: 5.5, w: 100.2, h: 20 }, 1.5, { w: 160, h: 30 })).toEqual({ x: 15, y: 8, w: 145, h: 22 });
  expect(toImage({ x: 0, y: 0, w: 756, h: 430 }, 2, { w: 1512, h: 860 })).toEqual({ x: 0, y: 0, w: 1512, h: 860 });
});

test("the panel goes right of the selection, else below, left, above, slid to fit; docked in the far corner when nothing fits", () => {
  const panel = { w: 320, h: 200 };
  const view = { w: 1000, h: 800 }; // 12 px gap to the selection, 12 px margin to the view
  expect(placePanel({ x: 100, y: 100, w: 200, h: 100 }, panel, view)).toEqual({ x: 312, y: 100, docked: false });
  expect(placePanel({ x: 100, y: 700, w: 100, h: 50 }, panel, view)).toEqual({ x: 212, y: 588, docked: false }); // right, slid up
  expect(placePanel({ x: 700, y: 100, w: 250, h: 100 }, panel, view)).toEqual({ x: 668, y: 212, docked: false }); // below, slid left
  expect(placePanel({ x: 400, y: 20, w: 580, h: 760 }, panel, view)).toEqual({ x: 68, y: 20, docked: false }); // left
  expect(placePanel({ x: 20, y: 500, w: 950, h: 280 }, panel, view)).toEqual({ x: 20, y: 288, docked: false }); // above
  // Centre (450, 350): the bottom-right corner's panel is the farthest from it.
  expect(placePanel({ x: 0, y: 0, w: 900, h: 700 }, panel, view)).toEqual({ x: 668, y: 588, docked: true });
});

test("a drag makes a selection from its two corners, a move and a resize keep it inside the view and at least 8 px", () => {
  const view = { x: 0, y: 0, w: 400, h: 300 };
  expect(fromPoints({ x: 300, y: 200 }, { x: 100, y: 250 }, view)).toEqual({ x: 100, y: 200, w: 200, h: 50 });
  expect(fromPoints({ x: -20, y: 10 }, { x: 450, y: 20 }, view)).toEqual({ x: 0, y: 10, w: 400, h: 10 });
  expect(move({ x: 350, y: 10, w: 40, h: 20 }, 30, -30, view)).toEqual({ x: 360, y: 0, w: 40, h: 20 });
  const r = { x: 100, y: 100, w: 50, h: 40 };
  expect(resize(r, "se", 20, -50, view)).toEqual({ x: 100, y: 100, w: 70, h: 8 });
  expect(resize(r, "nw", 60, -150, view)).toEqual({ x: 142, y: 0, w: 8, h: 140 });
  expect(resize(r, "e", 300, 99, view)).toEqual({ x: 100, y: 100, w: 300, h: 40 });
});

test("inside a recorded region, a selection stays in the region (D37)", () => {
  const region = { x: 100, y: 50, w: 200, h: 100 };
  expect(fromPoints({ x: 20, y: 20 }, { x: 150, y: 90 }, region)).toEqual({ x: 100, y: 50, w: 50, h: 40 });
  expect(move({ x: 250, y: 60, w: 40, h: 20 }, 30, 0, region)).toEqual({ x: 260, y: 60, w: 40, h: 20 });
  expect(resize({ x: 120, y: 60, w: 40, h: 20 }, "nw", -50, -50, region)).toEqual({ x: 100, y: 50, w: 60, h: 30 });
});

test("the recording timer sits outside the region; when nothing fits, it docks on the far edge and the region gives way (D37)", () => {
  const hud = { w: 220, h: 36 };
  const view = { w: 1000, h: 800 };
  const region = { x: 100, y: 100, w: 300, h: 200 };
  expect(placeHud(region, hud, view)).toEqual({ x: 412, y: 100, region });
  const lower = { x: 0, y: 300, w: 1000, h: 500 };
  expect(placeHud(lower, hud, view)).toEqual({ x: 12, y: 252, region: lower }); // above it
  // The whole window, centred: docked bottom right, the region ends 12 px above the bar.
  expect(placeHud({ x: 0, y: 0, w: 1000, h: 800 }, hud, view)).toEqual({ x: 768, y: 752, region: { x: 0, y: 0, w: 1000, h: 740 } });
  // Centre below the middle: docked at the top, the region starts 12 px under the bar.
  expect(placeHud({ x: 0, y: 50, w: 1000, h: 750 }, hud, view)).toEqual({ x: 768, y: 12, region: { x: 0, y: 60, w: 1000, h: 740 } });
});
