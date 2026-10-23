// A procedural, original KIN built from its genome. One sculpted, continuous soft body (an SDF
// shrink-wrapped to a mesh: see creature/form.ts) wearing shell-texture fur, a face seated on the
// surface (shader-painted eyes, nose, mouth, blush, brows), lathe-turned ears by genome kind, front
// paws, a multi-segment tail and an optional accent (crystal / sprout / ember). No asset files, no
// licensing questions, and the same seed renders the same creature on every device.

import * as THREE from 'three';
import type { Genome } from '../core/genome';
import { bodyGeometry, deriveForm, surfaceToward, type Form } from './creature/form';
import { eyeGeometry, eyeMaterial, eyeUniforms, type EyeUniforms } from './creature/eyes';
import { deformUniforms, FUR_TIERS, furShells, furUniforms, patch, plush, type DeformUniforms, type FurUniforms } from './creature/materials';

export interface CreatureParts {
  root: THREE.Group;
  squash: THREE.Group;
  /** Turns with the shader's head rotation (pivot at the neck). */
  head: THREE.Group;
  eyes: { mesh: THREE.Mesh; u: EyeUniforms }[];
  ears: THREE.Group[];
  tail: THREE.Group[];
  paws: THREE.Group[];
  mouth: { smile: THREE.Object3D; open: THREE.Group; tongue: THREE.Mesh };
  cheeks: THREE.Mesh[];
  brows: THREE.Mesh[];
  accent: THREE.Object3D | null;
  accentMat: THREE.MeshStandardMaterial | null;
  deform: DeformUniforms;
  fur: FurUniforms;
  furMeshes: THREE.InstancedMesh[];
  form: Form;
  /** Head centre in body space (for hit-testing and look-at). */
  headCenter: THREE.Vector3;
  setFurTier(tier: number): void;
  dispose(): void;
}

const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, s, l);
const MAX_SHELLS = FUR_TIERS[FUR_TIERS.length - 1]!;

/** Default fur tier: fewer shells on small/touch screens; the app may change it live. */
function defaultTier(): number {
  // ?fur=0..3 pins the quality (0 = plush only), for slow devices and software-GL test runs.
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('fur');
  if (q !== null && /^[0-3]$/.test(q)) return Number(q);
  if (typeof matchMedia === 'undefined') return 2;
  return matchMedia('(pointer: coarse)').matches ? 2 : 3;
}

