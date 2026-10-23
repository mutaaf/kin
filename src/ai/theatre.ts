// The thought theatre: every AI call made visible (the COLD GAS judges' theatre, made for KIN).
// An aurora-field particle field (lazy chunk) morphs with the real call as it happens:
//
//   READ     your KIN, made of light (points sampled from its actual mesh) while the card is read
//   REFLECT  (analysis) the "why it's becoming this" history scrolls past, the field turns inward
//   THINK    the mind: one signal per streamed token
//   SPEAK    the choice (or the persona's title), spelled in light; then the words land on screen
//
// Three modes share it: "think" (what is it thinking), "ask" (answer a question in character) and
// "analyze" (a cinematic personality reading that ends on a card you can keep).
// Around it: who answered (model, provider, where, who pays), live counters (tokens in/out,
// time to first token, tokens/s, cost or neurons), the raw stream, and "Inspect the call".
import { create, fromPoints, fromText, register } from 'aurora-field';
import '@fontsource/geist-mono/700.css';
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { makeGenome } from '../core/genome';
import { rng } from '../core/rng';
import { buildCreature } from '../render/creatureMesh';
import { direct, type Done } from './client';
import { nice, PROVIDER_INFO, type AIChoice } from './config';
import { localAnalysis, localAnswer, localThought, type Analysis, type Answer, type Card, type Thought } from './schema';
import './ai.css';

export type TheatreMode = 'think' | 'ask' | 'analyze';

interface Meta {
  source: 'model' | 'local';
  model?: string;
  note?: string;
}
export interface TheatreResult extends Thought, Meta {}
export interface AnswerResult extends Answer, Meta {}
export interface AnalysisResult extends Analysis, Meta {}

type V3 = [number, number, number];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MIN_MS = { read: 2400, reflect: 2600, think: 1600 };
const SPELL = { preset: 'aurora' as const, point: [176, 255, 228] as V3, accent: [176, 255, 228] as V3, glow: [150, 245, 210] as V3, fog: [120, 180, 170] as V3 };
// The light-KIN: porcelain points with a mint glow, so the creature reads as a bright figure.
const BODY = { preset: 'aurora' as const, point: [236, 246, 242] as V3, accent: [110, 229, 202] as V3, glow: [110, 229, 202] as V3, fog: [60, 90, 100] as V3 };
// The reflect stage: a warmer, amber inner light.
const INNER = { preset: 'aurora' as const, point: [255, 226, 186] as V3, accent: [233, 175, 107] as V3, glow: [233, 175, 107] as V3, fog: [90, 70, 60] as V3 };

