// A KIN's voice: procedural, cute, wordless babble. Each syllable is a glottal source (saw + sine,
// with vibrato) through two vowel formants, under a soft envelope. Pitch, brightness and syllable
// set come from the genome, so every KIN sounds like itself on every device; the contour comes
// from the emotion (happy chirps up, questions rise, sleepy hums, sad wobbles, giggles bubble).
//
// `plan()` is pure (testable, deterministic per seed + utterance count); `Voice.say()` performs it
// and returns a mouth-opening curve so the face can lip-sync.

import type { Genome } from '../core/genome';
import { hash, rng } from '../core/rng';

export type Utterance = 'hello' | 'happy' | 'question' | 'sleepy' | 'sad' | 'giggle' | 'hey' | 'grumble' | 'yawn' | 'sneeze' | 'hum' | 'love';

export interface Syllable {
  at: number; // seconds from start
  dur: number;
  f0: number; // start pitch, Hz
  f1: number; // end pitch, Hz
  vowel: [number, number]; // formant frequencies
  gain: number;
  breath: number; // 0..1 noise mix (yawns, sneezes)
}

// Soft, round vowels (a, o, u, i, e), in formant pairs scaled up for a small throat.
const VOWELS: [number, number][] = [[900, 1500], [620, 1100], [420, 900], [380, 2300], [560, 1900]];

export function voiceTraits(g: Genome) {
  const r = rng(hash('voice:' + g.seed));
  return {
    base: 520 + r() * 260 - (g.size - 1) * 400, // smaller KIN, higher voice
    bright: 1.05 + r() * 0.35,
    vowels: [Math.floor(r() * 5), Math.floor(r() * 5), Math.floor(r() * 5)],
    speed: 0.85 + r() * 0.3,
  };
}

export function plan(g: Genome, kind: Utterance, n = 0): Syllable[] {
  const v = voiceTraits(g);
  const r = rng(hash(`say:${g.seed}:${kind}:${n}`));
  const vowel = (i: number): [number, number] => {
    const [a, b] = VOWELS[v.vowels[(i + Math.floor(r() * 2)) % 3]!]!;
    return [a * v.bright, b * v.bright];
  };
  const B = v.base;
  const out: Syllable[] = [];
  let t = 0;
  const add = (dur: number, f0: number, f1: number, gain = 1, breath = 0, gap = 0.03) => {
    out.push({ at: t, dur: dur / v.speed, f0, f1, vowel: vowel(out.length), gain, breath });
    t += dur / v.speed + gap;
  };
  switch (kind) {
    case 'hello':
      add(0.11, B * 1.1, B * 1.35);
      add(0.16, B * 1.25, B * 1.6);
      break;
    case 'happy':
      for (let i = 0; i < 2 + Math.floor(r() * 2); i++) add(0.08 + r() * 0.04, B * (1.2 + i * 0.12), B * (1.45 + i * 0.12), 0.9);
      break;
    case 'love':
      add(0.22, B * 1.05, B * 1.3, 0.8, 0.05, 0.06);
      add(0.32, B * 1.2, B * 0.95, 0.75, 0.05);
      break;
    case 'question':
      add(0.1, B, B * 1.05);
      add(0.2, B * 1.05, B * 1.7);
      break;
    case 'sleepy':
    case 'hum':
      add(0.38, B * 0.72, B * 0.66, 0.55, 0.15, 0.05);
      if (kind === 'hum') add(0.3, B * 0.8, B * 0.86, 0.5, 0.1);
      break;
    case 'yawn':
      add(0.7, B * 1.15, B * 0.6, 0.6, 0.45);
      break;
    case 'sad':
      add(0.32, B * 0.95, B * 0.72, 0.65, 0.05, 0.05);
      add(0.26, B * 0.8, B * 0.66, 0.55, 0.05);
      break;
    case 'giggle':
      for (let i = 0; i < 5; i++) add(0.055, B * (1.5 - i * 0.04), B * (1.62 - i * 0.04), 0.8, 0.12, 0.035);
      break;
    case 'hey':
      add(0.14, B * 1.45, B * 1.15, 1);
      break;
    case 'grumble':
      add(0.28, B * 0.6, B * 0.55, 0.55, 0.2, 0.03);
      add(0.2, B * 0.58, B * 0.5, 0.45, 0.2);
      break;
    case 'sneeze':
      add(0.12, B * 1.3, B * 1.5, 0.35, 0.3, 0.12);
      add(0.09, B * 1.8, B * 1.1, 1, 0.85);
      break;
  }
  return out;
}

