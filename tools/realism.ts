// Realism harness (docs/REALISM.md). Builds Stage + KinView + attachWorld like app.ts, but steps
// the simulation on its OWN clock (fixed 1/60 s ticks), so frame sequences are exact even under
// software GL. Debug overlay: planted feet (mint), swinging feet (amber), a footprint trail that
// proves planted feet never slide, and the body's collision ring.
//
// /kin/tools/realism.html?scene=walk|step|mushroom|ball|berry|nest&seed=28&overlay=1
// Playwright drives window.__realism: await start(); await advance(ms); (screenshot); …
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/geist';
import '../src/ui/style.css';
import * as THREE from 'three';
import { newKin, type KinRecord } from '../src/core/creature';
import { makeGenome } from '../src/core/genome';
import type { Sky } from '../src/env/sky';
import type { KV } from '../src/persistence/store';
import { KinView } from '../src/render/kinView';
import { Stage } from '../src/render/stage';
import { attachWorld } from '../src/world/attach';
import { KIN_CAPSULE } from '../src/world/physics';

const q = new URLSearchParams(location.search);
const scene = q.get('scene') ?? 'walk';
const seed = Number(q.get('seed') ?? 28);
const overlay = q.get('overlay') !== '0';
const mem = new Map<string, string>();
const kv: KV = { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v), del: (k) => void mem.delete(k) };

let kin: KinRecord = { ...newKin(0, seed), hatched: true, name: 'Zuri' };
const stage = new Stage(document.getElementById('stage')!);
const view = new KinView(makeGenome(kin.seed), stage);
const sky: Sky = {
  lat: 32.8, lon: -96.8, place: 'Dallas', tempC: 20, windKmh: 4, windDir: 270, precipMm: 0, snow: false, cloud: 0.15,
  sunElev: 38, sunAz: 200, code: 1, fetchedAt: 0, source: 'default',
};
stage.setSky(sky);
const sounds = new Proxy({}, { get: () => () => {} });
const w = attachWorld({ stage, view, kv, slot: 'h', kin: () => kin, setKin: (k) => (kin = k), sfx: sounds, reducedMotion: () => true });

// ── Overlay
const ov = new THREE.Group();
stage.world.add(ov);
const footMat = [new THREE.MeshBasicMaterial({ color: '#6EE5CA', depthTest: false }), new THREE.MeshBasicMaterial({ color: '#E9AF6B', depthTest: false })];
const footDots = [0, 1].map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), footMat[0]);
  m.renderOrder = 10;
  ov.add(m);
  return m;
});
const ring = new THREE.Mesh(new THREE.RingGeometry(KIN_CAPSULE.radius - 0.006, KIN_CAPSULE.radius, 64), new THREE.MeshBasicMaterial({ color: '#9EA8FF', transparent: true, opacity: 0.8, depthTest: false }));
ring.rotation.x = -Math.PI / 2;
ring.renderOrder = 10;
ov.add(ring);
const printGeo = new THREE.CircleGeometry(0.018, 12);
const printMat = new THREE.MeshBasicMaterial({ color: '#2e5d55', transparent: true, opacity: 0.85, depthTest: false });
const prints: THREE.Mesh[] = [];
ov.visible = overlay;

// ── Simulated clock
let now = 1_000_000;
let simT = 0;
const DT = 1 / 60;
let driver: ((dt: number) => void) | null = null;

function tick() {
  driver?.(DT);
  now += DT * 1000;
  simT += DT;
  stage.update(DT, simT);
  view.update(DT, now, simT);
  w.update(DT, now, simT);
  // overlay
  const gf = view.gaitFrame;
  if (gf) {
    gf.feet.forEach((f, i) => {
      footDots[i]!.position.set(f.pos.x, f.pos.y + 0.01, f.pos.z);
      footDots[i]!.material = footMat[f.planted ? 0 : 1]!;
    });
    for (const i of gf.touchdowns) {
      const f = gf.feet[i]!;
      const pm = new THREE.Mesh(printGeo, printMat);
      pm.rotation.x = -Math.PI / 2;
      pm.position.set(f.pos.x, f.pos.y + 0.003, f.pos.z);
      pm.renderOrder = 9;
      ov.add(pm);
      prints.push(pm);
    }
  }
  ring.position.set(view.pos.x, view.groundY + 0.008, view.pos.z);
  // Close-up follow (render only: physics and the creature keep their real coordinates).
  if (zoom) stage.world.position.set(-view.pos.x, Number(q.get('lift') ?? 0.35), -view.pos.z + 0.3);
}

