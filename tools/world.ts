// Dev harness for the world track: builds a Stage + KinView + attachWorld exactly as app.ts will,
// with a minimal brain loop, so physics, matter, actors and care can be seen and screenshotted
// without the app. URL: /kin/tools/world.html?seed=7&wx=rain&hour=14&surprise=bird&debug
// window.__kin exposes the world for scripted scenes (Playwright).
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/geist';
import '../src/ui/style.css';
import * as THREE from 'three';
import { decide, drift, type Action } from '../src/core/brain';
import { newKin, type KinRecord } from '../src/core/creature';
import { makeGenome } from '../src/core/genome';
import { applyWx, atHour, type Sky } from '../src/env/sky';
import type { KV } from '../src/persistence/store';
import { KinView } from '../src/render/kinView';
import { Stage } from '../src/render/stage';
import { attachWorld } from '../src/world/attach';
import type { SurpriseKind } from '../src/core/care';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 7);
const mem = new Map<string, string>();
const kv: KV = { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v), del: (k) => void mem.delete(k) };
if (q.has('care')) mem.set('kin:v1:h:care', q.get('care')!);

let kin: KinRecord = { ...newKin(Date.now(), seed), hatched: true, name: q.get('name') ?? 'Zuri' };
const stage = new Stage(document.getElementById('stage')!);
const view = new KinView(makeGenome(kin.seed), stage);
view.placeAt(0.2, 0.2);

let sky: Sky = {
  lat: 32.8, lon: -96.8, place: 'Dallas', tempC: 20, windKmh: 10, windDir: 270, precipMm: 0, snow: false, cloud: 0.2,
  sunElev: 30, sunAz: 180, code: 1, fetchedAt: 0, source: 'default',
};
let o = q.has('hour') ? atHour(sky, Number(q.get('hour'))) : sky;
if (q.get('wx')) o = applyWx(o, q.get('wx')!);
if (q.has('wind')) o = { ...o, windKmh: Number(q.get('wind')) };
sky = o;
stage.setSky(sky);

const sounds = new Proxy({}, { get: () => () => {} });
const w = attachWorld({ stage, view, kv, slot: 'h', kin: () => kin, setKin: (k) => (kin = k), sfx: sounds, reducedMotion: () => false });

// Minimal brain loop (same shape as app.ts).
let current: { action: Action; until: number } = { action: 'idle', until: 0 };
const recent: Action[] = [];
let tick = 0;
setInterval(() => {
  tick++;
  const ctx = { now: Date.now(), weather: sky, petting: view.petting > 0.2, peerEdge: null, guest: null };
  kin = { ...kin, drives: drift(kin.drives, current.action, 0.25, ctx) };
  if (q.has('still') || view.busy || Date.now() < current.until) return;
  const d = decide(kin, ctx, recent, tick);
  recent.push(d.action);
  if (recent.length > 8) recent.shift();
  current = { action: d.action, until: Date.now() + d.durationMs };
  view.look = null;
  view.applyAction(d.action);
}, 250);

const dbg = document.getElementById('debug')!;
dbg.hidden = !q.has('debug');
let last = performance.now();
let fps = 60;
const stats = { worldMs: 0 };
const frame = (tNow: number) => {
  const dt = Math.min(0.05, (tNow - last) / 1000);
  last = tNow;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  stage.update(dt, tNow / 1000);
  view.update(dt, Date.now(), tNow / 1000);
  const t0 = performance.now();
  w.update(dt, Date.now(), tNow / 1000);
  stats.worldMs += (performance.now() - t0 - stats.worldMs) * 0.05;
  stage.render();
  if (q.has('debug')) {
    const p = w.world.physics;
    dbg.textContent =
      `fps ${fps.toFixed(0)} · world ${stats.worldMs.toFixed(2)} ms/frame · physics step ${p ? p.stepMs.toFixed(3) : '-'} ms (${p?.awakeCount() ?? 0} awake) · actor ticks ${w.world.sched.ticks}\n` +
      `needs ${Object.entries(w.world.care.needs).map(([k, v]) => k + ' ' + v.toFixed(2)).join(' · ')}\nsnow ${w.world.snowDepth.toFixed(2)} · ${view.action}`;
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
addEventListener('resize', () => stage.resize());

(window as unknown as { __kin: unknown }).__kin = {
  world: w.world,
  ui: w.ui,
  view,
  stage,
  stats,
  THREE,
  surprise: (k: SurpriseKind) => w.world.surprise(k),
  setSky: (patch: Partial<Sky>) => {
    sky = { ...sky, ...patch };
    stage.setSky(sky);
  },
};
void w.ready.then(() => {
  const s = q.get('surprise') as SurpriseKind | null;
  if (s) w.world.surprise(s);
  document.title = 'ready';
});
