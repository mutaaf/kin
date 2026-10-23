import { describe, expect, it } from 'vitest';
import { arrivalReaction, decide, type Context } from '../src/core/brain';
import { newKin } from '../src/core/creature';
import { makeGenome, makeTraits } from '../src/core/genome';
import { rng } from '../src/core/rng';

const sky = { tempC: 20, windKmh: 5, precipMm: 0, snow: false, cloud: 0.2, sunElev: 30 };
const ctx = (p: Partial<Context> = {}): Context => ({ now: 0, weather: sky, petting: false, peerEdge: null, guest: null, ...p });

describe('genome', () => {
  it('is a pure function of the seed (same creature on every device)', () => {
    expect(makeGenome(42)).toEqual(makeGenome(42));
    expect(makeTraits(42)).toEqual(makeTraits(42));
    expect(makeGenome(42)).not.toEqual(makeGenome(43));
  });
});

describe('brain', () => {
  it('a tired KIN at night chooses sleep, and explains why', () => {
    const k = newKin(0, 5);
    k.drives.energy = 0.05;
    const d = decide(k, ctx({ weather: { ...sky, sunElev: -20 } }), [], 1);
    expect(d.action).toBe('sleep');
    expect(d.why[0]).toMatch(/night|tired/);
  });
  it('a friend at the edge pulls attention', () => {
    const d = decide(newKin(0, 9), ctx({ peerEdge: 'right' }), [], 1);
    expect(d.action).toBe('look_edge');
  });
  it('real rain sends it to shelter', () => {
    const k = newKin(0, 11);
    k.drives.energy = 0.9;
    const d = decide(k, ctx({ weather: { ...sky, precipMm: 6, cloud: 1, windKmh: 30 } }), [], 3);
    expect(d.action).toBe('shelter');
  });
  it('is deterministic for a given tick', () => {
    const k = newKin(0, 21);
    expect(decide(k, ctx(), [], 7)).toEqual(decide(k, ctx(), [], 7));
  });
});

describe('arrival reaction', () => {
  it('varies by temperament, not a hardcoded response', () => {
    const shy = { traits: { curiosity: 0.5, bravery: 0.1, playfulness: 0.2, warmth: 0.3, energy: 0.5 }, drives: { energy: 0.5, social: 0.5, curious: 0.5, comfort: 0.5 }, friends: {} };
    const bold = { ...shy, traits: { ...shy.traits, bravery: 0.9, warmth: 0.9 } };
    const count = (h: typeof shy, r: string) => Array.from({ length: 400 }, (_, i) => arrivalReaction(h, 'x', rng(i))).filter((x) => x === r).length;
    expect(count(shy, 'cautious')).toBeGreaterThan(count(bold, 'cautious') * 2);
    expect(count(bold, 'eager')).toBeGreaterThan(count(shy, 'eager') * 2);
  });
  it('familiarity softens caution', () => {
    const shy = { traits: { curiosity: 0.5, bravery: 0.15, playfulness: 0.3, warmth: 0.5, energy: 0.5 }, drives: { energy: 0.5, social: 0.5, curious: 0.5, comfort: 0.5 }, friends: {} };
    const friend = { ...shy, friends: { x: { name: 'N', hue: 1, meets: 6, lastAt: 0, affinity: 0.8 } } };
    const cautious = (h: typeof shy) => Array.from({ length: 400 }, (_, i) => arrivalReaction(h, 'x', rng(i))).filter((r) => r === 'cautious').length;
    expect(cautious(friend)).toBeLessThan(cautious(shy));
  });
});
