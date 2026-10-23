import { describe, expect, it } from 'vitest';
import { place, readingMs, resolveOverlap, revealPlan, tokenize, voiceFor } from '../src/ui/speech';

describe('cinematic speech: pure parts', () => {
  it('tokenizes graphemes and *emphasis* (markers removed)', () => {
    const g = tokenize('Ugh. *Love* it 💖');
    expect(g.map((x) => x.ch).join('')).toBe('Ugh. Love it 💖');
    expect(g.filter((x) => x.em).map((x) => x.ch).join('')).toBe('Love');
    expect(g.at(-1)!.ch).toBe('💖');
    expect(new Set(g.map((x) => x.word)).size).toBe(4);
  });

  it('reveals in order, breathes at punctuation, slams whole words for brats, drawls when sleepy', () => {
    const g = tokenize('Hi. Hello there');
    const p = revealPlan(g, 'neutral');
    for (let i = 1; i < p.length; i++) expect(p[i]!).toBeGreaterThanOrEqual(p[i - 1]!);
    expect(p[3]! - p[2]!).toBeGreaterThan(200); // the full stop
    const brat = revealPlan(g, 'brat');
    expect(brat[4]).toBe(brat[5]); // same word, same instant
    const sleepy = revealPlan(g, 'neutral', 'sleepy');
    expect(sleepy.at(-1)!).toBeGreaterThan(p.at(-1)!);
    expect(revealPlan(g, 'royal').at(-1)!).toBeGreaterThan(revealPlan(g, 'gamer').at(-1)!);
  });

  it('leaves words up long enough to read, within bounds', () => {
    expect(readingMs('Hi')).toBe(1800);
    expect(readingMs('word '.repeat(10))).toBeGreaterThan(3000);
    expect(readingMs('word '.repeat(200))).toBe(9000);
  });

  it('never covers the face: above when there is room, beside when not, always on screen', () => {
    const head = { x: 200, y: 500, r: 60 };
    const above = place(head, 220, 70, 400, 860);
    expect(above.side).toBe('above');
    expect(above.y + 70).toBeLessThanOrEqual(head.y - head.r);
    expect(above.tip.y).toBeLessThan(head.y);
    const high = place({ x: 120, y: 110, r: 50 }, 200, 70, 400, 860);
    expect(high.side).toBe('right');
    expect(high.x).toBeGreaterThanOrEqual(120 + 50);
    const cornered = place({ x: 380, y: 100, r: 50 }, 300, 70, 400, 860);
    expect(['left', 'below']).toContain(cornered.side);
    for (const p of [above, high, cornered]) {
      expect(p.x).toBeGreaterThanOrEqual(12);
      expect(p.x).toBeLessThanOrEqual(400);
    }
  });

  it("moves out of other bubbles without covering any KIN's face", () => {
    const me = { x: 120, y: 470, r: 46 };
    const friend = { x: 280, y: 515, r: 46 };
    const other = { x: 40, y: 300, w: 220, h: 60 };
    const p = place(me, 270, 80, 393, 852, 16);
    resolveOverlap(p, 270, 80, me, [other], 393, 852, 16, 12, [friend]);
    const box = { x: p.x, y: p.y, w: 270, h: 80 };
    const hits = (f: { x: number; y: number; r: number }) => box.x < f.x + f.r && box.x + box.w > f.x - f.r && box.y < f.y + f.r && box.y + box.h > f.y - f.r;
    expect(hits(me)).toBe(false);
    expect(hits(friend)).toBe(false);
    expect(box.y + box.h <= other.y || box.y >= other.y + other.h || box.x >= other.x + other.w || box.x + box.w <= other.x).toBe(true);
  });

  it('picks a babble that fits', () => {
    expect(voiceFor('neutral', '', 'Are you there?')).toBe('question');
    expect(voiceFor('brat', 'sassy', 'No.')).toBe('hey');
    expect(voiceFor('royal', 'proud', 'Splendid.')).toBe('hum');
    expect(voiceFor('neutral', 'sleepy', 'zz')).toBe('sleepy');
  });
});
