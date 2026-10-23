// Three original habitats. Each keeps the stage's interaction anchors (mushroom shelter, nest,
// glowing plant, the sunny spot) and the world track's play band clear, and dresses everything
// around them so no part of the frame is empty.

import * as THREE from 'three';
import { crystals, pond, puff, tree } from './kit';
import type { BuildCtx, HabitatSpec } from './base';

// ── Sky Meadow: a floating-island garden above a sea of cloud ─────────────────────────────────
function den(ctx: BuildCtx, at: THREE.Vector3) {
  // A cozy nook: a rounded mossy dome with an arched doorway, a warm glow inside and a lantern.
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 20, Math.PI * 0.18, Math.PI * 1.64, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#7fa88a', roughness: 0.95, side: THREE.DoubleSide }),
  );
  shell.rotation.y = Math.PI * 0.5;
  shell.scale.set(0.9, 0.85, 0.9);
  const inside = new THREE.Mesh(new THREE.CircleGeometry(0.86, 32), new THREE.MeshBasicMaterial({ color: '#ffcf8a' }));
  inside.rotation.x = -Math.PI / 2;
  inside.position.y = 0.02;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff('rgba(255,200,130,1)', 'rgba(255,170,90,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
  glow.scale.setScalar(1.6);
  glow.position.set(0, 0.45, 0.25);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 10, 30, Math.PI), new THREE.MeshStandardMaterial({ color: '#c9a57a', roughness: 0.8 }));
  arch.position.set(0, 0.0, 0.86);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10), new THREE.MeshStandardMaterial({ color: '#fff1d0', emissive: '#ffbf6a', emissiveIntensity: 1.6 }));
  lantern.position.set(0.55, 0.62, 0.8);
  const light = new THREE.PointLight('#ffb766', 1.2, 4.5, 1.8);
  light.userData.base = 1.4;
  light.position.set(0, 0.6, 0.9);
  ctx.lights.push(light);
  g.add(shell, inside, glow, arch, lantern, light);
  g.position.copy(at).setY(ctx.heightAt(at.x, at.z));
  g.rotation.y = 0.35;
  ctx.group.add(g);
  return (t: number) => {
    (glow.material as THREE.SpriteMaterial).opacity = 0.35 + ctx.u.uNight.value * 0.55 + Math.sin(t * 2.3) * 0.03;
  };
}

function stones(ctx: BuildCtx, n: number, area: (r: () => number) => [number, number]) {
  const mat = new THREE.MeshStandardMaterial({ color: '#d9d2c6', roughness: 0.85 });
  const geo = new THREE.DodecahedronGeometry(1, 1);
  const m = new THREE.InstancedMesh(geo, mat, n);
  const mm = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < n * 4 && k < n; i++) {
    const [x, z] = area(ctx.r);
    if (!ctx.inside(x, z, 0.9) || ctx.reserved(x, z, 0.1)) continue;
    const s = 0.06 + ctx.r() * 0.16;
    mm.compose(new THREE.Vector3(x, ctx.heightAt(x, z) + s * 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(ctx.r(), ctx.r() * 6, ctx.r())), new THREE.Vector3(s * 1.3, s * 0.6, s));
    m.setMatrixAt(k++, mm);
  }
  m.count = k;
  ctx.group.add(m);
}

function bushes(ctx: BuildCtx, n: number, color: string) {
  // Soft, clustered shrubs at the garden's edges and back (never in front of the KIN).
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const m = new THREE.InstancedMesh(geo, mat, n * 5);
  const mm = new THREE.Matrix4();
  const c = new THREE.Color();
  const base = new THREE.Color(color);
  let k = 0;
  for (let i = 0; i < n * 8 && k < n * 5; i++) {
    const x = (ctx.r() - 0.5) * 17;
    const z = -6.6 + ctx.r() * 7.4;
    // Frame the view at the sides; keep the horizon behind the KIN open to the sky.
    if (!ctx.inside(x, z, 0.9) || ctx.reserved(x, z, 0.6) || Math.abs(x) < (z > -1.6 ? 4.2 : 2.6)) continue;
    const s = 0.2 + ctx.r() * 0.28;
    for (let b = 0; b < 5 && k < n * 5; b++) {
      const ox = (ctx.r() - 0.5) * s * 1.4;
      const oz = (ctx.r() - 0.5) * s;
      const ss = s * (0.45 + ctx.r() * 0.45);
      mm.compose(new THREE.Vector3(x + ox, ctx.heightAt(x, z) + ss * 0.6 + (b ? ctx.r() * s * 0.4 : 0), z + oz), new THREE.Quaternion(), new THREE.Vector3(ss, ss * 0.85, ss));
      m.setMatrixAt(k, mm);
      m.setColorAt(k, c.copy(base).offsetHSL((ctx.r() - 0.5) * 0.03, 0, (ctx.r() - 0.5) * 0.12 + (b ? 0.04 : -0.03)));
      k++;
    }
  }
  m.count = k;
  ctx.group.add(m);
}

