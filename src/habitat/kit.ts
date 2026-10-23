// Procedural building blocks shared by every habitat: an original, stylised kit (no external art).
// Everything is cheap on purpose: instancing for repeated things, emissive instead of lights,
// one wind uniform for every swaying thing.

import * as THREE from 'three';
import { rng, type Rng } from '../core/rng';

export type Quality = 0 | 1 | 2; // low, medium, high

/** Shared animated uniforms: one write per frame drives every shader in a habitat. */
export interface Uniforms {
  uTime: { value: number };
  uWind: { value: THREE.Vector2 };
  uNight: { value: number };
}

export const makeUniforms = (): Uniforms => ({ uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.15, 0) }, uNight: { value: 0 } });

/** Smooth value noise (2D), deterministic. */
export function noise2(seed: number) {
  const r = rng(seed);
  const p = Array.from({ length: 512 }, () => r());
  const h = (x: number, y: number) => p[((x * 73856093) ^ (y * 19349663)) & 511]!;
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi);
    const b = h(xi + 1, yi);
    const c = h(xi, yi + 1);
    const d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Superellipse radius at angle a (rounded-rectangle island outlines). */
const superR = (a: number, n = 3.2) => 1 / Math.pow(Math.abs(Math.cos(a)) ** n + Math.abs(Math.sin(a)) ** n, 1 / n);

export interface IslandOpts {
  rx: number;
  rz: number;
  seed: number;
  /** Raised rim height at the back (gives the garden a horizon). */
  backRise?: number;
  /** Depth of the hanging rock underneath. */
  depth?: number;
  top: THREE.Color;
  rock: THREE.Color;
  /** Region kept dead flat for play: |x| < flatX, z in [flatZ0, flatZ1]. */
  flatX?: number;
  flatZ?: [number, number];
  /** Optional y offset function for the top (hills). */
  rough?: number;
}

/**
 * A floating island: a gently undulating grassy top with vertex-colour variation, a rocky skirt
 * and an underside tapering to a point. Returns the mesh plus a heightAt() for placing things.
 */
export function island(o: IslandOpts) {
  const n = noise2(o.seed);
  const rings = 34;
  const segs = 120;
  const flatX = o.flatX ?? 3.2;
  const [fz0, fz1] = o.flatZ ?? [-1.6, 1.8];
  const heightAt = (x: number, z: number) => {
    const ex = Math.max(0, Math.abs(x) - flatX) / (o.rx - flatX);
    const ez = z < fz0 ? (fz0 - z) / (o.rz - Math.abs(fz0)) : z > fz1 ? (z - fz1) / (o.rz - fz1) : 0;
    const e = Math.min(1, Math.hypot(ex, ez));
    const hills = (n(x * 0.45, z * 0.45) - 0.5) * (o.rough ?? 0.35) * e;
    const back = z < fz0 ? (o.backRise ?? 0.5) * Math.min(1, (fz0 - z) / 3) ** 1.6 : 0;
    return hills + back;
  };
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  // Top: concentric rings out to the rim.
  pos.push(0, heightAt(0, 0), 0);
  col.push(o.top.r, o.top.g, o.top.b);
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const r = superR(a) * t * (1 + (n(Math.cos(a) * 3, Math.sin(a) * 3) - 0.5) * 0.12 * t);
      const x = Math.cos(a) * r * o.rx;
      const z = Math.sin(a) * r * o.rz;
      const y = heightAt(x, z) - (t > 0.94 ? (t - 0.94) * 2.2 : 0);
      pos.push(x, y, z);
      const v = n(x * 1.3 + 9, z * 1.3) * 0.18 + n(x * 4, z * 4) * 0.06;
      c.copy(o.top).offsetHSL(v * 0.06 - 0.02, v * 0.1, v * 0.22 - 0.08 + (t > 0.9 ? -0.05 : 0));
      col.push(c.r, c.g, c.b);
    }
  }
  const ring = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * segs + (j % segs));
  for (let j = 0; j < segs; j++) idx.push(0, ring(1, j + 1), ring(1, j));
  for (let i = 1; i < rings; i++)
    for (let j = 0; j < segs; j++) {
      const a = ring(i, j);
      const b = ring(i, j + 1);
      const d = ring(i + 1, j);
      const e = ring(i + 1, j + 1);
      idx.push(a, b, d, b, e, d);
    }
  // Skirt: rock hanging below, tapering to a point (the floating island).
  const depth = o.depth ?? 3.2;
  const rimStart = 1 + (rings - 1) * segs;
  const layers = 9;
  let prevStart = rimStart;
  for (let k = 1; k <= layers; k++) {
    const t = k / layers;
    const shrink = 1 - t ** 1.4 * 0.92;
    const start = pos.length / 3;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const jag = 1 + (n(j * 0.35 + k, k * 1.7) - 0.5) * 0.22;
      const r = superR(a) * shrink * jag;
      const x = Math.cos(a) * r * o.rx;
      const z = Math.sin(a) * r * o.rz;
      pos.push(x, -0.1 - t * depth + (n(j * 0.2, k) - 0.5) * 0.3, z);
      c.copy(o.rock).offsetHSL(0, 0, -t * 0.12 + (n(j * 0.5, k * 2) - 0.5) * 0.08);
      col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < segs; j++) {
      const a = prevStart + j;
      const b = prevStart + ((j + 1) % segs);
      const d = start + j;
      const e = start + ((j + 1) % segs);
      idx.push(a, b, d, b, e, d);
    }
    prevStart = start;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  const inside = (x: number, z: number, margin = 0.92) => {
    const a = Math.atan2(z / o.rz, x / o.rx);
    return Math.hypot(x / o.rx, z / o.rz) < superR(a) * margin;
  };
  return { mesh, heightAt, inside };
}

