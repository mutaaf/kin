// The KIN's sculpted body: one continuous, soft form (head, cheeks, forehead, torso, tummy, back
// feet) defined as a signed-distance field with smooth unions, then shrink-wrapped onto a sphere
// mesh. No seams, no stacked balls: a single silhouette with baby proportions (head ≈ 55% of the
// height, big forehead, small chin, chubby cheeks, round tummy, stubby feet).
//
// Deterministic: the form is a pure function of the seed (makeGenome's fields plus extra form
// parameters drawn from rng(hash('form:' + seed))), so every device builds the same creature.
// Built once per seed and cached.

import * as THREE from 'three';
import type { Genome } from '../../core/genome';
import { hash, range, rng } from '../../core/rng';

export type Pattern = 'plain' | 'mask' | 'socks' | 'spots' | 'saddle';

export interface Form {
  /** Head ellipsoid radii and centre height. */
  head: { rx: number; ry: number; rz: number; y: number };
  forehead: number;
  cheek: number; // cheek fluff radius
  torso: { rx: number; ry: number; rz: number; y: number };
  tummy: number;
  foot: number;
  neckY: number;
  /** Eye placement: horizontal spread (rad), height on the face, size. */
  eye: { spread: number; y: number; r: number };
  irisHue: number;
  pattern: Pattern;
  patternHue: number;
  fluff: number; // fur length multiplier 0.7–1.4
  earLen: number;
  earWidth: number;
  tailLen: number;
  mouth: 'smile' | 'cat';
  brow: number; // brow tuft size, 0 = none
}

export function deriveForm(g: Genome): Form {
  const r = rng(hash('form:' + g.seed));
  const round = g.round; // 0 bean … 1 ball
  const headR = 0.37 + range(r, -0.015, 0.025);
  return {
    head: { rx: headR * (1.04 + round * 0.06), ry: headR * range(r, 0.9, 0.97), rz: headR * 0.93, y: 0.585 },
    forehead: headR * range(r, 0.86, 0.94),
    cheek: range(r, 0.085, 0.115),
    torso: { rx: 0.25 + round * 0.04, ry: 0.185 + (1 - round) * 0.015, rz: 0.225, y: 0.205 },
    tummy: range(r, 0.165, 0.19),
    foot: range(r, 0.072, 0.09),
    neckY: 0.37,
    eye: { spread: range(r, 0.36, 0.44), y: range(r, -0.01, 0.03), r: 0.088 * g.eyeScale },
    irisHue: (g.accentHue + range(r, -25, 25) + 360) % 360,
    pattern: (['plain', 'plain', 'mask', 'socks', 'spots', 'saddle'] as const)[Math.floor(r() * 6)]!,
    patternHue: (g.hue + range(r, -20, 20) + 360) % 360,
    fluff: range(r, 0.75, 1.35),
    earLen: range(r, 0.85, 1.2),
    earWidth: range(r, 0.85, 1.2),
    tailLen: range(r, 0.8, 1.25),
    mouth: r() < 0.55 ? 'smile' : 'cat',
    brow: r() < 0.5 ? range(r, 0.6, 1) : 0,
  };
}

// ── SDF primitives
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
// Math.sqrt, not Math.hypot: hypot is several times slower in V8 and this runs ~400k times per build.
const len = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
const sphere = (x: number, y: number, z: number, r: number) => len(x, y, z) - r;
/** Approximate ellipsoid distance (Inigo Quilez). */
const ellipsoid = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
  const k0 = len(x / rx, y / ry, z / rz);
  const k1 = len(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
};