export const SKY_MEADOW: HabitatSpec = {
  id: 'sky-meadow',
  seed: 4101,
  top: '#8fca8a',
  rock: '#a48a76',
  grassTint: '#9bd38f',
  flowerHues: [330, 42, 198, 275, 12, 55],
  backdrop: { kind: 'open', islands: 5, ridges: [{ hue: 222, sat: 0.25, light: 0.62, count: 9, jag: 0.12 }] },
  spores: { color: '#ffe9b0', count: 40 },
  build(ctx) {
    const fns: ((t: number) => void)[] = [];
    // Composed for a portrait phone frame: the hero props sit just behind the play band, so the
    // low camera stacks them around the KIN's head (den left, crystals, pond right).
    fns.push(den(ctx, new THREE.Vector3(-2.3, 0, -3.5)));
    const pd = pond({ at: new THREE.Vector3(1.55, ctx.heightAt(1.55, -2.85), -2.85), rx: 1.05, rz: 0.5, u: ctx.u });
    ctx.group.add(pd.group);
    ctx.group.add(crystals({ at: new THREE.Vector3(-0.85, ctx.heightAt(-0.85, -2.45), -2.45), count: 7, hue: 172, scale: 0.12, u: ctx.u, seed: 11 }));
    ctx.group.add(crystals({ at: new THREE.Vector3(2.85, ctx.heightAt(2.85, -2.15), -2.15), count: 5, hue: 205, scale: 0.1, u: ctx.u, seed: 12 }));
    ctx.group.add(crystals({ at: new THREE.Vector3(-3.7, ctx.heightAt(-3.7, -1.9), -1.9), count: 4, hue: 285, scale: 0.09, u: ctx.u, seed: 13 }));
    stones(ctx, [14, 24, 34][ctx.q]!, (r) => [(r() - 0.5) * 16, -6 + r() * 12]);
    bushes(ctx, [8, 14, 20][ctx.q]!, '#6fae78');
    // Trees frame the sky at the back corners, near enough to read on a phone.
    for (const [x, z, h] of [[-3.9, -4.4, 2.2], [-5.4, -3.4, 2.8], [3.6, -4.6, 2.5], [5.3, -3.2, 2.0]] as const) {
      const t = tree(ctx.r, { height: h, leaf: new THREE.Color().setHSL(0.34 + ctx.r() * 0.05, 0.42, 0.42), bark: new THREE.Color('#8a6a52') });
      t.position.set(x, ctx.heightAt(x, z), z);
      ctx.group.add(t);
    }
    return (_dt, t) => {
      for (const f of fns) f(t);
    };
  },
};

