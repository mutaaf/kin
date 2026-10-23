// The shared shape of a habitat: a floating island (the playable ground, dead flat where the
// KIN and the toys live), a living layer (grass, flowers, glowing spores, per-habitat props),
// and a far-world backdrop. Every habitat reacts to the real sky through setSky().

import * as THREE from 'three';
import type { Sky } from '../env/sky';
import type { Palette } from '../render/stage';
import { DECOR } from '../render/stage';
import { rng, type Rng } from '../core/rng';
import { Backdrop, type BackdropOpts } from './backdrop';
import { flowers, grass, island, makeUniforms, puff, type Quality, type Uniforms } from './kit';

export interface Anchors {
  nest: THREE.Vector3;
  shelter: THREE.Vector3;
  plant: THREE.Vector3;
  sunny: THREE.Vector3;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** What a habitat needs from the stage (Stage satisfies this structurally). */
export interface HabitatHost {
  scene: THREE.Scene;
  world: THREE.Group;
  camera: THREE.Camera;
  w: number;
  h: number;
  px: number;
}

export interface HabitatSpec {
  id: string;
  seed: number;
  top: string;
  rock: string;
  grassTint: string;
  flowerHues: number[];
  backdrop: Omit<BackdropOpts, 'u' | 'seed'>;
  /** Extra props and living things for this habitat. Return per-frame updaters. */
  build: (ctx: BuildCtx) => ((dt: number, t: number) => void) | void;
  /** Called on every sky change, after the base reacted. */
  onSky?: (s: Sky, p: Palette) => void;
  spores?: { color: string; count: number };
  /** Enclosed places stay lit by their own glow whatever the hour (0..1). */
  minNight?: number;
  /** Enclosed places own their fog colour instead of the outdoor horizon. */
  fogColor?: string;
}

export interface BuildCtx {
  group: THREE.Group;
  q: Quality;
  u: Uniforms;
  r: Rng;
  heightAt: (x: number, z: number) => number;
  inside: (x: number, z: number, margin?: number) => boolean;
  /** True where props must not go: the play band and the stage's interaction anchors. */
  reserved: (x: number, z: number, pad?: number) => boolean;
  lights: THREE.Light[];
}

// The world track's objects live in this band (blocks, plots, ball, puddles) and the stage's
// decor sits at DECOR: props must keep clear of both.
const PLAY = { x: 3.0, z0: -1.35, z1: 1.7 };
const KEEP = [DECOR.mushroom, DECOR.nest, DECOR.plant].map((d) => ({ x: d.x, z: d.z, r: 0.85 }));

export class Habitat {
  readonly group = new THREE.Group();
  readonly backdrop: Backdrop;
  readonly anchors: Anchors;
  readonly bounds: Bounds = { minX: -2.6, maxX: 2.6, minZ: -1.2, maxZ: 1.4 };
  readonly heightAt: (x: number, z: number) => number;
  readonly u = makeUniforms();
  private grassMat: THREE.MeshStandardMaterial;
  private islandMat: THREE.MeshStandardMaterial;
  private tick: ((dt: number, t: number) => void) | void;
  private lights: THREE.Light[] = [];
  private spores: THREE.Points | null = null;
  private base: { top: THREE.Color; grass: THREE.Color };

  constructor(readonly spec: HabitatSpec, readonly q: Quality) {
    const r = rng(spec.seed);
    const top = new THREE.Color(spec.top);
    const isl = island({ rx: 9.5, rz: 7.2, seed: spec.seed, top, rock: new THREE.Color(spec.rock), backRise: 0.28, depth: 4.2, flatX: 3.4, flatZ: [-1.6, 2.0], rough: 0.35 });
    this.islandMat = isl.mesh.material as THREE.MeshStandardMaterial;
    this.group.add(isl.mesh);
    this.heightAt = isl.heightAt;
    const reserved = (x: number, z: number, pad = 0) =>
      (Math.abs(x) < PLAY.x + pad && z > PLAY.z0 - pad && z < PLAY.z1 + pad) || KEEP.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + pad);

