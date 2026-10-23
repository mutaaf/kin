// Personality that grows. A KIN isn't a class picked from a menu: it's a blend over a few
// archetypes that drifts, slowly and explainably, with what it lives through: what you feed it,
// how you play, the tricks it practises, when it's awake, who it visits, the weather, and what you
// talk about. A sporty brat and a royal scholar are both normal outcomes. Pure, deterministic,
// bounded (every level stays in 0..1), reversible (levels relax toward the KIN's own baseline,
// and you can steer), and it keeps a readable history of why it's becoming what it is.
//
// No IP: "Pop Star" means generic show-biz, trend-savvy energy; no real people, brands or games.
//
// ── Integration for app.ts / the world ───────────────────────────────────────────────────────
//   import { loadPersona, savePersona, experience, settle, expression, personaCard } from './core/persona';
//   let persona = loadPersona(kv, slot, kin.seed, kin.traits, Date.now());
//   const grow = (ev: Experience) => { persona = experience(persona, ev, Date.now()); savePersona(kv, slot, persona); };
//   // Feeding (src/world/feed.ts calls back with the snack it ate):
//   //   new FeedSystem(world.world, stage, { onEaten: (s) => grow({ k: 'fed', snack: s.id, deltas: s.deltas, label: s.name }) })
//   // Play and care (from world events / care UI):  grow({ k: 'play', kind: 'fetch' }), grow({ k: 'trick', trick: 'dance' }),
//   //   grow({ k: 'groomed' }), grow({ k: 'found' }), grow({ k: 'decorated' }), grow({ k: 'garden' })
//   // Visits (owner fx 'home' with a memory, host fx 'hosting'): grow({ k: 'visit', friend: theirTopArchetype })
//   // Talking to the AI: grow({ k: 'talk', text: question })    ← keyword lexicon, no AI needed
//   // Once a minute from the brain tick:  persona = settle(persona, Date.now(), { hour, weather: weatherWord(sky), active: current.action !== 'sleep' })
//   // AI director card: { ...cardNow(), persona: personaCard(persona) }
//   // Render/world hooks (later): expression(persona) → { title, emotes, idles, accessories, voice, speech }
// ──────────────────────────────────────────────────────────────────────────────────────────────

// Structural types only: this module is shared with the Worker, so it imports nothing.
/** Same shape as genome.ts Traits. */
export interface Traits {
  curiosity: number;
  bravery: number;
  playfulness: number;
  warmth: number;
  energy: number;
}
/** Same shape as persistence/store.ts KV. */
interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const ARCHETYPES = ['popstar', 'scholar', 'gamer', 'athlete', 'brat', 'royal', 'explorer', 'artist'] as const;
export type Archetype = (typeof ARCHETYPES)[number];
export type Levels = Record<Archetype, number>;

export const NOUN: Record<Archetype, string> = {
  popstar: 'Pop Star', scholar: 'Scholar', gamer: 'Gamer', athlete: 'Athlete',
  brat: 'Brat', royal: 'Royal', explorer: 'Explorer', artist: 'Artist',
};
export const ADJ: Record<Archetype, string> = {
  popstar: 'Starry', scholar: 'Bookish', gamer: 'Gamer', athlete: 'Sporty',
  brat: 'Bratty', royal: 'Royal', explorer: 'Wandering', artist: 'Arty',
};
/** Accent hue per archetype, for titles, chips and speech styling. */
export const HUE: Record<Archetype, number> = {
  popstar: 320, scholar: 205, gamer: 265, athlete: 25, brat: 345, royal: 45, explorer: 150, artist: 185,
};

export interface HistoryEntry {
  at: number;
  a: Archetype;
  d: number;
  why: string;
}

export interface Persona {
  v: 1;
  levels: Levels;
  /** Where it relaxes back to: the KIN's own nature, from its seed traits. */
  base: Levels;
  history: HistoryEntry[];
  /** Diminishing returns: how much each archetype has gained today. */
  day: { key: string; gained: Partial<Levels> };
  /** Last time `settle` ran (decay and habits are time-based). */
  settledAt: number;
  /** Optional gentle steer the player chose; null = let it grow. */
  steer: Archetype | null;
}

