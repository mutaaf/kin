// The feedback vocabulary (CREATIVE_DIRECTION): soft bell for greeting, low thump for landing,
// airy rising tone for the portal, layered chime for a successful visit, a purr for petting.
// All synthesized: no files, works offline, instantly muteable. Respects the sound setting.

export class Sfx {
  private ctx: AudioContext | null = null;
  enabled = true;

  /** Must be called from a user gesture once (autoplay policy). */
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

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number; attack?: number } = {}) {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    const t0 = c.currentTime + (opts.delay ?? 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(freq * opts.slide, t0 + dur);
    const peak = opts.gain ?? 0.08;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  chirp(pitch = 1) {
    this.tone(1250 * pitch, 0.09, { slide: 1.5, gain: 0.05 });
    this.tone(1650 * pitch, 0.08, { slide: 1.3, gain: 0.04, delay: 0.09 });
  }

  bell() {
    this.tone(880, 0.9, { gain: 0.05 });
    this.tone(1320, 0.7, { gain: 0.025, delay: 0.01 });
  }

  thump() {
    this.tone(120, 0.18, { slide: 0.55, gain: 0.12, type: 'sine' });
  }

  portal() {
    this.tone(330, 0.75, { slide: 2.6, gain: 0.035, type: 'triangle', attack: 0.2 });
  }

  chime() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.7, { gain: 0.035, delay: i * 0.08 }));
  }

  purr() {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    const lfo = c.createOscillator();
    const lg = c.createGain();
    const g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 52;
    lfo.frequency.value = 24;
    lg.gain.value = 0.02;
    lfo.connect(lg).connect(g.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.025, t0 + 0.15);
    g.gain.linearRampToValueAtTime(0.0001, t0 + 0.9);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    o.connect(f).connect(g).connect(c.destination);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + 1);
    lfo.stop(t0 + 1);
  }

  sad() {
    this.tone(520, 0.35, { slide: 0.7, gain: 0.04 });
  }
}
