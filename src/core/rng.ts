// Deterministic randomness. Everything that must replay identically (genome, brain variation,
// race outcomes later) draws from a seeded stream, never Math.random.

export type Rng = () => number;

/** mulberry32: tiny, fast, good enough for gameplay; not for security. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash, used to derive sub-seeds ("genome:" + id, "brain:" + tick). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
export const range = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function randomId(prefix: string): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + '_' + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}