// ?zoom=320: a close-up at 320 px per unit that follows the KIN, to judge feet and contact.
const zoom = Number(q.get('zoom') ?? 0);
if (zoom) {
  (stage as unknown as { soloPx: () => number }).soloPx = () => zoom;
  (stage as unknown as { px: number }).px = 0;
  stage.resize();
}

// ── Scenes
const target = new THREE.Vector3();
function walkTo(x: number, z: number, speed = 0.8, then?: () => void) {
  target.set(x, 0, z);
  driver = (dt) => {
    if (view.walkToward(target, speed, dt)) {
      driver = null;
      then?.();
    }
  };
}

async function setup() {
  await w.ready;
  for (let i = 0; i < 30; i++) tick(); // let toys settle
  const P = w.world.physics!;
  switch (scene) {
    case 'walk':
      view.yaw = Math.PI / 2;
      view.placeAt(-1.6, 0.45);
      walkTo(1.6, 0.45, 0.8);
      break;
    case 'step': {
      // A low stepping stone (a rug, a door sill, a book in AR): the body steps up, feet plant on top.
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.9), new THREE.MeshStandardMaterial({ color: '#cfc8bd', roughness: 0.85 }));
      stone.position.set(0.1, 0.03, 0.45);
      stage.world.add(stone);
      P.addStatic({ box: [0.35, 0.03, 0.45] }, { x: 0.1, y: 0.03, z: 0.45 });
      view.yaw = Math.PI / 2;
      view.placeAt(-1.3, 0.45);
      walkTo(1.4, 0.45, 0.6);
      break;
    }
    case 'mushroom':
      // Straight at the stalk: it must stop at the cap's edge or slide around, never pass through.
      view.yaw = -Math.PI / 2;
      view.placeAt(-0.2, -0.75);
      walkTo(-2.6, -0.9, 0.8);
      break;
    case 'ball': {
      const ball = w.world.entities.get('ball')!.body!;
      ball.moveTo({ x: 0.3, y: 0.11, z: 0.5 });
      ball.setVel({ x: 0, y: 0, z: 0 });
      view.yaw = Math.PI / 2;
      view.placeAt(-1.2, 0.5);
      walkTo(1.6, 0.5, 0.9);
      break;
    }
    case 'berry':
      view.yaw = Math.PI / 2;
      view.placeAt(-1.0, 0.5);
      w.world.eat(1, new THREE.Vector3(0.35, 0, 0.55));
      break;
    case 'nest':
      // Into bed: it climbs over the woven rim (feet stand on it) and settles.
      view.yaw = 0;
      view.placeAt(1.55, 0.35);
      walkTo(1.55, -0.75, 0.6);
      break;
    case 'turn':
      view.yaw = 0;
      view.placeAt(0, 0.4);
      driver = () => (view.yaw += 0.035);
      break;
  }
}

const dbg = document.getElementById('debug')!;
dbg.hidden = !q.has('debug');
(window as unknown as { __realism: unknown }).__realism = {
  start: setup,
  /** Advance the simulation by `ms` of sim time, then render once. */
  advance(ms: number) {
    const n = Math.max(1, Math.round(ms / (DT * 1000)));
    for (let i = 0; i < n; i++) tick();
    stage.render();
    const gf = view.gaitFrame;
    return {
      x: view.pos.x, z: view.pos.z, groundY: view.groundY, prints: prints.length,
      feet: gf?.feet.map((f) => ({ ...f.pos, planted: f.planted })),
      ball: w.world.entities.get('ball')?.body?.pos(),
    };
  },
};
stage.render();
