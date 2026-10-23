// What every actor looks like. Procedural and original (no asset licences), in the garden's
// material language: porcelain, soft plush, glossy toys, a little light at night. Geometry is
// shared across instances; each factory returns a group whose origin sits on the ground.

import * as THREE from 'three';
import type { ItemKind } from '../core/care';

const g = {
  sphere: new THREE.SphereGeometry(1, 32, 20),
  lowSphere: new THREE.SphereGeometry(1, 14, 10),
  box: new THREE.BoxGeometry(1, 1, 1, 1, 1, 1),
  disc: new THREE.CircleGeometry(1, 48),
  ring: new THREE.RingGeometry(0.86, 1, 48),
};

const mat = {
  rubber: new THREE.MeshPhysicalMaterial({ color: '#E9AF6B', roughness: 0.35, clearcoat: 0.6 }),
  wood: new THREE.MeshStandardMaterial({ color: '#D9A86C', roughness: 0.75 }),
  woodDark: new THREE.MeshStandardMaterial({ color: '#B77F4A', roughness: 0.8 }),
  jelly: new THREE.MeshPhysicalMaterial({ color: '#7FEAD2', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.86, sheen: 0.5, sheenColor: new THREE.Color('#E6FFF8') }),
  feather: new THREE.MeshStandardMaterial({ color: '#C9D0FF', roughness: 0.8, side: THREE.DoubleSide }),
  featherGold: new THREE.MeshStandardMaterial({ color: '#F2CB7A', roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide, emissive: '#6a4a10', emissiveIntensity: 0.25 }),
  rachis: new THREE.MeshStandardMaterial({ color: '#F6F6F3', roughness: 0.6 }),
  puddle: new THREE.MeshPhysicalMaterial({ color: '#B9C8E8', roughness: 0.04, metalness: 0.25, clearcoat: 1, transparent: true, opacity: 0.72, depthWrite: false }),
  ripple: new THREE.MeshBasicMaterial({ color: '#E8F0FF', transparent: true, opacity: 0.0, depthWrite: false }),
  snow: new THREE.MeshStandardMaterial({ color: '#F4F7FB', roughness: 0.95 }),
  print: new THREE.MeshBasicMaterial({ color: '#AEB9CC', transparent: true, opacity: 0.0, depthWrite: false }),
  soil: new THREE.MeshStandardMaterial({ color: '#7A5A44', roughness: 1 }),
  sprout: new THREE.MeshStandardMaterial({ color: '#7CCB8F', roughness: 0.7 }),
  stone: new THREE.MeshStandardMaterial({ color: '#D8D4CC', roughness: 0.7 }),
  stripe: new THREE.MeshStandardMaterial({ color: '#9C978E', roughness: 0.7 }),
  shell: new THREE.MeshPhysicalMaterial({ color: '#F6E4D8', roughness: 0.35, clearcoat: 0.8, sheen: 1, sheenColor: new THREE.Color('#FFD9EC') }),
  crystalMint: new THREE.MeshStandardMaterial({ color: '#BFF5E6', emissive: '#6EE5CA', emissiveIntensity: 0.6, roughness: 0.15, transparent: true, opacity: 0.92 }),
  crystalDusk: new THREE.MeshStandardMaterial({ color: '#D9C2FF', emissive: '#9EA8FF', emissiveIntensity: 0.7, roughness: 0.15, transparent: true, opacity: 0.92 }),
  seed: new THREE.MeshStandardMaterial({ color: '#8C6A4A', roughness: 0.6 }),
  acorn: new THREE.MeshStandardMaterial({ color: '#B47A45', roughness: 0.55 }),
  acornHat: new THREE.MeshStandardMaterial({ color: '#6E4E33', roughness: 0.9 }),
  ladyRed: new THREE.MeshPhysicalMaterial({ color: '#E2483E', roughness: 0.25, clearcoat: 1 }),
  black: new THREE.MeshStandardMaterial({ color: '#15161B', roughness: 0.4 }),
  bird: new THREE.MeshPhysicalMaterial({ color: '#9EA8FF', roughness: 0.7, sheen: 1, sheenColor: new THREE.Color('#E8ECFF') }),
  birdBelly: new THREE.MeshPhysicalMaterial({ color: '#F6F6F3', roughness: 0.8, sheen: 1 }),
  beak: new THREE.MeshStandardMaterial({ color: '#E9AF6B', roughness: 0.5 }),
  blanket: new THREE.MeshPhysicalMaterial({ color: '#9EA8FF', roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#DDE2FF'), side: THREE.DoubleSide }),
  blanketTrim: new THREE.MeshStandardMaterial({ color: '#F6F6F3', roughness: 0.9 }),
  bowl: new THREE.MeshPhysicalMaterial({ color: '#F6F6F3', roughness: 0.25, clearcoat: 0.8 }),
  water: new THREE.MeshPhysicalMaterial({ color: '#8EC9FF', roughness: 0.05, transparent: true, opacity: 0.8, clearcoat: 1 }),
  brushHandle: new THREE.MeshStandardMaterial({ color: '#E9AF6B', roughness: 0.5 }),
  brushBristle: new THREE.MeshStandardMaterial({ color: '#F6F6F3', roughness: 0.9 }),
  glint: new THREE.SpriteMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.9, depthWrite: false }),
};

