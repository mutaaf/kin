import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/ai/ai.css', () => ({}));
vi.mock('@fontsource/geist-mono/700.css', () => ({}));
vi.mock('aurora-field', () => ({ create: vi.fn(), register: vi.fn(), fromPoints: vi.fn(), fromText: vi.fn() }));

describe('light-KIN points (the theatre and the landing hero)', () => {
  it('samples a creature surface into a few thousand unit-scale points, deterministically', async () => {
    const { kinPoints } = await import('../src/ai/theatre');
    const a = kinPoints(28, 1200);
    expect(a.length).toBeGreaterThan(900);
    expect(Math.max(...a.map(([x, y, z]) => Math.hypot(x!, y!, z!)))).toBeCloseTo(1, 5);
    expect(kinPoints(28, 1200)).toEqual(a);
  });
});
