// Cinematic speech. Dialogue, not a tooltip: a bubble that hangs above the KIN's head on a
// spring and follows it in screen space with a live, curving tail; the words arrive one character
// at a time in step with its babble voice; and the typography moves the way the KIN feels. A
// bratty KIN slams its words down, a royal one lets them drift in in an elegant serif, a gamer's
// glitch in, a pop star's shimmer, a scholar's type out. *Emphasis* words are lit in the persona's
// colour. Thoughts float in a cloud in italics; speech sits in a solid bubble. Two KIN can talk in
// turns. Subtitles mode (and reduced motion) puts everything in a calm caption bar instead.
//
// It never covers the face (bubbles sit above the head, or beside it when there's no room), it's
// crisp at any pixel ratio (whole-pixel transforms, real text), and it leaves the screen on its
// own after a reading time computed from the words. Tap a bubble to finish it, tap again to go on.
//
// ── Integration for app.ts ────────────────────────────────────────────────────────────────────
//   import { SpeechLayer } from './ui/speech';
//   const speech = new SpeechLayer(document.getElementById('hud')!, {
//     reducedMotion: () => settings.reducedMotion,
//     subtitles: () => settings.subtitles,          // add `subtitles: false` to Settings
//     onVoice: (who, kind) => (who === 'me' ? view : guests.get(who)?.view)?.say(kind),
//   });
//   speech.speaker('me', () => { const h = view.screenHit(); return view.visible ? h : null; });
//   // guests: speech.speaker(visitId, () => g.view.screenHit())   and  speech.forget(visitId) on leave
//   // Replace hud.thought(...) with:
//   const ex = expression(persona);   // src/core/persona.ts
//   speech.say({ who: 'me', text: r.thought, kind: 'thought', style: ex.speech, mood: r.mood, title: ex.title, name: kin.name, hue: ex.hue });
//   // Answers: kind 'speech'. Snack lines: speech.say({ who: 'me', text: snackLine(s, ex.dominant), style: ex.speech, ... })
//   // A visit exchange: speech.exchange([{ who: 'me', text: 'Hi!' }, { who: visitId, text: 'Hello!' }])
// ──────────────────────────────────────────────────────────────────────────────────────────────

import './speech.css';

export type SpeechStyle = 'neutral' | 'popstar' | 'scholar' | 'gamer' | 'athlete' | 'brat' | 'royal' | 'explorer' | 'artist';
export type VoiceKind = 'hello' | 'happy' | 'question' | 'sleepy' | 'sad' | 'giggle' | 'hey' | 'grumble' | 'yawn' | 'hum' | 'love';

export interface Line {
  /** Speaker id registered with `speaker()`. */
  who: string;
  text: string;
  kind?: 'speech' | 'thought';
  style?: SpeechStyle;
  mood?: string;
  /** Persona title for the chip, e.g. "Sporty Brat". */
  title?: string;
  name?: string;
  /** Accent hue (persona) for emphasis and the chip dot. */
  hue?: number;
  /** Override the reading time once all words are in (ms). */
  holdMs?: number;
}

export interface Anchor {
  /** Head centre in CSS px. */
  x: number;
  y: number;
  /** Head radius in CSS px. */
  r: number;
}

// ── Pure helpers (tested) ──────────────────────────────────────────────────────────────────────

export interface Glyph {
  ch: string;
  em: boolean;
  /** Index of the word this glyph belongs to (spaces belong to the previous word). */
  word: number;
}

/** Split text into graphemes, honouring *emphasis* markers (which are removed). */
export function tokenize(text: string): Glyph[] {
  const out: Glyph[] = [];
  let em = false;
  let word = 0;
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const chars = seg ? [...seg.segment(text)].map((s) => s.segment) : [...text];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === '*') {
      em = !em;
      continue;
    }
    if (c === ' ' && out.length && out[out.length - 1]!.ch !== ' ') {
      out.push({ ch: c, em: false, word });
      word++;
      continue;
    }
    out.push({ ch: c, em, word });
  }
  return out;
}

/** Characters per second by style: how fast each personality talks. */
export const CPS: Record<SpeechStyle, number> = {
  neutral: 38, popstar: 42, scholar: 46, gamer: 56, athlete: 52, brat: 48, royal: 24, explorer: 36, artist: 30,
};

const PAUSE: [RegExp, number][] = [[/[.!?]/, 260], [/[,;:]/, 120], [/…/, 420], [/[—–-]/, 80]];

