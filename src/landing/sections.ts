// Small live proofs for the "what's new" sections. Each one uses the real modules the app runs.

import * as THREE from 'three';
import { decide, type Action } from '../core/brain';
import { newKin } from '../core/creature';
import { makeGenome, suggestName, temperament } from '../core/genome';
import { describe as describeSky, readSky, type Sky } from '../env/sky';
import { sunPosition } from '../env/sun';
import { browserKV } from '../persistence/store';
import type { ScreenRect } from '../protocol/messages';
import { crossingHop, hopAt, layout } from '../render/choreo';
import { buildCreature } from '../render/creatureMesh';
import { palette } from '../render/stage';

const SVGNS = 'http://www.w3.org/2000/svg';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.append(el);
  return el;
};

/** Runs `frame` only while `el` is on screen. */
export function whileVisible(el: Element, frame: (t: number) => void) {
  let on = false;
  let raf = 0;
  const loop = (t: number) => {
    frame(t);
    if (on) raf = requestAnimationFrame(loop);
  };
  new IntersectionObserver(([e]) => {
    const was = on;
    on = !!e?.isIntersecting;
    if (on && !was) raf = requestAnimationFrame(loop);
    if (!on) cancelAnimationFrame(raf);
  }).observe(el);
}

// ───────────── 01 · The stitch: a finger slides off one phone and onto the next.

export function stitchDemo(host: HTMLElement) {
  const W = 520;
  const H = 300;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'diagram', role: 'img', 'aria-label': 'A finger slides from the left phone across the gap onto the right phone; both edges light up and the phones are linked.' }, host);
  const phone = (x: number) => {
    svg('rect', { x, y: 30, width: 180, height: 240, rx: 26, class: 'd-phone' }, root);
    svg('rect', { x: x + 8, y: 38, width: 164, height: 224, rx: 19, class: 'd-screen' }, root);
  };
  phone(70);
  phone(270);
  const glowL = svg('rect', { x: 236, y: 38, width: 6, height: 224, rx: 3, class: 'd-glow' }, root);
  const glowR = svg('rect', { x: 278, y: 38, width: 6, height: 224, rx: 3, class: 'd-glow' }, root);
  const trail = svg('path', { d: '', class: 'd-trail' }, root);
  const finger = svg('circle', { r: 15, class: 'd-finger' }, root);
  const ring = svg('circle', { r: 15, class: 'd-ring' }, root);
  const tOut = svg('text', { x: 155, y: 292, class: 'd-label', 'text-anchor': 'middle' }, root);
  const tIn = svg('text', { x: 360, y: 292, class: 'd-label', 'text-anchor': 'middle' }, root);
  const tOk = svg('text', { x: 260, y: 20, class: 'd-label d-ok', 'text-anchor': 'middle' }, root);
  const period = 4200;
  whileVisible(root, (now) => {
    const u = reduced() ? 0.62 : (now % period) / period;
    const k = Math.min(1, Math.max(0, (u - 0.08) / 0.5));
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const x = 130 + e * 250;
    const y = 190 - Math.sin(e * Math.PI) * 26;
    finger.setAttribute('cx', String(x));
    finger.setAttribute('cy', String(y));
    const onGlass = x < 242 || x > 278;
    finger.setAttribute('opacity', u < 0.06 || u > 0.72 ? '0' : onGlass ? '1' : '0.35');
    trail.setAttribute('d', `M130 190 Q${(130 + x) / 2} ${190 - Math.sin(e * Math.PI * 0.5) * 30} ${x} ${y}`);
    trail.setAttribute('opacity', u > 0.72 ? String(Math.max(0, 1 - (u - 0.72) * 6)) : '1');
    const outLit = x >= 236;
    const inLit = x >= 278;
    glowL.setAttribute('opacity', outLit ? '1' : '0.12');
    glowR.setAttribute('opacity', inLit ? '1' : '0.12');
    tOut.textContent = outLit ? 'out · right edge · t = 0 ms' : '';
    tIn.textContent = inLit ? 'in · left edge · t′ = 84 ms' : '';
    tOk.textContent = u > 0.6 && u < 0.95 ? 'matched · linked · seam offset +12 px' : '';
    const pulse = u > 0.58 && u < 0.8 ? (u - 0.58) / 0.22 : 0;
    ring.setAttribute('cx', '260');
    ring.setAttribute('cy', '150');
    ring.setAttribute('r', String(20 + pulse * 120));
    ring.setAttribute('opacity', pulse ? String(0.6 * (1 - pulse)) : '0');
  });
}