/** Points sampled from the creature's real surface, centred and scaled to the unit sphere. */
export function kinPoints(seed: number, n = 2400): V3[] {
  const parts = buildCreature(makeGenome(seed));
  parts.root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  parts.root.traverse((o) => {
    const m = o as THREE.Mesh;
    // The body surface only: fur shells are InstancedMesh offsets of it, and would blur the silhouette.
    if (m.isMesh && m.visible && m.geometry && !(m as THREE.InstancedMesh).isInstancedMesh) meshes.push(m);
  });
  const weights = meshes.map((m) => {
    m.geometry.computeBoundingSphere();
    const s = new THREE.Vector3();
    m.getWorldScale(s);
    return (m.geometry.boundingSphere!.radius * Math.max(s.x, s.y, s.z)) ** 2;
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const r = rng(seed);
  const pts: V3[] = [];
  const p = new THREE.Vector3();
  meshes.forEach((m, i) => {
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(geo));
    // Seeded sampling, so the light-KIN matches every time (the method exists; @types lags it).
    (sampler as unknown as { setRandomGenerator(f: () => number): void }).setRandomGenerator(r);
    sampler.build();
    const k = Math.max(4, Math.round((weights[i]! / total) * n));
    for (let j = 0; j < k; j++) {
      sampler.sample(p);
      p.applyMatrix4(m.matrixWorld);
      pts.push([p.x, -(p.y - 0.55), p.z]); // screen y points down in the field
    }
    if (geo !== m.geometry) geo.dispose();
  });
  parts.dispose();
  const max = Math.max(...pts.map(([x, y, z]) => Math.hypot(x, y, z))) || 1;
  return pts.map(([x, y, z]): V3 => [x / max, y / max, z / max]);
}

interface Opts {
  card: Card;
  seed: number;
  ai: AIChoice;
  reduced: boolean;
  onSettings: () => void;
}

/** What is it thinking? (the original contract, used by app.ts) */
export function runTheatre(o: Opts & { mode?: 'think' }): Promise<TheatreResult> {
  return show<TheatreResult>({ ...o, mode: 'think' });
}

/** Ask it something: an in-character answer plus one safe act. */
export function askTheatre(o: Opts & { question: string }): Promise<AnswerResult> {
  return show<AnswerResult>({ ...o, mode: 'ask' });
}

/** A cinematic personality reading. Resolves when the player closes the reading card. */
export function analyzeTheatre(o: Opts): Promise<AnalysisResult> {
  return show<AnalysisResult>({ ...o, mode: 'analyze' });
}

async function show<R extends Meta>(o: Opts & { mode: TheatreMode; question?: string }): Promise<R> {
  const { card, seed, ai, reduced, mode } = o;
  const self = `kin:self:${seed}`;
  try {
    register(self, fromPoints(kinPoints(seed)));
  } catch {
    /* already registered */
  }
  const stages = mode === 'analyze' ? ['read', 'reflect', 'think', 'speak'] : ['read', 'think', 'speak'];
  const label: Record<string, string> = { read: 'Read', reflect: 'Reflect', think: mode === 'ask' ? 'Listen' : 'Think', speak: mode === 'analyze' ? 'Reveal' : 'Speak' };
  const root = document.createElement('div');
  root.className = `th th-${mode}`;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', mode === 'analyze' ? `A reading of ${card.name}` : mode === 'ask' ? `${card.name} answers` : `What ${card.name} is thinking`);
  const who = ai.provider === 'edge' ? 'Free · runs on Cloudflare’s edge' : `${PROVIDER_INFO[ai.provider].label} · billed to your key`;
  root.innerHTML = `
    <div class="th-stage"><canvas class="th-canvas"></canvas></div>
    <div class="th-ui">
      <header class="th-head">
        <ol class="th-rail">${stages.map((s) => `<li data-s="${s}">${label[s]}</li>`).join('')}</ol>
        <button class="btn th-close" data-close>Skip</button>
      </header>
      <p class="th-caption" data-caption></p>
      <ol class="th-why" data-why aria-label="Why it is becoming this"></ol>
      <aside class="th-card">
        <div class="th-model"><b data-model>${esc(nice(ai.model))}</b><span>${esc(who)}</span><span data-where></span></div>
        <dl class="th-stats">
          <div><dt>in</dt><dd data-stat="in">–</dd></div><div><dt>out</dt><dd data-stat="out">0</dd></div>
          <div><dt>first token</dt><dd data-stat="ttft">–</dd></div><div><dt>tok/s</dt><dd data-stat="tps">–</dd></div>
          <div><dt>${ai.provider === 'edge' ? 'neurons' : 'cost'}</dt><dd data-stat="cost">–</dd></div>
        </dl>
        <pre class="th-raw" data-raw aria-label="Raw model output"></pre>
        <details class="th-inspect"><summary>Inspect the call</summary><div data-inspect></div></details>
        <button class="btn th-byok" data-byok>${ai.provider === 'edge' ? 'Use your own AI' : 'Change AI'}</button>
      </aside>
      <section class="th-reading" data-reading hidden></section>
    </div>`;
  document.getElementById('hud')!.append(root);
  requestAnimationFrame(() => root.classList.add('on'));
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const stat = (k: string, v: string) => ($(`[data-stat="${k}"]`).textContent = v);
  const caption = (t: string) => {
    const el = $('[data-caption]');
    el.classList.remove('in');
    void el.offsetWidth; // restart the caption's entrance
    el.textContent = t.replace(/\*/g, ''); // emphasis markers are for the speech layer
    el.classList.add('in');
  };

  let field: ReturnType<typeof create> | null = null;
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      // The show must never break the call, but say why it didn't play.
      console.warn('[kin theatre]', err);
    }
  };
  const makeField = (shapes: string[], palette: typeof BODY, autonomy: number) => {
    if (reduced) return;
    safe(() => {
      field?.destroy();
      field = create($('.th-canvas') as HTMLCanvasElement, {
        container: $('.th-stage'), shapes, initial: shapes[0], cycle: 0, palette, blank: true,
        interactive: false, stars: 70, autonomy, depth: 3.0, intro: 0,
        count: (w: number) => (w < 700 ? 3000 : 4200), radius: (w: number, h: number) => Math.min(w * 0.42, h * 0.32),
      });
    });
  };
  const signal = (strength: number, spread: number) => safe(() => (field as unknown as { signal?: (a?: unknown, b?: number, c?: number) => void })?.signal?.(undefined, strength, spread));
  makeField([self, 'mind'], BODY, 0.2);
  const setStage = (s: string) => {
    root.dataset.stage = s;
    root.querySelectorAll<HTMLElement>('.th-rail li').forEach((li) => {
      li.className = li.dataset.s === s ? 'on' : stages.indexOf(li.dataset.s!) < stages.indexOf(s) ? 'done' : '';
    });
  };

  const abort = new AbortController();
  let skipped = false;
  const skip = new Promise<void>((res) => {
    $('[data-close]').onclick = () => {
      skipped = true;
      abort.abort();
      res();
    };
  });
  $('[data-byok]').onclick = () => o.onSettings();

  // READ
  setStage('read');
  const t0 = performance.now();
  const persona = card.persona && card.persona.title !== 'Little One' ? `, becoming a ${card.persona.title}` : '';
  caption(
    mode === 'ask'
      ? `${card.name} heard you: “${o.question}”`
      : `Reading ${card.name}${persona}: ${card.weather.word}, ${Math.round(card.weather.tempC)}°, ${card.timeOfDay}. Energy ${Math.round(card.drives.energy * 100)}, wants company ${Math.round(card.drives.social * 100)}.`,
  );
  const pulse = setInterval(() => signal(26, 3), 200);

  // The call runs while the show plays; the show never waits longer than it must.
  let result: R | null = null;
  let out = '';
  let tokens = 0;
  let firstAt = 0;
  let lastSignal = 0;
  const local = (note: string): R => {
    const base = mode === 'analyze' ? localAnalysis(card) : mode === 'ask' ? localAnswer(card, rng(Date.now())) : localThought(card, rng(Date.now()));
    return { ...base, source: 'local', note } as unknown as R;
  };
  const body = mode === 'ask' ? { card, question: o.question } : { card };
  const call = direct<unknown>(mode, body, ai, {
    prompt: (e) => {
      $('[data-where]').textContent = e.colo ? `answered near ${e.colo}` : '';
      $('[data-inspect]').innerHTML = `<h4>System</h4><pre>${esc(e.system)}</pre><h4>Card</h4><pre>${esc(e.user)}</pre><h4>Response</h4><pre data-resp></pre>`;
    },
    token: (e) => {
      if (!firstAt) {
        firstAt = performance.now();
        stat('ttft', `${Math.round(firstAt - t0)} ms`);
      }
      out += e.text;
      tokens++;
      stat('out', String(tokens));
      $('[data-raw]').textContent = out.slice(-320);
      const now = performance.now();
      if (now - lastSignal > 33) {
        signal(14, 2);
        lastSignal = now;
      }
    },
    done: (e: Done<unknown>) => {
      stat('in', String(e.usage.inTokens || '–'));
      if (e.usage.outTokens) stat('out', String(e.usage.outTokens));
      const secs = firstAt ? (performance.now() - firstAt) / 1000 : 0;
      if (secs > 0.05) stat('tps', String(Math.round((e.usage.outTokens || tokens) / secs)));
      stat('cost', ai.provider === 'edge' ? (e.usage.neurons ? e.usage.neurons.toFixed(1) : 'free') : e.cost !== null ? `$${e.cost.toFixed(5)}` : 'your rate');
      const resp = root.querySelector('[data-resp]');
      if (resp) resp.textContent = out;
      result = e.result
        ? ({ ...(e.result as object), source: 'model', model: ai.model } as unknown as R)
        : local(`The answer didn't fit the rules (${e.errors.join('; ')}), so ${card.name} ${mode === 'analyze' ? 'got a reading from the device' : 'answered for itself'}.`);
    },
    error: (e) => {
      result = local(`${e.message} ${card.name} ${mode === 'analyze' ? 'got a reading from the device' : 'answered for itself'}.`);
    },
  }, abort.signal).catch(() => {
    result ??= local('Offline: words from the device.');
  });

  await Promise.race([wait(MIN_MS.read), skip]);

  // REFLECT (analysis): the real history of why it's becoming this, line by line.
  if (!skipped && mode === 'analyze') {
    setStage('reflect');
    caption(card.persona?.why.length ? 'What made it who it is…' : 'Still small. Every day is a first.');
    makeField(['mind', self], INNER, 0.4);
    const list = $('[data-why]');
    const lines = card.persona?.why.length ? card.persona.why : ['hatched recently', 'is still finding its favourite things'];
    lines.forEach((w, i) => setTimeout(() => {
      const li = document.createElement('li');
      li.textContent = w;
      list.append(li);
      signal(40, 4);
    }, 300 + i * 650));
    await Promise.race([wait(MIN_MS.reflect + lines.length * 300), skip]);
  }

  // THINK
  if (!skipped) {
    setStage('think');
    caption(mode === 'ask' ? 'Thinking about how to say it…' : mode === 'analyze' ? 'Putting it into words…' : 'Thinking…');
    safe(() => {
      field?.set({ palette: 'aurora', autonomy: 0.35 });
      field?.setShape('mind', { pin: 1e9 });
    });
    await Promise.race([Promise.all([call, wait(MIN_MS.think)]), skip, wait(30_000)]);
  }
  clearInterval(pulse);
  const final: R = result ?? local('That took too long, so words from the device.');

  // SPEAK
  if (!skipped) {
    setStage('speak');
    const f = final as unknown as Partial<Thought & Answer & Analysis>;
    const word = mode === 'analyze' ? (f.becoming ?? card.persona?.title ?? 'KIN') : (f.act ?? 'idle');
    caption(final.note ?? (mode === 'analyze' ? `${card.name} is becoming…` : `“${f.thought ?? f.answer ?? ''}”`));
    // Shapes must be registered before create(), so the word gets its own field, assembling from blank.
    const shapeName = `spell:${word.toLowerCase().replace(/\W+/g, '-')}`;
    safe(() => {
      try {
        register(shapeName, fromText(word.toUpperCase().split(' ').slice(0, 3).join('\n'), { font: '700 160px "Geist Mono", ui-monospace, monospace', edges: 0.72, depth: 0, scale: 0.6 }));
      } catch {
        /* registered on an earlier call */
      }
    });
    makeField([shapeName], SPELL, 0);
    if (mode === 'analyze') {
      await Promise.race([wait(2200), skip]);
      if (!skipped) await readingCard($('[data-reading]'), card.name, final as unknown as Analysis & Meta, root);
    } else {
      await Promise.race([wait(2600), skip]);
    }
  }
  root.classList.remove('on');
  await wait(380);
  safe(() => field?.destroy());
  root.remove();
  return final;
}

