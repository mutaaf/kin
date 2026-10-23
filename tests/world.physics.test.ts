import { describe, expect, it } from 'vitest';
import { Physics } from '../src/world/physics';

describe('physics (Rapier)', () => {
  it('a dropped ball bounces, settles and falls asleep', async () => {
    const p = await Physics.load();
    const ball = p.add({ id: 'ball', shape: { ball: 0.11 }, material: 'rubber', pos: { x: 0, y: 1.5, z: 0 } });
    let bounces = 0;
    let lastVy = 0;
    for (let i = 0; i < 60 * 8; i++) {
      p.step(1 / 60);
      const vy = ball.vel().y;
      if (lastVy < -0.5 && vy > 0.2) bounces++;
      lastVy = vy;
    }
    expect(bounces).toBeGreaterThanOrEqual(2);
    expect(ball.pos().y).toBeCloseTo(0.11, 1);
    expect(ball.asleep()).toBe(true);
    expect(p.stepMs).toBeLessThan(2);
  });

  it('materials differ: rubber bounces higher than wood', async () => {
    const p = await Physics.load();
    const rub = p.add({ id: 'r', shape: { ball: 0.1 }, material: 'rubber', pos: { x: -1, y: 1, z: 0 } });
    const wood = p.add({ id: 'w', shape: { ball: 0.1 }, material: 'wood', pos: { x: 1, y: 1, z: 0 } });
    let peakR = 0;
    let peakW = 0;
    let landed = false;
    for (let i = 0; i < 120; i++) {
      p.step(1 / 60);
      if (rub.pos().y < 0.12) landed = true;
      if (landed) (peakR = Math.max(peakR, rub.pos().y)), (peakW = Math.max(peakW, wood.pos().y));
    }
    expect(peakR).toBeGreaterThan(peakW);
  });

  it('garden walls keep a hard throw in view', async () => {
    const p = await Physics.load();
    p.setBounds(2, -1.25, 1.35);
    const ball = p.add({ id: 'ball', shape: { ball: 0.11 }, material: 'rubber', pos: { x: 0, y: 0.5, z: 0 } });
    ball.setVel({ x: 14, y: 3, z: 6 });
    for (let i = 0; i < 300; i++) p.step(1 / 60);
    expect(Math.abs(ball.pos().x)).toBeLessThan(2.2);
    expect(ball.pos().z).toBeLessThan(1.6);
  });

  it('the kinematic KIN pushes a block out of its way', async () => {
    const p = await Physics.load();
    const block = p.add({ id: 'b', shape: { box: [0.1, 0.1, 0.1] }, material: 'wood', pos: { x: 0.5, y: 0.1, z: 0 } });
    for (let i = 0; i <= 90; i++) {
      p.setKin({ x: -0.5 + i * 0.015, y: 0, z: 0 });
      p.step(1 / 60);
    }
    expect(block.pos().x).toBeGreaterThan(0.6);
  });

  it('is deterministic on one machine: same inputs, same result', async () => {
    const run = async () => {
      const p = await Physics.load();
      const b = p.add({ id: 'b', shape: { ball: 0.11 }, material: 'rubber', pos: { x: 0, y: 0.4, z: 0 } });
      b.setVel({ x: 3, y: 2, z: 1 });
      for (let i = 0; i < 240; i++) p.step(1 / 60);
      return b.pos();
    };
    expect(await run()).toEqual(await run());
  });
});
