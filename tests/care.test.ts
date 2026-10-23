import { describe, expect, it } from 'vitest';
import {
  CATALOG, NEED_FLOOR, NEEDS, bondLevel, canTeach, collect, dig, ensurePlots, feed, newCare, plant, plotCount, reviveCare,
  season, surprisesFor, tick, trick, water, wants, type Env,
} from '../src/core/care';

const H = 3_600_000;
const day: Env = { sunElev: 40, tempC: 20, precipMm: 0, snow: false };
const night: Env = { sunElev: -20, tempC: 12, precipMm: 0, snow: false };

describe('care never punishes', () => {
  it('a month of neglect leaves a hungry, sleepy KIN — never below the floor, never sick', () => {
    let c = newCare(0);
    for (let t = 1; t <= 30 * 24; t++) c = tick(c, t * H, t % 24 < 12 ? day : night, false).care;
    for (const n of NEEDS) expect(c.needs[n]).toBeGreaterThanOrEqual(NEED_FLOOR);
    expect(wants(c).length).toBeGreaterThan(0);
    expect(c.plant.size).toBeGreaterThan(0.2); // the plant droops at worst, it never dies
  });

  it('caps catch-up after a long absence at 48 h', () => {
    const a = tick(newCare(0), 48 * H, day, false).care;
    const b = tick(newCare(0), 400 * H, day, false).care;
    expect(b.needs).toEqual(a.needs);
  });

  it('sleep restores rest; rain cleans and waters', () => {
    const c0 = { ...newCare(0), needs: { ...newCare(0).needs, rest: 0.2, clean: 0.3 } };
    expect(tick(c0, 3 * H, night, true).care.needs.rest).toBeGreaterThan(0.8);
    const wet = tick(c0, 1 * H, { ...day, precipMm: 3 }, false).care;
    expect(wet.needs.clean).toBeGreaterThan(0.6);
    expect(wet.plant.water).toBe(1);
  });
});

describe('the plant and the garden grow with real time', () => {
  it('daylight sets and ripens berries, up to three; overripe ones fall', () => {
    let c = newCare(0);
    let fallen = 0;
    for (let t = 1; t <= 72; t++) {
      const r = tick(c, t * H, day, false);
      c = r.care;
      fallen += r.fallen;
    }
    expect(c.plant.berries.length).toBeLessThanOrEqual(3);
    expect(fallen).toBeGreaterThan(0);
  });

  it('a planted, watered seed blooms in about two days', () => {
    let c = collect(newCare(0), 0, 'seed-mint').care;
    c = plant(c, 0, 0, 'seed-mint')!.care;
    expect(c.collection['seed-mint']).toBe(0);
    for (let t = 1; t <= 60; t++) c = water(tick(c, t * H, day, false).care, t * H, 0).care;
    expect(c.plots[0]!.growth).toBe(1);
  });

  it('refuses to plant what you do not have', () => {
    expect(plant(newCare(0), 0, 0, 'seed-moon')).toBeNull();
    expect(plant(collect(newCare(0), 0, 'pebble-round').care, 0, 0, 'pebble-round')).toBeNull();
  });
});

describe('progression only goes up, forever', () => {
  it('bond levels are infinite and named', () => {
    expect(bondLevel(0)).toMatchObject({ level: 1, name: 'New friends' });
    const big = bondLevel(5_000_000);
    expect(big.level).toBeGreaterThan(40);
    expect(big.name).toMatch(/^Kindred/);
  });

  it('XP has diminishing returns within an hour (anti-grind), never zero', () => {
    let c = newCare(0);
    const xps: number[] = [];
    for (let i = 0; i < 12; i++) {
      const o = feed(c, 1000 + i);
      xps.push(o.xp);
      c = o.care;
    }
    expect(xps[0]).toBe(xps[4]);
    expect(xps[11]!).toBeLessThan(xps[0]!);
    expect(xps[11]!).toBeGreaterThan(0);
    expect(feed(c, 2 * H).xp).toBe(xps[0]); // next hour, full again
  });

  it('tricks improve with practice: skill rises every attempt, success rate follows', () => {
    let c = newCare(0);
    let early = 0;
    let late = 0;
    for (let i = 0; i < 200; i++) {
      const o = trick(c, i * H, 'sit', (i * 0.6180339) % 1);
      if (i < 20 && o.success) early++;
      if (i >= 180 && o.success) late++;
      c = o.care;
    }
    expect(c.skills.sit).toBeGreaterThan(0.9);
    expect(late).toBeGreaterThan(early);
    expect(c.attempts.sit).toBe(200);
  });

  it('tricks unlock with the bond; garden plots open up', () => {
    const c = newCare(0);
    expect(canTeach(c, 'sit')).toBe(true);
    expect(canTeach(c, 'dance')).toBe(false);
    const rich = { ...c, bondXp: 100_000 };
    expect(canTeach(rich, 'dance')).toBe(true);
    expect(plotCount(rich)).toBeGreaterThan(3);
    expect(ensurePlots(rich).plots.length).toBe(plotCount(rich));
  });

  it('revives an old or partial save without throwing', () => {
    const r = reviveCare({ v: 1, needs: { fun: 0.2 } }, 0);
    expect(r.needs.fun).toBe(0.2);
    expect(r.needs.fullness).toBeGreaterThan(0);
    expect(reviveCare('garbage', 0).v).toBe(1);
  });
});

describe('days have their own surprises and finds', () => {
  it('surprises and digs are stable for a date + KIN and differ across days', () => {
    const d1 = new Date(2026, 9, 22);
    const d2 = new Date(2026, 9, 23);
    expect(surprisesFor(d1, 7)).toEqual(surprisesFor(d1, 7));
    const all = Array.from({ length: 20 }, (_, i) => JSON.stringify(surprisesFor(new Date(2026, 0, 1 + i), 7)));
    expect(new Set(all).size).toBeGreaterThan(5);
    expect(dig(d1, 7, 0, 'autumn')).toEqual(dig(d1, 7, 0, 'autumn'));
    expect(dig(d2, 7, 9, 'autumn')).toBeNull(); // a few finds a day keeps them special
  });

  it('seasonal items only turn up in their season', () => {
    for (let i = 0; i < 300; i++) {
      const it = dig(new Date(2026, 6, 1 + (i % 28)), i, i % 4, 'summer');
      if (it?.season) expect(it.season).toBe('summer');
    }
  });

  it('seasons flip in the southern hemisphere', () => {
    expect(season(new Date(2026, 0, 10), 32)).toBe('winter');
    expect(season(new Date(2026, 0, 10), -33)).toBe('summer');
  });

  it('the catalogue is honest: every rarity 1..4 and unique ids', () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((c) => c.rarity))).toEqual(new Set([1, 2, 3, 4]));
  });
});
