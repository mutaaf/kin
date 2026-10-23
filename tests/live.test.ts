import { describe, expect, it } from 'vitest';
import { cleanCare, liveStateFrom, LiveThrottle, needsFromDrives, shouldRun, type LiveInput } from '../src/platform/live';

const base: LiveInput = {
  kin: { name: 'Mosi', seed: 28, hatched: true },
  genome: { hue: 162.4, accentHue: 330 },
  sky: { tempC: 14, precipMm: 2, snow: false, windKmh: 9, sunElev: 20, cloud: 0.9 },
  action: 'shelter',
  needs: { hunger: 0.3, play: 0.7, rest: 0.8, clean: 0.9, affection: 0.6 },
};

describe('Live Activity state', () => {
  it('shapes a small, bounded payload from the world', () => {
    const s = liveStateFrom({ ...base, line: 'x'.repeat(400), kin: { ...base.kin, name: 'A very long name indeed' } });
    expect(s.weather).toBe('rainy');
    expect(s.mode).toBe('home');
    expect(s.mood).toBe('cozy');
    expect(s.doing).toBe('under the mushroom');
    expect(s.line.length).toBeLessThanOrEqual(120);
    expect(s.name.length).toBeLessThanOrEqual(16);
    expect(s.hue).toBe(162);
    expect(JSON.stringify(s).length).toBeLessThan(1024); // ActivityKit allows 4 KB
  });

  it('knows when the KIN is away visiting or asleep', () => {
    expect(liveStateFrom({ ...base, away: 'Nox' })).toMatchObject({ mode: 'away', friend: 'Nox', doing: 'visiting' });
    expect(liveStateFrom({ ...base, action: 'sleep' })).toMatchObject({ mode: 'asleep', mood: 'sleepy' });
    const night = liveStateFrom({ ...base, action: 'sit', sky: { ...base.sky, precipMm: 0, sunElev: -20 }, needs: { ...base.needs, rest: 0.2 } });
    expect(night).toMatchObject({ mode: 'asleep', weather: 'starry' });
  });

  it('clamps needs and never emits NaN', () => {
    const s = liveStateFrom({ ...base, needs: { hunger: -1, play: 9, rest: NaN, clean: 0.5, affection: 0.5 } });
    expect([s.hunger, s.play, s.rest]).toEqual([0, 1, 0.8]);
    const d = needsFromDrives({ energy: 0.2, social: 0.9, curious: 0.5, comfort: 0.7 });
    for (const v of Object.values(d)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('runs only when supported, authorized, enabled and hatched', () => {
    const ok = { supported: true, authorized: true, enabled: true, running: 0 };
    expect(shouldRun({ hatched: true, support: ok })).toBe(true);
    expect(shouldRun({ hatched: false, support: ok })).toBe(false);
    expect(shouldRun({ hatched: true, support: { ...ok, authorized: false } })).toBe(false);
    expect(shouldRun({ hatched: true, support: { ...ok, enabled: false } })).toBe(false);
    expect(shouldRun({ hatched: true, support: null })).toBe(false);
  });
});

describe('update throttle', () => {
  it('sends meaningful changes at once, trivial ones at most every 3 minutes', () => {
    const t = new LiveThrottle();
    const s = liveStateFrom(base);
    expect(t.shouldSend(s, 0)).toBe(true);
    expect(t.shouldSend({ ...s, hunger: s.hunger + 0.05 }, 10_000)).toBe(false);
    expect(t.shouldSend({ ...s, hunger: s.hunger + 0.2 }, 20_000)).toBe(true);
    expect(t.shouldSend({ ...s, hunger: s.hunger + 0.21 }, 30_000)).toBe(false);
    expect(t.shouldSend({ ...s, hunger: s.hunger + 0.21, line: 'Nom.' }, 40_000)).toBe(true);
    expect(t.shouldSend({ ...s, hunger: s.hunger + 0.22, line: 'Nom.' }, 40_000 + 3 * 60_000)).toBe(true);
  });
});

describe('care from the activity', () => {
  it('keeps known verbs at sane times, de-duplicated, oldest first', () => {
    const now = 1_800_000_000_000;
    const c = cleanCare([
      { verb: 'pet', at: now - 2000 },
      { verb: 'feed', at: now - 5000 },
      { verb: 'feed', at: now - 5000 },
      { verb: 'launch_rockets', at: now },
      { verb: 'tuck', at: now - 30 * 86_400_000 },
      { verb: 'play', at: now + 10 * 60_000 },
      null,
    ], now);
    expect(c).toEqual([{ verb: 'feed', at: now - 5000 }, { verb: 'pet', at: now - 2000 }]);
    expect(cleanCare('nope')).toEqual([]);
  });
});
