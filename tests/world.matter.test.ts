import { describe, expect, it } from 'vitest';
import { Scheduler, type Actor } from '../src/world/actors';
import { featherStep, flockStep, newFeather, newFlock, newSkin, puddleStep, skinEnergy, skinStep, snowStep, v3, wind, type Puddle } from '../src/world/matter';
import { rng } from '../src/core/rng';

const bounds = { halfW: 3, zMin: -1.2, zMax: 1.3 };

describe('actor runtime', () => {
  it('runs each actor at its own cadence and lets idle actors sleep until an event wakes them', () => {
    const s = new Scheduler(rng(1));
    let fast = 0;
    let slow = 0;
    let sleeper = 0;
    s.add({ id: 'fast', kind: 'x', state: 0, hz: 20, awake: true, tick: () => void fast++ } as Actor);
    s.add({ id: 'slow', kind: 'x', state: 0, hz: 1, awake: true, tick: () => void slow++ } as Actor);
    s.add({ id: 'sleepy', kind: 'y', state: 0, hz: 10, awake: true, wakeOn: ['rain-started'], tick: () => (sleeper++, false) } as Actor);
    for (let t = 0; t <= 2000; t += 10) s.step(t);
    expect(fast).toBeGreaterThan(35);
    expect(slow).toBe(3);
    expect(sleeper).toBe(1); // ticked once, then slept
    s.bus.emit({ type: 'rain-started' });
    s.step(2010);
    s.step(2200);
    expect(sleeper).toBe(2);
  });

  it('delivers events to listeners after the step, in order', () => {
    const s = new Scheduler(rng(1));
    const seen: string[] = [];
    s.bus.on('thrown', (e) => seen.push('thrown:' + e.id));
    s.bus.on('*', (e) => seen.push('*' + e.type));
    s.add({ id: 'a', kind: 'x', state: 0, hz: 1, awake: true, tick: (c) => c.bus.emit({ type: 'thrown', id: 'ball', speed: 3 }) } as Actor);
    s.step(0);
    expect(seen).toEqual(['thrown:ball', '*thrown']);
  });
});

describe('matter', () => {
  it('a feather floats down slowly, drifts downwind and settles', () => {
    const f = newFeather(0, 2, 0);
    const air = { windKmh: 18, windDir: 270 }; // from the west → blows east (+x)
    let t = 0;
    while (!f.resting && t < 30) {
      featherStep(f, 1 / 60, air, t, { ...bounds, halfW: 50 }, rng(2));
      t += 1 / 60;
    }
    expect(f.resting).toBe(true);
    expect(t).toBeGreaterThan(2); // floaty: 2 units take seconds, not a ballistic 0.4 s
    expect(f.p.x).toBeGreaterThan(0.5);
  });

  it('wind follows the real direction', () => {
    expect(wind({ windKmh: 20, windDir: 270 }, 0).x).toBeGreaterThan(0);
    expect(wind({ windKmh: 20, windDir: 90 }, 0).x).toBeLessThan(0);
    expect(wind({ windKmh: 0, windDir: 90 }, 0).x).toBeCloseTo(0);
  });

  it('a flock stays together, stays in bounds and scatters from the KIN', () => {
    const r = rng(3);
    const f = newFlock(8, v3(0, 0.8, 0), r);
    const q = { speed: 0.9, home: v3(0, 0.8, 0), homePull: 0.3, avoid: null, avoidR: 0.8, yMin: 0.2, yMax: 2, halfW: 3, zMin: -1.2, zMax: 1.3, wind: { x: 0, z: 0 } };
    for (let i = 0; i < 600; i++) flockStep(f, 1 / 30, q, r);
    for (const p of f.p) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(3);
      expect(p.y).toBeGreaterThanOrEqual(0.2);
    }
    const near = f.p.filter((p) => Math.hypot(p.x, p.z) < 0.6).length;
    for (let i = 0; i < 60; i++) flockStep(f, 1 / 30, { ...q, avoid: v3(0, 0.6, 0), homePull: 0 }, r);
    expect(f.p.filter((p) => Math.hypot(p.x, p.z) < 0.6).length).toBeLessThanOrEqual(near);
  });

  it('puddles fill in rain and dry in sun; snow builds and melts', () => {
    const ps: Puddle[] = [{ x: 0, z: 0, r: 0, max: 0.4 }];
    for (let i = 0; i < 600; i++) puddleStep(ps, 1, { precipMm: 2, snow: false, tempC: 14, sunElev: 10, cloud: 1 });
    expect(ps[0]!.r).toBeCloseTo(0.4);
    for (let i = 0; i < 1800; i++) puddleStep(ps, 1, { precipMm: 0, snow: false, tempC: 25, sunElev: 50, cloud: 0 });
    expect(ps[0]!.r).toBe(0);
    let d = 0;
    for (let i = 0; i < 600; i++) d = snowStep(d, 1, { precipMm: 1, snow: true, tempC: -2, sunElev: 10, cloud: 1 });
    expect(d).toBeGreaterThan(0.5);
    const frozen = snowStep(d, 600, { precipMm: 0, snow: false, tempC: -5, sunElev: 10, cloud: 0 });
    expect(frozen).toBe(d);
    for (let i = 0; i < 3600; i++) d = snowStep(d, 1, { precipMm: 0, snow: false, tempC: 8, sunElev: 40, cloud: 0 });
    expect(d).toBe(0);
  });

  it('the jelly skin wobbles after an impact, squashes on the floor, then settles', () => {
    // a ring of 8 vertices around a core of radius 0.15
    const n = 8;
    const rest = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) (rest[i * 3] = Math.cos((i / n) * 6.28) * 0.15), (rest[i * 3 + 1] = Math.sin((i / n) * 6.28) * 0.15);
    const nbr = Array.from({ length: n }, (_, i) => [(i + 1) % n, (i + n - 1) % n]);
    const s = newSkin(rest, nbr);
    skinStep(s, 1 / 60, v3(0, -400, 0), 0.15);
    expect(skinEnergy(s)).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) skinStep(s, 1 / 60, v3(), 0.1); // core sunk: the bottom flattens
    const bottom = 0.1 + rest[Math.round(n * 0.75) * 3 + 1]! + s.off[Math.round(n * 0.75) * 3 + 1]!;
    expect(bottom).toBeGreaterThanOrEqual(-1e-6);
    for (let i = 0; i < 600; i++) skinStep(s, 1 / 60, v3(), 0.15);
    expect(skinEnergy(s)).toBeLessThan(1e-4);
  });
});
