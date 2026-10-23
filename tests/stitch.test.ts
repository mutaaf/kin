import { describe, expect, it } from 'vitest';
import { matchStitch, type StitchEvent } from '../src/stitch/match';

const ev = (p: Partial<StitchEvent>): StitchEvent => ({ peer: 'a', dir: 'out', edge: 'right', y: 400, t: 1000, v: 0.8, ...p });

describe('stitch matching', () => {
  it('pairs an out-swipe with the in-swipe that follows across the facing edge, and calibrates dy', () => {
    const out = ev({ peer: 'a', y: 420 });
    const r = matchStitch(ev({ peer: 'b', dir: 'in', edge: 'left', y: 380, t: 1080 }), [out]);
    expect(r).not.toBe('ambiguous');
    expect(r && r !== 'ambiguous' && r.dy).toBe(40);
  });

  it('ignores the wrong edge, the wrong order and stale swipes', () => {
    expect(matchStitch(ev({ peer: 'b', dir: 'in', edge: 'right', t: 1080 }), [ev({})])).toBeNull();
    expect(matchStitch(ev({ peer: 'b', dir: 'in', edge: 'left', t: 600 }), [ev({})])).toBeNull();
    expect(matchStitch(ev({ peer: 'b', dir: 'in', edge: 'left', t: 2200 }), [ev({})])).toBeNull();
  });

  it('refuses to guess when two pairs swipe at the same moment', () => {
    const r = matchStitch(ev({ peer: 'c', dir: 'in', edge: 'left', t: 1090 }), [ev({ peer: 'a' }), ev({ peer: 'b', t: 1010 })]);
    expect(r).toBe('ambiguous');
  });

  it('never pairs a device with itself', () => {
    expect(matchStitch(ev({ peer: 'a', dir: 'in', edge: 'left', t: 1050 }), [ev({ peer: 'a' })])).toBeNull();
  });
});