/**
 * When each glyph appears (ms from the start). Punctuation breathes; bratty KIN deliver whole
 * words at once (the slam); sleepy ones drawl.
 */
export function revealPlan(glyphs: Glyph[], style: SpeechStyle, mood = ''): number[] {
  let cps = CPS[style];
  if (mood === 'sleepy') cps *= 0.6;
  if (mood === 'excited') cps *= 1.25;
  if (mood === 'shy') cps *= 0.75;
  const step = 1000 / cps;
  const at: number[] = [];
  let t = 0;
  let wordStart = 0;
  let lastWord = -1;
  for (const g of glyphs) {
    if (style === 'brat') {
      // Whole words land together, with a beat between them.
      if (g.word !== lastWord) {
        wordStart = t;
        lastWord = g.word;
        t += step * 4;
      }
      at.push(wordStart);
    } else {
      at.push(t);
      t += step;
    }
    for (const [re, ms] of PAUSE) if (re.test(g.ch)) t += ms;
  }
  return at;
}

/** How long to leave words on screen once they're all in: about 230 wpm, a floor and a ceiling. */
export function readingMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1800, Math.min(9000, 900 + words * 260 + text.length * 12));
}

export interface Placement {
  x: number;
  y: number;
  side: 'above' | 'right' | 'left' | 'below';
  /** Tail tip (near the head, never on the face). */
  tip: { x: number; y: number };
  /** Where the tail leaves the bubble. */
  root: { x: number; y: number };
}

/**
 * Put a w×h bubble next to a head without covering it: above if it fits, else beside, else below.
 * Clamped to the viewport with a margin; the tail points at the head's edge, not its middle.
 */
export function place(a: Anchor, w: number, h: number, vw: number, vh: number, safeTop = 72, margin = 12): Placement {
  const gap = 14;
  const clampX = (x: number) => Math.max(margin, Math.min(vw - w - margin, x));
  const clampY = (y: number) => Math.max(safeTop, Math.min(vh - h - margin, y));
  const above = a.y - a.r - gap - h;
  if (above >= safeTop) {
    const x = clampX(a.x - w * 0.35);
    return { x, y: above, side: 'above', tip: { x: a.x, y: a.y - a.r * 0.92 }, root: { x: Math.max(x + 18, Math.min(x + w - 18, a.x + 6)), y: above + h } };
  }
  const right = a.x + a.r + gap;
  if (right + w <= vw - margin) {
    const y = clampY(a.y - h * 0.6);
    return { x: right, y, side: 'right', tip: { x: a.x + a.r * 0.92, y: a.y }, root: { x: right, y: Math.max(y + 14, Math.min(y + h - 14, a.y)) } };
  }
  const left = a.x - a.r - gap - w;
  if (left >= margin) {
    const y = clampY(a.y - h * 0.6);
    return { x: left, y, side: 'left', tip: { x: a.x - a.r * 0.92, y: a.y }, root: { x: left + w, y: Math.max(y + 14, Math.min(y + h - 14, a.y)) } };
  }
  const below = Math.min(vh - h - margin, a.y + a.r + gap);
  const x = clampX(a.x - w * 0.35);
  return { x, y: below, side: 'below', tip: { x: a.x, y: a.y + a.r * 0.92 }, root: { x: Math.max(x + 18, Math.min(x + w - 18, a.x)), y: below } };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect, pad = 8) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
/** The speaker's face, as a box: a bubble may never cover it. */
const faceBox = (a: Anchor): Rect => ({ x: a.x - a.r, y: a.y - a.r, w: a.r * 2, h: a.r * 2 });

/**
 * Move a placed bubble out of other speakers' bubbles. It slides sideways first (keeping its
 * place above its own head), then up, and it never moves onto its own face or off-screen; if no
 * clean spot exists it keeps its original place (two bubbles touching beats a covered face).
 */