/** Grass blades, instanced, swaying with the real wind; tips catch light, bases sit in shade. */
export function grass(o: { count: number; place: (r: Rng) => { x: number; z: number; s: number } | null; y: (x: number, z: number) => number; tint: THREE.Color; u: Uniforms; seed: number; height?: number }) {
  const h = o.height ?? 0.2;
  const blade = new THREE.BufferGeometry();
  // A curved, tapered blade with 3 segments.
  const pts = [-0.016, 0, 0, 0.016, 0, 0, -0.012, h * 0.4, 0.01, 0.012, h * 0.4, 0.01, -0.006, h * 0.75, 0.03, 0.006, h * 0.75, 0.03, 0, h, 0.06];
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const sh = [0.42, 0.42, 0.7, 0.7, 0.95, 0.95, 1.25];
  blade.setAttribute('color', new THREE.Float32BufferAttribute(sh.flatMap((v) => [v, v, v]), 3));
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
  blade.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: o.tint, roughness: 0.85, side: THREE.DoubleSide, vertexColors: true });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, o.u);
    s.vertexShader = 'uniform float uTime; uniform vec2 uWind;\n' + s.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float hg = clamp(position.y / ${h.toFixed(3)}, 0.0, 1.0);
       vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
       float ph = ip.x * 1.9 + ip.z * 2.7;
       float gust = 0.6 + 0.4 * sin(uTime * 0.6 + ip.x * 0.2 - ip.z * 0.1);
       float sway = (length(uWind) * gust + 0.035) * (0.75 + 0.25 * sin(uTime * (1.8 + length(uWind) * 3.0) + ph));
       transformed.x += (uWind.x * sway * 1.8 + 0.012 * sin(uTime * 1.1 + ph)) * hg * hg;
       transformed.z += uWind.y * sway * 1.8 * hg * hg;`,
    );
  };
  const r = rng(o.seed);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const placed: THREE.Matrix4[] = [];
  for (let i = 0; i < o.count * 3 && placed.length < o.count; i++) {
    const p = o.place(r);
    if (!p) continue;
    e.set((r() - 0.5) * 0.25, r() * Math.PI * 2, (r() - 0.5) * 0.25);
    q.setFromEuler(e);
    const s = p.s * (0.75 + r() * 0.5);
    m.compose(new THREE.Vector3(p.x, o.y(p.x, p.z) - 0.005, p.z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.6), s));
    placed.push(m.clone());
  }
  const mesh = new THREE.InstancedMesh(blade, mat, placed.length);
  // Patches: clumps of lighter, yellower and deeper, bluer green so the lawn never reads flat.
  const patch = noise2(o.seed + 99);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  placed.forEach((mm, i) => {
    mesh.setMatrixAt(i, mm);
    v.setFromMatrixPosition(mm);
    const n = patch(v.x * 0.55, v.z * 0.55); // 0 shady/blue … 1 sunlit/yellow
    const dark = 0.82 + n * 0.18 + (r() - 0.5) * 0.08;
    c.setRGB(dark * (0.92 + n * 0.12), dark, dark * (1.04 - n * 0.22));
    mesh.setColorAt(i, c);
  });
  mesh.frustumCulled = false;
  return { mesh, mat };
}

/** Little glowing flowers (instanced): petals + a luminous heart that blooms at night. */
export function flowers(o: { count: number; place: (r: Rng) => { x: number; z: number } | null; y: (x: number, z: number) => number; hues: number[]; u: Uniforms; seed: number }) {
  const r = rng(o.seed);
  const petal = new THREE.SphereGeometry(1, 10, 6);
  petal.scale(0.045, 0.012, 0.024);
  petal.translate(0.035, 0, 0);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) parts.push(petal.clone().rotateY((k / 5) * Math.PI * 2));
  const head = mergeGeos(parts);
  const stem = new THREE.CylinderGeometry(0.004, 0.006, 1, 5);
  stem.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, vertexColors: false, emissive: '#ffffff', emissiveIntensity: 0.0 });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, o.u);
    s.fragmentShader = 'uniform float uNight; uniform float uTime;\n' + s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       totalEmissiveRadiance = diffuseColor.rgb * (0.12 + uNight * 1.1);`,
    );
  };
  const stemMat = new THREE.MeshStandardMaterial({ color: '#4f8f6a', roughness: 0.8 });
  const n = o.count;
  const heads = new THREE.InstancedMesh(head, mat, n);
  const stems = new THREE.InstancedMesh(stem, stemMat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  let k = 0;
  for (let i = 0; i < n * 4 && k < n; i++) {
    const p = o.place(r);
    if (!p) continue;
    const y = o.y(p.x, p.z);
    const hgt = 0.06 + r() * 0.1;
    const s = 0.65 + r() * 0.5;
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4));
    m.compose(new THREE.Vector3(p.x, y + hgt, p.z), q, new THREE.Vector3(s, s, s));
    heads.setMatrixAt(k, m);
    m.compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion(), new THREE.Vector3(1, hgt, 1));
    stems.setMatrixAt(k, m);
    c.setHSL(o.hues[Math.floor(r() * o.hues.length)]! / 360, 0.82, 0.66);
    heads.setColorAt(k, c);
    k++;
  }
  heads.count = stems.count = k;
  const g = new THREE.Group();
  g.add(stems, heads);
  return g;
}

