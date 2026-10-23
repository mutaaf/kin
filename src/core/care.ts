// Care and progression: the relationship model. Pure and deterministic (time is an input), so
// it is fully testable and the same on every device.
//
// House rules (VISION.md): no anxiety-inducing decay, no sickness, no death, no pay-to-win.
// Needs drift gently and floor well above zero. A neglected KIN is simply hungry, sleepy and
// overjoyed to see you. Progress (bond, tricks, collection, garden) only ever goes up.

import { hash, rng } from './rng';

export type Need = 'fullness' | 'fun' | 'clean' | 'rest' | 'affection';
export const NEEDS: readonly Need[] = ['fullness', 'fun', 'clean', 'rest', 'affection'];
export type Needs = Record<Need, number>;

export type Trick = 'sit' | 'spin' | 'highfive' | 'fetch' | 'roll' | 'dance';
export const TRICKS: readonly Trick[] = ['sit', 'spin', 'highfive', 'fetch', 'roll', 'dance'];
/** Bond level at which each trick can be taught. */
export const TRICK_UNLOCK: Record<Trick, number> = { sit: 1, fetch: 1, spin: 2, highfive: 3, roll: 5, dance: 7 };

export type ItemKind = 'pebble' | 'shell' | 'seed' | 'feather' | 'leaf' | 'crystal' | 'acorn';
export interface CatalogItem {
  id: string;
  kind: ItemKind;
  name: string;
  /** 1 common … 4 rare. Shown honestly in the Garden Book. */
  rarity: 1 | 2 | 3 | 4;
  season?: Season;
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** The whole catalogue. Rarity is transparent; nothing is for sale. */
export const CATALOG: readonly CatalogItem[] = [
  { id: 'pebble-round', kind: 'pebble', name: 'Round pebble', rarity: 1 },
  { id: 'pebble-striped', kind: 'pebble', name: 'Striped pebble', rarity: 2 },
  { id: 'pebble-heart', kind: 'pebble', name: 'Heart-shaped pebble', rarity: 3 },
  { id: 'shell-spiral', kind: 'shell', name: 'Spiral shell', rarity: 2 },
  { id: 'shell-fan', kind: 'shell', name: 'Fan shell', rarity: 2 },
  { id: 'shell-pearl', kind: 'shell', name: 'Pearly shell', rarity: 4 },
  { id: 'seed-mint', kind: 'seed', name: 'Mint bell seed', rarity: 1 },
  { id: 'seed-sun', kind: 'seed', name: 'Sunburst seed', rarity: 2, season: 'summer' },
  { id: 'seed-moon', kind: 'seed', name: 'Moonpetal seed', rarity: 3 },
  { id: 'seed-frost', kind: 'seed', name: 'Frost lily seed', rarity: 3, season: 'winter' },
  { id: 'feather-blue', kind: 'feather', name: 'Blue feather', rarity: 2 },
  { id: 'feather-gold', kind: 'feather', name: 'Golden feather', rarity: 4 },
  { id: 'leaf-maple', kind: 'leaf', name: 'Maple leaf', rarity: 1, season: 'autumn' },
  { id: 'leaf-heart', kind: 'leaf', name: 'Heart leaf', rarity: 3 },
  { id: 'acorn', kind: 'acorn', name: 'Acorn with a hat', rarity: 2, season: 'autumn' },
  { id: 'crystal-mint', kind: 'crystal', name: 'Mint crystal', rarity: 3 },
  { id: 'crystal-dusk', kind: 'crystal', name: 'Dusk crystal', rarity: 4 },
];
export const itemById = (id: string) => CATALOG.find((c) => c.id === id);

export interface Plot {
  seed: string | null;
  plantedAt: number;
  /** 0 = seed … 1 = in bloom. */
  growth: number;
  /** 0..1, rain and watering fill it; it slowly dries. */
  water: number;
}

export interface CareState {
  v: 1;
  needs: Needs;
  bondXp: number;
  /** XP earned per kind of verb in the current hour (diminishing returns). */
  hourXp: { hour: number; byVerb: Partial<Record<Verb, number>> };
  skills: Record<Trick, number>;
  attempts: Record<Trick, number>;
  /** item id → count found. */
  collection: Record<string, number>;
  firstFound: Record<string, number>;
  plots: Plot[];
  /** The plant: growth accumulates with daylight; berries ripen on it. */
  plant: { size: number; water: number; berries: number[]; bloom: number };
  /** Decor placed in the garden: item id + position. */
  placed: { id: string; x: number; z: number }[];
  /** Days (YYYY-MM-DD) whose finds were already dug up, and how many. */
  dug: Record<string, number>;
  asleepUnderBlanket: boolean;
  lastAt: number;
  /** Totals, for the Garden Book. */
  stats: { fed: number; baths: number; throws: number; fetches: number; finds: number; friends: number };
}

export type Verb = 'feed' | 'bath' | 'brush' | 'play' | 'pet' | 'tuck' | 'trick' | 'plant' | 'water' | 'find' | 'befriend';

const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const NEED_FLOOR = 0.15;
const HOUR = 3_600_000;

/** Gentle drift per hour (awake). */
const DRIFT: Needs = { fullness: -0.06, fun: -0.08, clean: -0.03, rest: -0.05, affection: -0.04 };

export function newCare(now: number): CareState {
  return {
    v: 1,
    needs: { fullness: 0.75, fun: 0.7, clean: 0.9, rest: 0.85, affection: 0.7 },
    bondXp: 0,
    hourXp: { hour: Math.floor(now / HOUR), byVerb: {} },
    skills: { sit: 0, spin: 0, highfive: 0, fetch: 0, roll: 0, dance: 0 },
    attempts: { sit: 0, spin: 0, highfive: 0, fetch: 0, roll: 0, dance: 0 },
    collection: {},
    firstFound: {},
    plots: [0, 1, 2].map(() => ({ seed: null, plantedAt: 0, growth: 0, water: 0.5 })),
    plant: { size: 0.4, water: 0.7, berries: [0.6], bloom: 0 },
    placed: [],
    dug: {},
    asleepUnderBlanket: false,
    lastAt: now,
    stats: { fed: 0, baths: 0, throws: 0, fetches: 0, finds: 0, friends: 0 },
  };
}

/** Repair a stored state from an older or partial version. Never throws. */
export function reviveCare(raw: unknown, now: number): CareState {
  const base = newCare(now);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<CareState>;
  if (r.v !== 1) return base;
  return {
    ...base,
    ...r,
    needs: { ...base.needs, ...(r.needs ?? {}) },
    skills: { ...base.skills, ...(r.skills ?? {}) },
    attempts: { ...base.attempts, ...(r.attempts ?? {}) },
    stats: { ...base.stats, ...(r.stats ?? {}) },
    plant: { ...base.plant, ...(r.plant ?? {}) },
    plots: Array.isArray(r.plots) && r.plots.length ? r.plots : base.plots,
  };
}

// ── Environment the model reads (no DOM, no three).
export interface Env {
  /** Sun elevation in degrees. */
  sunElev: number;
  tempC: number;
  precipMm: number;
  snow: boolean;
}

/**
 * Advance time. Needs drift (slower while asleep, rest refills), the plant grows with daylight
 * and drinks rain, berries ripen, garden plots grow. Long absences are capped and gentle.
 */
export function tick(c: CareState, now: number, env: Env, asleep: boolean): { care: CareState; fallen: number } {
  const dtH = Math.min(48, Math.max(0, (now - c.lastAt) / HOUR));
  if (dtH <= 0) return { care: c, fallen: 0 };
  const needs = { ...c.needs };
  for (const n of NEEDS) {
    let d = DRIFT[n] * dtH;
    if (asleep) d = n === 'rest' ? 0.3 * dtH : d * 0.35;
    needs[n] = clamp(needs[n] + d, NEED_FLOOR, 1);
  }
  const daylight = env.sunElev > 0 ? Math.min(1, env.sunElev / 30) : 0;
  const raining = env.precipMm > 0.1 && !env.snow;
  // Out in the rain counts as a (gentle) bath.
  if (raining && !asleep) needs.clean = clamp(needs.clean + 0.4 * dtH, NEED_FLOOR, 1);

  const plantWater = clamp(c.plant.water + (raining ? 0.5 : -0.04) * dtH);
  const thirst = plantWater < 0.2 ? 0.3 : 1; // a dry plant grows slowly; it never dies
  const size = clamp(c.plant.size + 0.03 * daylight * thirst * dtH, 0.2, 1);
  // A berry ripens over ~3 h of daylight; a new one sets every ~2 h of daylight, up to 3.
  let berries = c.plant.berries.map((b) => clamp(b + (0.33 * daylight * thirst + 0.02) * dtH, 0, 1.4));
  const fallen = berries.filter((b) => b >= 1.4).length; // overripe berries drop (the world spawns them)
  berries = berries.filter((b) => b < 1.4);
  let bloom = c.plant.bloom + 0.5 * (0.25 + daylight) * thirst * dtH;
  while (bloom >= 1) {
    bloom -= 1;
    if (berries.length < 3 && size > 0.35) berries.push(0);
  }

  const plots = c.plots.map((p) => {
    if (!p.seed) return p;
    const water = clamp(p.water + (raining ? 0.6 : -0.08) * dtH);
    const rate = water > 0.15 ? 1 / 48 : 1 / 160; // ~2 real days to bloom when watered
    return { ...p, water, growth: clamp(p.growth + rate * dtH * (0.4 + 0.6 * daylight)) };
  });

  return { care: { ...c, needs, plant: { ...c.plant, water: plantWater, size, berries, bloom }, plots, lastAt: now }, fallen };
}

/** True when the KIN has been away from you long enough to deserve a reunion. */
export const isReunion = (prevLastAt: number, now: number) => now - prevLastAt > 6 * HOUR;

// ── Verbs
export interface Outcome {
  care: CareState;
  xp: number;
  /** Did a trick land? */
  success?: boolean;
  levelUp?: number;
}

const VERB_XP: Record<Verb, number> = { feed: 6, bath: 6, brush: 4, play: 5, pet: 2, tuck: 5, trick: 7, plant: 8, water: 3, find: 4, befriend: 10 };
/** XP from one verb within an hour: full for the first 5, then halving. Never zero. */
function xpFor(c: CareState, verb: Verb, now: number): [number, CareState['hourXp']] {
  const hour = Math.floor(now / HOUR);
  const hx = c.hourXp.hour === hour ? c.hourXp : { hour, byVerb: {} };
  const n = hx.byVerb[verb] ?? 0;
  const xp = Math.max(0.5, VERB_XP[verb] * (n < 5 ? 1 : 0.5 ** (n - 4)));
  return [xp, { hour, byVerb: { ...hx.byVerb, [verb]: n + 1 } }];
}

function gain(c: CareState, verb: Verb, now: number, needs: Partial<Needs>): Outcome {
  const [xp, hourXp] = xpFor(c, verb, now);
  const merged = { ...c.needs };
  for (const [k, v] of Object.entries(needs) as [Need, number][]) merged[k] = clamp(merged[k] + v, NEED_FLOOR, 1);
  const before = bondLevel(c.bondXp).level;
  const bondXp = c.bondXp + xp;
  const after = bondLevel(bondXp).level;
  return { care: { ...c, needs: merged, bondXp, hourXp }, xp, levelUp: after > before ? after : undefined };
}

export function feed(c: CareState, now: number, ripeness = 1): Outcome {
  const o = gain(c, 'feed', now, { fullness: 0.3 + 0.1 * Math.min(1, ripeness), affection: 0.04 });
  o.care = { ...o.care, stats: { ...o.care.stats, fed: o.care.stats.fed + 1 } };
  return o;
}
export function bath(c: CareState, now: number): Outcome {
  const o = gain(c, 'bath', now, { clean: 0.55, fun: 0.05 });
  o.care = { ...o.care, stats: { ...o.care.stats, baths: o.care.stats.baths + 1 } };
  return o;
}
export const brush = (c: CareState, now: number) => gain(c, 'brush', now, { clean: 0.12, affection: 0.08 });
export const pet = (c: CareState, now: number) => gain(c, 'pet', now, { affection: 0.06 });
export function play(c: CareState, now: number, kind: 'throw' | 'fetch' | 'toy'): Outcome {
  const o = gain(c, 'play', now, { fun: kind === 'fetch' ? 0.18 : 0.1, rest: -0.02, fullness: -0.01 });
  const s = o.care.stats;
  o.care = { ...o.care, stats: { ...s, throws: s.throws + (kind === 'throw' ? 1 : 0), fetches: s.fetches + (kind === 'fetch' ? 1 : 0) } };
  return o;
}
export function tuck(c: CareState, now: number): Outcome {
  const o = gain(c, 'tuck', now, { affection: 0.1 });
  o.care = { ...o.care, asleepUnderBlanket: true };
  return o;
}
export const wake = (c: CareState): CareState => ({ ...c, asleepUnderBlanket: false });

/** Mood multiplier for tricks: a happy, fed, rested KIN performs better. */
export function mood(c: CareState): number {
  const n = c.needs;
  return clamp(0.45 + 0.55 * ((n.fun + n.rest + n.affection + n.fullness) / 4), 0.4, 1);
}

export function canTeach(c: CareState, t: Trick) {
  return bondLevel(c.bondXp).level >= TRICK_UNLOCK[t];
}

/** Ask for a trick. Practice always teaches; success is skill × mood, with a seeded roll. */
export function trick(c: CareState, now: number, t: Trick, roll: number): Outcome {
  const skill = c.skills[t];
  const p = 0.12 + 0.8 * skill * mood(c);
  const success = roll < p;
  const learned = clamp(skill + (success ? 0.08 : 0.05) * (1 - skill));
  const o = gain(c, 'trick', now, { fun: 0.06, affection: success ? 0.04 : 0.01 });
  o.care = { ...o.care, skills: { ...o.care.skills, [t]: learned }, attempts: { ...o.care.attempts, [t]: o.care.attempts[t] + 1 } };
  o.success = success;
  return o;
}

export function collect(c: CareState, now: number, id: string): Outcome {
  const o = gain(c, 'find', now, { fun: 0.05 });
  const count = (o.care.collection[id] ?? 0) + 1;
  o.care = {
    ...o.care,
    collection: { ...o.care.collection, [id]: count },
    firstFound: o.care.firstFound[id] ? o.care.firstFound : { ...o.care.firstFound, [id]: now },
    stats: { ...o.care.stats, finds: o.care.stats.finds + 1 },
  };
  return o;
}

export function befriend(c: CareState, now: number): Outcome {
  const o = gain(c, 'befriend', now, { fun: 0.1, affection: 0.05 });
  o.care = { ...o.care, stats: { ...o.care.stats, friends: o.care.stats.friends + 1 } };
  return o;
}

/** Plant a seed from the collection in a free plot. */
export function plant(c: CareState, now: number, plot: number, seedId: string): Outcome | null {
  const p = c.plots[plot];
  if (!p || p.seed || !((c.collection[seedId] ?? 0) > 0) || itemById(seedId)?.kind !== 'seed') return null;
  const o = gain(c, 'plant', now, { fun: 0.05 });
  const plots = o.care.plots.map((x, i) => (i === plot ? { seed: seedId, plantedAt: now, growth: 0, water: 0.6 } : x));
  o.care = { ...o.care, plots, collection: { ...o.care.collection, [seedId]: c.collection[seedId]! - 1 } };
  return o;
}

export function water(c: CareState, now: number, target: 'plant' | number): Outcome {
  const o = gain(c, 'water', now, {});
  if (target === 'plant') o.care = { ...o.care, plant: { ...o.care.plant, water: 1 } };
  else o.care = { ...o.care, plots: o.care.plots.map((p, i) => (i === target ? { ...p, water: 1 } : p)) };
  return o;
}

/** Pick a berry from the plant (the ripest). Returns its ripeness, or null if none. */
export function pickBerry(c: CareState): { care: CareState; ripeness: number } | null {
  if (!c.plant.berries.length) return null;
  const i = c.plant.berries.indexOf(Math.max(...c.plant.berries));
  const ripeness = c.plant.berries[i]!;
  return { care: { ...c, plant: { ...c.plant, berries: c.plant.berries.filter((_, j) => j !== i) } }, ripeness };
}

/** More garden plots open as the bond grows (3, then +1 every 3 levels, up to 8). */
export function plotCount(c: CareState) {
  return Math.min(8, 3 + Math.floor(bondLevel(c.bondXp).level / 3));
}
export function ensurePlots(c: CareState): CareState {
  const n = plotCount(c);
  if (c.plots.length >= n) return c;
  return { ...c, plots: [...c.plots, ...Array.from({ length: n - c.plots.length }, () => ({ seed: null, plantedAt: 0, growth: 0, water: 0.5 }))] };
}

// ── Bond: infinite levels
const BOND_NAMES = ['New friends', 'Curious', 'Trusting', 'Pals', 'Close', 'Best friends', 'Inseparable', 'Kindred'];
export function bondLevel(xp: number): { level: number; name: string; into: number; need: number } {
  let level = 1;
  let need = 60;
  let left = xp;
  while (left >= need) {
    left -= need;
    level++;
    need = Math.round(60 * level ** 1.35);
  }
  const name = level <= BOND_NAMES.length ? BOND_NAMES[level - 1]! : `Kindred ${level - BOND_NAMES.length + 1}`;
  return { level, name, into: left, need };
}

// ── Time: seasons and daily surprises
export function season(date: Date, lat: number): Season {
  const m = date.getMonth(); // 0..11
  const north: Season = m < 2 || m === 11 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'autumn';
  if (lat >= 0) return north;
  return ({ winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' } as const)[north];
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type SurpriseKind = 'bird' | 'lost-toy' | 'butterfly-swarm' | 'shooting-star' | 'shell-wash' | 'golden-find';
export interface Surprise {
  kind: SurpriseKind;
  /** Local hour when it becomes possible. */
  hour: number;
}

/** The day's surprises: a pure function of the date and the KIN, so it's stable all day. */
export function surprisesFor(date: Date, kinSeed: number): Surprise[] {
  const r = rng(hash(`surprise:${dayKey(date)}:${kinSeed}`));
  const pool: Surprise[] = [
    { kind: 'bird', hour: 7 + Math.floor(r() * 4) },
    { kind: 'lost-toy', hour: 10 + Math.floor(r() * 6) },
    { kind: 'butterfly-swarm', hour: 11 + Math.floor(r() * 4) },
    { kind: 'shooting-star', hour: 21 + Math.floor(r() * 2) },
    { kind: 'shell-wash', hour: 8 + Math.floor(r() * 8) },
    { kind: 'golden-find', hour: 9 + Math.floor(r() * 9) },
  ];
  const n = 1 + (r() < 0.55 ? 1 : 0);
  const out: Surprise[] = [];
  while (out.length < n) {
    const s = pool.splice(Math.floor(r() * pool.length), 1)[0]!;
    if (s.kind === 'golden-find' && r() < 0.6) continue; // rarer
    out.push(s);
  }
  return out.sort((a, b) => a.hour - b.hour);
}

/** What a dig turns up today: seeded by date + KIN + how many digs so far; seasonal items weighted. */
export function dig(date: Date, kinSeed: number, nth: number, s: Season, golden = false): CatalogItem | null {
  if (nth >= 4 && !golden) return null; // a few finds a day keeps them special
  const r = rng(hash(`dig:${dayKey(date)}:${kinSeed}:${nth}`));
  if (golden) return CATALOG.find((c) => c.id === (r() < 0.5 ? 'feather-gold' : 'crystal-dusk'))!;
  const weights = CATALOG.map((c) => {
    if (c.season && c.season !== s) return 0;
    const base = [0, 10, 4, 1.4, 0.4][c.rarity]!;
    return c.season === s ? base * 2 : base;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < CATALOG.length; i++) {
    x -= weights[i]!;
    if (x <= 0) return CATALOG[i]!;
  }
  return CATALOG[0]!;
}

/** The lowest need, if it's low enough to show a soft glyph. */
export function wants(c: CareState): Need[] {
  return NEEDS.filter((n) => c.needs[n] < 0.38).sort((a, b) => c.needs[a] - c.needs[b]).slice(0, 2);
}