/** A soft glow texture for fireflies, glints and sparkles. */
let glowTex: THREE.Texture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  mat.glint.map = glowTex;
  return glowTex;
}

const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, s: [number, number, number] = [1, 1, 1], p: [number, number, number] = [0, 0, 0]) => {
  const o = new THREE.Mesh(geo, m);
  o.scale.set(...s);
  o.position.set(...p);
  return o;
};

/** The ball keeps the stage's own mesh (it already exists); this is for a second toy ball. */
export function ballView(r = 0.11) {
  return mesh(g.sphere, mat.rubber, [r, r, r]);
}

export function blockView(h: number, tone = 0) {
  const grp = new THREE.Group();
  const b = mesh(g.box, tone ? mat.woodDark : mat.wood, [h * 2, h * 2, h * 2]);
  // A carved star on the face reads as a toy block, not a crate.
  const star = mesh(new THREE.CircleGeometry(h * 0.55, 5), tone ? mat.wood : mat.woodDark, [1, 1, 1], [0, 0, h + 0.001]);
  grp.add(b, star);
  return grp;
}

/** Jelly: an icosphere whose vertices the soft-body skin moves every frame. */
export function jellyView(r: number) {
  const geo = new THREE.IcosahedronGeometry(r, 3);
  const m = new THREE.Mesh(geo, mat.jelly);
  const shine = mesh(g.lowSphere, new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.55 }), [r * 0.22, r * 0.12, r * 0.12], [-r * 0.35, r * 0.45, r * 0.6]);
  const grp = new THREE.Group();
  grp.add(m, shine);
  return { group: grp, geo, shine };
}

/** Unique positions of a geometry and their neighbours (for the skin springs). */
export function weld(geo: THREE.BufferGeometry): { rest: Float32Array; map: number[]; nbr: number[][] } {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const idx = new Map<string, number>();
  const map: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let u = idx.get(k);
    if (u === undefined) {
      u = rest.length / 3;
      idx.set(k, u);
      rest.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    map.push(u);
  }
  const nset: Set<number>[] = Array.from({ length: rest.length / 3 }, () => new Set());
  for (let i = 0; i < map.length; i += 3) {
    const [a, b, c] = [map[i]!, map[i + 1]!, map[i + 2]!];
    nset[a]!.add(b).add(c);
    nset[b]!.add(a).add(c);
    nset[c]!.add(a).add(b);
  }
  return { rest: new Float32Array(rest), map, nbr: nset.map((s) => [...s]) };
}

/** A feather: a lens-shaped vane with a pale rachis. */
export function featherView(gold = false) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.12);
  shape.quadraticCurveTo(0.05, -0.02, 0.012, 0.12);
  shape.quadraticCurveTo(-0.045, 0.0, 0, -0.12);
  const vane = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), gold ? mat.featherGold : mat.feather);
  const rachis = mesh(new THREE.CylinderGeometry(0.0025, 0.004, 0.25, 5), mat.rachis, [1, 1, 1], [0.004, 0, 0.001]);
  const grp = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(vane, rachis);
  inner.rotation.x = -Math.PI / 2;
  grp.add(inner);
  return grp;
}

/** A leaf for the instanced leaf layer. */
export function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.05);
  s.quadraticCurveTo(0.045, 0, 0, 0.06);
  s.quadraticCurveTo(-0.045, 0, 0, -0.05);
  const geo = new THREE.ShapeGeometry(s, 8);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function puddleView() {
  const grp = new THREE.Group();
  const surface = mesh(g.disc, mat.puddle.clone());
  surface.rotation.x = -Math.PI / 2;
  surface.scale.y = 0.62; // flattened by the camera's tilt anyway; keeps puddles oval like real ones
  surface.position.y = 0.006;
  surface.renderOrder = 2;
  grp.add(surface);
  const ripples: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = mesh(g.ring, mat.ripple.clone());
    r.rotation.x = -Math.PI / 2;
    r.position.y = 0.008;
    r.renderOrder = 3;
    grp.add(r);
    ripples.push(r);
  }
  return { group: grp, surface, ripples };
}

export function snowCap(r: number, h: number) {
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat.snow);
  cap.scale.set(1, h / r, 1);
  return cap;
}

export function footprint() {
  const m = mesh(g.disc, mat.print.clone(), [0.05, 0.07, 1]);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.007;
  return m;
}

