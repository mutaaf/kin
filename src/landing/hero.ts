// Hero: a KIN made of light. Points and normals are sampled from the REAL procedural mesh
// (the same buildCreature() the app renders), handed to aurora-field as lit surfels, and then
// morphed through the story: one KIN, another, two phones side by side, a KIN mid-hop over the seam.

import * as AuroraField from 'aurora-field';
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { makeGenome } from '../core/genome';
import { buildCreature } from '../render/creatureMesh';

type V3 = [number, number, number];

interface Cloud {
  points: V3[];
  normals: V3[];
  tone: number[];
  bright: number[];
  /** Total surface area in shape units, for surfel sizing. */
  area: number;
}

/** Sample a creature's surface: area-weighted across every visible mesh, in aurora-field space. */
export function sampleKin(seed: number, count = 7000): Cloud {
  const parts = buildCreature(makeGenome(seed));
  for (const l of parts.lids) l.visible = false;
  parts.root.updateMatrixWorld(true);
  const eyeMeshes = new Set<THREE.Object3D>();
  for (const e of parts.eyes) e.traverse((o) => eyeMeshes.add(o));
  const accentMeshes = new Set<THREE.Object3D>();
  parts.accent?.traverse((o) => accentMeshes.add(o));
  const meshes: { mesh: THREE.Mesh; area: number; kind: 'fur' | 'eye' | 'accent' }[] = [];
  parts.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !o.visible || !isVisible(o)) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const area = surfaceArea(g);
    g.dispose();
    meshes.push({ mesh: m, area, kind: eyeMeshes.has(o) ? 'eye' : accentMeshes.has(o) ? 'accent' : 'fur' });
  });
  const total = meshes.reduce((a, m) => a + m.area, 0);
  const pts: V3[] = [];
  const nrm: V3[] = [];
  const tone: number[] = [];
  const bright: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const { mesh, area, kind } of meshes) {
    // Eyes get extra density: they carry the expression even made of light.
    const share = Math.max(kind === 'fur' ? 6 : 40, Math.round((count * area) / total) * (kind === 'eye' ? 3 : 1));
    const sampler = new MeshSurfaceSampler(mesh).build();
    nm.getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < share; i++) {
      sampler.sample(p, n);
      p.applyMatrix4(mesh.matrixWorld);
      n.applyMatrix3(nm).normalize();
      if (kind !== 'fur') bright.push(pts.length);
      pts.push([p.x, p.y, p.z]);
      nrm.push([n.x, n.y, n.z]);
      tone.push(kind === 'fur' ? 0 : 1);
    }
  }
  parts.dispose();
  // three: +y up, +z toward the viewer. aurora-field: +y down, +z away. Rotate 180° about x.
  const box = new THREE.Box3().setFromArray(pts.flat());
  const c = box.getCenter(new THREE.Vector3());
  const s = 1 / Math.max(box.max.x - c.x, box.max.y - c.y, box.max.z - c.z);
  // Shuffle so any prefix of n points is an even sample of the whole body.
  const order = pts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(fract(Math.sin(i * 12.9898 + seed) * 43758.5453) * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const brightSet = new Set(bright);
  const out: Cloud = { points: [], normals: [], tone: [], bright: [], area: total * s * s };
  for (const i of order) {
    const q = pts[i]!;
    const v = nrm[i]!;
    if (brightSet.has(i)) out.bright.push(out.points.length);
    out.points.push([(q[0] - c.x) * s, -(q[1] - c.y) * s, -(q[2] - c.z) * s]);
    out.normals.push([v[0], -v[1], -v[2]]);
    out.tone.push(tone[i]!);
  }
  return out;
}

const fract = (x: number) => x - Math.floor(x);

function isVisible(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

function surfaceArea(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let sum = 0;
  const tri = (i: number, j: number, k: number) => {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, j);
    c.fromBufferAttribute(pos, k);
    sum += b.sub(a).cross(c.sub(a)).length() / 2;
  };
  if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
  return sum;
}

