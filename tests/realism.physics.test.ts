// The KIN as a physical character, and the environment API for AR (src/world/physics.ts).
import { describe, expect, it } from 'vitest';
import { KIN_CAPSULE, Physics } from '../src/world/physics';

/** Walk the character toward (tx, tz) at `speed` for `secs`, stepping physics like the app does. */
function walk(p: Physics, from: { x: number; z: number }, tx: number, tz: number, speed = 1, secs = 3) {
  let pos = { x: from.x, y: 0, z: from.z };
  const dt = 1 / 60;
  for (let t = 0; t < secs; t += dt) {
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) break;
    const s = Math.min(d, speed * dt);
    pos = p.moveKin(pos, { x: (dx / d) * s, y: -0.02, z: (dz / d) * s });
    p.step(dt);
  }
  return pos;
}

describe('the KIN as a physical character', () => {
  it("can't walk through the mushroom's stalk: it stops (or slides) at its surface", async () => {
    const p = await Physics.load();
    p.addStatic({ cylinder: [0.275, 0.15] }, { x: 0, y: 0.275, z: 0 });
    const end = walk(p, { x: -1.5, z: 0 }, 1.5, 0, 1, 4);
    // Either it was stopped in front, or it slid around: never inside the stalk.
    const closest = Math.hypot(end.x, end.z);
    expect(closest).toBeGreaterThan(KIN_CAPSULE.radius + 0.15 - 0.03);
  });

  it('slides along an obstacle instead of stopping dead when walking at an angle', async () => {
    const p = await Physics.load();
    p.addStatic({ box: [0.05, 0.5, 2] }, { x: 0, y: 0.5, z: 0 }); // a wall along z at x = 0
    const end = walk(p, { x: -1, z: -1 }, 1, 1, 1, 3);
    expect(end.x).toBeLessThan(0); // still on its side of the wall
    expect(end.z).toBeGreaterThan(0.3); // but it slid along it
  });

  it('shoves a light ball out of its way (mass ratio), and barely moves a heavy stone', async () => {
    const p = await Physics.load();
    p.setBounds(10, -10, 10);
    const ball = p.add({ id: 'ball', shape: { ball: 0.11 }, material: 'rubber', pos: { x: 0, y: 0.11, z: 0 } });
    const stone = p.add({ id: 'stone', shape: { box: [0.35, 0.35, 0.35] }, material: 'stone', pos: { x: 0, y: 0.35, z: 3 } });
    for (let i = 0; i < 30; i++) p.step(1 / 60);
    walk(p, { x: -1, z: 0 }, 1, 0, 0.9, 3);
    expect(Math.abs(ball.pos().x) + Math.abs(ball.pos().z)).toBeGreaterThan(0.15);
    walk(p, { x: 0, z: 1.5 }, 0, 4.5, 0.9, 3);
    const s = stone.pos();
    expect(Math.hypot(s.x, s.z - 3)).toBeLessThan(0.12);
  });

  it('steps up a low ledge (a 6 cm stone) but not a block-high one (18 cm)', async () => {
    const p = await Physics.load();
    p.addStatic({ box: [0.35, 0.03, 0.45] }, { x: 0.1, y: 0.03, z: 0.45 });
    const onto = walk(p, { x: -1.3, z: 0.45 }, 0.2, 0.45, 0.6, 4);
    expect(onto.x).toBeGreaterThan(0.1);
    expect(onto.y).toBeGreaterThan(0.04);
    const q = await Physics.load();
    q.addStatic({ box: [0.35, 0.09, 0.45] }, { x: 0.1, y: 0.09, z: 0.45 });
    const blocked = walk(q, { x: -1.3, z: 0.45 }, 0.2, 0.45, 0.6, 4);
    expect(blocked.x).toBeLessThan(-0.5);
  });

  it('walks over a passable rim (its nest) but feet still stand on it', async () => {
    const p = await Physics.load();
    p.addStatic({ ball: 0.1 }, { x: 0, y: 0.07, z: 0 }, { passable: true });
    const end = walk(p, { x: -1, z: 0 }, 1, 0, 1, 3);
    expect(end.x).toBeGreaterThan(0.9);
    expect(p.groundAt(0, 0, 0.6)).toBeCloseTo(0.17, 2);
  });

  it('knows the ground: lawn, the top of a resting block, and not a toy being held', async () => {
    const p = await Physics.load();
    const block = p.add({ id: 'b', shape: { box: [0.09, 0.09, 0.09] }, material: 'wood', pos: { x: 0.5, y: 0.09, z: 0 } });
    for (let i = 0; i < 60; i++) p.step(1 / 60);
    expect(p.groundAt(-1, 0)).toBeCloseTo(0, 3);
    expect(p.groundAt(0.5, 0)).toBeCloseTo(0.18, 2);
    block.hold(true);
    expect(p.groundAt(0.5, 0)).toBeCloseTo(0, 3);
  });

  it('a held toy is never pushed into the ground', async () => {
    const p = await Physics.load();
    const ball = p.add({ id: 'ball', shape: { ball: 0.11 }, material: 'rubber', pos: { x: 0, y: 0.5, z: 0 } });
    ball.hold(true);
    ball.moveTo({ x: 0, y: -0.3, z: 0 });
    p.step(1 / 60);
    expect(ball.pos().y).toBeGreaterThanOrEqual(0.11 - 1e-3);
  });
});

describe('environment colliders (AR)', () => {
  it('replace: a real table plane becomes the ground; off its edge is a void; null restores the lawn', async () => {
    const p = await Physics.load();
    p.setEnvironment({ mode: 'replace', planes: [{ id: 't', position: { x: 0, y: 0.5, z: 0 }, rotation: [0, 0, 0, 1], extent: [1.2, 0.8], classification: 'table' }], meshes: [] });
    expect(p.groundAt(0.2, 0.1, 2)).toBeCloseTo(0.5, 3);
    expect(p.raycastDown({ x: 0.2, y: 2, z: 0.1 })!.on).toBe('env:t');
    expect(p.groundAt(3, 0, 2)).toBe(-Infinity);
    // A dropped toy lands on the table.
    const b = p.add({ id: 'b', shape: { ball: 0.1 }, material: 'rubber', pos: { x: 0, y: 1.2, z: 0 } });
    for (let i = 0; i < 240; i++) p.step(1 / 60);
    expect(b.pos().y).toBeCloseTo(0.6, 1);
    p.setEnvironment(null);
    expect(p.groundAt(3, 0, 2)).toBeCloseTo(0, 3);
  });

  it('augment: a scanned mesh (a step) adds to the lawn and feet find its top', async () => {
    const p = await Physics.load();
    // A 1×1 quad at y = 0.12 (two triangles), e.g. a LiDAR-scanned rug or step.
    const positions = [-0.5, 0.12, -0.5, 0.5, 0.12, -0.5, 0.5, 0.12, 0.5, -0.5, 0.12, 0.5];
    p.setEnvironment({ mode: 'augment', planes: [], meshes: [{ id: 'step', positions, indices: [0, 2, 1, 0, 3, 2], faceClass: ['floor', 'floor'] }] });
    expect(p.groundAt(0, 0, 1)).toBeCloseTo(0.12, 3);
    expect(p.groundAt(2, 0, 1)).toBeCloseTo(0, 3);
  });
});
