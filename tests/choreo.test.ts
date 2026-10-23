import { describe, expect, it } from 'vitest';
import { BEZEL_PX, crossingHop, facingEdge, hopAt, layout, sharedScreen, toLocal } from '../src/render/choreo';
import type { ScreenRect } from '../src/protocol/messages';

const win = (x: number, w = 600, h = 800, fine = true): ScreenRect => ({ x, y: 40, w, h, sw: 1728, sh: 1117, fine });

describe('choreography', () => {
  it('uses real screen geometry for two desktop windows and finds the facing edge', () => {
    const a = win(0);
    const b = win(620);
    expect(sharedScreen(a, b)).toBe(true);
    expect(facingEdge(a, b)).toBe('right');
    expect(facingEdge(b, a)).toBe('left');
  });

  it('lays out phones side by side with a bezel gap, vertically centred', () => {
    const a = win(0, 390, 844, false);
    const b = win(0, 412, 915, false);
    const L = layout(a, b, 'right');
    expect(L.dst.x).toBe(390 + BEZEL_PX);
    expect(L.dst.y).toBeCloseTo((844 - 915) / 2);
  });

  it('both peers evaluate the identical arc and the seam is crossed airborne', () => {
    const a = win(0, 390, 844, false);
    const b = win(0, 390, 844, false);
    const fromLocal = { x: 330, y: 560 };
    const hopA = crossingHop(a, b, 'right', fromLocal);
    const hopB = crossingHop(a, b, 'right', fromLocal); // computed on the other device from the same message
    expect(hopB).toEqual(hopA);
    // find where the arc crosses the source's right edge
    let seamU = 0;
    for (let u = 0; u <= 1; u += 0.001) if (hopAt(hopA, u).p.x >= 390) { seamU = u; break; }
    expect(seamU).toBeGreaterThan(0.1);
    expect(seamU).toBeLessThan(0.9);
    expect(hopAt(hopA, seamU).height).toBeGreaterThan(hopA.peak * 0.5);
    // landing lies inside the destination window
    const L = layout(a, b, 'right');
    const land = toLocal(hopAt(hopA, 1).p, L.dst);
    expect(land.x).toBeGreaterThan(0);
    expect(land.x).toBeLessThan(390);
  });
});
