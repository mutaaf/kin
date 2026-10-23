// Realism rules for the gait (src/render/creature/gait.ts), checked without graphics.
import { describe, expect, it } from 'vitest';
import { Gait, type GroundFn } from '../src/render/creature/gait';

const flat: GroundFn = () => 0;
/** A 0.18-tall platform (a step up) occupying x ∈ [0.6, 0.78], wide enough for both feet. */
const withBlock: GroundFn = (x, z, fromY) => (x >= 0.6 && x <= 0.78 && Math.abs(z) <= 0.3 && fromY >= 0.18 ? 0.18 : 0);

/** Walk the body along +x at `speed` for `secs`, recording every foot's position each frame. */
function walk(g: Gait, speed: number, secs: number, ground = flat, yawOf = () => Math.PI / 2) {
  const dt = 1 / 60;
  let x = 0;
  const z = 0;
  const frames: ReturnType<Gait['update']>[] = [];
  const planted: { i: number; x: number; y: number; z: number; px: number; pz: number }[][] = [];
  for (let t = 0; t < secs; t += dt) {
    x += speed * dt;
    const f = g.update({ x, z, yaw: yawOf(), vx: speed, vz: 0, dt, ground, free: false });
    frames.push(f);
    planted.push(f.feet.map((ft, i) => ({ i, x: ft.pos.x, y: ft.pos.y, z: ft.pos.z, px: ft.planted ? 1 : 0, pz: 0 })));
  }
  return { frames, planted, x };
}

describe('gait: planted feet', () => {
  it('a planted foot never slides while the body walks over it', () => {
    const g = new Gait();
    g.plantAll(0, 0, Math.PI / 2, flat);
    const { frames } = walk(g, 0.8, 3);
    let maxSlide = 0;
    for (let k = 1; k < frames.length; k++) {
      for (let i = 0; i < 2; i++) {
        const a = frames[k - 1]!.feet[i]!;
        const b = frames[k]!.feet[i]!;
        if (a.planted && b.planted) maxSlide = Math.max(maxSlide, Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z, b.pos.y - a.pos.y));
      }
    }
    expect(maxSlide).toBe(0);
  });

  it('walking alternates feet, keeps one planted, and keeps up with the body', () => {
    const g = new Gait();
    g.plantAll(0, 0, Math.PI / 2, flat);
    const { frames, x } = walk(g, 0.8, 3);
    const seq: number[] = [];
    for (const f of frames) for (const i of f.touchdowns) seq.push(i);
    expect(seq.length).toBeGreaterThan(8);
    let alternations = 0;
    for (let k = 1; k < seq.length; k++) if (seq[k] !== seq[k - 1]) alternations++;
    expect(alternations / (seq.length - 1)).toBeGreaterThan(0.8);
    // Never both feet in the air while walking.
    expect(frames.every((f) => f.hopping || f.feet.some((ft) => ft.planted))).toBe(true);
    // The feet keep up with the body (a short stride for a small creature), never trailing far.
    let worstLag = 0;
    let bx = 0;
    for (const f of frames) {
      bx += 0.8 / 60;
      for (const ft of f.feet) worstLag = Math.max(worstLag, Math.abs(ft.pos.x - bx));
    }
    expect(worstLag).toBeLessThan(0.2);
    void x;
  });

  it('feet rest on the ground (no floating, no sinking) when planted', () => {
    const g = new Gait();
    g.plantAll(0, 0, 0, flat);
    const { frames } = walk(g, 0.6, 2);
    for (const f of frames) for (const ft of f.feet) if (ft.planted) expect(ft.pos.y).toBe(0);
  });

  it('turning in place steps the feet', () => {
    const g = new Gait();
    g.plantAll(0, 0, 0, flat);
    let steps = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      const f = g.update({ x: 0, z: 0, yaw: t * 2.5, vx: 0, vz: 0, dt: 1 / 60, ground: flat, free: false });
      steps += f.touchdowns.length;
    }
    expect(steps).toBeGreaterThanOrEqual(4);
  });

  it('a foot that lands on a block plants on its top, and clears its edge on the way', () => {
    const g = new Gait();
    g.plantAll(0.3, 0, Math.PI / 2, withBlock);
    let onTop = 0;
    let minClear = Infinity;
    let x = 0.3;
    for (let t = 0; t < 1.2; t += 1 / 60) {
      x += 0.5 / 60;
      const f = g.update({ x, z: 0, yaw: Math.PI / 2, vx: 0.5, vz: 0, dt: 1 / 60, ground: withBlock, free: false });
      for (const ft of f.feet) {
        const over = ft.pos.x >= 0.6 && ft.pos.x <= 0.78 && Math.abs(ft.pos.z) <= 0.3;
        if (over && ft.planted) {
          onTop++;
          expect(ft.pos.y).toBeCloseTo(0.18, 5);
        }
        if (over && !ft.planted) minClear = Math.min(minClear, ft.pos.y);
      }
    }
    expect(onTop).toBeGreaterThan(0);
    // A swinging foot over the block is never inside it.
    if (Number.isFinite(minClear)) expect(minClear).toBeGreaterThanOrEqual(0.15);
  });

  it('runs hop: both feet leave and land together, with a bigger bob', () => {
    const g = new Gait({ size: 1, hipX: 0.135, hipZ: 0.03, stride: 0.075, lift: 0.055, bounce: 0.6 });
    g.plantAll(0, 0, Math.PI / 2, flat);
    const { frames } = walk(g, 2.2, 2);
    const both = frames.filter((f) => f.touchdowns.length === 2).length;
    expect(both).toBeGreaterThan(2);
    expect(Math.max(...frames.map((f) => f.bob))).toBeGreaterThan(0.04);
  });

  it('free (airborne) feet ride with the body, then re-plant on landing', () => {
    const g = new Gait();
    g.plantAll(0, 0, 0, flat);
    const f1 = g.update({ x: 1, z: 0, yaw: 0, vx: 0, vz: 0, dt: 1 / 60, ground: flat, free: true, freeHeight: 0.3 });
    expect(f1.feet.every((f) => !f.planted)).toBe(true);
    expect(f1.feet[0]!.pos.x).toBeCloseTo(1 - 0.135, 3);
    const f2 = g.update({ x: 1, z: 0, yaw: 0, vx: 0, vz: 0, dt: 1 / 60, ground: flat, free: false });
    expect(f2.touchdowns).toEqual([0, 1]);
    expect(f2.feet.every((f) => f.planted && f.pos.y === 0)).toBe(true);
  });
});
