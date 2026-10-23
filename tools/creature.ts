// Dev-only expression / turntable sheet: seeds (rows) × expressions (columns), each rendered as a
// close-up through a scissor viewport. ?seeds=1,7,12&exprs=neutral,happy,love&cell=260&dpr=2&yaw=0.35
import * as THREE from 'three';
import { makeGenome } from '../src/core/genome';
import { KinView, type Mood } from '../src/render/kinView';
import type { Stage } from '../src/render/stage';

const q = new URLSearchParams(location.search);
const seeds = (q.get('seeds') ?? '3,7,12,19,28,41,55,63').split(',').map(Number);
const exprs = (q.get('exprs') ?? 'neutral,happy,love,sleepy,surprised,sad,talk,petted').split(',');
const cell = Number(q.get('cell') ?? 220);
const dpr = Number(q.get('dpr') ?? 2);
const yaw0 = Number(q.get('yaw') ?? 0.3);
const tier = Number(q.get('fur') ?? 3);
const camZ = Number(q.get('dist') ?? 3.2);
const orbit = Number(q.get('orbit') ?? 0);

const W = cell * exprs.length;
const H = cell * seeds.length;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(dpr);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setScissorTest(true);
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#e2e9ff', '#6e8f7e', 1.25));
const sun = new THREE.DirectionalLight('#fff4e6', 2.2);
sun.position.set(-3, 6, 5);
const fill = new THREE.DirectionalLight('#dfe6ff', 0.6);
fill.position.set(0.5, 4, 10);
scene.add(sun, fill);
const world = new THREE.Group();
scene.add(world);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#9fd6b6', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
world.add(ground);

const cam = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
const sky = { tempC: 20, windKmh: 6, windDir: 200, precipMm: 0, snow: false, cloud: 0.3, sunElev: 30, sunAz: 180, lat: 0, lon: 0, place: '', code: 1, fetchedAt: 0, source: 'default' as const };
const stub = {
  world, sky, glow: 0.5, px: 120, w: 400, h: 800,
  anchors: { nest: new THREE.Vector3(), shelter: new THREE.Vector3(), plant: new THREE.Vector3(), sunny: new THREE.Vector3() },
  ballPosition: () => new THREE.Vector3(50, 0, 50),
  kickBall: () => {},
  toScreen: (v: THREE.Vector3) => {
    const p = v.clone().project(cam);
    return { x: (p.x + 1) * 0.5 * cell, y: (1 - p.y) * 0.5 * cell };
  },
  toWorld: () => new THREE.Vector3(),
  edgeX: () => 3,
} as unknown as Stage;

interface Cell {
  view: KinView;
  expr: string;
  r: number;
  c: number;
}
type Peek = { nextFlourish: number; blinkAt: number; mouthCurve: unknown };
const cells: Cell[] = [];
seeds.forEach((seed, r) =>
  exprs.forEach((expr, c) => {
    const v = new KinView(makeGenome(seed), stub);
    v.setFurTier(tier);
    // One row of well-separated cells, so no creature ever shows up behind another.
    const x = (r * exprs.length + c) * 9;
    v.placeAt(x, 0);
    v.yaw = yaw0;
    v.look = new THREE.Vector3(x + 0.4, 1.1, 5);
    cells.push({ view: v, expr, r, c });
  }),
);

let now = Date.now();
for (const cl of cells) {
  const v = cl.view;
  const p = v as unknown as Peek;
  p.nextFlourish = now + 1e9;
  p.blinkAt = now + 1e9;
  if (cl.expr === 'talk') {
    v.express('happy', 1e9);
    p.mouthCurve = { fn: () => 0.8, at: now + 1e9 };
  } else if (cl.expr === 'petted') {
    v.express('love', 1e9);
  } else v.express(cl.expr as Mood, 1e9);
}
// Settle: simulate 1.2 s of frames (the face eases toward each expression).
for (let i = 0; i < 72; i++) {
  now += 16.7;
  for (const cl of cells) {
    if (cl.expr === 'petted') cl.view.petting = 0.8;
    if (cl.expr === 'talk') (cl.view as unknown as Peek).mouthCurve = { fn: () => 0.8, at: now };
    cl.view.update(1 / 60, now, now / 1000);
  }
}
for (const cl of cells) {
  const x = cl.c * cell;
  const y = H - (cl.r + 1) * cell;
  renderer.setViewport(x, y, cell, cell);
  renderer.setScissor(x, y, cell, cell);
  renderer.setClearColor(new THREE.Color().setHSL(0.6, 0.35, 0.86 - ((cl.r + cl.c) % 2) * 0.02));
  const p = cl.view.pos;
  cam.position.set(p.x + 0.35 * Math.cos(orbit) + Math.sin(orbit) * camZ, 0.95, p.z + Math.cos(orbit) * camZ);
  cam.lookAt(p.x, 0.5, p.z);
  renderer.render(scene, cam);
}
(window as unknown as { __png: string }).__png = renderer.domElement.toDataURL('image/png');
document.title = 'ready';
