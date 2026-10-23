// Stitch matching: pairing that nobody can see. One finger slides off the edge of screen A and
// onto screen B. A reports "out at my right edge, height yA, at time t"; B reports "in at my left
// edge, height yB, at t′". If exactly one such pair lines up in time, they're paired, and the
// same gesture calibrates the seam (which edges touch, how the screens are offset vertically).
// No camera, no microphone, no visible code, no permission prompt.
// (Ideas: Hinckley's "Stitching" pen gestures, 2004; Bump's time-correlated matching, 2009.)
// Pure, shared by the relay Worker and the tests.

export type StitchEdge = 'left' | 'right';

export interface StitchEvent {
  peer: string;
  dir: 'out' | 'in';
  edge: StitchEdge;
  /** CSS px from the top of the reporting screen where the finger crossed the edge. */
  y: number;
  /** Server-time of the crossing (receive time − client-reported age). */
  t: number;
  /** Swipe speed at the edge, px/ms. Used to predict the bezel-crossing delay. */
  v: number;
}

export interface Pairing {
  out: StitchEvent;
  in: StitchEvent;
  /** in-screen top relative to out-screen top, in CSS px (B.y − A.y in a shared layout). */
  dy: number;
}

/** A finger needs ~20–250 ms to cross two bezels and the gap; allow for network jitter. */
export const WINDOW = { minMs: -180, maxMs: 650 };

const opposite = (e: StitchEdge): StitchEdge => (e === 'left' ? 'right' : 'left');

/**
 * Try to match `ev` against the pending events. Returns the pairing when exactly one candidate
 * fits, `ambiguous` when several do (two pairs of people swiping at once: ask them to retry),
 * or null to keep waiting.
 */
export function matchStitch(ev: StitchEvent, pending: readonly StitchEvent[]): Pairing | 'ambiguous' | null {
  const cands = pending.filter((p) => {
    if (p.peer === ev.peer || p.dir === ev.dir || p.edge !== opposite(ev.edge)) return false;
    const [o, i] = ev.dir === 'out' ? [ev, p] : [p, ev];
    const dt = i.t - o.t;
    return dt >= WINDOW.minMs && dt <= WINDOW.maxMs;
  });
  if (cands.length === 0) return null;
  // Rank by how well the delay matches the expected bezel-crossing time at the swipe's speed.
  const score = (p: StitchEvent) => {
    const [o, i] = ev.dir === 'out' ? [ev, p] : [p, ev];
    const expected = Math.min(250, 48 / Math.max(0.2, o.v));
    return Math.abs(i.t - o.t - expected);
  };
  const ranked = cands.map((c) => [c, score(c)] as const).sort((a, b) => a[1] - b[1]);
  if (ranked.length > 1 && ranked[1]![1] - ranked[0]![1] < 120) return 'ambiguous';
  const best = ranked[0]![0];
  const [o, i] = ev.dir === 'out' ? [ev, best] : [best, ev];
  return { out: o, in: i, dy: o.y - i.y };
}
