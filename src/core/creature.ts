// The durable creature record and its reducers. The home owner is the only authority over
// this record (SYSTEM_DESIGN "State authority model"); a host never persists a visitor.

import { makeGenome, makeTraits, suggestName, type Genome, type Traits } from './genome';
import { clamp01, randomId } from './rng';

export interface Drives {
  /** 1 = rested. Falls while active, refills while sleeping. */
  energy: number;
  /** Desire for company. Rises while alone, satisfied by petting and visits. */
  social: number;
  /** Desire for novelty. Rises while idle. */
  curious: number;
  /** Physical comfort; weather and petting move it. */
  comfort: number;
}

export interface Memory {
  id: string;
  at: number;
  kind: 'hatched' | 'visited' | 'hosted' | 'returned_early' | 'thought';
  /** The other KIN, by alias only. No owner identity is ever stored. */
  other?: { id: string; name: string; hue: number };
  reaction?: Reaction;
  note: string;
  weather?: string;
}

export interface Friend {
  name: string;
  hue: number;
  meets: number;
  lastAt: number;
  /** -1 rival … +1 friend. Bounded and slow-moving. */
  affinity: number;
}

export type Placement =
  | { kind: 'home' }
  | { kind: 'away'; visitId: string; hostPeer: string; hostId: string; hostName: string; since: number };

export type Reaction = 'eager' | 'cautious' | 'playful' | 'aloof';

export interface KinRecord {
  v: 1;
  id: string;
  seed: number;
  name: string;
  bornAt: number;
  hatched: boolean;
  traits: Traits;
  drives: Drives;
  bond: number;
  memories: Memory[];
  friends: Record<string, Friend>;
  placement: Placement;
  lastSeenAt: number;
}

export const MAX_MEMORIES = 60;

export function newKin(now: number, seed = (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) >>> 0): KinRecord {
  const traits = makeTraits(seed);
  return {
    v: 1,
    id: randomId('kin'),
    seed,
    name: suggestName(seed),
    bornAt: now,
    hatched: false,
    traits,
    drives: { energy: 0.8, social: 0.5, curious: 0.6, comfort: 0.8 },
    bond: 0,
    memories: [],
    friends: {},
    placement: { kind: 'home' },
    lastSeenAt: now,
  };
}

export const genomeOf = (k: Pick<KinRecord, 'seed'>): Genome => makeGenome(k.seed);

export function remember(k: KinRecord, m: Omit<Memory, 'id'>): KinRecord {
  // Idempotent by (kind, other, at-second): replays of the same event don't double-log.
  const dupe = k.memories.some((x) => x.kind === m.kind && x.other?.id === m.other?.id && Math.abs(x.at - m.at) < 1000);
  if (dupe) return k;
  const memories = [{ ...m, id: randomId('mem') }, ...k.memories].slice(0, MAX_MEMORIES);
  return { ...k, memories };
}

export function meet(k: KinRecord, other: { id: string; name: string; hue: number }, now: number, delta: number): KinRecord {
  const prev = k.friends[other.id];
  const affinity = Math.max(-1, Math.min(1, (prev?.affinity ?? 0) + delta));
  return {
    ...k,
    friends: {
      ...k.friends,
      [other.id]: { name: other.name, hue: other.hue, meets: (prev?.meets ?? 0) + 1, lastAt: now, affinity },
    },
  };
}

/**
 * Coarse catch-up after the app was closed or the tab suspended: bounded, never punishing.
 * (No decay timers: a KIN left alone for a month is simply rested and a bit lonely.)
 */
export function catchUp(k: KinRecord, now: number): KinRecord {
  const hours = Math.min(48, Math.max(0, (now - k.lastSeenAt) / 3_600_000));
  if (hours < 0.01) return { ...k, lastSeenAt: now };
  const d = k.drives;
  return {
    ...k,
    lastSeenAt: now,
    drives: {
      energy: clamp01(d.energy + hours * 0.15),
      social: clamp01(d.social + hours * 0.05),
      curious: clamp01(d.curious + hours * 0.08),
      comfort: clamp01(d.comfort + (0.8 - d.comfort) * Math.min(1, hours / 4)),
    },
  };
}