// ── Forest Grove: tall old trees, ferns, glowing mushrooms, shafts of light ───────────────────
export const FOREST_GROVE: HabitatSpec = {
  id: 'forest-grove',
  seed: 5207,
  top: '#5e9a62',
  rock: '#7b6650',
  grassTint: '#78b06e',
  flowerHues: [48, 18, 300, 190],
  backdrop: {
    kind: 'open',
    islands: 0,
    ridges: [
      { hue: 200, sat: 0.2, light: 0.55, count: 14, jag: 0.16 },
      { hue: 160, sat: 0.25, light: 0.38, count: 18, jag: 0.22 },
      { hue: 140, sat: 0.3, light: 0.26, count: 22, jag: 0.26 },
    ],
  },
  spores: { color: '#c8ffd9', count: 55 },
  build(ctx) {
    // A ring of tall trees around the back and sides.
    const ring: [number, number, number][] = [];
    for (let i = 0; i < [10, 14, 18][ctx.q]!; i++) {
      const a = Math.PI * (1.08 + (i / ([10, 14, 18][ctx.q]! - 1)) * 0.84);
      const rr = 5.6 + ctx.r() * 1.6;
      ring.push([Math.cos(a) * rr * 1.2, Math.sin(a) * rr * 0.8 - 0.4, 3.2 + ctx.r() * 2.4]);
    }
    for (const [x, z, h] of ring) {
      if (!ctx.inside(x, z, 0.95)) continue;
      const t = tree(ctx.r, { height: h, leaf: new THREE.Color().setHSL(0.3 + ctx.r() * 0.07, 0.45, 0.3 + ctx.r() * 0.08), bark: new THREE.Color('#5d4636') });
      t.position.set(x, ctx.heightAt(x, z), z);
      ctx.group.add(t);
    }
    // Ferns: fans of thin leaves.
    const frond = new THREE.ConeGeometry(0.028, 0.32, 4);
    frond.scale(1, 1, 0.35);
    frond.translate(0, 0.16, 0);
    frond.rotateX(0.9);
    const fm = new THREE.InstancedMesh(frond, new THREE.MeshStandardMaterial({ color: '#4f8d55', roughness: 0.8 }), 400);
    const mm = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < 300 && k < 390; i++) {
      const x = (ctx.r() - 0.5) * 16;
      const z = -6 + ctx.r() * 11;
      if (!ctx.inside(x, z, 0.9) || ctx.reserved(x, z, 0.35)) continue;
      for (let f = 0; f < 6 && k < 400; f++) {
        mm.compose(new THREE.Vector3(x, ctx.heightAt(x, z), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (f / 6) * 6.28 + ctx.r(), 0)), new THREE.Vector3(1, 0.8 + ctx.r() * 0.6, 1));
        fm.setMatrixAt(k++, mm);
      }
    }
    fm.count = k;
    ctx.group.add(fm);
    // A mossy fallen log.
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 3.2, 18), new THREE.MeshStandardMaterial({ color: '#6b5240', roughness: 0.95 }));
    log.rotation.set(0, 0.4, Math.PI / 2);
    log.position.set(-4.4, ctx.heightAt(-4.4, -2.6) + 0.26, -2.6);
    ctx.group.add(log);
    // Glowing mushrooms that light up at night.
    const capMat = new THREE.MeshStandardMaterial({ color: '#bff2ff', emissive: '#4fd1ff', emissiveIntensity: 0.2, roughness: 0.4 });
    const caps: THREE.Mesh[] = [];
    for (let i = 0; i < 14; i++) {
      const x = -4.9 + ctx.r() * 1.6;
      const z = -2.2 + ctx.r() * 0.8;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06 + ctx.r() * 0.05, 12, 8, 0, 6.28, 0, Math.PI / 2), capMat);
      m.position.set(x, ctx.heightAt(x, z) + 0.06, z);
      caps.push(m);
      ctx.group.add(m);
    }
    // Shafts of light through the canopy (daytime).
    const rayMat = new THREE.MeshBasicMaterial({ map: puff('rgba(255,244,210,0.9)', 'rgba(255,244,210,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.18, side: THREE.DoubleSide });
    const rays: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 6), rayMat);
      ray.position.set(-3 + i * 2 + ctx.r(), 2.6, -3 - ctx.r());
      ray.rotation.z = 0.35;
      rays.push(ray);
      ctx.group.add(ray);
    }
    return (_dt, t) => {
      capMat.emissiveIntensity = 0.15 + ctx.u.uNight.value * 1.6 + Math.sin(t * 1.5) * 0.05;
      rayMat.opacity = (1 - ctx.u.uNight.value) * (0.12 + Math.sin(t * 0.4) * 0.03);
    };
  },
};

