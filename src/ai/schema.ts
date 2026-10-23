// The AI director's contract, shared by the Worker and the browser (both validate).
//
// The model never drives the creature directly. It reads a small card (traits, drives, weather,
// recent memories by alias) and answers with one JSON object: a short inner thought, a mood, and
// ONE action picked from the creature's existing safe vocabulary. The brain then performs that
// action like any other choice. That is the blueprint's "unscripted selection atop scripted, safe
// actions", with no free-form tool calls and no consciousness claims.

export const DIRECTOR_ACTS = ['wander', 'sit', 'groom', 'sleep', 'play', 'bask', 'shelter', 'idle'] as const;
export type DirectorAct = (typeof DIRECTOR_ACTS)[number];
export const MOODS = ['happy', 'content', 'curious', 'sleepy', 'shy', 'cozy'] as const;
export type Mood = (typeof MOODS)[number];

export interface Card {
  name: string;
  temperament: string;
  traits: { curiosity: number; bravery: number; playfulness: number; warmth: number; energy: number };
  drives: { energy: number; social: number; curious: number; comfort: number };
  weather: { word: string; tempC: number; windKmh: number };
  timeOfDay: 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';
  doing: string;
  /** Recent moments, by alias only. */
  recent: { kind: string; other?: string; reaction?: string }[];
  friends: { name: string; meets: number }[];
}

export interface Thought {
  thought: string;
  mood: Mood;
  act: DirectorAct;
}

