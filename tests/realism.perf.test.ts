// What realism costs per frame (phone budget: the whole frame gets ~16 ms; this must be a sliver).
import { describe, expect, it } from 'vitest';
import { Gait } from '../src/render/creature/gait';
import { Physics } from '../src/world/physics';

describe('realism cost per frame', () => {
  it('gait + ground rays + character move + physics step stay well under 1 ms', async () => {
    const p = await Physics.load();
    // A busy garden: scenery, the ball, two blocks, a dozen resting finds.
    p.addStatic({ cylinder: [0.275, 0.15] }, { x: -1.6, y: 0.275, z: -0.85 });
    p.addStatic({ cylinder: [0.17, 0.59] }, { x: -1.6, y: 0.69, z: -0.85 });
    for (let i = 0; i < 10; i++) p.addStatic({ ball: 0.1 }, { x: 1.55 + Math.cos(i) * 0.36, y: 0.07, z: -0.75 + Math.sin(i) * 0.29 }, { passable: true });
    p.add({ id: 'ball', shape: { ball: 0.11 }, material: 'rubber', pos: { x: 0.4, y: 0.11, z: 0.2 } });
    p.add({ id: 'b0', shape: { box: [0.09, 0.09, 0.09] }, material: 'wood', pos: { x: 1.2, y: 0.09, z: 0.95 } });
    p.add({ id: 'b1', shape: { box: [0.09, 0.09, 0.09] }, material: 'wood', pos: { x: 1.2, y: 0.27, z: 0.95 } });
    for (let i = 0; i < 12; i++) p.add({ id: 'f' + i, shape: { cylinder: [0.035, 0.055] }, material: 'stone', pos: { x: -1 + i * 0.18, y: 0.04, z: 0.6 } });
    const gait = new Gait();
    const ground = (x: number, z: number, fromY: number) => p.groundAt(x, z, fromY);
    gait.plantAll(-2, 0.3, Math.PI / 2, ground);
    let pos = { x: -2, y: 0, z: 0.3 };
    const dt = 1 / 60;
    // Warm up, then measure 600 frames of walking back and forth through the garden.
    let t0 = 0;
    let frames = 0;
    for (let f = 0; f < 700; f++) {
      if (f === 100) t0 = performance.now();
      const dir = Math.floor(f / 240) % 2 ? -1 : 1;
      const r = p.moveKin(pos, { x: dir * 0.9 * dt, y: -0.02, z: Math.sin(f / 40) * 0.3 * dt });
      const vx = (r.x - pos.x) / dt;
      const vz = (r.z - pos.z) / dt;
      pos = r;
      gait.update({ x: pos.x, z: pos.z, yaw: Math.atan2(vx, vz), vx, vz, dt, ground, free: false });
      p.step(dt);
      if (f >= 100) frames++;
    }
    const perFrame = (performance.now() - t0) / frames;
    console.log(`realism per frame: ${perFrame.toFixed(3)} ms (character move ${p.moveMs.toFixed(3)} ms, physics step ${p.stepMs.toFixed(3)} ms)`);
    expect(perFrame).toBeLessThan(1);
  });
});