export function plotView() {
  const grp = new THREE.Group();
  const soil = mesh(g.disc, mat.soil, [0.2, 0.2, 1]);
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.005;
  const sprout = new THREE.Group();
  const stem = mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.22, 6), mat.sprout, [1, 1, 1], [0, 0.11, 0]);
  const leafL = mesh(g.lowSphere, mat.sprout, [0.05, 0.012, 0.025], [-0.04, 0.16, 0]);
  const leafR = mesh(g.lowSphere, mat.sprout, [0.05, 0.012, 0.025], [0.04, 0.12, 0]);
  leafL.rotation.z = 0.5;
  leafR.rotation.z = -0.5;
  const bloom = new THREE.Group();
  const petalMat = new THREE.MeshPhysicalMaterial({ color: '#F6F6F3', roughness: 0.6, sheen: 1, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const p = mesh(g.lowSphere, petalMat, [0.045, 0.01, 0.022]);
    const a = (i / 6) * Math.PI * 2;
    p.position.set(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
    p.rotation.y = -a;
    bloom.add(p);
  }
  bloom.add(mesh(g.lowSphere, mat.beak, [0.025, 0.02, 0.025]));
  bloom.position.y = 0.23;
  sprout.add(stem, leafL, leafR, bloom);
  grp.add(soil, sprout);
  return { group: grp, sprout, bloom, petalMat };
}

/** Collectible finds, by kind. Small, legible at a glance, with a sparkle until picked up. */
export function itemView(kind: ItemKind, id: string) {
  const grp = new THREE.Group();
  switch (kind) {
    case 'pebble': {
      grp.add(mesh(g.sphere, mat.stone, [0.06, 0.035, 0.05], [0, 0.035, 0]));
      if (id.includes('striped')) grp.add(mesh(new THREE.TorusGeometry(0.052, 0.006, 6, 24), mat.stripe, [1, 0.7, 1], [0, 0.035, 0]));
      if (id.includes('heart')) grp.children[0]!.scale.set(0.065, 0.035, 0.055);
      break;
    }
    case 'shell': {
      const sh = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 24, 1, true), mat.shell);
      sh.rotation.z = Math.PI / 2;
      sh.position.y = 0.04;
      grp.add(sh, mesh(g.sphere, mat.shell, [0.05, 0.03, 0.05], [0.03, 0.03, 0]));
      break;
    }
    case 'seed':
      grp.add(mesh(g.sphere, mat.seed, [0.025, 0.035, 0.025], [0, 0.035, 0]));
      break;
    case 'feather':
      grp.add(featherView(id.includes('gold')));
      grp.children[0]!.position.y = 0.012;
      break;
    case 'leaf': {
      const l = new THREE.Mesh(leafGeometry(), new THREE.MeshStandardMaterial({ color: id.includes('heart') ? '#E46E8A' : '#E07A3C', roughness: 0.7, side: THREE.DoubleSide }));
      l.scale.setScalar(1.6);
      l.position.y = 0.01;
      grp.add(l);
      break;
    }
    case 'crystal': {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), id.includes('dusk') ? mat.crystalDusk : mat.crystalMint);
      c.scale.set(1, 1.6, 1);
      c.position.y = 0.08;
      grp.add(c);
      break;
    }
    case 'acorn':
      grp.add(mesh(g.sphere, mat.acorn, [0.035, 0.045, 0.035], [0, 0.045, 0]), mesh(g.sphere, mat.acornHat, [0.04, 0.02, 0.04], [0, 0.085, 0]));
      break;
  }
  glowTexture();
  const glint = new THREE.Sprite(mat.glint);
  glint.scale.setScalar(0.12);
  glint.position.y = 0.12;
  grp.add(glint);
  return { group: grp, glint };
}

export function berryView() {
  const m = new THREE.MeshPhysicalMaterial({ color: '#7CCB8F', roughness: 0.25, clearcoat: 1 });
  const b = mesh(g.sphere, m, [0.045, 0.045, 0.045]);
  const leaf = mesh(g.lowSphere, mat.sprout, [0.025, 0.006, 0.012], [0.012, 0.045, 0]);
  const grp = new THREE.Group();
  grp.add(b, leaf);
  return { group: grp, mat: m };
}

/** Ripeness 0 → green, 0.7 → amber, 1 → ruby; overripe darkens a touch. */
export function berryColor(r: number, out: THREE.Color) {
  const green = new THREE.Color('#8FD39A');
  const amber = new THREE.Color('#F2B35E');
  const ruby = new THREE.Color('#E0445F');
  if (r < 0.7) out.copy(green).lerp(amber, r / 0.7);
  else out.copy(amber).lerp(ruby, Math.min(1, (r - 0.7) / 0.3));
  if (r > 1.1) out.multiplyScalar(0.8);
  return out;
}

