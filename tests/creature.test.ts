import { describe, expect, it } from 'vitest';
import { plan } from '../src/audio/voice';
import { makeGenome } from '../src/core/genome';
import { bodyGeometry, deriveForm, sdf } from '../src/render/creature/form';

describe('creature form', () => {
  it('is deterministic per seed (same creature on every device)', () => {
    const f = deriveForm(makeGenome(1234));
    const f2 = deriveForm(makeGenome(1234));
    expect(f2).toEqual(f);
    for (const [x, y, z] of [[0.1, 0.7, 0.2], [-0.2, 0.3, 0.1], [0, 0.95, 0]]) expect(sdf(f2, x!, y!, z!)).toBe(sdf(f, x!, y!, z!));
    expect(deriveForm(makeGenome(1235))).not.toEqual(f);
  });

  it('builds a closed, sane body for many seeds, quickly', () => {
    const t0 = performance.now();
    for (let seed = 1; seed <= 24; seed++) {
      const g = makeGenome(seed);
      const f = deriveForm(g);
      const { geometry } = bodyGeometry(g, f);
      const pos = geometry.getAttribute('position');
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
      }
      // Feet touch the ground, the head tops out near 1 unit, and the head is the bigger part.
      expect(minY, `seed ${seed}`).toBeGreaterThan(-0.05);
      expect(minY, `seed ${seed}`).toBeLessThan(0.06);
      expect(maxY, `seed ${seed}`).toBeGreaterThan(0.85);
      expect(maxY, `seed ${seed}`).toBeLessThan(1.15);
      expect((maxY - f.neckY) / (maxY - minY), `seed ${seed}: head share`).toBeGreaterThan(0.5);
      // The centre is inside, far away is outside.
      expect(sdf(f, 0, 0.45, 0)).toBeLessThan(0);
      expect(sdf(f, 0, 3, 0)).toBeGreaterThan(0);
    }
    // ~80 ms per body on a laptop: built once per seed at hatch/arrival, then cached.
    expect(performance.now() - t0).toBeLessThan(8_000);
  });
});

describe('voice', () => {
  it('plans the same babble for the same KIN, and different KIN sound different', () => {
    expect(plan(makeGenome(5), 'happy', 0)).toEqual(plan(makeGenome(5), 'happy', 0));
    expect(plan(makeGenome(5), 'happy', 0)[0]!.f0).not.toEqual(plan(makeGenome(6), 'happy', 0)[0]!.f0);
  });
  it('questions rise and sad sounds fall', () => {
    const q = plan(makeGenome(9), 'question').at(-1)!;
    expect(q.f1).toBeGreaterThan(q.f0);
    const s = plan(makeGenome(9), 'sad')[0]!;
    expect(s.f1).toBeLessThan(s.f0);
  });
});