export type Experience =
  | { k: 'fed'; snack: string; deltas: Partial<Levels>; label?: string }
  | { k: 'play'; kind: 'fetch' | 'throw' | 'toy' | 'chase' }
  | { k: 'trick'; trick: string }
  | { k: 'groomed' }
  | { k: 'bath' }
  | { k: 'found'; rare?: boolean }
  | { k: 'dig' }
  | { k: 'decorated' }
  | { k: 'garden' }
  | { k: 'visit'; friend?: Archetype | null; friendName?: string }
  | { k: 'hosted'; friend?: Archetype | null; friendName?: string }
  | { k: 'ignored' }
  | { k: 'talk'; text: string }
  | { k: 'steer'; a: Archetype | null };

const DAY_CAP = 0.12; // the most any one archetype can grow in a day, so change stays gradual
const HISTORY = 40;
const RELAX_PER_DAY = 0.02; // fraction of the gap to baseline that closes per day without input

const zero = (): Levels => Object.fromEntries(ARCHETYPES.map((a) => [a, 0])) as Levels;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A KIN's nature, from its traits: small leanings, never a destiny. */
export function baseline(t: Traits): Levels {
  const b = zero();
  b.athlete = 0.02 + 0.06 * t.energy * t.bravery;
  b.gamer = 0.02 + 0.06 * t.playfulness * t.curiosity;
  b.popstar = 0.02 + 0.06 * t.warmth * t.playfulness;
  b.scholar = 0.02 + 0.06 * t.curiosity * (1 - t.playfulness * 0.5);
  b.explorer = 0.02 + 0.06 * t.bravery * t.curiosity;
  b.brat = 0.01 + 0.05 * (1 - t.warmth) * t.playfulness;
  b.royal = 0.01 + 0.05 * (1 - t.warmth) * (1 - t.playfulness * 0.5);
  b.artist = 0.02 + 0.05 * t.curiosity * t.warmth;
  for (const a of ARCHETYPES) b[a] = Math.round(b[a] * 1000) / 1000;
  return b;
}

export function newPersona(traits: Traits, now: number): Persona {
  const base = baseline(traits);
  return { v: 1, levels: { ...base }, base, history: [], day: { key: dayKey(now), gained: {} }, settledAt: now, steer: null };
}

// What each experience nudges, and how to say why. Deltas are small; a week of the same kind of
// care visibly changes a KIN, a single snack only flavours it.
const RULES: Record<Exclude<Experience['k'], 'fed' | 'talk' | 'visit' | 'hosted' | 'steer' | 'trick' | 'play' | 'found'>, [Partial<Levels>, string]> = {
  groomed: [{ royal: 0.012, popstar: 0.004 }, 'loves being groomed'],
  bath: [{ royal: 0.006, athlete: 0.003 }, 'enjoys a fresh bath'],
  dig: [{ explorer: 0.01, athlete: 0.003 }, 'keeps digging for treasure'],
  decorated: [{ artist: 0.014, royal: 0.004 }, 'decorates the garden'],
  garden: [{ artist: 0.008, scholar: 0.004 }, 'tends the garden'],
  ignored: [{ brat: 0.01 }, 'was left waiting'],
};

const TRICKS: Record<string, [Partial<Levels>, string]> = {
  dance: [{ popstar: 0.016 }, 'practises its dance'],
  spin: [{ popstar: 0.008, athlete: 0.006 }, 'practises spins'],
  highfive: [{ athlete: 0.008, popstar: 0.004 }, 'loves a high-five'],
  fetch: [{ athlete: 0.012 }, 'trains at fetch'],
  roll: [{ gamer: 0.006, brat: 0.004 }, 'shows off a roll'],
  sit: [{ royal: 0.006, scholar: 0.004 }, 'practises sitting nicely'],
};

