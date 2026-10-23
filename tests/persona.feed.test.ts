import { describe, expect, it } from 'vitest';
import { cleanTopic, dailyMenu, localTopicCard, snackFromCard, snackLine, SNACKS, validTopicCard } from '../src/world/feed';
import { IP_WORDS } from '../src/ai/schema';

describe('feeding content', () => {
  it('has a snack for every core archetype, each a small nudge, none IP', () => {
    const covered = new Set(SNACKS.flatMap((s) => Object.keys(s.deltas)));
    for (const a of ['popstar', 'scholar', 'gamer', 'athlete', 'brat', 'royal']) expect(covered).toContain(a);
    for (const s of SNACKS) {
      for (const v of Object.values(s.deltas)) expect(v).toBeLessThanOrEqual(0.04);
      expect(IP_WORDS.test(JSON.stringify(s))).toBe(false);
    }
  });

  it('changes the menu daily, deterministically per KIN', () => {
    const a = dailyMenu('2026-10-23', 28).map((s) => s.id);
    expect(dailyMenu('2026-10-23', 28).map((s) => s.id)).toEqual(a);
    const week = new Set(Array.from({ length: 7 }, (_, i) => dailyMenu(`2026-10-${10 + i}`, 28).map((s) => s.id).join()));
    expect(week.size).toBeGreaterThan(3);
    expect(a.length).toBeGreaterThanOrEqual(3);
  });

  it('speaks after eating in its current voice', () => {
    const tart = SNACKS.find((s) => s.id === 'trivia-tart')!;
    expect(snackLine(tart, 'brat')).toMatch(/slightly/);
    expect(snackLine(tart, 'gamer')).toBe(tart.lines.neutral);
  });

  it('turns a topic into a safe snack, AI or local', () => {
    expect(cleanTopic('  Space!!! ')).toBe('Space');
    expect(cleanTopic('visit www.example.com')).toBeNull();
    expect(cleanTopic('my phone 555 123 4567')).toBeNull();
    const local = localTopicCard('basketball');
    expect(local.weights).toHaveProperty('athlete');
    const ok = validTopicCard({ name: 'Comet Crunch', flavor: 'Tastes like a shooting star.', weights: { scholar: 0.8, explorer: 0.4 }, line: 'Whoosh!' })!;
    expect(ok.name).toBe('comet crunch');
    expect((ok.weights.scholar ?? 0) + (ok.weights.explorer ?? 0)).toBeCloseTo(0.03, 3);
    expect(validTopicCard({ name: 'Minecraft Muffin', flavor: 'x', weights: { gamer: 1 } })).toBeNull();
    expect(validTopicCard({ name: 'Ok', flavor: 'x', weights: { wizard: 1 } })).toBeNull();
    const snack = snackFromCard(ok);
    expect(snack.custom).toBe(true);
    expect(snack.shape).toBe('tart');
  });
});
