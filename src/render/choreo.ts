// The crossing illusion, as math. Both screens place their windows in one shared "global" pixel
// space and evaluate the same hop curve in it; each one simply draws the part that falls inside
// its own rectangle. On one laptop that space is the real screen (windows side by side line up
// to the pixel). Across phones it is a virtual layout: the destination sits flush against the
// chosen edge with a bezel gap, vertically centred, which is how people actually hold two phones.
//
// Engineering truth (VISION.md): two local renders coordinated by messages. This file is the
// contract that keeps them agreeing.

import type { Edge } from '../core/brain';
import type { ScreenRect } from '../protocol/messages';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** Physical bezel gap between two phones, in CSS px (~2 bezels + air ≈ 8 mm ≈ 48 px). */
export const BEZEL_PX = 48;

/** True when both rects are windows on the same physical display, so screen coordinates agree. */
export function sharedScreen(a: ScreenRect | null, b: ScreenRect | null): boolean {
  return !!a && !!b && a.fine && b.fine && a.sw === b.sw && a.sh === b.sh;
}

/** Which edge of `src` faces `dst`. Only left/right in this slice (phones side by side). */
export function facingEdge(src: ScreenRect | null, dst: ScreenRect | null): Edge {
  if (!sharedScreen(src, dst)) return 'right';
  return dst!.x + dst!.w / 2 >= src!.x + src!.w / 2 ? 'right' : 'left';
}

/** Place both windows in one global space. Deterministic: both peers compute the same answer. */
export function layout(src: ScreenRect, dst: ScreenRect, edge: Edge): { src: Rect; dst: Rect } {
  if (sharedScreen(src, dst)) return { src: rectOf(src), dst: rectOf(dst) };
  const s: Rect = { x: 0, y: 0, w: src.w, h: src.h };
  const y = (src.h - dst.h) / 2;
  const d: Rect = edge === 'left' ? { x: -BEZEL_PX - dst.w, y, w: dst.w, h: dst.h } : { x: src.w + BEZEL_PX, y, w: dst.w, h: dst.h };
  return { src: s, dst: d };
}

const rectOf = (r: ScreenRect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });

/** Where a creature entering through `edge` of `r` lands: a little inside, on the ground band. */
export function landing(r: Rect, entryEdge: Edge, nearY: number): Pt {
  const inset = Math.min(r.w * 0.3, 170);
  const x = entryEdge === 'left' ? r.x + inset : r.x + r.w - inset;
  const y = Math.min(r.y + r.h * 0.72, Math.max(r.y + r.h * 0.5, nearY));
  return { x, y };
}

export interface Hop {
  from: Pt;
  to: Pt;
  /** Peak height in world units. */
  peak: number;
}

export const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

/**
 * Evaluate the hop at u ∈ [0, 1]. Horizontal motion eases in and out (anticipation, then
 * settle); height is a parabola, so the seam is crossed airborne, which hides latency and bezels.
 */
export function hopAt(h: Hop, u: number): { p: Pt; height: number } {
  const k = ease(Math.max(0, Math.min(1, u)));
  return {
    p: { x: h.from.x + (h.to.x - h.from.x) * k, y: h.from.y + (h.to.y - h.from.y) * k },
    height: 4 * h.peak * u * (1 - u),
  };
}

/** Global → local CSS px for the window at `r`. */
export const toLocal = (p: Pt, r: Rect): Pt => ({ x: p.x - r.x, y: p.y - r.y });
export const toGlobal = (p: Pt, r: Rect): Pt => ({ x: p.x + r.x, y: p.y + r.y });

/** The crossing hop from the source's start point to the destination landing, in global px. */
export function crossingHop(src: ScreenRect, dst: ScreenRect, edge: Edge, fromLocal: Pt): Hop {
  const L = layout(src, dst, edge);
  const from = toGlobal(fromLocal, L.src);
  const entry: Edge = edge === 'right' ? 'left' : 'right';
  const to = landing(L.dst, entry, from.y);
  const dist = Math.abs(to.x - from.x);
  return { from, to, peak: Math.min(1.6, 0.55 + dist / 900) };
}

/** Fallback when a peer's rect is unknown: assume a same-size phone next door. */
export function guessRect(own: ScreenRect): ScreenRect {
  return { ...own, x: own.x + own.w + BEZEL_PX, fine: false };
}