const PLAY: Record<string, [Partial<Levels>, string]> = {
  fetch: [{ athlete: 0.01, gamer: 0.003 }, 'plays fetch'],
  throw: [{ athlete: 0.006 }, 'chases what you throw'],
  toy: [{ gamer: 0.008 }, 'plays with toys'],
  chase: [{ athlete: 0.008, explorer: 0.003 }, 'chases things'],
};

// Talking: a tiny keyword lexicon maps a sentence to the worlds it touches. Generic words only.
export const LEXICON: Record<Archetype, RegExp> = {
  popstar: /\b(sing|song|music|dance|star|stage|concert|fashion|trend|famous|camera|show|party|glitter|style|pop)\w*/i,
  scholar: /\b(why|how|fact|learn|book|read|science|space|planet|history|math|wiki|know|study|school|ocean|dinosaur|atom|brain)\w*/i,
  gamer: /\b(game|play|level|boss|quest|score|pixel|controller|arcade|puzzle|speedrun|win|loot|console|joystick)\w*/i,
  athlete: /\b(run|sport|ball|soccer|football|basketball|tennis|swim|race|gym|jump|team|goal|train|fast|strong)\w*/i,
  brat: /\b(no+|mine|whatever|boring|ugh|nope|meh|sass|rude|bossy|grumpy|demand)\w*/i,
  royal: /\b(king|queen|crown|castle|prince|princess|royal|palace|throne|fancy|tea|jewel|gold|velvet)\w*/i,
  explorer: /\b(explore|adventure|map|mountain|forest|travel|camp|hike|cave|island|treasure|journey|wild)\w*/i,
  artist: /\b(draw|paint|art|color|colour|craft|build|design|poem|story|sculpt|doodle|create)\w*/i,
};

export function classify(text: string): Partial<Levels> {
  const out: Partial<Levels> = {};
  const t = text.slice(0, 200);
  for (const a of ARCHETYPES) if (LEXICON[a].test(t)) out[a] = 1;
  return out;
}

/** Apply one experience. Pure: returns a new persona. */
export function experience(p: Persona, ev: Experience, now: number): Persona {
  let deltas: Partial<Levels> = {};
  let why = '';
  switch (ev.k) {
    case 'fed':
      deltas = ev.deltas;
      why = `ate ${ev.label ?? 'a snack'}`;
      break;
    case 'play':
      [deltas, why] = PLAY[ev.kind] ?? [{}, ''];
      break;
    case 'trick':
      [deltas, why] = TRICKS[ev.trick] ?? [{ popstar: 0.004 }, 'learns tricks'];
      break;
    case 'found':
      deltas = { explorer: ev.rare ? 0.016 : 0.008 };
      why = ev.rare ? 'found something rare' : 'finds little treasures';
      break;
    case 'visit':
    case 'hosted': {
      deltas = { explorer: ev.k === 'visit' ? 0.01 : 0.002, popstar: 0.004 };
      if (ev.friend) deltas = { ...deltas, [ev.friend]: (deltas[ev.friend] ?? 0) + 0.01 };
      why = ev.friendName ? `${ev.k === 'visit' ? 'visited' : 'hosted'} ${ev.friendName}` : ev.k === 'visit' ? 'went visiting' : 'had a visitor';
      break;
    }
    case 'talk': {
      const hits = classify(ev.text);
      const n = Object.keys(hits).length;
      for (const a of Object.keys(hits) as Archetype[]) deltas[a] = 0.01 / Math.max(1, n);
      why = 'talked with you';
      break;
    }
    case 'steer':
      return { ...p, steer: ev.a };
    default: {
      const r = RULES[ev.k];
      [deltas, why] = r;
    }
  }
  return grow(p, deltas, why, now);
}