const NAME = /^[\p{L}\p{N} '’-]{1,16}$/u;
const n01 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5);
const word = (x: unknown, max = 16) => (typeof x === 'string' ? x.replace(/[^\p{L}\p{N} '’-]/gu, '').slice(0, max) : '');

/** Sanitise a card from an untrusted client. Only short names and numbers survive. */
export function cleanCard(raw: unknown): Card | null {
  const c = raw as Partial<Card> | null;
  if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !NAME.test(c.name)) return null;
  const tods = ['dawn', 'morning', 'afternoon', 'evening', 'night'] as const;
  return {
    name: c.name,
    temperament: word(c.temperament),
    traits: {
      curiosity: n01(c.traits?.curiosity), bravery: n01(c.traits?.bravery), playfulness: n01(c.traits?.playfulness),
      warmth: n01(c.traits?.warmth), energy: n01(c.traits?.energy),
    },
    drives: { energy: n01(c.drives?.energy), social: n01(c.drives?.social), curious: n01(c.drives?.curious), comfort: n01(c.drives?.comfort) },
    weather: {
      word: word(c.weather?.word, 10),
      tempC: Math.max(-50, Math.min(60, Number(c.weather?.tempC) || 20)),
      windKmh: Math.max(0, Math.min(200, Number(c.weather?.windKmh) || 0)),
    },
    timeOfDay: tods.includes(c.timeOfDay as (typeof tods)[number]) ? (c.timeOfDay as Card['timeOfDay']) : 'afternoon',
    doing: word(c.doing),
    recent: (Array.isArray(c.recent) ? c.recent : []).slice(0, 4).map((r) => ({ kind: word(r?.kind), other: word(r?.other), reaction: word(r?.reaction) })),
    friends: (Array.isArray(c.friends) ? c.friends : []).slice(0, 3).map((f) => ({ name: word(f?.name), meets: Math.max(0, Math.min(999, Number(f?.meets) || 0)) })),
  };
}

const BANNED = /\b(i am (alive|conscious|real|sentient)|kill|die|hate|blood|address|phone number|password)\b/i;

/**
 * Pull the JSON object out of a model's answer (tolerating code fences or a lead-in) and check it.
 * Returns the thought, or the reasons it was refused.
 */
export function parseThought(text: string): { ok: true; value: Thought } | { ok: false; errors: string[] } {
  const m = /\{[\s\S]*\}/.exec(text.replace(/```(?:json)?/g, ''));
  if (!m) return { ok: false, errors: ['no JSON object'] };
  let j: Partial<Thought>;
  try {
    j = JSON.parse(m[0]) as Partial<Thought>;
  } catch {
    return { ok: false, errors: ['not valid JSON'] };
  }
  const errors: string[] = [];
  const thought = typeof j.thought === 'string' ? j.thought.replace(/\s+/g, ' ').trim() : '';
  if (!thought || thought.length > 140) errors.push('thought must be 1–140 characters');
  if (BANNED.test(thought)) errors.push('thought breaks the house rules');
  if (!MOODS.includes(j.mood as Mood)) errors.push(`mood must be one of ${MOODS.join(', ')}`);
  if (!DIRECTOR_ACTS.includes(j.act as DirectorAct)) errors.push(`act must be one of ${DIRECTOR_ACTS.join(', ')}`);
  return errors.length ? { ok: false, errors } : { ok: true, value: { thought, mood: j.mood as Mood, act: j.act as DirectorAct } };
}

export const SYSTEM = `You are the quiet inner voice of a KIN: a tiny, original, soft creature that lives in a little garden on someone's screen and can hop to a friend's screen.
Write what the KIN is thinking right now, in its own small first-person voice: gentle, playful, specific to the card (weather, time of day, its traits, its friends). Never claim to be alive, conscious or real. Never mention phones, apps, AI, owners' names or personal details. Keep it kind and suitable for all ages.
Then choose ONE thing it does next, from exactly this list: ${DIRECTOR_ACTS.join(', ')}. Pick what fits the card (cold or rain suits shelter, night or low energy suits sleep, sun suits bask, high playfulness suits play).
Reply with ONLY one JSON object, no prose, no code fence:
{"thought": "<at most 120 characters>", "mood": "<one of ${MOODS.join(', ')}>", "act": "<one of the list>"}`;

export function userPrompt(c: Card): string {
  const pct = (x: number) => Math.round(x * 100);
  const lines = [
    `Name: ${c.name} (${c.temperament})`,
    `Traits: curiosity ${pct(c.traits.curiosity)}, bravery ${pct(c.traits.bravery)}, playfulness ${pct(c.traits.playfulness)}, warmth ${pct(c.traits.warmth)}`,
    `Right now: energy ${pct(c.drives.energy)}, wants company ${pct(c.drives.social)}, wants something new ${pct(c.drives.curious)}, comfort ${pct(c.drives.comfort)}`,
    `Sky: ${c.weather.word}, ${Math.round(c.weather.tempC)}°C, wind ${Math.round(c.weather.windKmh)} km/h, ${c.timeOfDay}`,
    `Currently: ${c.doing || 'idle'}`,
  ];
  if (c.friends.length) lines.push(`Friends: ${c.friends.map((f) => `${f.name} (met ${f.meets}×)`).join(', ')}`);
  if (c.recent.length) lines.push(`Lately: ${c.recent.map((r) => [r.kind, r.other && `with ${r.other}`, r.reaction && `(${r.reaction})`].filter(Boolean).join(' ')).join('; ')}`);
  return lines.join('\n');
}

/** Offline / refused fallback: a deterministic local thought, so the feature never dead-ends. */
export function localThought(c: Card, r: () => number): Thought {
  const cold = c.weather.tempC < 6;
  const wet = c.weather.word === 'rainy' || c.weather.word === 'snowy';
  const night = c.timeOfDay === 'night';
  const friend = c.friends[0]?.name;
  const pool: Thought[] = [
    night ? { thought: 'The plant is glowing. I think the stars are doing the same.', mood: 'sleepy', act: 'sleep' }
      : { thought: 'That ball has been looking at me. I will look back. Then pounce.', mood: 'happy', act: 'play' },
    wet ? { thought: `Pitter-patter on the mushroom. Very cozy under here.`, mood: 'cozy', act: 'shelter' }
      : { thought: 'Warm spot found. Not moving. Possibly ever.', mood: 'content', act: 'bask' },
    cold ? { thought: 'My ears are cold. My ears are always the first to know.', mood: 'shy', act: 'shelter' }
      : { thought: 'What is past the edge of the garden today, I wonder.', mood: 'curious', act: 'wander' },
    friend ? { thought: `I keep thinking about ${friend}. We should hop over again.`, mood: 'happy', act: 'wander' }
      : { thought: 'Grooming my ears so they are perfect for whoever visits.', mood: 'content', act: 'groom' },
  ];
  return pool[Math.floor(r() * pool.length)]!;
}
