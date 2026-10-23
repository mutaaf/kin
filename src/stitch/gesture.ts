// Detects the two halves of a stitch on this screen:
//   out: a fast swipe that leaves through the left/right edge (finger lifts at the edge)
//   in:  a touch that begins at the left/right edge and moves inward
// Reports the moment and height of the edge crossing. Pure DOM, no permissions.

export interface StitchHalf {
  dir: 'out' | 'in';
  edge: 'left' | 'right';
  y: number;
  /** performance.now() at the edge crossing. */
  at: number;
  /** px/ms at the edge. */
  v: number;
}

const EDGE_PX = 30;
const MIN_V = 0.35; // px/ms: a deliberate flick, not a slow drag that happens to end at the edge

export function watchStitch(el: HTMLElement, cb: (h: StitchHalf) => void): () => void {
  let track: { id: number; pts: { x: number; y: number; t: number }[]; startEdge: 'left' | 'right' | null } | null = null;

  const down = (e: PointerEvent) => {
    const w = el.clientWidth;
    const startEdge = e.clientX <= EDGE_PX ? 'left' : e.clientX >= w - EDGE_PX ? 'right' : null;
    track = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }], startEdge };
  };
  const move = (e: PointerEvent) => {
    if (!track || e.pointerId !== track.id) return;
    track.pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (track.pts.length > 12) track.pts.shift();
    // in: started at an edge and is clearly moving inward
    if (track.startEdge) {
      const p0 = track.pts[0]!;
      const dx = e.clientX - p0.x;
      const inward = track.startEdge === 'left' ? dx > 24 : dx < -24;
      if (inward) {
        const v = Math.abs(dx) / Math.max(1, e.timeStamp - p0.t);
        cb({ dir: 'in', edge: track.startEdge, y: p0.y, at: p0.t, v });
        track.startEdge = null;
      }
    }
  };
  const up = (e: PointerEvent) => {
    if (!track || e.pointerId !== track.id) return;
    const pts = track.pts;
    track = null;
    if (pts.length < 3) return;
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    const w = el.clientWidth;
    const edge = b.x >= w - EDGE_PX ? 'right' : b.x <= EDGE_PX ? 'left' : null;
    if (!edge) return;
    const recent = pts[Math.max(0, pts.length - 4)]!;
    const v = Math.abs(b.x - recent.x) / Math.max(1, b.t - recent.t);
    const travelled = Math.abs(b.x - a.x);
    const heading = edge === 'right' ? b.x - recent.x > 0 : b.x - recent.x < 0;
    if (v < MIN_V || travelled < 80 || !heading) return;
    cb({ dir: 'out', edge, y: b.y, at: b.t, v });
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