/** Add deltas with diminishing returns (per day cap, saturation near 1), and log why. */
export function grow(p: Persona, deltas: Partial<Levels>, why: string, now: number): Persona {
  const key = dayKey(now);
  const gained: Partial<Levels> = key === p.day.key ? { ...p.day.gained } : {};
  const levels = { ...p.levels };
  const log: HistoryEntry[] = [];
  for (const [a, raw] of Object.entries(deltas) as [Archetype, number][]) {
    if (!ARCHETYPES.includes(a) || !Number.isFinite(raw) || raw === 0) continue;
    let d = Math.max(-0.08, Math.min(0.08, raw));
    if (p.steer && a === p.steer && d > 0) d *= 1.5;
    if (d > 0) {
      const room = Math.max(0, DAY_CAP - (gained[a] ?? 0));
      d = Math.min(d, room) * (1 - levels[a]); // saturates toward 1
      gained[a] = (gained[a] ?? 0) + d;
    } else {
      d = d * levels[a];
    }
    if (Math.abs(d) < 1e-5) continue;
    levels[a] = clamp01(levels[a] + d);
    // Gentle lateral pull: growing one side of a personality slightly quiets the strongest other.
    if (d > 0) {
      const top = ARCHETYPES.filter((x) => x !== a).reduce((m, x) => (levels[x] > levels[m] ? x : m), a === 'popstar' ? 'scholar' : 'popstar');
      levels[top] = clamp01(levels[top] - d * 0.15);
    }
    log.push({ at: now, a, d: Math.round(d * 10000) / 10000, why });
  }
  if (!log.length) return { ...p, day: { key, gained } };
  return { ...p, levels, day: { key, gained }, history: [...log, ...p.history].slice(0, HISTORY) };
}

/**
 * Time-based drift: levels relax toward the KIN's own nature (so it's always reversible), and
 * habits leave a trace (night owls lean gamer, early risers lean athlete, snow days make explorers).
 * Call about once a minute; it's idempotent over short intervals.
 */
export function settle(p: Persona, now: number, ctx: { hour?: number; weather?: string; active?: boolean } = {}): Persona {
  const days = Math.max(0, Math.min(30, (now - p.settledAt) / 86_400_000));
  if (days < 1 / 1440) return p; // under a minute
  const levels = { ...p.levels };
  const k = 1 - Math.pow(1 - RELAX_PER_DAY, days);
  for (const a of ARCHETYPES) {
    if (p.steer === a) continue; // the steered archetype doesn't fade
    levels[a] = clamp01(levels[a] + (p.base[a] - levels[a]) * k);
  }
  let next: Persona = { ...p, levels, settledAt: now };
  if (ctx.active && ctx.hour !== undefined) {
    const mins = days * 1440;
    const per = 0.0004 * Math.min(10, mins);
    if (ctx.hour >= 22 || ctx.hour < 4) next = grow(next, { gamer: per }, 'stays up late', now);
    else if (ctx.hour >= 5 && ctx.hour < 8) next = grow(next, { athlete: per }, 'is an early riser', now);
    if (ctx.weather === 'snowy' || ctx.weather === 'windy') next = grow(next, { explorer: per * 0.5 }, `loves ${ctx.weather} days`, now);
    if (ctx.weather === 'sunny') next = grow(next, { athlete: per * 0.3, popstar: per * 0.2 }, 'soaks up the sun', now);
  }
  return next;
}

// ── Reading the persona ────────────────────────────────────────────────────────────────────────

/** Shares of each archetype above baseline, strongest first. */
export function blend(p: Persona): [Archetype, number][] {
  const above = ARCHETYPES.map((a) => [a, Math.max(0, p.levels[a] - p.base[a] * 0.5)] as [Archetype, number]);
  const total = above.reduce((s, [, v]) => s + v, 0) || 1;
  return above.map(([a, v]) => [a, v / total] as [Archetype, number]).sort((x, y) => y[1] - x[1]);
}

/** 0 (a trace) … 4 (fully that). */
export function tier(level: number): 0 | 1 | 2 | 3 | 4 {
  return level >= 0.85 ? 4 : level >= 0.6 ? 3 : level >= 0.35 ? 2 : level >= 0.15 ? 1 : 0;
}