// ── Crystal Cave: a glowing grotto of crystals and a luminous pool ─────────────────────────────
export const CRYSTAL_CAVE: HabitatSpec = {
  id: 'crystal-cave',
  seed: 6311,
  top: '#5a5370',
  rock: '#3e3850',
  grassTint: '#5f8f8a',
  flowerHues: [190, 280, 320],
  backdrop: { kind: 'cave', ridges: [{ hue: 258, sat: 0.2, light: 0.12, count: 12, jag: 0.3 }] },
  spores: { color: '#c9b6ff', count: 60 },
  minNight: 0.75,
  fogColor: '#1a1428',
  build(ctx) {
    // The back wall: a curved shell of rock enclosing the grotto.
    const wall = new THREE.Mesh(
      // three.js measures cylinder angles from +z: π/2 … 3π/2 is the half behind the garden.
      new THREE.CylinderGeometry(8.5, 9.5, 7, 48, 6, true, Math.PI * 0.42, Math.PI * 1.16),
      // Rock never takes the outdoor fog: a cave wall must stay dark and close.
      new THREE.MeshStandardMaterial({ color: '#241f33', roughness: 1, side: THREE.BackSide, fog: false }),
    );
    const pos = wall.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const j = 1 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.08;
      pos.setXYZ(i, pos.getX(i) * j, pos.getY(i), pos.getZ(i) * j);
    }
    wall.geometry.computeVertexNormals();
    wall.scale.set(1, 1, 0.75);
    wall.position.set(0, 3.2, 0.6);
    ctx.group.add(wall);
    // Crystal clusters in many hues along the wall and floor.
    const hues = [180, 200, 265, 290, 320, 160];
    for (let i = 0; i < [8, 12, 16][ctx.q]!; i++) {
      const a = Math.PI * (1.1 + ctx.r() * 0.8);
      const x = Math.cos(a) * (5.8 + ctx.r() * 1.5);
      const z = Math.sin(a) * (4.4 + ctx.r() * 0.8);
      if (ctx.reserved(x, z, 0.4)) continue;
      ctx.group.add(crystals({ at: new THREE.Vector3(x, ctx.heightAt(x, z), z), count: 4 + Math.floor(ctx.r() * 5), hue: hues[i % hues.length]!, scale: 0.12 + ctx.r() * 0.16, u: ctx.u, seed: 40 + i }));
    }
    // Stalagmites.
    const stal = new THREE.ConeGeometry(0.18, 1, 7);
    stal.translate(0, 0.5, 0);
    const sm = new THREE.InstancedMesh(stal, new THREE.MeshStandardMaterial({ color: '#4a4360', roughness: 0.9 }), 30);
    const mm = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < 120 && k < 30; i++) {
      const x = (ctx.r() - 0.5) * 16;
      const z = -6 + ctx.r() * 10;
      // Rising from the back and the sides only: never between the camera and the KIN.
      if (!ctx.inside(x, z, 0.9) || ctx.reserved(x, z, 0.5) || (z > -1.8 && Math.abs(x) < 4.5)) continue;
      const h = 0.35 + ctx.r() * 1.0;
      mm.compose(new THREE.Vector3(x, ctx.heightAt(x, z), z), new THREE.Quaternion(), new THREE.Vector3(0.6 + ctx.r() * 0.6, h, 0.6 + ctx.r() * 0.6));
      sm.setMatrixAt(k++, mm);
    }
    sm.count = k;
    ctx.group.add(sm);
    // A luminous pool.
    const pd = pond({ at: new THREE.Vector3(3.5, ctx.heightAt(3.5, -2.3), -2.3), rx: 1.3, rz: 0.7, u: ctx.u });
    (pd.uniforms.uDeep.value as THREE.Color).set('#1b4f6b');
    (pd.uniforms.uSky.value as THREE.Color).set('#5fe0ff');
    ctx.group.add(pd.group);
    const poolLight = new THREE.PointLight('#62d9ff', 1, 5, 1.6);
    poolLight.userData.base = 1.6;
    poolLight.position.set(3.5, 0.6, -2.2);
    const crystalLight = new THREE.PointLight('#b58cff', 1, 6, 1.6);
    crystalLight.userData.base = 1.8;
    crystalLight.position.set(-3.5, 1.2, -3);
    ctx.lights.push(poolLight, crystalLight);
    ctx.group.add(poolLight, crystalLight);
  },
};

export const SPECS = { 'sky-meadow': SKY_MEADOW, 'forest-grove': FOREST_GROVE, 'crystal-cave': CRYSTAL_CAVE } as const;