// ───────────── 02 · Two renders, one illusion: the real hop arc in a shared pixel space.

export function arcDemo(host: HTMLElement) {
  const phoneRect = (x: number): ScreenRect => ({ x, y: 0, w: 390, h: 844, sw: 390, sh: 844, fine: false });
  const a = phoneRect(0);
  const b = phoneRect(0);
  const from = { x: 330, y: 560 };
  const hop = crossingHop(a, b, 'right', from);
  const L = layout(a, b, 'right');
  const PX = 118; // world units → CSS px on a phone (render/stage.ts)
  // A close-up of the seam: the real curve, cropped to where the action is.
  const top = from.y - 250;
  const minX = L.src.x + 130;
  const maxX = L.dst.x + L.dst.w - 130;
  const vb = `${minX} ${top} ${maxX - minX} 360`;
  const root = svg('svg', { viewBox: vb, class: 'diagram tall', role: 'img', 'aria-label': 'The hop arc computed by the app: it crosses the gap between the two screens at the top of its jump.' }, host);
  for (const r of [L.src, L.dst]) {
    svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 54, class: 'd-phone' }, root);
    svg('line', { x1: r.x, y1: from.y + 20, x2: r.x + r.w, y2: from.y + 20, class: 'd-ground' }, root);
  }
  svg('rect', { x: L.src.x + L.src.w, y: -20, width: L.dst.x - (L.src.x + L.src.w), height: L.src.h + 40, class: 'd-gap' }, root);
  const pts: string[] = [];
  let seamU = 0;
  for (let i = 0; i <= 120; i++) {
    const u = i / 120;
    const { p, height } = hopAt(hop, u);
    pts.push(`${p.x.toFixed(1)},${(p.y - height * PX * 0.86).toFixed(1)}`);
    if (!seamU && p.x >= L.src.x + L.src.w) seamU = u;
  }
  svg('polyline', { points: pts.join(' '), class: 'd-arc' }, root);
  const shadowPts = Array.from({ length: 61 }, (_, i) => {
    const { p } = hopAt(hop, i / 60);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  });
  svg('polyline', { points: shadowPts.join(' '), class: 'd-shadow' }, root);
  const seam = hopAt(hop, seamU);
  const seamY = seam.p.y - seam.height * PX * 0.86;
  svg('circle', { cx: seam.p.x, cy: seamY, r: 9, class: 'd-seam' }, root);
  svg('line', { x1: seam.p.x, y1: seamY - 14, x2: seam.p.x, y2: top + 46, class: 'd-lead' }, root);
  const label = svg('text', { x: seam.p.x, y: top + 34, 'text-anchor': 'middle', class: 'd-label big' }, root);
  label.textContent = `seam crossed at ${Math.round((seam.height / hop.peak) * 100)}% of peak height`;
  const sa = svg('text', { x: L.src.x + L.src.w - 16, y: from.y + 50, 'text-anchor': 'end', class: 'd-label' }, root);
  sa.textContent = 'screen A draws this half';
  const sb = svg('text', { x: L.dst.x + 16, y: from.y + 50, class: 'd-label' }, root);
  sb.textContent = 'screen B draws this half';
  const dot = svg('circle', { r: 16, class: 'd-kin' }, root);
  const T = 1050;
  whileVisible(root, (now) => {
    const u = reduced() ? seamU : Math.min(1, ((now % (T + 1400)) / T));
    const { p, height } = hopAt(hop, u);
    dot.setAttribute('cx', String(p.x));
    dot.setAttribute('cy', String(p.y - height * PX * 0.86 - 14));
    dot.setAttribute('class', p.x < L.src.x + L.src.w ? 'd-kin' : 'd-kin b');
  });
  return { seamPct: Math.round((seam.height / hop.peak) * 100) };
}

