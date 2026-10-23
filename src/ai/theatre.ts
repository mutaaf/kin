// The thought theatre: every AI call made visible (the COLD GAS judges' theatre, made for KIN).
// An aurora-field particle field (lazy chunk) morphs with the real call as it happens:
//
//   READ    your KIN, made of light (points sampled from its actual mesh) while the card is read
//   THINK   the mind: one signal per streamed token
//   SPEAK   the choice, spelled in light; then the thought lands as a bubble over the creature
//
// Around it: who answered (model, provider, where, who pays), live counters (tokens in/out,
// time to first token, tokens/s, cost or neurons), the raw stream, and "Inspect the call".
import { create, fromPoints, fromText, register } from 'aurora-field';
import '@fontsource/geist-mono/700.css';
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { makeGenome } from '../core/genome';
import { rng } from '../core/rng';
import { buildCreature } from '../render/creatureMesh';
import { think } from './client';
import { nice, PROVIDER_INFO, type AIChoice } from './config';
import { localThought, type Card, type Thought } from './schema';
import './ai.css';

export interface TheatreResult extends Thought {
  source: 'model' | 'local';
  model?: string;
  note?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MIN_MS = { read: 2600, think: 1600 };
const SPELL = { preset: 'aurora', point: [176, 255, 228], accent: [176, 255, 228], glow: [150, 245, 210], fog: [120, 180, 170] };
// The light-KIN: porcelain points with a mint glow, so the creature reads as a bright figure.
const BODY = { preset: 'aurora', point: [236, 246, 242], accent: [110, 229, 202], glow: [110, 229, 202], fog: [60, 90, 100] };

/** Points sampled from the creature's real surface, centred and scaled to the unit sphere. */
export function kinPoints(seed: number, n = 2400): number[][] {
  const parts = buildCreature(makeGenome(seed));
  parts.root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  parts.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible && m.geometry) meshes.push(m);
  });
  // Allocate samples by approximate surface area (bounding-sphere radius², scaled).
  const weights = meshes.map((m) => {
    m.geometry.computeBoundingSphere();
    const s = new THREE.Vector3();
    m.getWorldScale(s);
    return (m.geometry.boundingSphere!.radius * Math.max(s.x, s.y, s.z)) ** 2;
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const r = rng(seed);
  const pts: number[][] = [];
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
  const max = Math.max(...pts.map(([x, y, z]) => Math.hypot(x!, y!, z!))) || 1;
  return pts.map(([x, y, z]) => [x! / max, y! / max, z! / max]);
}

export async function runTheatre(opts: { card: Card; seed: number; ai: AIChoice; reduced: boolean; onSettings: () => void }): Promise<TheatreResult> {
  const { card, seed, ai, reduced } = opts;
  const self = `kin:self:${seed}`;
  try {
    register(self, fromPoints(kinPoints(seed)));
  } catch {
    /* already registered */
  }
  const root = document.createElement('div');
  root.className = 'th';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `What ${card.name} is thinking`);
  const who = ai.provider === 'edge' ? 'Free · runs on Cloudflare’s edge' : `${PROVIDER_INFO[ai.provider].label} · billed to your key`;
  root.innerHTML = `
    <div class="th-stage"><canvas class="th-canvas"></canvas></div>
    <div class="th-ui">
      <header class="th-head">
        <ol class="th-rail"><li data-s="read">Read</li><li data-s="think">Think</li><li data-s="speak">Speak</li></ol>
        <button class="btn th-close" data-close>Skip</button>
      </header>
      <p class="th-caption" data-caption></p>
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
    </div>`;
  document.getElementById('hud')!.append(root);
  requestAnimationFrame(() => root.classList.add('on'));
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const stat = (k: string, v: string) => ($(`[data-stat="${k}"]`).textContent = v);
  const caption = (t: string) => ($('[data-caption]').textContent = t);

  let field: ReturnType<typeof create> | null = null;
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      // The show must never break the call, but say why it didn't play.
      console.warn('[kin theatre]', err);
    }
  };
  if (!reduced) {
    safe(() => {
      field = create($('.th-canvas') as HTMLCanvasElement, {
        container: $('.th-stage'), shapes: [self, 'mind'], initial: self, cycle: 0, palette: BODY, blank: true,
        interactive: false, stars: 70, autonomy: 0.2, depth: 3.0, intro: 0,
        count: (w: number) => (w < 700 ? 3000 : 4200), radius: (w: number, h: number) => Math.min(w * 0.42, h * 0.32),
      });
    });
  }
  const setStage = (s: 'read' | 'think' | 'speak') => {
    root.dataset.stage = s;
    root.querySelectorAll<HTMLElement>('.th-rail li').forEach((li) => {
      const order = ['read', 'think', 'speak'];
      li.className = li.dataset.s === s ? 'on' : order.indexOf(li.dataset.s!) < order.indexOf(s) ? 'done' : '';
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
  $('[data-byok]').onclick = () => opts.onSettings();

  // READ
  setStage('read');
  const t0 = performance.now();
  caption(`Reading ${card.name}: ${card.weather.word}, ${Math.round(card.weather.tempC)}°, ${card.timeOfDay}. Energy ${Math.round(card.drives.energy * 100)}, wants company ${Math.round(card.drives.social * 100)}.`);
  const pulse = setInterval(() => safe(() => (field as unknown as { signal?: (a?: unknown, b?: number, c?: number) => void })?.signal?.(undefined, 26, 3)), 200);

  let result: TheatreResult | null = null;
  let out = '';
  let tokens = 0;
  let firstAt = 0;
  let lastSignal = 0;
  const call = think(card, ai, {
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
        safe(() => (field as unknown as { signal?: (a?: unknown, b?: number, c?: number) => void })?.signal?.(undefined, 14, 2));
        lastSignal = now;
      }
    },
    done: (e) => {
      stat('in', String(e.usage.inTokens || '–'));
      if (e.usage.outTokens) stat('out', String(e.usage.outTokens));
      const secs = firstAt ? (performance.now() - firstAt) / 1000 : 0;
      if (secs > 0.05) stat('tps', String(Math.round((e.usage.outTokens || tokens) / secs)));
      stat('cost', ai.provider === 'edge' ? (e.usage.neurons ? e.usage.neurons.toFixed(1) : 'free') : e.cost !== null ? `$${e.cost.toFixed(5)}` : 'your rate');
      const resp = root.querySelector('[data-resp]');
      if (resp) resp.textContent = out;
      result = e.thought
        ? { ...e.thought, source: 'model', model: ai.model }
        : { ...localThought(card, rng(Date.now())), source: 'local', note: `The answer didn't fit the rules (${e.errors.join('; ')}), so ${card.name} thought for itself.` };
    },
    error: (e) => {
      result = { ...localThought(card, rng(Date.now())), source: 'local', note: `${e.message} ${card.name} thought for itself.` };
    },
  }, abort.signal).catch(() => {
    result ??= { ...localThought(card, rng(Date.now())), source: 'local', note: 'Offline: a thought from the device.' };
  });

  await Promise.race([wait(MIN_MS.read), skip]);
  // THINK
  if (!skipped) {
    setStage('think');
    caption('Thinking…');
    safe(() => {
      field?.set({ palette: 'aurora', autonomy: 0.35 });
      field?.setShape('mind', { pin: 1e9 });
    });
    await Promise.race([Promise.all([call, wait(MIN_MS.think)]), skip, wait(30_000)]);
  }
  clearInterval(pulse);
  const final: TheatreResult = result ?? { ...localThought(card, rng(Date.now())), source: 'local', note: 'That took too long, so a thought from the device.' };
  // SPEAK
  if (!skipped) {
    setStage('speak');
    caption(final.note ?? `“${final.thought}”`);
    const word = `spell:${final.act}`;
    // Shapes must be registered before create(), so the word gets its own field, assembling from blank.
    if (field) {
      safe(() => {
        try {
          register(word, fromText(final.act.toUpperCase(), { font: '700 160px "Geist Mono", ui-monospace, monospace', edges: 0.72, depth: 0, scale: 0.6 }));
        } catch {
          /* registered on an earlier thought */
        }
        field?.destroy();
        field = create($('.th-canvas') as HTMLCanvasElement, {
          container: $('.th-stage'), shapes: [word], initial: word, cycle: 0, palette: SPELL, blank: true,
          interactive: false, stars: 70, autonomy: 0, depth: 3.0, intro: 0,
          count: (w: number) => (w < 700 ? 2400 : 3600), radius: (w: number, h: number) => Math.min(w * 0.36, h * 0.3),
        });
      });
    }
    await Promise.race([wait(2600), skip]);
  }
  root.classList.remove('on');
  await wait(380);
  safe(() => field?.destroy());
  root.remove();
  return final;
}