    const counts = [2600, 4600, 7600][this.q]!;
    const g = grass({
      count: counts, seed: spec.seed + 1, tint: new THREE.Color(spec.grassTint), u: this.u, y: isl.heightAt, height: 0.1,
      place: (rr) => {
        const x = (rr() - 0.5) * 18;
        const z = -7 + rr() * 14;
        if (!isl.inside(x, z, 0.93)) return null;
        // Short and sparse where the KIN walks; lush toward the edges.
        const play = Math.abs(x) < PLAY.x && z > PLAY.z0 && z < PLAY.z1;
        if (play && rr() < 0.55) return null;
        return { x, z, s: play ? 0.5 : 0.85 + rr() * 0.45 };
      },
    });
    this.grassMat = g.mat;
    this.group.add(g.mesh);

    this.group.add(
      flowers({
        count: [90, 170, 280][this.q]!, seed: spec.seed + 2, hues: spec.flowerHues, u: this.u, y: isl.heightAt,
        place: (rr) => {
          const x = (rr() - 0.5) * 17;
          const z = -6.5 + rr() * 13;
          return isl.inside(x, z, 0.9) && !reserved(x, z, 0.2) ? { x, z } : null;
        },
      }),
    );

    this.tick = spec.build({ group: this.group, q: this.q, u: this.u, r, heightAt: isl.heightAt, inside: isl.inside, reserved, lights: this.lights });

    // Glowing spores: drift over the garden; brighter at night.
    if (spec.spores) {
      const n = spec.spores.count * (this.q + 1);
      const p: number[] = [];
      for (let i = 0; i < n; i++) p.push((r() - 0.5) * 14, 0.1 + r() * 2.2, -5 + r() * 8);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      this.spores = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ map: puff(), color: spec.spores.color, size: 0.09, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }),
      );
      this.group.add(this.spores);
    }

    this.backdrop = new Backdrop({ ...spec.backdrop, seed: spec.seed + 3, u: this.u });
    this.base = { top, grass: new THREE.Color(spec.grassTint) };
    this.anchors = {
      nest: new THREE.Vector3(DECOR.nest.x, 0, DECOR.nest.z),
      shelter: new THREE.Vector3(DECOR.mushroom.x + 0.15, 0, DECOR.mushroom.z + 0.3),
      plant: new THREE.Vector3(DECOR.plant.x, 0, DECOR.plant.z),
      sunny: new THREE.Vector3(0.35, 0, 0.55),
    };
  }

  /** Set by mountHabitat: the scene's fog, for habitats that own their fog colour. */
  fog: THREE.Fog | null = null;

  setSky(s: Sky, p: Palette) {
    if (this.spec.fogColor && this.fog) this.fog.color.set(this.spec.fogColor);
    const night = Math.max(p.night, this.spec.minNight ?? 0);
    this.u.uNight.value = night;
    const wind = Math.min(1, s.windKmh / 45);
    const dir = THREE.MathUtils.degToRad(s.windDir + 180);
    this.u.uWind.value.set(Math.sin(dir) * wind * 0.5, -Math.cos(dir) * wind * 0.2);
    // Light does most of the day/night work; tints only carry snow and the hour's warmth.
    const snow = s.snow && s.precipMm > 0.1 ? 1 : 0;
    const warm = new THREE.Color(p.horizon);
    this.islandMat.color.set('#ffffff').lerp(warm, 0.08).lerp(new THREE.Color('#ffffff').multiplyScalar(1.25), snow * 0.7);
    this.grassMat.color.copy(this.base.grass).lerp(warm, 0.06).lerp(new THREE.Color('#e9eef6'), snow * 0.6);
    if (this.spores) (this.spores.material as THREE.PointsMaterial).opacity = 0.15 + night * 0.75;
    for (const l of this.lights) l.intensity = (l.userData.base as number) * (0.15 + night * 1.2);
    this.backdrop.setSky(s, p);
    this.spec.onSky?.(s, p);
  }

  update(dt: number, t: number, host: HabitatHost) {
    this.u.uTime.value = t;
    if (this.spores) {
      const a = this.spores.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        const y = a.getY(i) + Math.sin(t * 0.7 + i) * dt * 0.06;
        a.setY(i, y);
        a.setX(i, a.getX(i) + Math.sin(t * 0.3 + i * 1.7) * dt * 0.05 + this.u.uWind.value.x * dt * 0.3);
        if (a.getX(i) > 7) a.setX(i, -7);
        if (a.getX(i) < -7) a.setX(i, 7);
      }
      a.needsUpdate = true;
    }
    this.tick?.(dt, t);
    this.backdrop.update(host.camera, dt, t, host);
  }

  dispose() {
    for (const root of [this.group, this.backdrop.group]) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const x of mats) x.dispose();
      });
      root.removeFromParent();
    }
  }
}
