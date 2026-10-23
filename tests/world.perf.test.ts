// Physics budget for a full garden: 12 dynamic bodies + the scenery colliders, everything awake
// (the worst case: a thrown toy knocking into the rest). Logged so the number is visible in CI.
import { describe, expect, it } from 'vitest';
import { Physics } from '../src/world/physics';

describe('physics budget', () => {
  it('a busy garden steps well under a millisecond', async () => {
    const p = await Physics.load();
    p.setBounds(1.7, -1.3, 1.4);
    p.addStatic({ cylinder: [0.27, 0.15] }, { x: -1.6, y: 0.27, z: -0.85 });
    p.addStatic({ cylinder: [0.17, 0.59] }, { x: -1.6, y: 0.69, z: -0.85 });
    for (let i = 0; i < 10; i++) p.addStatic({ ball: 0.1 }, { x: 1.55 + Math.cos(i) * 0.36, y: 0.07, z: -0.75 + Math.sin(i) * 0.29 });
    const bodies = [
      p.add({ id: 'ball', shape: { ball: 0.11 }, material: 'rubber', pos: { x: 0, y: 1, z: 0 } }),
      p.add({ id: 'b0', shape: { box: [0.09, 0.09, 0.09] }, material: 'wood', pos: { x: 1, y: 0.09, z: 0.9 } }),
      p.add({ id: 'b1', shape: { box: [0.09, 0.09, 0.09] }, material: 'wood', pos: { x: 1, y: 0.27, z: 0.9 } }),
      p.add({ id: 'jelly', shape: { ball: 0.14 }, material: 'jelly', pos: { x: -0.9, y: 0.6, z: 0.8 } }),
    ];
    for (let i = 0; i < 8; i++) bodies.push(p.add({ id: 'f' + i, shape: { ball: 0.05 }, material: 'stone', pos: { x: -1.2 + i * 0.3, y: 0.3 + i * 0.1, z: 0.5 } }));
    bodies[0]!.setVel({ x: 6, y: 2, z: 1 });
    // warm up, then measure 600 steps (10 s of garden time) with the KIN walking through it
    for (let i = 0; i < 60; i++) p.step(1 / 60);
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) {
      p.setKin({ x: Math.sin(i / 60) * 1.2, y: 0, z: 0.4 });
      if (i % 120 === 0) bodies[i % bodies.length]!.impulse({ x: 0.05, y: 0.03, z: 0 });
      p.step(1 / 60);
    }
    const perStep = (performance.now() - t0) / 600;
    console.log(`[perf] physics: ${perStep.toFixed(3)} ms/step with ${bodies.length} bodies (${p.awakeCount()} awake at the end)`);
    expect(perStep).toBeLessThan(1);
  });
});
