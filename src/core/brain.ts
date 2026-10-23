// Utility AI. Runs a few times a second, never per frame, never in the cloud. The brain picks
// *which* safe action to do; the renderer decides only *how* it looks. Every choice carries a
// `why` so the dev HUD (?debug) can explain it.
//
// score(goal) = needs + context + trait_bias + relationship_bias - repetition - safety + variation

import type { Drives, KinRecord, Reaction } from './creature';
import { clamp01, hash, rng, type Rng } from './rng';

export type Action =
  | 'idle'
  | 'wander'
  | 'sit'
  | 'groom'
  | 'sleep'
  | 'play'
  | 'look_edge'
  | 'shiver'
  | 'shelter'
  | 'bask'
  | 'greet_guest';

export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface Weather {
  tempC: number;
  windKmh: number;
  precipMm: number;
  snow: boolean;
  cloud: number; // 0..1
  /** Sun elevation in degrees; negative = night. */
  sunElev: number;
}

export interface Context {
  now: number;
  weather: Weather;
  petting: boolean;
  /** A peer with an open invitation sits beyond this edge. */
  peerEdge: Edge | null;
  guest: { id: string; name: string } | null;
}

export interface Decision {
  action: Action;
  durationMs: number;
  why: string[];
  scores: [Action, number][];
}

const DURATION: Record<Action, [number, number]> = {
  idle: [1800, 4000],
  wander: [2500, 5000],
  sit: [3000, 7000],
  groom: [2200, 3500],
  sleep: [9000, 20000],
  play: [3000, 5000],
  look_edge: [1600, 2600],
  shiver: [1500, 2500],
  shelter: [4000, 8000],
  bask: [4000, 8000],
  greet_guest: [2200, 3200],
};

export function decide(k: KinRecord, ctx: Context, recent: readonly Action[], tick: number): Decision {
  const r = rng(hash(`brain:${k.seed}:${tick}`));
  const d = k.drives;
  const t = k.traits;
  const w = ctx.weather;
  const night = w.sunElev < -4;
  const cold = w.tempC < 6;
  const hot = w.tempC > 31;
  const wet = w.precipMm > 0.15;

  const s: Partial<Record<Action, [number, string]>> = {};
  const add = (a: Action, v: number, why: string) => {
    const cur = s[a];
    s[a] = cur ? [cur[0] + v, cur[1] + ', ' + why] : [v, why];
  };

  add('idle', 0.25, 'baseline');
  add('wander', 0.2 + d.curious * 0.5 + t.curiosity * 0.25, `curious ${d.curious.toFixed(2)}`);
  add('sit', 0.15 + (1 - d.energy) * 0.35, `energy ${d.energy.toFixed(2)}`);
  add('groom', 0.12 + (1 - d.comfort) * 0.3, `comfort ${d.comfort.toFixed(2)}`);
  add('sleep', (1 - d.energy) ** 2 * 1.4 + (night ? 0.35 : 0), night ? 'night, tired' : 'tired');
  add('play', 0.1 + t.playfulness * 0.4 + d.energy * 0.25 - (night ? 0.2 : 0), `playful ${t.playfulness}`);

  // Weather is felt, not displayed: the creature reacts to the real sky outside.
  if (cold) add('shiver', 0.35 + (6 - w.tempC) * 0.04, `${w.tempC.toFixed(0)}°C`);
  if (wet || w.windKmh > 35) add('shelter', 0.3 + w.precipMm * 0.15 + w.windKmh / 120, wet ? 'rain' : 'strong wind');
  if (!night && w.cloud < 0.45 && !hot && !wet) add('bask', 0.25 + (1 - d.comfort) * 0.2, 'sun out');
  if (hot) add('sit', 0.3, 'hot, conserving');

  if (ctx.peerEdge) add('look_edge', 0.8 + t.curiosity * 0.5, `a friend waits ${ctx.peerEdge}`);
  if (ctx.guest) {
    const rel = k.friends[ctx.guest.id];
    add('greet_guest', 0.7 + t.warmth * 0.4 + (rel ? rel.affinity * 0.3 : 0), rel ? `knows ${ctx.guest.name}` : 'new guest');
  }
  if (ctx.petting) {
    // Being petted pins attention; sleep is never interrupted into play.
    add('sit', 0.9, 'being petted');
  }

  // Repetition penalty keeps it from looking like a loop.
  for (const [i, a] of recent.slice(-4).entries()) add(a, -0.12 * (i + 1) * 0.5, 'did recently');

  const scores = Object.entries(s).map(([a, [v]]) => [a as Action, v + (r() - 0.5) * 0.18] as [Action, number]);
  scores.sort((x, y) => y[1] - x[1]);
  const best = scores[0]![0];
  const [lo, hi] = DURATION[best];
  return { action: best, durationMs: lo + (hi - lo) * r(), why: [s[best]![1]], scores };
}

/** Drives drift each brain tick according to what the creature is doing. dt in seconds. */
export function drift(d: Drives, a: Action, dt: number, ctx: Pick<Context, 'petting' | 'guest' | 'weather'>): Drives {
  const k = dt / 60; // per-minute rates keep the numbers readable
  const active = a === 'wander' || a === 'play' || a === 'greet_guest';
  const w = ctx.weather;
  let comfortTarget = 0.85;
  if (w.tempC < 6 || w.tempC > 31) comfortTarget -= 0.25;
  if (w.precipMm > 0.15 && a !== 'shelter') comfortTarget -= 0.2;
  if (ctx.petting) comfortTarget = 1;
  return {
    energy: clamp01(d.energy + (a === 'sleep' ? 0.35 : active ? -0.06 : -0.015) * k),
    social: clamp01(d.social + (ctx.petting || ctx.guest ? -0.5 : 0.02) * k),
    curious: clamp01(d.curious + (a === 'wander' || a === 'play' ? -0.25 : 0.05) * k),
    comfort: clamp01(d.comfort + (comfortTarget - d.comfort) * Math.min(1, 0.6 * k * 10)),
  };
}

/**
 * How a KIN reacts when another one arrives (beat 5 of KIN CROSS). Trait-weighted but varied:
 * the same pair won't greet identically every time, and familiarity softens caution.
 */
export function arrivalReaction(host: Pick<KinRecord, 'traits' | 'drives' | 'friends'>, visitorId: string, r: Rng): Reaction {
  const t = host.traits;
  const rel = host.friends[visitorId];
  const familiar = rel ? Math.min(1, rel.meets / 4) * 0.5 + rel.affinity * 0.3 : 0;
  const w: [Reaction, number][] = [
    ['eager', t.warmth * 0.6 + t.bravery * 0.5 + familiar + host.drives.social * 0.3],
    ['playful', t.playfulness * 0.9 + host.drives.energy * 0.3 + familiar * 0.4],
    ['cautious', (1 - t.bravery) * 0.9 - familiar * 0.8 + (1 - host.drives.energy) * 0.1],
    ['aloof', (1 - t.warmth) * 0.7 - familiar * 0.5 + (1 - host.drives.social) * 0.2],
  ];
  const total = w.reduce((a, [, v]) => a + Math.max(0.02, v), 0);
  let x = r() * total;
  for (const [reaction, v] of w) {
    x -= Math.max(0.02, v);
    if (x <= 0) return reaction;
  }
  return 'eager';
}