export class Voice {
  enabled = true;
  private ctx: AudioContext | null = null;
  private count = 0;
  private noise: AudioBuffer | null = null;

  constructor(private g: Genome) {}

  /** Call once from a user gesture (autoplay policy). Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /**
   * Speak. Returns the mouth-openness curve (0..1) over time in ms, for lip sync. The curve is
   * returned even when muted, so the face still "talks" silently.
   */
  say(kind: Utterance): (ms: number) => number {
    const syl = plan(this.g, kind, this.count++);
    const mouth = (ms: number) => {
      const s = ms / 1000;
      for (const x of syl) if (s >= x.at && s <= x.at + x.dur) return Math.sin(((s - x.at) / x.dur) * Math.PI) * Math.min(1, x.gain + 0.2);
      return 0;
    };
    const c = this.ctx;
    if (!c || !this.enabled || c.state !== 'running') return mouth;
    const t0 = c.currentTime + 0.01;
    const out = c.createGain();
    out.gain.value = 0.11;
    out.connect(c.destination);
    for (const x of syl) this.syllable(c, out, t0 + x.at, x);
    setTimeout(() => out.disconnect(), (syl.at(-1)!.at + syl.at(-1)!.dur + 0.3) * 1000);
    return mouth;
  }

  private syllable(c: AudioContext, out: AudioNode, t: number, x: Syllable) {
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(x.gain, t + Math.min(0.025, x.dur * 0.3));
    env.gain.setValueAtTime(x.gain, t + x.dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + x.dur);
    // Glottal source: a bright saw for the voice, a sine for body, a little vibrato.
    const saw = c.createOscillator();
    saw.type = 'sawtooth';
    const sine = c.createOscillator();
    for (const o of [saw, sine]) {
      o.frequency.setValueAtTime(x.f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, x.f1), t + x.dur);
    }
    const vib = c.createOscillator();
    vib.frequency.value = 6.5;
    const vibAmt = c.createGain();
    vibAmt.gain.value = x.f0 * 0.012;
    vib.connect(vibAmt);
    vibAmt.connect(saw.frequency);
    vibAmt.connect(sine.frequency);
    const sawG = c.createGain();
    sawG.gain.value = 0.35 * (1 - x.breath);
    const sineG = c.createGain();
    sineG.gain.value = 0.6 * (1 - x.breath * 0.5);
    saw.connect(sawG);
    sine.connect(sineG);
    // Two formants make the vowel.
    const mix = c.createGain();
    for (const [f, q, g] of [[x.vowel[0], 6, 1.4], [x.vowel[1], 9, 0.8]] as const) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const bg = c.createGain();
      bg.gain.value = g;
      sawG.connect(bp).connect(bg).connect(mix);
    }
    sineG.connect(mix);
    // Breath (yawns, sneezes, giggles): filtered noise.
    if (x.breath > 0) {
      const n = c.createBufferSource();
      n.buffer = this.noiseBuffer(c);
      const hp = c.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 2400;
      hp.Q.value = 0.7;
      const ng = c.createGain();
      ng.gain.value = x.breath * 0.5;
      n.connect(hp).connect(ng).connect(mix);
      n.start(t);
      n.stop(t + x.dur + 0.02);
    }
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    mix.connect(lp).connect(env).connect(out);
    for (const o of [saw, sine, vib]) {
      o.start(t);
      o.stop(t + x.dur + 0.03);
    }
  }

  private noiseBuffer(c: AudioContext) {
    if (this.noise) return this.noise;
    const b = c.createBuffer(1, c.sampleRate * 0.8, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    return b;
  }
}