// ───────────── 04 · The real sky, read the way the app reads it (coarse, no prompt).

export async function skyDemo(line: HTMLElement, strip: HTMLCanvasElement) {
  let s: Sky;
  try {
    s = await readSky(browserKV(), { precise: false, search: '' });
  } catch {
    return;
  }
  line.textContent = `${s.place} · ${describeSky(s)}${s.source === 'live' || s.source === 'cached' ? '' : ' (offline default)'}`;
  const p = palette(s);
  const ctx = strip.getContext('2d')!;
  const dpr = Math.min(3, devicePixelRatio || 1);
  const w = strip.clientWidth;
  const h = strip.clientHeight;
  strip.width = w * dpr;
  strip.height = h * dpr;
  ctx.scale(dpr, dpr);
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  g.addColorStop(0, p.top);
  g.addColorStop(0.62, p.mid);
  g.addColorStop(1, p.horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#' + p.ground.getHexString();
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  const night = s.sunElev < -4;
  const sx = w * (0.5 + Math.max(-0.42, Math.min(0.42, (((night ? 200 : s.sunAz) - 180) / 120) * 0.45)));
  const sy = h * 0.62 - (Math.max(-4, night ? 35 : s.sunElev) / 70) * h * 0.55;
  const sun = ctx.createRadialGradient(sx, sy, 2, sx, sy, 26);
  sun.addColorStop(0, night ? 'rgba(240,244,255,0.95)' : 'rgba(255,250,240,1)');
  sun.addColorStop(0.35, night ? 'rgba(200,210,255,0.3)' : 'rgba(255,236,200,0.55)');
  sun.addColorStop(1, 'rgba(255,220,170,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  if (night && s.cloud < 0.8) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 46; i++) ctx.fillRect((i * 97.3) % w, (i * 41.9) % (h * 0.5), i % 5 ? 1 : 1.6, i % 5 ? 1 : 1.6);
  }
  if (s.precipMm > 0.1) {
    ctx.strokeStyle = s.snow ? 'rgba(255,255,255,0.8)' : 'rgba(207,224,255,0.5)';
    for (let i = 0; i < 70; i++) {
      const x = (i * 37.3) % w;
      const y = (i * 53.7) % (h * 0.9);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + (s.snow ? 1.5 : 9));
      ctx.stroke();
    }
  }
}

// ───────────── 05 · The brain, explained: live utility scores with their reasons.