export function buildCreature(g: Genome): CreatureParts {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const geo = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const mat = <T extends THREE.Material>(x: T) => (mats.push(x), x);

  const form = deriveForm(g);
  const body = bodyGeometry(g, form); // cached per seed: not disposed with the view
  const furColor = hsl(g.hue, g.sat, g.light);
  const sheen = hsl(g.hue, g.sat * 0.6, Math.min(0.95, g.light + 0.2));
  const rim = hsl(g.hue, 0.45, 0.93);
  const innerColor = hsl(g.accentHue, 0.5, 0.8);
  const skinTone = furColor.clone().lerp(new THREE.Color('#ffffff'), 0.08);

  const deform = deformUniforms(body.neck);
  const fur = furUniforms(0.02 * form.fluff, 118);
  const furMeshes: THREE.InstancedMesh[] = [];

  const root = new THREE.Group();
  const squash = new THREE.Group();
  root.add(squash);

  // ── Body: plush base + instanced fur shells, sharing the head/belly/cheek deformation.
  const skinMat = mat(plush(null, sheen, { vertexColors: true }));
  patch(skinMat, { deform, rim });
  squash.add(new THREE.Mesh(body.geometry, skinMat));
  // Shells use the SAME plush shading as the skin beneath them, so neither the strands nor the
  // gaps between them pop (a mismatch reads as glitter). Texture comes from the silhouette and a
  // gentle root shadow only.
  const bodyFurMat = mat(plush(null, sheen, { vertexColors: true }));
  patch(bodyFurMat, { deform, fur });
  const bodyFur = furShells(body.geometry, bodyFurMat, MAX_SHELLS);
  squash.add(bodyFur);
  furMeshes.push(bodyFur);

  // Small furry parts (paws, ears, tail): one shared skin + one shared fur material.
  const partSkin = mat(plush(furColor, sheen));
  patch(partSkin, { rim });
  const partFur = mat(plush(furColor, sheen));
  patch(partFur, { fur });
  const furry = (gm: THREE.BufferGeometry, skin: THREE.Material = partSkin, fm: THREE.Material | null = partFur) => {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(gm, skin));
    if (fm) {
      const shells = furShells(gm, fm, MAX_SHELLS);
      grp.add(shells);
      furMeshes.push(shells);
    }
    return grp;
  };
  const ball = geo(new THREE.SphereGeometry(1, 32, 24));

  // ── Head group: pivot at the neck; features are seated on the SDF surface.
  const head = new THREE.Group();
  head.position.copy(body.neck);
  squash.add(head);
  const hc = new THREE.Vector3(0, form.head.y, 0);
  const local = (p: THREE.Vector3) => p.clone().sub(body.neck);
  const seat = (obj: THREE.Object3D, dir: THREE.Vector3, sink = 0, from = hc) => {
    const s = surfaceToward(form, from, dir);
    obj.position.copy(local(s.p.addScaledVector(s.n, -sink)));
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.n);
    head.add(obj);
    return s;
  };

  // Eyes
  const iris = hsl(form.irisHue, 0.62, 0.52);
  const eyeGeo = geo(eyeGeometry());
  const er = form.eye.r;
  const eyes: CreatureParts['eyes'] = [];
  for (const side of [-1, 1]) {
    const u = eyeUniforms(side, iris, skinTone);
    const m = new THREE.Mesh(eyeGeo, mat(eyeMaterial(u)));
    m.scale.set(er, er * 1.14, er * 0.42);
    const holder = new THREE.Group();
    holder.add(m);
    seat(holder, new THREE.Vector3(side * Math.sin(form.eye.spread), 0.1 + form.eye.y, Math.cos(form.eye.spread)), er * 0.12);
    eyes.push({ mesh: m, u });
  }

  // Nose: a small soft rounded triangle.
  const dark = mat(new THREE.MeshPhysicalMaterial({ color: hsl(g.hue, 0.3, 0.12), roughness: 0.25, clearcoat: 0.6 }));
  const nose = new THREE.Mesh(ball, dark);
  nose.scale.set(0.03, 0.021, 0.018);
  const noseHolder = new THREE.Group();
  noseHolder.add(nose);
  seat(noseHolder, new THREE.Vector3(0, -0.14, 1), -0.004);

  // Mouth: a smile (or a cat "w"), and an open mouth with a tongue for talking/laughing.
  const mouthHolder = new THREE.Group();
  seat(mouthHolder, new THREE.Vector3(0, -0.3, 1), -0.002);
  const arcGeo = geo(new THREE.TorusGeometry(0.032, 0.0075, 10, 28, Math.PI));
  let smile: THREE.Object3D;
  if (form.mouth === 'cat') {
    const w = new THREE.Group();
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(arcGeo, dark);
      a.rotation.z = Math.PI;
      a.scale.setScalar(0.8);
      a.position.x = s * 0.026;
      w.add(a);
    }
    smile = w;
  } else {
    const a = new THREE.Mesh(arcGeo, dark);
    a.rotation.z = Math.PI;
    smile = a;
  }
  mouthHolder.add(smile);
  const open = new THREE.Group();
  const cavity = new THREE.Mesh(geo(new THREE.CircleGeometry(0.036, 32)), mat(new THREE.MeshBasicMaterial({ color: '#3a1420' })));
  const tongue = new THREE.Mesh(geo(new THREE.CircleGeometry(0.024, 28)), mat(new THREE.MeshBasicMaterial({ color: '#f08aa0' })));
  tongue.position.set(0, -0.012, 0.001);
  open.add(cavity, tongue);
  open.position.y = -0.012;
  open.scale.set(1, 0.001, 1);
  mouthHolder.add(open);

  // Blush
  const blushMat = mat(new THREE.MeshBasicMaterial({ color: hsl(350, 0.85, 0.74), transparent: true, opacity: 0.4, depthWrite: false }));
  const blushGeo = geo(new THREE.CircleGeometry(0.05, 32));
  const cheeks: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const c = new THREE.Mesh(blushGeo, blushMat.clone());
    mats.push(c.material as THREE.Material);
    c.scale.set(1, 0.7, 1);
    const holder = new THREE.Group();
    holder.add(c);
    seat(holder, new THREE.Vector3(side * 0.6, -0.22, 0.76), -0.004);
    cheeks.push(c);
  }

  // Brow tufts (worry, surprise, grumpiness), only on some seeds.
  const brows: THREE.Mesh[] = [];
  if (form.brow > 0) {
    const browMat = mat(plush(furColor.clone().multiplyScalar(0.82), sheen));
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(ball, browMat);
      b.scale.set(0.035 * form.brow, 0.012, 0.014);
      const holder = new THREE.Group();
      holder.add(b);
      seat(holder, new THREE.Vector3(side * 0.42, 0.42, 0.8), -0.004);
      brows.push(b);
    }
  }

  // Ears: lathe profiles by kind, flattened; inner ear in the accent tint.
  const earProfile = (k: Genome['ears']): [number, number][] => {
    switch (k) {
      case 'round': return Array.from({ length: 12 }, (_, i) => { const a = (i / 11) * Math.PI; return [Math.sin(a) * 0.11, 0.11 - Math.cos(a) * 0.11] as [number, number]; });
      case 'long': return [[0, 0], [0.07, 0.01], [0.085, 0.1], [0.083, 0.22], [0.068, 0.33], [0.04, 0.39], [0, 0.41]];
      case 'tuft': return [[0, 0], [0.09, 0.0], [0.092, 0.06], [0.07, 0.13], [0.035, 0.19], [0, 0.22]];
      default: return [[0, 0], [0.1, 0.0], [0.104, 0.07], [0.086, 0.15], [0.05, 0.23], [0.012, 0.275], [0, 0.28]];
    }
  };
  const prof = earProfile(g.ears).map(([x, y]) => new THREE.Vector2(x * form.earWidth, y * form.earLen));
  const earGeo = geo(new THREE.LatheGeometry(prof, 28));
  const innerGeo = geo(new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p.x * 0.62, p.y * 0.78 + 0.012)), 24));
  const innerMat = mat(plush(innerColor, hsl(g.accentHue, 0.6, 0.92)));
  const ears: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    const s = surfaceToward(form, hc, new THREE.Vector3(side * 0.6, 0.8, -0.08));
    pivot.position.copy(local(s.p.addScaledVector(s.n, -0.02)));
    const splay = g.ears === 'long' ? 0.95 : g.ears === 'round' ? 0.55 : 0.32;
    pivot.rotation.set(-0.12, 0, -side * splay);
    pivot.userData.z0 = pivot.rotation.z;
    pivot.userData.x0 = pivot.rotation.x;
    const outer = furry(earGeo);
    outer.scale.set(1, 1, 0.42);
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.scale.set(1, 1, 0.3);
    inner.position.z = 0.026;
    pivot.add(outer, inner);
    if (g.ears === 'tuft') {
      const tip = furry(ball);
      tip.scale.setScalar(0.045);
      tip.position.y = 0.22 * form.earLen;
      pivot.add(tip);
    }
    head.add(pivot);
    ears.push(pivot);
  }

  // Front paws: tiny mittens that lift, wave and paddle.
  const paws: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.15, 0.13, 0.15);
    const paw = furry(ball);
    paw.scale.set(0.062, 0.07, 0.072);
    paw.position.set(0, -0.06, 0.02);
    pivot.add(paw);
    squash.add(pivot);
    paws.push(pivot);
  }

  // Tail: a chain of joints, each on its own spring in KinView.
  const tail: THREE.Group[] = [];
  const tailBase = surfaceToward(form, new THREE.Vector3(0, form.torso.y, 0), new THREE.Vector3(0, 0.05, -1));
  let parent: THREE.Object3D = squash;
  const segs: { r: number; len: number; tip?: 'leaf' }[] =
    g.tail === 'plume' ? [{ r: 0.075, len: 0.06 }, { r: 0.09, len: 0.08 }, { r: 0.095, len: 0.08 }, { r: 0.075, len: 0.07 }]
      : g.tail === 'curl' ? [{ r: 0.05, len: 0.05 }, { r: 0.048, len: 0.05 }, { r: 0.045, len: 0.05 }, { r: 0.04, len: 0.045 }, { r: 0.034, len: 0.04 }]
        : g.tail === 'leaf' ? [{ r: 0.04, len: 0.05 }, { r: 0.035, len: 0.06, tip: 'leaf' }]
          : [{ r: 0.075, len: 0.02 }];
  segs.forEach((sg, i) => {
    const joint = new THREE.Group();
    if (i === 0) joint.position.copy(tailBase.p).addScaledVector(tailBase.n, -0.03);
    else joint.position.set(0, 0, -segs[i - 1]!.len * form.tailLen);
    // Rest pose: the plume sweeps up and back (never above the head), the curl rolls over.
    const rest = g.tail === 'curl' ? -0.55 : g.tail === 'plume' ? (i === 0 ? -0.5 : -0.14) : -0.3;
    joint.rotation.x = rest;
    joint.userData.x0 = rest;
    if (sg.tip === 'leaf') {
      const leaf = new THREE.Mesh(ball, innerMat);
      leaf.scale.set(0.07, 0.016, 0.12);
      leaf.position.z = -0.08;
      joint.add(leaf);
    } else {
      const seg = furry(ball);
      seg.scale.set(sg.r, sg.r, sg.r * 1.15);
      seg.position.z = -sg.len * 0.5;
      joint.add(seg);
    }
    parent.add(joint);
    parent = joint;
    tail.push(joint);
  });

  // Accent: the species flourish. Emissive, so it glows softly at night.
  let accent: THREE.Object3D | null = null;
  let accentMat: THREE.MeshStandardMaterial | null = null;
  if (g.accent !== 'none') {
    const grp = new THREE.Group();
    if (g.accent === 'crystal') {
      accentMat = mat(new THREE.MeshStandardMaterial({ color: hsl(g.accentHue, 0.7, 0.75), emissive: hsl(g.accentHue, 0.9, 0.55), emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.94 }));
      const oct = geo(new THREE.OctahedronGeometry(1, 0));
      [[0, 0.05, 0, 0.06], [-0.055, 0.015, 0.01, 0.036], [0.055, 0.015, 0.01, 0.04]].forEach(([x, y, z, s]) => {
        const m = new THREE.Mesh(oct, accentMat!);
        m.scale.set(s!, s! * 1.7, s!);
        m.position.set(x!, y!, z!);
        m.rotation.z = x! * 4;
        grp.add(m);
      });
    } else if (g.accent === 'sprout') {
      accentMat = mat(new THREE.MeshStandardMaterial({ color: hsl(125, 0.5, 0.55), emissive: hsl(125, 0.7, 0.3), emissiveIntensity: 0.15, roughness: 0.6 }));
      const stem = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.007, 0.011, 0.08, 8)), accentMat);
      stem.position.y = 0.035;
      grp.add(stem);
      for (const side of [-1, 1]) {
        const leaf = new THREE.Mesh(ball, accentMat);
        leaf.scale.set(0.05, 0.012, 0.028);
        leaf.position.set(side * 0.045, 0.078, 0);
        leaf.rotation.z = side * 0.5;
        grp.add(leaf);
      }
    } else {
      accentMat = mat(new THREE.MeshStandardMaterial({ color: hsl(28, 1, 0.6), emissive: hsl(22, 1, 0.5), emissiveIntensity: 1.2, roughness: 0.4, transparent: true, opacity: 0.92 }));
      const flame = new THREE.Mesh(geo(new THREE.ConeGeometry(0.04, 0.12, 20)), accentMat);
      flame.position.y = 0.06;
      const core = new THREE.Mesh(ball, accentMat);
      core.scale.setScalar(0.042);
      core.position.y = 0.02;
      grp.add(flame, core);
    }
    const s = surfaceToward(form, hc, new THREE.Vector3(0, 1, 0.22));
    grp.position.copy(local(s.p.addScaledVector(s.n, -0.01)));
    head.add(grp);
    accent = grp;
  }

  root.scale.setScalar(g.size);

  const parts: CreatureParts = {
    root, squash, head, eyes, ears, tail, paws, cheeks, brows, accent, accentMat, deform, fur, furMeshes, form,
    mouth: { smile, open, tongue },
    headCenter: hc,
    setFurTier(tier: number) {
      const n = FUR_TIERS[Math.max(0, Math.min(FUR_TIERS.length - 1, tier))]!;
      fur.uShells.value = Math.max(1, n);
      for (const m of furMeshes) {
        m.count = n;
        m.visible = n > 0;
      }
    },
    dispose() {
      geos.forEach((x) => x.dispose());
      mats.forEach((x) => x.dispose());
    },
  };
  parts.setFurTier(defaultTier());
  return parts;
}
