// Renders KIN's app icon / splash from the real procedural creature (no hand-drawn art to drift
// out of sync). ?seed=N&size=1024&mode=icon|splash. Used by scripts/make-icons.mjs.
import * as THREE from 'three';
import { makeGenome } from '../src/core/genome';
import { buildCreature } from '../src/render/creatureMesh';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 7);
const size = Number(q.get('size') ?? 1024);
const mode = q.get('mode') ?? 'icon';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(size, size);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
// Graphite with a periwinkle-to-mint glow behind the creature.
const c = document.createElement('canvas');
c.width = c.height = 512;
const g = c.getContext('2d')!;
const bg = g.createLinearGradient(0, 0, 0, 512);
bg.addColorStop(0, '#171B2E');
bg.addColorStop(1, '#0B0D12');
g.fillStyle = bg;
g.fillRect(0, 0, 512, 512);
const glow = g.createRadialGradient(256, 300, 10, 256, 300, 260);
glow.addColorStop(0, 'rgba(110,229,202,0.38)');
glow.addColorStop(0.5, 'rgba(158,168,255,0.14)');
glow.addColorStop(1, 'rgba(158,168,255,0)');
g.fillStyle = glow;
g.fillRect(0, 0, 512, 512);
const tex = new THREE.CanvasTexture(c);
tex.colorSpace = THREE.SRGBColorSpace;
scene.background = tex;

scene.add(new THREE.HemisphereLight('#E6ECFF', '#203030', 1.3));
const key = new THREE.DirectionalLight('#FFF3E2', 2.4);
key.position.set(-2, 4, 5);
const rim = new THREE.DirectionalLight('#6EE5CA', 2.2);
rim.position.set(3, 2, -4);
scene.add(key, rim);

const k = buildCreature(makeGenome(seed));
k.root.rotation.y = -0.25;
k.head.rotation.set(-0.12, 0.18, 0.06);
scene.add(k.root);

const cam = new THREE.PerspectiveCamera(mode === 'icon' ? 24 : 18, 1, 0.1, 50);
cam.position.set(0, 0.8, mode === 'icon' ? 2.85 : 6.5);
cam.lookAt(0, mode === 'icon' ? 0.66 : 0.5, 0);
renderer.render(scene, cam);
document.title = 'ready';
