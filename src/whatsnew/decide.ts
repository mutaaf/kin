// When the "What's new" modal shows. Pure: no DOM, no timers, so tests/whatsnew.test.ts covers it.
//
// - It shows at most once per version, after an update, on the web and on native.
// - Never on a first visit or a fresh install: that visit only records the version as seen.
// - A returning player from before this feature existed (a hatched KIN, no version recorded)
//   counts as an update, so they see the notes once.
// - Never under test, capture or demo flags (embed, the store-capture sky overrides, the
//   two-window and relay test params, debug, or an automated browser). `?whatsnew=1` forces a
//   preview for QA and screenshots and records nothing; `?whatsnew=0` suppresses it.
// - Native (Debug builds only): the launch argument `-KINWhatsNew YES` sets FORCE_GLOBAL on the
//   page, which forces the same preview on a phone or simulator. It records nothing either.
// - A callout's button opens its feature: `routeTo` maps a notes destination to a shell action.

import type { Destination } from './notes';

/** Device-wide (not per slot), like `kin:device`: one update, one modal, however many homes. */
export const SEEN_KEY = 'kin:whatsnew:seen';

/** Params used by the landing trailer, store captures, two-window tests and debugging. */
export const SKIP_PARAMS = ['embed', 'wx', 'hour', 'first', 'sx', 'room', 'seed', 'relay', 'debug'] as const;

/** Compare dotted numeric versions: <0 if a<b, 0 if equal, >0 if a>b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Set on `window` by the Debug native shell (KINBridgeViewController) for `-KINWhatsNew YES`. */
export const FORCE_GLOBAL = '__KIN_WHATSNEW__';

export interface Env {
  search: string;
  /** navigator.webdriver: Playwright, store capture scripts and other automation. */
  automated?: boolean;
  /** Vitest or any non-app mode. */
  test?: boolean;
  /** The native Debug force switch (FORCE_GLOBAL). */
  forced?: boolean;
}

export type Gate = 'force' | 'skip' | 'normal';

export function gate(env: Env): Gate {
  const q = new URLSearchParams(env.search);
  const w = q.get('whatsnew');
  if (w === '0') return 'skip';
  // Embedded trailer instances never show it, even when forced.
  if (q.has('embed')) return 'skip';
  if (w !== null || env.forced) return 'force';
  if (env.test || env.automated) return 'skip';
  return SKIP_PARAMS.some((p) => q.has(p)) ? 'skip' : 'normal';
}

export interface State {
  /** The version recorded as seen on this device, or null if none. */
  seen: string | null;
  current: string;
  /** This device already had a hatched KIN before this load. */
  returning: boolean;
  /** Notes exist for the current version. */
  hasNotes: boolean;
}

export interface Decision {
  show: boolean;
  /** Write `current` to SEEN_KEY. */
  record: boolean;
}

export function decide(s: State, g: Gate = 'normal'): Decision {
  if (g === 'skip') return { show: false, record: false };
  if (g === 'force') return { show: s.hasNotes, record: false };
  if (s.seen === s.current) return { show: false, record: false };
  // First visit or fresh install: remember the version, show nothing.
  if (s.seen === null && !s.returning) return { show: false, record: true };
  // Downgrade (an older build after a newer one): just remember.
  if (s.seen !== null && compareVersions(s.current, s.seen) < 0) return { show: false, record: true };
  return { show: s.hasNotes, record: true };
}

/** The shell action (src/ui/shell `Shell.go`) that opens each callout's feature. */
export const ROUTES: Record<Destination, string> = {
  explore: 'explore', // the Explore sheet: the habitat cards
  play: 'play', // rings the ball in the garden with a "flick it" hint
  kin: 'identity', // the Your KIN sheet, with the personality bars
  train: 'train', // the trick ring around the KIN
};

export const routeTo = (d: Destination): string => ROUTES[d];