export function brainDemo(host: HTMLElement) {
  const kin = newKin(0, 21);
  kin.name = suggestName(21);
  kin.hatched = true;
  const controls = host.querySelector<HTMLElement>('.brain-controls')!;
  const list = host.querySelector<HTMLElement>('.brain-list')!;
  const verdict = host.querySelector<HTMLElement>('.brain-verdict')!;
  const state = { temp: 22, rain: 0, hour: 14, energy: 0.7, friend: false };
  const slider = (key: 'temp' | 'rain' | 'hour' | 'energy', label: string, min: number, max: number, step: number, fmt: (v: number) => string) => {
    const wrap = document.createElement('label');
    wrap.className = 'ctl';
    wrap.innerHTML = `<span>${label}</span><output></output><input type="range" min="${min}" max="${max}" step="${step}" value="${state[key]}" aria-label="${label}">`;
    const input = wrap.querySelector('input')!;
    const out = wrap.querySelector('output')!;
    const sync = () => {
      state[key] = Number(input.value);
      out.textContent = fmt(state[key]);
      render();
    };
    input.addEventListener('input', sync);
    controls.append(wrap);
    out.textContent = fmt(state[key]);
  };
  const friendBtn = document.createElement('button');
  friendBtn.className = 'chip';
  friendBtn.type = 'button';
  friendBtn.setAttribute('aria-pressed', 'false');
  friendBtn.textContent = 'A friend waits at the edge';
  friendBtn.addEventListener('click', () => {
    state.friend = !state.friend;
    friendBtn.setAttribute('aria-pressed', String(state.friend));
    render();
  });
  const LABEL: Record<Action, string> = {
    idle: 'idle', wander: 'wander', sit: 'sit', groom: 'groom', sleep: 'sleep', play: 'play with the ball',
    look_edge: 'look toward the edge', shiver: 'shiver', shelter: 'shelter under the mushroom', bask: 'bask in the sun', greet_guest: 'greet the guest',
  };
  function render() {
    kin.drives = { ...kin.drives, energy: state.energy };
    const d = new Date();
    d.setHours(Math.floor(state.hour), (state.hour % 1) * 60);
    const sun = sunPosition(d, 32.78, -96.8);
    const res = decide(
      kin,
      {
        now: 0,
        weather: { tempC: state.temp, windKmh: state.rain > 3 ? 30 : 8, precipMm: state.rain, snow: state.temp < 1 && state.rain > 0, cloud: state.rain > 0 ? 0.9 : 0.2, sunElev: sun.elevation },
        petting: false,
        peerEdge: state.friend ? 'right' : null,
        guest: null,
      },
      [],
      7,
    );
    const top = res.scores.slice(0, 6);
    const max = Math.max(...top.map(([, v]) => v), 0.01);
    list.innerHTML = top
      .map(([a, v], i) => `<li class="${i === 0 ? 'win' : ''}"><span class="a">${LABEL[a]}</span><span class="bar"><i style="width:${Math.max(4, (v / max) * 100).toFixed(1)}%"></i></span><span class="v">${v.toFixed(2)}</span></li>`)
      .join('');
    verdict.innerHTML = `<b>${kin.name}</b> (${temperament(kin.traits)}) chooses to <b>${LABEL[res.action]}</b><span>because ${res.why.join('; ')}</span>`;
  }
  slider('temp', 'Temperature', -10, 40, 1, (v) => `${v}°C`);
  slider('rain', 'Rain', 0, 8, 0.5, (v) => (v ? `${v} mm/h` : 'dry'));
  slider('hour', 'Time', 0, 23.5, 0.5, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${v % 1 ? '30' : '00'}`);
  slider('energy', 'Energy', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
  controls.append(friendBtn);
  render();
}

// ───────────── 06 · Same seed, same creature, on every device.

export function seedDemo(canvas: HTMLCanvasElement, label: HTMLElement, button: HTMLButtonElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(3, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#E6ECFF', '#203030', 1.4));
  const key = new THREE.DirectionalLight('#FFF3E2', 2.2);
  key.position.set(-2, 4, 5);
  const rim = new THREE.DirectionalLight('#6EE5CA', 1.8);
  rim.position.set(3, 2, -4);
  scene.add(key, rim);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  cam.position.set(0, 0.7, 3.4);
  cam.lookAt(0, 0.52, 0);
  let current: ReturnType<typeof buildCreature> | null = null;
  const seeds = [28, 12, 3, 41, 19, 55, 7, 63];
  let i = 0;
  const show = (seed: number) => {
    if (current) {
      scene.remove(current.root);
      current.dispose();
    }
    current = buildCreature(makeGenome(seed));
    for (const l of current.lids) l.visible = false;
    scene.add(current.root);
    const g = makeGenome(seed);
    label.innerHTML = `<b>seed ${seed}</b> · ${suggestName(seed)} · ${g.ears} ears · ${g.tail} tail · ${g.accent === 'none' ? 'no accent' : g.accent}`;
  };
  const size = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  size();
  addEventListener('resize', size);
  show(seeds[0]!);
  button.addEventListener('click', () => show(seeds[(i = (i + 1) % seeds.length)]!));
  whileVisible(canvas, (t) => {
    if (current) {
      current.root.rotation.y = reduced() ? -0.3 : Math.sin(t / 1600) * 0.5;
      current.head.rotation.z = Math.sin(t / 900) * 0.05;
    }
    renderer.render(scene, cam);
  });
}
