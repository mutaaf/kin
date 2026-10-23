import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, blend, classify, dialogueStyle, dominant, experience, expression, grow, newPersona, personaCard,
  revivePersona, settle, title, why, type Persona,
} from '../src/core/persona';
import { makeTraits } from '../src/core/genome';
import { cleanCard, IP_WORDS } from '../src/ai/schema';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 9, 23, 12);
const fresh = () => newPersona(makeTraits(7), t0);
const feedFor = (p: Persona, a: (typeof ARCHETYPES)[number], days: number, perDay = 6) => {
  for (let d = 0; d < days; d++) for (let i = 0; i < perDay; i++) p = experience(p, { k: 'fed', snack: a, deltas: { [a]: 0.03 }, label: `${a} snack` }, t0 + d * DAY + i * 60_000);
  return p;
};

describe('persona', () => {
  it('starts as a little one, leaning slightly on its own traits', () => {
    const p = fresh();
    expect(title(p)).toBe('Little One');
    for (const a of ARCHETYPES) expect(p.levels[a]).toBeLessThan(0.1);
  });

  it('grows gradually: one snack flavours it, a week of the same snacks changes it', () => {
    let p = fresh();
    p = experience(p, { k: 'fed', snack: 'trivia-tart', deltas: { scholar: 0.03 } }, t0);
    expect(p.levels.scholar).toBeLessThan(0.12);
    p = feedFor(p, 'scholar', 7);
    expect(p.levels.scholar).toBeGreaterThan(0.45);
    expect(dominant(p)).toBe('scholar');
    expect(title(p)).toMatch(/Scholar/);
  });

  it('caps growth per day (no overnight transformations)', () => {
    const p = feedFor(fresh(), 'royal', 1, 50);
    expect(p.levels.royal).toBeLessThan(0.25);
  });

  it('blends: a sporty brat is a normal outcome', () => {
    let p = feedFor(fresh(), 'brat', 6);
    p = feedFor(p, 'athlete', 4, 4);
    const b = blend(p);
    expect(b[0]![0]).toBe('brat');
    expect(b[1]![0]).toBe('athlete');
    expect(title(p)).toBe('Sporty Brat');
    expect(dialogueStyle(p)).toMatch(/Brat.*Athlete|Athlete.*Brat/s);
  });

  it('stays bounded and is reversible: without input it relaxes toward its own nature', () => {
    let p = feedFor(fresh(), 'gamer', 20, 12);
    for (const a of ARCHETYPES) expect(p.levels[a]).toBeLessThanOrEqual(1);
    const high = p.levels.gamer;
    p = settle(p, t0 + 120 * DAY, {});
    expect(p.levels.gamer).toBeLessThan(high * 0.7);
    expect(p.levels.gamer).toBeGreaterThanOrEqual(p.base.gamer - 1e-9);
  });

  it('a steered archetype grows faster and does not fade', () => {
    let p = experience(fresh(), { k: 'steer', a: 'artist' }, t0);
    p = feedFor(p, 'artist', 5);
    const lv = p.levels.artist;
    p = settle(p, t0 + 60 * DAY, {});
    expect(p.levels.artist).toBe(lv);
  });

  it('habits leave a trace: a night owl leans gamer', () => {
    let p = fresh();
    for (let i = 1; i <= 60; i++) p = settle(p, t0 + i * 10 * 60_000, { hour: 23, active: true });
    expect(p.levels.gamer).toBeGreaterThan(fresh().levels.gamer);
    expect(why(p).join(' ')).toMatch(/stays up late/);
  });

  it('explains itself and talks are classified by a generic lexicon', () => {
    let p = feedFor(fresh(), 'popstar', 3);
    p = experience(p, { k: 'talk', text: 'can you sing me a song about the stage?' }, t0 + 3 * DAY);
    expect(why(p)[0]).toMatch(/ate popstar snack.*Pop Star/);
    expect(classify('What planet is the biggest?')).toHaveProperty('scholar');
    expect(classify('let us play a game')).toHaveProperty('gamer');
  });

  it('exposes expression hooks for render and voice', () => {
    const p = feedFor(fresh(), 'royal', 12);
    const ex = expression(p);
    expect(ex.dominant).toBe('royal');
    expect(ex.accessories.map((a) => a.id)).toContain('crown-tiny');
    expect(ex.speech).toBe('royal');
    expect(ex.voice.tempo).toBeLessThan(1);
  });

  it('is deterministic and survives storage round-trips (and junk)', () => {
    const a = feedFor(fresh(), 'explorer', 4);
    const b = feedFor(fresh(), 'explorer', 4);
    expect(a).toEqual(b);
    expect(revivePersona(JSON.parse(JSON.stringify(a)), makeTraits(7), t0 + 5 * DAY)).toEqual(a);
    const junk = revivePersona({ v: 1, levels: { scholar: 9, nope: 3 }, steer: 'evil' }, makeTraits(7), t0);
    expect(junk.levels.scholar).toBe(1);
    expect(junk.steer).toBeNull();
  });

  it('never moves on non-finite or unknown deltas', () => {
    const p = fresh();
    const q = grow(p, { scholar: Number.NaN, wizard: 0.5 } as Record<string, number>, 'x', t0);
    expect(q.levels).toEqual(p.levels);
  });

  it('travels to the AI as a clean card, free of IP', () => {
    const card = personaCard(feedFor(fresh(), 'popstar', 6));
    const c = cleanCard({
      name: 'Lumi', temperament: 'playful', traits: makeTraits(7), drives: { energy: 0.5, social: 0.5, curious: 0.5, comfort: 0.5 },
      weather: { word: 'sunny', tempC: 20, windKmh: 5 }, timeOfDay: 'afternoon', doing: 'sit', recent: [], friends: [], persona: { ...card, blend: [...card.blend, ['wizard', 1]] },
    })!;
    expect(c.persona!.title).toMatch(/Pop Star/);
    expect(c.persona!.blend.every(([a]) => ARCHETYPES.includes(a))).toBe(true);
    expect(IP_WORDS.test(JSON.stringify(card))).toBe(false);
  });
});