export function resolveOverlap(
  p: Placement, w: number, h: number, a: Anchor, others: Rect[], vw: number, vh: number, safeTop = 72, margin = 12, otherFaces: Anchor[] = [],
) {
  // No bubble may cover any KIN's face: its own, or a friend's standing nearby.
  const faces = [faceBox(a), ...otherFaces.map(faceBox)];
  const ok = (x: number, y: number) => {
    const r = { x, y, w, h };
    return x >= margin && x + w <= vw - margin && y >= safeTop && y + h <= vh - margin && !faces.some((f) => overlaps(r, f, 4)) && !others.some((o) => overlaps(r, o));
  };
  if (ok(p.x, p.y)) return p;
  const candidates: [number, number][] = [];
  for (const o of [...others, ...faces.slice(1)]) {
    candidates.push([o.x + o.w + 10, p.y], [o.x - w - 10, p.y], [p.x, o.y - h - 10]);
  }
  // Also try straight up above the speaker, in steps.
  for (let k = 1; k <= 6; k++) candidates.push([p.x, p.y - k * 24]);
  candidates.sort((u, v) => Math.hypot(u[0] - p.x, u[1] - p.y) - Math.hypot(v[0] - p.x, v[1] - p.y));
  const best = candidates.find(([x, y]) => ok(x, y));
  if (!best) return p;
  const [dx, dy] = [best[0] - p.x, best[1] - p.y];
  p.x += dx;
  p.y += dy;
  // The tail still leaves from the edge nearest the head.
  p.root.x = Math.max(p.x + 18, Math.min(p.x + w - 18, p.root.x + dx * 0));
  if (p.side === 'above' || p.side === 'below') p.root.y += dy;
  else p.root.y = Math.max(p.y + 14, Math.min(p.y + h - 14, p.root.y + dy));
  if (p.side === 'left' || p.side === 'right') p.root.x = p.side === 'right' ? p.x : p.x + w;
  return p;
}

/** Which babble the voice should make for a line. */
export function voiceFor(style: SpeechStyle, mood = '', text = ''): VoiceKind {
  if (mood === 'sleepy') return 'sleepy';
  if (/\?\s*$/.test(text)) return 'question';
  if (mood === 'sad' || mood === 'shy') return 'sad';
  if (style === 'brat' || mood === 'sassy') return 'hey';
  if (style === 'royal' || style === 'artist') return 'hum';
  if (mood === 'happy' || mood === 'excited' || style === 'popstar' || style === 'gamer') return 'giggle';
  if (mood === 'cozy' || mood === 'content') return 'love';
  return 'happy';
}

// ── The layer ──────────────────────────────────────────────────────────────────────────────────

interface Bubble {
  line: Line;
  el: HTMLElement;
  text: HTMLElement;
  tail: SVGPathElement;
  pos: { x: number; y: number; vx: number; vy: number; init: boolean };
  plan: number[];
  start: number;
  total: number;
  done: boolean;
  end: number;
  resolve: () => void;
  leaving: boolean;
}

export interface SpeechOptions {
  reducedMotion?: () => boolean;
  subtitles?: () => boolean;
  /** Babble with lip sync while words arrive (KinView.say). */
  onVoice?: (who: string, kind: VoiceKind) => void;
  safeTop?: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class SpeechLayer {
  private anchors = new Map<string, () => Anchor | null>();
  private queues = new Map<string, Line[]>();
  private showing = new Map<string, Bubble>();
  private waiters = new Map<Line, () => void>();
  private svg: SVGSVGElement;
  private bar: HTMLElement;
  private raf = 0;
  private last = 0;

  constructor(private host: HTMLElement, private o: SpeechOptions = {}) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('sp-tails');
    this.svg.setAttribute('aria-hidden', 'true');
    this.bar = document.createElement('div');
    this.bar.className = 'sp-subs';
    this.bar.setAttribute('role', 'log');
    this.bar.setAttribute('aria-live', 'polite');
    host.append(this.svg, this.bar);
  }

  speaker(id: string, anchor: () => Anchor | null) {
    this.anchors.set(id, anchor);
  }

  forget(id: string) {
    this.anchors.delete(id);
    this.queues.delete(id);
    const b = this.showing.get(id);
    if (b) this.dismiss(id, b);
  }