export function title(p: Persona): string {
  const ranked = ARCHETYPES.map((a) => [a, p.levels[a]] as [Archetype, number]).sort((x, y) => y[1] - x[1]);
  const [a1, l1] = ranked[0]!;
  const [a2, l2] = ranked[1]!;
  if (l1 < 0.15) return 'Little One';
  if (l2 < 0.15 || l2 < l1 * 0.55) return `${tier(l1) >= 3 ? 'True ' : ''}${NOUN[a1]}`;
  return `${ADJ[a2]} ${NOUN[a1]}`;
}

export const dominant = (p: Persona): Archetype => ARCHETYPES.reduce((m, a) => (p.levels[a] > p.levels[m] ? a : m), 'popstar' as Archetype);

export interface Expression {
  title: string;
  dominant: Archetype;
  hue: number;
  tiers: Record<Archetype, number>;
  /** Emotes it reaches for more often (KinView.emote kinds). */
  emotes: string[];
  /** Idle flourishes it prefers (KinView.idleFlourish kinds). */
  idles: string[];
  /** Accessories it has earned (render track draws them later). */
  accessories: { id: string; label: string; archetype: Archetype }[];
  /** Voice shaping for the babble synth. */
  voice: { pitch: number; tempo: number };
  /** Speech style key for the speech layer (speech.ts). */
  speech: Archetype | 'neutral';
}

const EMOTES: Record<Archetype, string[]> = {
  popstar: ['sparkle', 'note', 'heart'], scholar: ['question', 'exclaim'], gamer: ['exclaim', 'sparkle'],
  athlete: ['exclaim', 'sweat'], brat: ['cloud', 'exclaim'], royal: ['sparkle', 'heart'],
  explorer: ['question', 'sparkle'], artist: ['heart', 'note'],
};
const IDLES: Record<Archetype, string[]> = {
  popstar: ['hum', 'spin'], scholar: ['headTilt', 'stargaze'], gamer: ['tailChase', 'roll'],
  athlete: ['stretch', 'tailChase'], brat: ['shake', 'roll'], royal: ['sway', 'groom'],
  explorer: ['headTilt', 'stargaze'], artist: ['hum', 'sway'],
};
const GEAR: Record<Archetype, [number, string, string][]> = {
  popstar: [[1, 'sparkle-clip', 'a sparkly hair clip'], [3, 'star-shades', 'star-shaped shades']],
  scholar: [[1, 'tiny-glasses', 'tiny round glasses'], [3, 'scroll', 'a little scroll']],
  gamer: [[1, 'headset', 'a tiny headset'], [3, 'cap-backwards', 'a backwards cap']],
  athlete: [[1, 'headband', 'a sweatband'], [3, 'jersey', 'a team jersey']],
  brat: [[1, 'bow-tilt', 'a tilted bow'], [3, 'bubblegum', 'a bubblegum bubble']],
  royal: [[1, 'crown-tiny', 'a tiny crown'], [3, 'cape', 'a velvet cape']],
  explorer: [[1, 'scarf', 'a trail scarf'], [3, 'backpack', 'a tiny backpack']],
  artist: [[1, 'beret', 'a beret'], [3, 'paint-smudge', 'a paint smudge']],
};

export function expression(p: Persona): Expression {
  const tiers = Object.fromEntries(ARCHETYPES.map((a) => [a, tier(p.levels[a])])) as Record<Archetype, number>;
  const ranked = blend(p);
  const top = ranked.filter(([a]) => tiers[a] >= 1).map(([a]) => a);
  const dom = dominant(p);
  const accessories = ARCHETYPES.flatMap((a) => GEAR[a].filter(([t]) => tiers[a] >= t).map(([, id, label]) => ({ id, label, archetype: a })));
  const lv = p.levels;
  return {
    title: title(p),
    dominant: dom,
    hue: HUE[dom],
    tiers,
    emotes: [...new Set(top.slice(0, 2).flatMap((a) => EMOTES[a]))],
    idles: [...new Set(top.slice(0, 2).flatMap((a) => IDLES[a]))],
    accessories,
    voice: {
      pitch: 1 + 0.12 * lv.popstar - 0.1 * lv.royal + 0.08 * lv.brat,
      tempo: 1 + 0.15 * lv.gamer + 0.12 * lv.athlete - 0.12 * lv.royal - 0.05 * lv.scholar,
    },
    speech: tiers[dom] >= 1 ? dom : 'neutral',
  };
}

