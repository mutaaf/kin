// Live Activities (iOS 17+): KIN on the Lock Screen and in the Dynamic Island, with Feed / Play /
// Pet / Tuck in buttons that work without opening the app. On the web every call is a no-op.
//
// Native side: ios/App/App/LiveActivityPlugin.swift (jsName "KINLive"), the widget extension
// ios/App/KINWidgets, shared model + intent in ios/App/Shared. See docs/LIVE_ACTIVITIES.md.
//
// ─── Integration for app.ts ─────────────────────────────────────────────────────────────────
//   import { live, liveStateFrom } from './platform/live';
//
//   // 1. After the KIN is hatched and on every brain tick (250 ms is fine: `update` throttles to
//   //    meaningful changes or once every 3 minutes). Starting is automatic: the plugin starts
//   //    the activity on its own while the app is in the foreground, and keeps it updated after.
//   void live.update(liveStateFrom({ kin, genome, sky, action: current.action, needs, line,
//                                    away: kin.placement.kind === 'away' ? kin.placement.hostName : null,
//                                    fahrenheit: /^en-US/.test(navigator.language) }));
//      (`needs` comes from the care model: { hunger, play, rest, clean, affection } in 0..1;
//       until the world track lands, pass drive-derived values, see `needsFromDrives`.)
//   //    `line`: the latest thought (AI director) or reaction; falls back to a mood line.
//
//   // 2. Apply care done from the activity (on launch and whenever the app becomes visible):
//   addEventListener('visibilitychange', async () => {
//     if (document.visibilityState !== 'visible') return;
//     for (const c of await live.pendingCare()) careModel.apply(c.verb, c.at); // 'feed'|'play'|'pet'|'tuck'
//   });
//
//   // 3. Give the activity a portrait of THIS creature (once after hatch, and after big changes),
//   //    right after stage.render() in the same frame (WebGL buffers aren't preserved):
//   const h = view.screenHit();
//   void live.setSnapshot(captureRegion(stage.renderer.domElement, h.x, h.y, h.r * 1.15));
//
//   // 4. Settings toggle "Live Activity on the Lock Screen":  void live.setEnabled(on);
//   // 5. "Release KIN":  void live.end();
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { Capacitor, registerPlugin } from '@capacitor/core';

export type CareVerb = 'feed' | 'play' | 'pet' | 'tuck';
export type LiveMode = 'home' | 'away' | 'asleep';

export interface LiveState {
  // identity (static for an activity's life)
  name: string;
  hue: number;
  accentHue: number;
  seed: number;
  // content
  mood: string;
  doing: string;
  hunger: number;
  play: number;
  rest: number;
  clean: number;
  affection: number;
  weather: string;
  tempC: number;
  mode: LiveMode;
  friend?: string;
  line: string;
  lastCared?: number;
  fahrenheit: boolean;
}

export interface Support {
  supported: boolean;
  authorized: boolean;
  enabled: boolean;
  running: number;
}

interface KINLivePlugin {
  isSupported(): Promise<Support>;
  start(s: LiveState & { restart?: boolean }): Promise<{ running: boolean }>;
  update(s: LiveState): Promise<{ running: boolean }>;
  end(): Promise<void>;
  setSnapshot(o: { png: string }): Promise<{ saved: boolean }>;
  pendingCare(): Promise<{ care: { verb: string; at: number }[] }>;
  setEnabled(o: { enabled: boolean }): Promise<{ enabled: boolean }>;
}

// ── Pure helpers (unit-tested in tests/live.test.ts) ────────────────────────────────────────

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.8);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** Humane need levels from today's brain drives, until the care model provides real ones. */
export function needsFromDrives(d: { energy: number; social: number; curious: number; comfort: number }) {
  return {
    hunger: clamp01(0.35 + d.comfort * 0.5),
    play: clamp01(1 - d.curious * 0.8),
    rest: clamp01(d.energy),
    clean: clamp01(0.6 + d.comfort * 0.4),
    affection: clamp01(1 - d.social * 0.8),
  };
}

const DOING: Record<string, string> = {
  idle: 'pottering about', wander: 'exploring', sit: 'sitting pretty', groom: 'grooming', sleep: 'asleep in the nest',
  play: 'chasing the ball', look_edge: 'peeking at the edge', shiver: 'keeping warm', shelter: 'under the mushroom',
  bask: 'basking', greet_guest: 'with a visitor',
};

const MOOD_LINE: Record<string, string> = {
  happy: 'Today is a good day.', content: 'All is well in the garden.', curious: 'What is that over there?',
  sleepy: 'Five more minutes…', shy: 'Just watching for now.', cozy: 'Snug as anything.',
};

export interface LiveInput {
  kin: { name: string; seed: number; hatched: boolean; memories?: { kind: string; note: string }[] };
  genome: { hue: number; accentHue: number };
  sky: { tempC: number; precipMm: number; snow: boolean; windKmh: number; sunElev: number; cloud: number };
  action: string;
  needs: { hunger: number; play: number; rest: number; clean: number; affection: number };
  mood?: string;
  line?: string | null;
  away?: string | null;
  lastCared?: number;
  fahrenheit?: boolean;
}

export function weatherWordOf(s: LiveInput['sky']): string {
  if (s.precipMm > 0.15) return s.snow ? 'snowy' : 'rainy';
  if (s.windKmh > 30) return 'windy';
  if (s.tempC > 31) return 'hot';
  if (s.tempC < 4) return 'cold';
  if (s.sunElev < -6) return 'starry';
  return s.cloud > 0.7 ? 'cloudy' : 'sunny';
}