  /** Say a line. Resolves when it has left the screen. Lines from one speaker queue up. */
  say(line: Line): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.set(line, resolve);
      const q = this.queues.get(line.who) ?? [];
      q.push(line);
      this.queues.set(line.who, q);
      this.pump(line.who);
    });
  }

  /** A conversation: each line waits for the previous one to finish revealing (not to leave). */
  async exchange(lines: Line[]) {
    for (const l of lines) {
      const p = this.say(l);
      await new Promise<void>((res) => {
        const tick = () => {
          const b = this.showing.get(l.who);
          if (!b || b.line !== l || b.done) return res();
          setTimeout(tick, 80);
        };
        setTimeout(tick, 60);
      });
      void p;
      await new Promise((r) => setTimeout(r, 380)); // a beat between turns
    }
  }

  clear() {
    for (const [id, b] of this.showing) this.dismiss(id, b);
    this.queues.clear();
  }

  private pump(who: string) {
    if (this.showing.has(who)) return;
    const q = this.queues.get(who);
    const line = q?.shift();
    if (!line) return;
    this.open(line);
  }

  private open(line: Line) {
    const style: SpeechStyle = line.style ?? 'neutral';
    const kind = line.kind ?? 'speech';
    const subs = !!this.o.subtitles?.();
    const calm = subs || !!this.o.reducedMotion?.();
    const glyphs = tokenize(line.text);
    const plan = calm ? glyphs.map(() => 0) : revealPlan(glyphs, style, line.mood);
    const total = (plan[plan.length - 1] ?? 0) + 260;
    // Another KIN is talking: its bubble steps back a little (dialogue rhythm).
    for (const [id, b] of this.showing) if (id !== line.who) b.el.classList.add('sp-back');

    const el = document.createElement('div');
    el.className = `sp sp-${kind} sp-${style}${line.mood ? ` sp-m-${line.mood}` : ''}${calm ? ' sp-calm' : ''}${subs ? ' sp-sub' : ''}`;
    el.style.setProperty('--hue', String(line.hue ?? 165));
    el.setAttribute('role', 'status');
    const chip = line.title || line.name ? `<div class="sp-chip"><i></i>${line.title ? `<b>${esc(line.title)}</b>` : ''}${line.name ? `<span>${esc(line.name)}</span>` : ''}</div>` : '';
    let html = '';
    let wordOpen = -1;
    glyphs.forEach((g, i) => {
      if (g.word !== wordOpen) {
        if (wordOpen >= 0) html += '</span>';
        html += `<span class="sp-w" style="--wd:${Math.round(plan[i]!)}ms">`;
        wordOpen = g.word;
      }
      const c = g.ch === ' ' ? ' ' : esc(g.ch);
      html += `<span class="sp-c${g.em ? ' sp-em' : ''}" style="--d:${Math.round(plan[i]!)}ms;--k:${i}">${c}</span>`;
    });
    if (wordOpen >= 0) html += '</span>';
    el.innerHTML = `${chip}<p class="sp-text" aria-label="${esc(line.text.replace(/\*/g, ''))}">${html}</p>${kind === 'thought' ? '<span class="sp-puff a"></span><span class="sp-puff b"></span>' : ''}`;
    (subs ? this.bar : this.host).append(el);
    const tail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tail.classList.add('sp-tail', `sp-tail-${kind}`);
    if (!subs) this.svg.append(tail);
    const b: Bubble = {
      line, el, text: el.querySelector('.sp-text')!, tail, pos: { x: 0, y: 0, vx: 0, vy: 0, init: false },
      plan, start: performance.now(), total, done: false, end: 0, resolve: () => {}, leaving: false,
    };
    b.end = b.start + total + (line.holdMs ?? readingMs(line.text));
    this.showing.set(line.who, b);
    requestAnimationFrame(() => el.classList.add('sp-in'));
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!b.done) this.finish(b);
      else this.dismiss(line.who, b);
    });
    // The voice: babble in phrases while the words arrive (one call per ~1.2 s of reveal).
    if (this.o.onVoice) {
      const kindV = voiceFor(style, line.mood, line.text);
      const phrases = Math.max(1, Math.ceil(total / 1200));
      for (let i = 0; i < Math.min(4, phrases); i++) setTimeout(() => !b.leaving && this.o.onVoice?.(line.who, kindV), i * 1200);
    }
    this.loop();
  }

  private finish(b: Bubble) {
    b.done = true;
    b.el.classList.add('sp-all');
    b.end = performance.now() + (b.line.holdMs ?? readingMs(b.line.text));
  }

  private dismiss(who: string, b: Bubble) {
    if (b.leaving) return;
    b.leaving = true;
    b.el.classList.remove('sp-in');
    b.el.classList.add('sp-out');
    b.tail.classList.add('sp-out');
    setTimeout(() => {
      b.el.remove();
      b.tail.remove();
      if (this.showing.get(who) === b) this.showing.delete(who);
      for (const other of this.showing.values()) other.el.classList.remove('sp-back');
      this.waiters.get(b.line)?.();
      this.waiters.delete(b.line);
      this.pump(who);
    }, 320);
  }

  private loop() {
    if (this.raf) return;
    this.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const vw = innerWidth;
      const vh = innerHeight;
      this.svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
      // Bubbles from different speakers never overlap: later ones step out of earlier ones' way.
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      // The newest line gets the natural spot above its speaker; older bubbles make way around it.
      const order = [...this.showing.entries()].sort((x, y) => y[1].start - x[1].start);
      for (const [who, b] of order) {
        if (!b.done && now - b.start >= b.total) b.done = true;
        if (!b.leaving && now >= b.end) this.dismiss(who, b);
        if (b.el.parentElement === this.bar) continue;
        const a = this.anchors.get(who)?.();
        if (!a) {
          b.el.style.opacity = '0';
          b.tail.setAttribute('d', '');
          continue;
        }
        b.el.style.opacity = '';
        const w = b.el.offsetWidth;
        const h = b.el.offsetHeight;
        const p = place(a, w, h, vw, vh, this.o.safeTop ?? 72);
        const nearby = [...this.anchors.entries()].filter(([id]) => id !== who).map(([, f]) => f()).filter((x): x is Anchor => !!x);
        resolveOverlap(p, w, h, a, placed, vw, vh, this.o.safeTop ?? 72, 12, nearby);
        placed.push({ x: p.x, y: p.y, w, h });
        // A soft spring: the bubble trails the head a little and settles (snaps under reduced motion).
        const P = b.pos;
        if (!P.init || this.o.reducedMotion?.()) {
          Object.assign(P, { x: p.x, y: p.y, vx: 0, vy: 0, init: true });
        } else {
          const k = 140;
          const c = 2 * Math.sqrt(k) * 0.82;
          P.vx += ((p.x - P.x) * k - P.vx * c) * dt;
          P.vy += ((p.y - P.y) * k - P.vy * c) * dt;
          P.x += P.vx * dt;
          P.y += P.vy * dt;
        }
        b.el.style.transform = `translate3d(${Math.round(P.x)}px, ${Math.round(P.y)}px, 0)`;
        b.el.dataset.side = p.side;
        // Tail: a tapered curve from the bubble's edge toward the head (stops short of the face).
        const rx = p.root.x + (P.x - p.x);
        const ry = p.root.y + (P.y - p.y);
        if (b.line.kind === 'thought') {
          b.tail.setAttribute('d', '');
          const pa = b.el.querySelector<HTMLElement>('.sp-puff.a');
          const pb = b.el.querySelector<HTMLElement>('.sp-puff.b');
          const lerp = (t: number) => [rx + (p.tip.x - rx) * t - P.x, ry + (p.tip.y - ry) * t - P.y];
          const [ax, ay] = lerp(0.35);
          const [bx, by] = lerp(0.7);
          if (pa) pa.style.transform = `translate(${Math.round(ax!)}px, ${Math.round(ay!)}px)`;
          if (pb) pb.style.transform = `translate(${Math.round(bx!)}px, ${Math.round(by!)}px)`;
        } else {
          const tx = p.tip.x + (rx - p.tip.x) * 0.18;
          const ty = p.tip.y + (ry - p.tip.y) * 0.18;
          const horiz = p.side === 'left' || p.side === 'right';
          const spread = 9;
          // The root sinks a few px into the bubble so the tail grows out of it, never floats.
          const sink = p.side === 'above' ? -6 : p.side === 'below' ? 6 : p.side === 'right' ? 6 : -6;
          const [r1x, r1y, r2x, r2y] = horiz ? [rx + sink, ry - spread, rx + sink, ry + spread] : [rx - spread, ry + sink, rx + spread, ry + sink];
          const cx = (rx + tx) / 2 + (horiz ? 0 : (tx - rx) * 0.25);
          const cy = (ry + ty) / 2 + (horiz ? (ty - ry) * 0.25 : 0);
          b.tail.setAttribute('d', `M${r1x.toFixed(1)},${r1y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${r2x.toFixed(1)},${r2y.toFixed(1)} Z`);
        }
      }
      if (this.showing.size) this.raf = requestAnimationFrame(step);
      else this.raf = 0;
    };
    this.raf = requestAnimationFrame(step);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clear();
    this.svg.remove();
    this.bar.remove();
  }
}
