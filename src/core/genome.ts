// A KIN's look and temperament are a pure function of its seed. Two devices that receive the
// same seed render the same creature: this is what makes a crossing keep identity and skin
// without shipping meshes over the wire.

import { hash, pick, range, rng } from './rng';

export type EarKind = 'pointed' | 'round' | 'long' | 'tuft';
export type TailKind = 'plume' | 'curl' | 'leaf' | 'nub';
export type Accent = 'crystal' | 'sprout' | 'ember' | 'none';

export interface Genome {
  seed: number;
  /** Body hue in degrees; saturation/lightness are kept in a soft band on purpose. */
  hue: number;
  sat: number;
  light: number;
  /** Secondary hue for belly, ear tips and accent glow. */
  accentHue: number;
  ears: EarKind;
  tail: TailKind;
  accent: Accent;
  /** 0.85–1.15 overall size; 0.9–1.2 eye scale. */
  size: number;
  eyeScale: number;
  /** Body roundness: 0 = bean, 1 = ball. */
  round: number;
}

export interface Traits {
  curiosity: number;
  bravery: number;
  playfulness: number;
  warmth: number;
  energy: number; // baseline energy, not current
}

// Hues are drawn from curated bands so every creature looks good next to graphite.
const HUE_BANDS: readonly [number, number][] = [
  [8, 28], // apricot
  [30, 48], // honey
  [150, 175], // mint
  [185, 205], // glacier
  [215, 240], // periwinkle
  [265, 290], // lilac
  [320, 345], // rose
];

export function makeGenome(seed: number): Genome {
  const r = rng(hash('genome:' + seed));
  const band = pick(r, HUE_BANDS);
  const hue = range(r, band[0], band[1]);
  return {
    seed,
    hue,
    sat: range(r, 0.42, 0.68),
    light: range(r, 0.62, 0.78),
    accentHue: (hue + pick(r, [40, 150, 180, 200, -40])) % 360,
    ears: pick(r, ['pointed', 'round', 'long', 'tuft'] as const),
    tail: pick(r, ['plume', 'curl', 'leaf', 'nub'] as const),
    accent: pick(r, ['crystal', 'sprout', 'ember', 'none', 'none'] as const),
    size: range(r, 0.88, 1.12),
    eyeScale: range(r, 0.92, 1.18),
    round: range(r, 0.35, 0.95),
  };
}

export function makeTraits(seed: number): Traits {
  const r = rng(hash('traits:' + seed));
  // Pull toward the middle so extremes are rare and memorable.
  const t = () => Math.round((0.15 + 0.7 * ((r() + r() + r()) / 3) ** 0.9) * 100) / 100;
  return { curiosity: t(), bravery: t(), playfulness: t(), warmth: t(), energy: t() };
}

const SYL_A = ['Lu', 'No', 'Pi', 'Mo', 'Ki', 'Su', 'Ta', 'Bo', 'Fen', 'Ri', 'Zu', 'Ola', 'Mi', 'Ve', 'Ju'];
const SYL_B = ['mi', 'x', 'po', 'ra', 'li', 'bo', 'ni', 'ku', 'wen', 'sa', 'to', 'lo', 'pa', 'vy', 'n'];

export function suggestName(seed: number): string {
  const r = rng(hash('name:' + seed));
  return pick(r, SYL_A) + pick(r, SYL_B);
}

/** Plain-language temperament, used in the Gather list and Memory Book. */
export function temperament(t: Traits): string {
  if (t.bravery > 0.62 && t.warmth > 0.55) return 'eager';
  if (t.bravery < 0.38) return 'cautious';
  if (t.playfulness > 0.6) return 'playful';
  if (t.warmth < 0.4) return 'aloof';
  return t.curiosity > 0.55 ? 'curious' : 'easygoing';
}