/** Shape the app's world into the small, bounded payload ActivityKit allows (≤ 4 KB). */
export function liveStateFrom(i: LiveInput): LiveState {
  const night = i.sky.sunElev < -6;
  const mode: LiveMode = i.away ? 'away' : i.action === 'sleep' || (night && i.needs.rest < 0.4) ? 'asleep' : 'home';
  const mood = i.mood ?? (mode === 'asleep' ? 'sleepy' : i.action === 'play' ? 'happy' : i.action === 'shelter' ? 'cozy' : 'content');
  const line = i.line?.trim() || (mode === 'away' ? `Having fun at ${i.away}'s.` : MOOD_LINE[mood] ?? MOOD_LINE.content!);
  return {
    name: cut(i.kin.name, 16),
    hue: Math.round(((i.genome.hue % 360) + 360) % 360),
    accentHue: Math.round(((i.genome.accentHue % 360) + 360) % 360),
    seed: i.kin.seed >>> 0,
    mood,
    doing: cut(mode === 'away' ? 'visiting' : DOING[i.action] ?? 'at home', 40),
    hunger: clamp01(i.needs.hunger),
    play: clamp01(i.needs.play),
    rest: clamp01(i.needs.rest),
    clean: clamp01(i.needs.clean),
    affection: clamp01(i.needs.affection),
    weather: weatherWordOf(i.sky),
    tempC: Math.round(i.sky.tempC * 10) / 10,
    mode,
    ...(i.away ? { friend: cut(i.away, 16) } : {}),
    line: cut(line, 120),
    ...(i.lastCared ? { lastCared: Math.floor(i.lastCared / 1000) } : {}),
    fahrenheit: !!i.fahrenheit,
  };
}

/** Should an activity be running at all right now? */
export function shouldRun(o: { hatched: boolean; support: Support | null }): boolean {
  return !!o.support && o.support.supported && o.support.authorized && o.support.enabled && o.hatched;
}

/**
 * Update cadence: at most every `minMs` on-device, except when something the player would notice
 * changes (mode, mood, line, identity, or a need moving by ≥ 0.15). ActivityKit budgets updates;
 * this keeps us well inside it and saves battery.
 */
export class LiveThrottle {
  private last: LiveState | null = null;
  private at = 0;
  constructor(private minMs = 3 * 60_000) {}

  shouldSend(s: LiveState, now: number): boolean {
    const p = this.last;
    const meaningful =
      !p || p.mode !== s.mode || p.mood !== s.mood || p.line !== s.line || p.name !== s.name || p.seed !== s.seed ||
      p.friend !== s.friend || p.weather !== s.weather ||
      (['hunger', 'play', 'rest', 'clean', 'affection'] as const).some((k) => Math.abs(p[k] - s[k]) >= 0.15);
    if (!meaningful && now - this.at < this.minMs) return false;
    this.last = s;
    this.at = now;
    return true;
  }

  reset() {
    this.last = null;
    this.at = 0;
  }
}

export const CARE_VERBS: readonly CareVerb[] = ['feed', 'play', 'pet', 'tuck'];

/** Validate care handed back by native: known verbs, sane times, oldest first, de-duplicated. */
export function cleanCare(raw: unknown, now = Date.now()): { verb: CareVerb; at: number }[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter((c): c is { verb: string; at: number } => !!c && typeof c.verb === 'string' && typeof c.at === 'number')
    .filter((c) => (CARE_VERBS as readonly string[]).includes(c.verb) && c.at > now - 14 * 86_400_000 && c.at <= now + 60_000)
    .map((c) => ({ verb: c.verb as CareVerb, at: Math.round(c.at) }))
    .filter((c) => {
      const k = `${c.verb}:${c.at}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.at - b.at);
}

/** Square crop around the creature's head, scaled to 180 px, as base64 PNG (no data: prefix). */
export function captureRegion(canvas: HTMLCanvasElement, cssX: number, cssY: number, cssR: number, size = 180): string {
  const scale = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
  const r = cssR * scale;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const g = out.getContext('2d');
  if (!g) return '';
  g.drawImage(canvas, cssX * scale - r, cssY * scale - r, r * 2, r * 2, 0, 0, size, size);
  return out.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

// ── The bridge ──────────────────────────────────────────────────────────────────────────────

const native = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
const plugin = native ? registerPlugin<KINLivePlugin>('KINLive') : null;
const throttle = new LiveThrottle();
const NOT: Support = { supported: false, authorized: false, enabled: false, running: 0 };
const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await f();
  } catch {
    return fallback;
  }
};

export const live = {
  available: native,
  isSupported: (): Promise<Support> => (plugin ? safe(() => plugin.isSupported(), NOT) : Promise.resolve(NOT)),
  /** Start (or replace with `restart`) right now. Usually unnecessary: `update` starts automatically. */
  start: (s: LiveState, restart = false) => (plugin ? safe(() => plugin.start({ ...s, restart }), { running: false }) : Promise.resolve({ running: false })),
  /** Throttled. Starts the activity automatically when in the foreground and none is running. */
  update: async (s: LiveState, now = Date.now()) => {
    if (!plugin || !throttle.shouldSend(s, now)) return { running: false, skipped: true };
    return { ...(await safe(() => plugin.update(s), { running: false })), skipped: false };
  },
  end: async () => {
    throttle.reset();
    if (plugin) await safe(() => plugin.end(), undefined);
  },
  setSnapshot: (pngBase64: string) => (plugin && pngBase64 ? safe(() => plugin.setSnapshot({ png: pngBase64 }), { saved: false }) : Promise.resolve({ saved: false })),
  pendingCare: async () => (plugin ? cleanCare((await safe(() => plugin.pendingCare(), { care: [] })).care) : []),
  setEnabled: async (enabled: boolean) => {
    throttle.reset();
    if (plugin) await safe(() => plugin.setEnabled({ enabled }), { enabled });
  },
};