export function sdf(f: Form, x: number, y: number, z: number): number {
  const H = f.head;
  // Small chin: squash the head's lower half a little; forehead bulges up and forward.
  const yy = y - H.y;
  // The head narrows toward a small chin (a round face, not a mushroom with jowls).
  const taper = yy < 0 ? 1 + 0.32 * Math.min(1, -yy / H.ry) : 1;
  let d = ellipsoid(x * taper, yy, z * (1 + (taper - 1) * 0.5), H.rx, H.ry, H.rz);
  // A round cranium: the forehead sphere sits high so the top of the head domes, not flattens.
  d = smin(d, sphere(x, y - (H.y + 0.06), z + 0.015, f.forehead), 0.1);
  // Chubby cheeks, tucked in front so the face is round rather than mushroom-shaped.
  const cx = H.rx * 0.5;
  d = smin(d, sphere(Math.abs(x) - cx, y - (H.y - 0.1), z - H.rz * 0.52, f.cheek), 0.08);
  // Muzzle
  d = smin(d, ellipsoid(x, y - (H.y - 0.09), z - H.rz * 0.72, 0.12, 0.085, 0.09), 0.08);
  // Torso + tummy, neckless join
  const T = f.torso;
  let b = ellipsoid(x, y - T.y, z, T.rx, T.ry, T.rz);
  b = smin(b, sphere(x, y - (T.y - 0.025), z - 0.075, f.tummy), 0.12);
  // Hip pads where the feet attach. The feet themselves are separate meshes (creatureMesh.ts) so
  // they can plant on the ground and step (src/render/creature/gait.ts) instead of skating along
  // with a body they're baked into.
  b = smin(b, ellipsoid(Math.abs(x) - 0.125, y - f.foot * 1.25, z + 0.02, f.foot * 0.85, f.foot * 0.7, f.foot * 0.95), 0.07);
  // A small smooth join: a soft neck crease so head and body read as two shapes.
  return smin(d, b, 0.11);
}

const CENTER = new THREE.Vector3(0, 0.45, 0);

export interface BodyGeometry {
  geometry: THREE.BufferGeometry;
  /** Head-region weight's pivot (neck), in body space. */
  neck: THREE.Vector3;
}

const cache = new Map<number, BodyGeometry>();

/**
 * Shrink-wrap the SDF: for each direction from the centre, find the OUTERMOST surface crossing.
 * Normals come from the SDF gradient, so shading is perfectly smooth. Extra attributes drive
 * vertex-shader deformation: aHead (turns with the head), aBelly (jiggles and breathes),
 * aCheek (puffs).
 */