export function ladybugView() {
  const grp = new THREE.Group();
  const shell = mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat.ladyRed, [0.035, 0.028, 0.042]);
  const head = mesh(g.lowSphere, mat.black, [0.016, 0.014, 0.014], [0, 0.008, 0.042]);
  grp.add(shell, head);
  for (const [x, z] of [[0.015, 0.012], [-0.015, 0.012], [0.017, -0.014], [-0.017, -0.014], [0, -0.028]] as const) {
    grp.add(mesh(g.lowSphere, mat.black, [0.007, 0.004, 0.007], [x, 0.024, z]));
  }
  return grp;
}

export function butterflyView(color: string) {
  const grp = new THREE.Group();
  const wingMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.12 });
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.05, 0.06, 0.09, 0.03, 0.08, -0.01);
  shape.bezierCurveTo(0.075, -0.05, 0.03, -0.05, 0, 0);
  const wg = new THREE.ShapeGeometry(shape, 10);
  wg.rotateX(-Math.PI / 2);
  const L = new THREE.Mesh(wg, wingMat);
  const R = new THREE.Mesh(wg, wingMat);
  R.scale.x = -1;
  const body = mesh(g.lowSphere, mat.black, [0.008, 0.008, 0.03]);
  const lp = new THREE.Group();
  const rp = new THREE.Group();
  lp.add(L);
  rp.add(R);
  grp.add(lp, rp, body);
  return { group: grp, left: lp, right: rp };
}

export function birdView() {
  const grp = new THREE.Group();
  const body = mesh(g.sphere, mat.bird, [0.09, 0.08, 0.11], [0, 0.1, 0]);
  const belly = mesh(g.sphere, mat.birdBelly, [0.07, 0.06, 0.07], [0, 0.085, 0.04]);
  const head = mesh(g.sphere, mat.bird, [0.06, 0.06, 0.06], [0, 0.2, 0.07]);
  const beak = mesh(new THREE.ConeGeometry(0.018, 0.045, 10), mat.beak, [1, 1, 1], [0, 0.195, 0.14]);
  beak.rotation.x = Math.PI / 2;
  const eyeL = mesh(g.lowSphere, mat.black, [0.01, 0.012, 0.01], [-0.032, 0.215, 0.115]);
  const eyeR = mesh(g.lowSphere, mat.black, [0.01, 0.012, 0.01], [0.032, 0.215, 0.115]);
  const tail = mesh(g.box, mat.bird, [0.06, 0.012, 0.08], [0, 0.12, -0.13]);
  tail.rotation.x = -0.5;
  const wingL = mesh(g.sphere, mat.bird, [0.02, 0.05, 0.08], [-0.085, 0.11, -0.01]);
  const wingR = mesh(g.sphere, mat.bird, [0.02, 0.05, 0.08], [0.085, 0.11, -0.01]);
  grp.add(body, belly, head, beak, eyeL, eyeR, tail, wingL, wingR);
  return { group: grp, head, wingL, wingR };
}

export function blanketView() {
  const grp = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.5, 0.42, 16, 12);
  geo.rotateX(-Math.PI / 2);
  const cloth = new THREE.Mesh(geo, mat.blanket);
  const trim = mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 4), mat.blanketTrim);
  trim.visible = false;
  grp.add(cloth, trim);
  return { group: grp, cloth, geo };
}

export function bowlView() {
  const grp = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat.bowl);
  bowl.scale.y = 0.5;
  bowl.rotation.x = Math.PI;
  bowl.position.y = 0.055;
  bowl.material = mat.bowl.clone();
  (bowl.material as THREE.Material).side = THREE.DoubleSide;
  const water = mesh(g.disc, mat.water, [0.095, 0.095, 1], [0, 0.045, 0]);
  water.rotation.x = -Math.PI / 2;
  grp.add(bowl, water);
  return grp;
}

export function dropView() {
  return mesh(g.sphere, mat.water, [0.05, 0.06, 0.05]);
}

export function brushView() {
  const grp = new THREE.Group();
  grp.add(mesh(g.box, mat.brushHandle, [0.05, 0.03, 0.16], [0, 0.03, 0]));
  for (let i = 0; i < 5; i++) grp.add(mesh(g.box, mat.brushBristle, [0.008, 0.03, 0.12], [-0.02 + i * 0.01, 0.0, 0]));
  return grp;
}

export function rainbowView() {
  const geo = new THREE.TorusGeometry(4.2, 0.22, 8, 96, Math.PI);
  const colors: number[] = [];
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    const t = Math.max(0, Math.min(1, (r - 3.98) / 0.44));
    c.setHSL(0.78 * (1 - t), 0.75, 0.66);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  m.position.set(0.6, 0, -4);
  return m;
}

export function streakView() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.012), new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false, fog: false }));
  return m;
}