/** A crystal cluster: faceted, translucent, softly self-lit (emissive pulses with uTime). */
export function crystals(o: { at: THREE.Vector3; count: number; hue: number; scale?: number; u: Uniforms; seed: number }) {
  const r = rng(o.seed);
  const g = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(1, 0);
  geo.scale(0.45, 1.6, 0.45);
  geo.translate(0, 1.2, 0);
  const col = new THREE.Color().setHSL(o.hue / 360, 0.7, 0.72);
  const mat = new THREE.MeshPhysicalMaterial({
    color: col, emissive: new THREE.Color().setHSL(o.hue / 360, 0.9, 0.5), emissiveIntensity: 0.4,
    roughness: 0.08, transmission: 0.35, thickness: 0.4, transparent: true, opacity: 0.92, clearcoat: 1,
  });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, o.u);
    s.fragmentShader = 'uniform float uNight; uniform float uTime;\n' + s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       totalEmissiveRadiance *= (0.5 + uNight * 1.6) * (0.85 + 0.15 * sin(uTime * 1.4));`,
    );
  };
  for (let i = 0; i < o.count; i++) {
    const m = new THREE.Mesh(geo, mat);
    const s = (o.scale ?? 0.12) * (0.5 + r() * 0.9);
    m.scale.setScalar(s);
    m.position.set((r() - 0.5) * 0.35 * (o.scale ?? 0.12) * 6, 0, (r() - 0.5) * 0.25 * (o.scale ?? 0.12) * 6);
    m.rotation.set((r() - 0.5) * 0.7, r() * 6.28, (r() - 0.5) * 0.7);
    g.add(m);
  }
  g.position.copy(o.at);
  return g;
}

/** A small pond: sky-tinted water with ripples, fresnel and a sun glint (no render targets). */
export function pond(o: { at: THREE.Vector3; rx: number; rz: number; u: Uniforms }) {
  const geo = new THREE.CircleGeometry(1, 64);
  geo.rotateX(-Math.PI / 2);
  geo.scale(o.rx, 1, o.rz);
  const uniforms = {
    ...o.u,
    uSky: { value: new THREE.Color('#9fb4ff') },
    uDeep: { value: new THREE.Color('#2a5c6a') },
    uSun: { value: new THREE.Color('#fff4dc') },
    uSunI: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform float uNight; uniform vec3 uSky; uniform vec3 uDeep; uniform vec3 uSun; uniform float uSunI;
      varying vec3 vW; varying vec2 vUv;
      float wave(vec2 p){ return sin(p.x*9.0+uTime*1.3)*0.5 + sin(p.y*11.0-uTime*1.1)*0.5 + sin((p.x+p.y)*15.0+uTime*2.0)*0.25; }
      void main(){
        vec2 c = vUv - 0.5; float r = length(c)*2.0;
        float w = wave(vW.xz);
        float fres = 0.35 + 0.45 * smoothstep(0.0, 1.0, r);
        vec3 col = mix(uDeep, uSky, fres + w*0.04);
        float glint = pow(max(0.0, w*0.5+0.5), 18.0) * uSunI * (1.0 - uNight*0.7);
        col += uSun * glint * 0.6;
        col += vec3(0.6,0.95,0.85) * uNight * 0.08;
        float edge = smoothstep(1.0, 0.86, r);
        gl_FragColor = vec4(col, 0.88 * edge);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(o.at).setY(o.at.y + 0.012);
  mesh.renderOrder = 2;
  // A soft stone rim.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 64), new THREE.MeshStandardMaterial({ color: '#cfc7b8', roughness: 0.9 }));
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(o.rx * 1.02, o.rz * 1.02, 0.6);
  rim.position.copy(o.at).setY(o.at.y + 0.01);
  const g = new THREE.Group();
  g.add(mesh, rim);
  return { group: g, uniforms };
}

/** A soft round puff texture (clouds, glows, bokeh), drawn once. */
export function puff(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.55)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A tall stylised tree: tapered trunk and layered, lumpy canopy blobs. */
export function tree(r: Rng, o: { height: number; leaf: THREE.Color; bark: THREE.Color }) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * o.height, 0.11 * o.height, o.height, 10, 4), new THREE.MeshStandardMaterial({ color: o.bark, roughness: 0.95 }));
  trunk.position.y = o.height / 2;
  g.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({ color: o.leaf, roughness: 0.85, flatShading: false });
  const blobs = 5 + Math.floor(r() * 4);
  for (let i = 0; i < blobs; i++) {
    const s = o.height * (0.22 + r() * 0.16);
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), leafMat);
    b.scale.set(s * (1 + r() * 0.3), s * (0.8 + r() * 0.3), s * (1 + r() * 0.3));
    const a = r() * 6.28;
    const rr = o.height * 0.18 * r();
    b.position.set(Math.cos(a) * rr, o.height * (0.85 + r() * 0.35), Math.sin(a) * rr);
    g.add(b);
  }
  return g;
}

/** Merge simple non-indexed/indexed geometries with the same attributes (position+normal+uv). */
export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