/** A creature cloud as an aurora-field shape builder, optionally scaled and placed. */
function kinBuilder(cloud: Cloud, at: V3 = [0, 0, 0], scale = 1) {
  return (n: number) => {
    const m = Math.min(n, cloud.points.length);
    const points: V3[] = [];
    const normals: V3[] = [];
    const tone: number[] = [];
    const surfel: number[] = [];
    const bright: number[] = [];
    const w = Math.sqrt(cloud.area / m) * 1.05 * scale;
    const brightSet = new Set(cloud.bright);
    for (let i = 0; i < n; i++) {
      const j = i % m;
      const q = cloud.points[j]!;
      points.push([at[0] + q[0] * scale, at[1] + q[1] * scale, at[2] + q[2] * scale]);
      normals.push(cloud.normals[j]!);
      tone.push(cloud.tone[j]!);
      surfel.push(brightSet.has(j) ? 0 : w);
      if (brightSet.has(j) && i < m) bright.push(i);
    }
    return { points, normals, tone, surfel, bright, facing: true, kick: 0.35, surfelAlpha: 0.07, surfelFlat: true };
  };
}

/** Rounded-rect path (corners as quadratic curves, which the parser samples smoothly). */
function phonePath(x: number, y: number, w: number, h: number, r: number) {
  return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

/** Two phones side by side and a KIN at the top of its hop over the seam. */
function crossingBuilder(kin: Cloud) {
  const frames = AuroraField.fromSVG(
    [phonePath(0, 0, 100, 200, 18), phonePath(116, 0, 100, 200, 18), 'M60 120 Q108 30 156 120'],
    { tone: [0, 0, 1], scale: 1 },
  );
  const small = kinBuilder(kin, [0, -0.36, 0], 0.27);
  return (n: number, r: () => number) => {
    const nk = Math.floor(n * 0.42);
    const f = frames(n - nk, r);
    const k = small(nk);
    const points = [...f.points, ...k.points];
    const off = f.points.length;
    return {
      points,
      normals: [...f.points.map((): V3 => [0, 0, -1]), ...k.normals],
      tone: [...(f.tone ?? f.points.map(() => 0)), ...k.tone],
      surfel: [...f.points.map(() => 0), ...k.surfel],
      pairs: f.pairs,
      bright: k.bright.map((i) => i + off),
      facing: true,
      kick: 0.2,
      surfelAlpha: 0.045,
      surfelFlat: true,
    };
  };
}

export interface Hero {
  field: AuroraField.Field;
  shapes: string[];
  captions: Record<string, string>;
}

export function startHero(canvas: HTMLCanvasElement, stage: HTMLElement, onShape: (caption: string) => void): Hero {
  const a = sampleKin(28);
  const b = sampleKin(12);
  AuroraField.register('kin:28', kinBuilder(a));
  AuroraField.register('kin:12', kinBuilder(b));
  AuroraField.register('kin:cross', crossingBuilder(a));
  const captions: Record<string, string> = {
    'kin:28': 'Seed 28 · sampled from the real creature mesh',
    'kin:12': 'Seed 12 · every seed is a different KIN',
    'kin:cross': 'Two screens · one hop over the seam',
  };
  const shapes = ['kin:28', 'kin:12', 'kin:cross'];
  const field = AuroraField.create(canvas, {
    shapes,
    stage,
    cycle: 7000,
    intro: 3200,
    depth: 3.2,
    stars: 90,
    seed: 28,
    palette: {
      preset: 'aurora',
      point: [168, 236, 214],
      accent: [190, 198, 255],
      hot: '#F6F6F3',
      star: '#C9D2F2',
      signal: [233, 175, 107],
      head: [246, 246, 243],
      glow: [110, 229, 202],
      glow2: [70, 80, 160],
      fog: [24, 30, 52],
    },
    light: { dir: [-0.5, -0.8, -0.6], ambient: 0.22, key: 0.85, rim: 0.7, spec: 0.45, shine: 28 },
    radius: (w: number, h: number) => Math.min(w * 0.42, h * 0.4, 300),
    count: (vw: number) => (vw < 760 ? 4800 : 6400),
    onShape: (name: string) => onShape(captions[name] ?? ''),
  } as AuroraField.Options);
  return { field, shapes, captions };
}