export function bodyGeometry(g: Genome, f = deriveForm(g)): BodyGeometry {
  const hit = cache.get(g.seed);
  if (hit) return hit;
  const geo = new THREE.SphereGeometry(1, 96, 72);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const normals = new Float32Array(n * 3);
  const head = new Float32Array(n);
  const belly = new Float32Array(n);
  const cheek = new Float32Array(n);
  const colors = new Float32Array(n * 3);
  const dir = new THREE.Vector3();
  const base = new THREE.Color().setHSL(g.hue / 360, g.sat, g.light);
  const cream = new THREE.Color().setHSL(g.hue / 360, g.sat * 0.45, Math.min(0.94, g.light + 0.17));
  const patt = new THREE.Color().setHSL(f.patternHue / 360, Math.min(1, g.sat * 1.1), Math.max(0.25, g.light - 0.2));
  const c = new THREE.Color();
  const e = 1e-3;
  for (let i = 0; i < n; i++) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    // Sphere-trace in from outside (under-relaxed: the ellipsoid distance is approximate), then
    // bisect the first crossing.
    let hi = 0.9;
    let lo = 0.9;
    for (let t = 0.9; t > 0; ) {
      const d = sdf(f, CENTER.x + dir.x * t, CENTER.y + dir.y * t, CENTER.z + dir.z * t);
      if (d < 0) {
        lo = t;
        break;
      }
      hi = t;
      t -= Math.max(0.004, Math.min(0.03, d * 0.7));
    }
    for (let k = 0; k < 12; k++) {
      const m = (lo + hi) / 2;
      if (sdf(f, CENTER.x + dir.x * m, CENTER.y + dir.y * m, CENTER.z + dir.z * m) < 0) lo = m;
      else hi = m;
    }
    const t = (lo + hi) / 2;
    const x = CENTER.x + dir.x * t;
    const y = CENTER.y + dir.y * t;
    const z = CENTER.z + dir.z * t;
    pos.setXYZ(i, x, y, z);
    const gx = sdf(f, x + e, y, z) - sdf(f, x - e, y, z);
    const gy = sdf(f, x, y + e, z) - sdf(f, x, y - e, z);
    const gz = sdf(f, x, y, z + e) - sdf(f, x, y, z - e);
    const gl = len(gx, gy, gz) || 1;
    normals.set([gx / gl, gy / gl, gz / gl], i * 3);

    const sm = (a: number, b: number, v: number) => {
      const q = Math.max(0, Math.min(1, (v - a) / (b - a)));
      return q * q * (3 - 2 * q);
    };
    head[i] = sm(f.neckY - 0.05, f.neckY + 0.1, y);
    belly[i] = sm(0.04, 0.12, z) * (1 - sm(0.3, 0.42, y)) * sm(0.02, 0.12, y);
    const cx = f.head.rx * 0.5;
    cheek[i] = Math.max(0, 1 - len(Math.abs(x) - cx, y - (f.head.y - 0.1), z - f.head.rz * 0.52) / (f.cheek * 1.6));

    // Colour: base, cream tummy + muzzle, and a pattern from the seed.
    c.copy(base);
    const muzzle = Math.max(0, 1 - len(x / 0.15, (y - (f.head.y - 0.11)) / 0.1, Math.max(0, f.head.rz * 0.65 - z) / 0.06));
    const tummy = belly[i]! * sm(0.08, 0.16, z);
    c.lerp(cream, Math.min(1, Math.max(muzzle * 1.2, tummy * 1.1)));
    let p = 0;
    if (f.pattern === 'mask') p = Math.max(0, 1 - len((Math.abs(x) - 0.14) / 0.12, (y - (f.head.y + 0.03)) / 0.09, 0)) * sm(0.1, 0.2, z);
    if (f.pattern === 'socks') p = 1 - sm(0.06, 0.1, y);
    if (f.pattern === 'saddle') p = sm(-0.02, -0.12, z) * sm(0.15, 0.25, y) * (1 - sm(0.4, 0.5, y));
    if (f.pattern === 'spots') {
      const sx = Math.sin(x * 31 + g.seed) * Math.sin(y * 27) * Math.sin(z * 29 + 1.3);
      p = sm(0.55, 0.7, sx) * sm(0.0, -0.08, z) * (1 - head[i]! * 0.6);
    }
    c.lerp(patt, Math.min(1, p) * 0.85);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aHead', new THREE.BufferAttribute(head, 1));
  geo.setAttribute('aBelly', new THREE.BufferAttribute(belly, 1));
  geo.setAttribute('aCheek', new THREE.BufferAttribute(cheek, 1));
  geo.computeBoundingSphere();
  const out = { geometry: geo, neck: new THREE.Vector3(0, f.neckY, 0) };
  cache.set(g.seed, out);
  return out;
}

/** The outermost surface point (and normal) along a direction from a point; used to seat the face. */
export function surfaceToward(f: Form, from: THREE.Vector3, dir: THREE.Vector3): { p: THREE.Vector3; n: THREE.Vector3 } {
  const d = dir.clone().normalize();
  let hi = 0.9;
  let lo = 0;
  for (let t = 0.9; t > 0; t -= 0.01) {
    if (sdf(f, from.x + d.x * t, from.y + d.y * t, from.z + d.z * t) < 0) {
      lo = t;
      break;
    }
    hi = t;
  }
  for (let k = 0; k < 20; k++) {
    const m = (lo + hi) / 2;
    if (sdf(f, from.x + d.x * m, from.y + d.y * m, from.z + d.z * m) < 0) lo = m;
    else hi = m;
  }
  const p = from.clone().addScaledVector(d, (lo + hi) / 2);
  const e = 1e-3;
  const n = new THREE.Vector3(
    sdf(f, p.x + e, p.y, p.z) - sdf(f, p.x - e, p.y, p.z),
    sdf(f, p.x, p.y + e, p.z) - sdf(f, p.x, p.y - e, p.z),
    sdf(f, p.x, p.y, p.z + e) - sdf(f, p.x, p.y, p.z - e),
  ).normalize();
  return { p, n };
}