/** The analysis ends on a card: becoming, the reading revealed line by line, favourites, motto. */
function readingCard(el: HTMLElement, name: string, a: Analysis & Meta, root: HTMLElement): Promise<void> {
  root.classList.add('reading');
  const sentences = a.reading.split(/(?<=[.!?])\s+/).filter(Boolean);
  el.innerHTML = `
    <p class="rd-kicker">${esc(name)} is becoming</p>
    <h2 class="rd-title">${esc(a.becoming)}</h2>
    <div class="rd-body">${sentences.map((s, i) => `<span style="--i:${i}">${esc(s)} </span>`).join('')}</div>
    ${a.favorites.length ? `<ul class="rd-favs" style="--i:${sentences.length}">${a.favorites.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <blockquote class="rd-motto" style="--i:${sentences.length + 1}">“${esc(a.motto)}”</blockquote>
    <p class="rd-src">${a.source === 'model' ? `Read by ${esc(nice(a.model ?? ''))}` : 'Read on this device'}</p>
    <button class="btn primary rd-done">Keep this</button>`;
  el.hidden = false;
  return new Promise((res) => {
    el.querySelector<HTMLButtonElement>('.rd-done')!.onclick = () => res();
    root.querySelector<HTMLElement>('[data-close]')!.onclick = () => res();
  });
}