/** The most important reasons, aggregated: "eats lots of trivia tarts (+Scholar)". */
export function why(p: Persona, n = 4): string[] {
  const agg = new Map<string, { a: Archetype; d: number; count: number }>();
  for (const h of p.history) {
    if (h.d <= 0) continue;
    const k = `${h.a}|${h.why}`;
    const cur = agg.get(k) ?? { a: h.a, d: 0, count: 0 };
    agg.set(k, { a: h.a, d: cur.d + h.d, count: cur.count + 1 });
  }
  return [...agg.entries()]
    .sort((x, y) => y[1].d - x[1].d)
    .slice(0, n)
    .map(([k, v]) => `${k.split('|')[1]}${v.count > 1 ? ` (${v.count}×)` : ''} → more ${NOUN[v.a]}`);
}

/** How the AI should write for this blend: a short style brief, generic and IP-free. */
export function dialogueStyle(p: Persona): string {
  const STYLE: Record<Archetype, string> = {
    popstar: 'bubbly show-biz sparkle, loves an audience, little catchphrases',
    scholar: 'curious and precise, loves a fun fact, gentle "did you know"',
    gamer: 'playful game talk (levels, quests, high scores), upbeat and quick',
    athlete: 'energetic coach-talk, pep and teamwork, loves a challenge',
    brat: 'sassy and dramatic but never mean, playful pouts, secretly sweet',
    royal: 'grand and courteous, a little fancy, says "we" and "most delightful"',
    explorer: 'adventurous and wondering, talks about maps, trails and treasure',
    artist: 'dreamy and colourful, notices shapes and colours, makes little poems',
  };
  const b = blend(p).filter(([a]) => p.levels[a] >= 0.15).slice(0, 2);
  if (!b.length) return 'a small, curious baby creature, simple sweet words';
  return b.map(([a, s]) => `${Math.round(s * 100)}% ${NOUN[a]}: ${STYLE[a]}`).join('; ');
}

/** The persona as it travels to the AI director (server re-sanitises). */
export function personaCard(p: Persona) {
  return {
    title: title(p),
    blend: blend(p).slice(0, 3).map(([a, s]) => [a, Math.round(s * 100) / 100] as [Archetype, number]),
    style: dialogueStyle(p),
    why: why(p, 3),
  };
}

// ── Persistence ────────────────────────────────────────────────────────────────────────────────

const key = (slot: string) => `kin:v1:${slot}:persona`;

export function revivePersona(raw: unknown, traits: Traits, now: number): Persona {
  const fresh = newPersona(traits, now);
  const p = raw as Partial<Persona> | null;
  if (!p || p.v !== 1 || !p.levels) return fresh;
  const levels = { ...fresh.levels };
  for (const a of ARCHETYPES) if (Number.isFinite(p.levels[a])) levels[a] = clamp01(p.levels[a]!);
  return {
    ...fresh,
    levels,
    history: Array.isArray(p.history) ? p.history.filter((h) => h && ARCHETYPES.includes(h.a)).slice(0, HISTORY) : [],
    day: p.day && typeof p.day.key === 'string' ? p.day : fresh.day,
    settledAt: Number.isFinite(p.settledAt) ? Math.min(now, p.settledAt!) : now,
    steer: p.steer && ARCHETYPES.includes(p.steer) ? p.steer : null,
  };
}

export function loadPersona(kv: KV, slot: string, _seed: number, traits: Traits, now: number): Persona {
  try {
    return revivePersona(JSON.parse(kv.get(key(slot)) ?? 'null'), traits, now);
  } catch {
    return newPersona(traits, now);
  }
}

export function savePersona(kv: KV, slot: string, p: Persona) {
  kv.set(key(slot), JSON.stringify(p));
}
