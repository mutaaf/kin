// Living habitats: the world the KIN lives in. Original, procedural, alive, and lit by the real
// sky. One is mounted at a time; the stage's interaction decor (mushroom shelter, nest, glowing
// plant, ball) stays where the world track expects it, and each habitat dresses around it.
//
// ── Integration for app.ts ──────────────────────────────────────────────────────────────────
//   import { mountHabitat, habitatQuality } from './habitat';
//   // after `const stage = new Stage(...)`:
//   let habitat = mountHabitat(stage, localStorage-or-settings habitat id ?? 'sky-meadow', habitatQuality());
//   // wherever stage.setSky(sky) is called, right after it:
//   habitat.setSky(sky, palette(sky));            // palette is exported from './render/stage'
//   // in frame(), after director.update(...) (the backdrop follows the camera) and before render:
//   habitat.update(dt, t, stage);
//   // switching (shell habitat picker):
//   habitat.dispose(); habitat = mountHabitat(stage, id, habitatQuality()); habitat.setSky(sky, palette(sky));
//   // camera bounds: new CameraDirector(rig, { bounds: () => habitat.bounds, ... })
//   // the CSS sky behind the canvas is replaced by the habitat's own sky:
//   document.querySelector<HTMLElement>('#stage .sky')!.style.display = 'none';
//
// ── Integration for stage.ts (after the AR track merges) ────────────────────────────────────
//   Give Stage an explicit switch instead of mountHabitat()'s fallback search for the sparse base
//   (ground plane, moss disc, grass field):
//     setBaseVisible(on: boolean) { this.ground.visible = this.moss.visible = this.grass.visible = on; }
//   (keep references to those three meshes as fields in the constructor). Also, in AR mode the
//   habitat should be hidden (habitat.group.visible = habitat.backdrop.group.visible = false).
// ─────────────────────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { Habitat, type HabitatHost } from './base';
import type { Quality } from './kit';
import { SPECS } from './habitats';

export type { Anchors, Bounds, HabitatHost } from './base';
export { Habitat } from './base';

export type HabitatId = keyof typeof SPECS;

export interface HabitatCard {
  id: string;
  name: string;
  blurb: string;
  /** 'built' habitats can be visited; others are honestly marked as not built yet. */
  status: 'built' | 'soon';
  /** Bond level needed (built ones only). */
  level: number;
  /** CSS gradient for the picker card (no image assets). */
  art: string;
}

export const HABITATS: HabitatCard[] = [
  { id: 'sky-meadow', name: 'Sky Meadow', blurb: 'A floating garden above a sea of cloud', status: 'built', level: 1, art: 'linear-gradient(160deg,#ffd9a8 0%,#9fb4ff 45%,#6fae78 100%)' },
  { id: 'forest-grove', name: 'Forest Grove', blurb: 'Old trees, ferns and glowing mushrooms', status: 'built', level: 2, art: 'linear-gradient(160deg,#d8f0c0 0%,#4f8d55 55%,#26402c 100%)' },
  { id: 'crystal-cave', name: 'Crystal Cave', blurb: 'A grotto of light and a luminous pool', status: 'built', level: 3, art: 'linear-gradient(160deg,#b58cff 0%,#3e3850 55%,#62d9ff 100%)' },
  { id: 'ocean-reef', name: 'Ocean Reef', blurb: 'Underwater wonder', status: 'soon', level: 0, art: 'linear-gradient(160deg,#7fe3ff,#1f6f9a)' },
  { id: 'snow-peaks', name: 'Snow Peaks', blurb: 'High, cold and bright', status: 'soon', level: 0, art: 'linear-gradient(160deg,#ffffff,#9fb4d8)' },
  { id: 'desert-dunes', name: 'Desert Dunes', blurb: 'Warm sand and long shadows', status: 'soon', level: 0, art: 'linear-gradient(160deg,#ffd29a,#c9874f)' },
  { id: 'cosmic-garden', name: 'Cosmic Garden', blurb: 'A garden among the stars', status: 'soon', level: 0, art: 'linear-gradient(160deg,#5b3ea8,#0b0d12)' },
];

/** A quality tier from the device: phones get the light ladder rung. */
export function habitatQuality(): Quality {
  const small = Math.min(innerWidth, innerHeight) < 600;
  const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 4;
  if (small) return cores >= 6 ? 1 : 0;
  return cores >= 8 ? 2 : 1;
}

/**
 * Hide the stage's sparse built-in ground (a flat plane, a moss disc and a grass field) so the
 * habitat's island replaces it. Interim: identifies them structurally until Stage exposes
 * setBaseVisible() (see the stage.ts note above).
 */
export function setStageBase(host: HabitatHost & { setBaseVisible?: (on: boolean) => void }, on: boolean) {
  if (host.setBaseVisible) return host.setBaseVisible(on);
  for (const o of host.world.children) {
    const m = o as THREE.Mesh;
    const p = (m.geometry as THREE.BufferGeometry & { parameters?: { width?: number; radius?: number } })?.parameters;
    const isGround = m.geometry instanceof THREE.PlaneGeometry && (p?.width ?? 0) >= 80;
    const isMoss = m.geometry instanceof THREE.CircleGeometry && Math.abs((p?.radius ?? 0) - 2.6) < 0.01;
    const isGrass = (m as unknown as THREE.InstancedMesh).isInstancedMesh && (m as unknown as THREE.InstancedMesh).count >= 2000;
    if (isGround || isMoss || isGrass) m.visible = on;
  }
}

export function mountHabitat(host: HabitatHost, id: string, q: Quality = habitatQuality()): Habitat {
  const spec = SPECS[(id in SPECS ? id : 'sky-meadow') as HabitatId];
  const h = new Habitat(spec, q);
  host.world.add(h.group);
  host.scene.add(h.backdrop.group);
  setStageBase(host, false);
  // Aerial perspective, not a wall: the habitat is deeper than the stage's old diorama, so push the
  // fog back (the far world is the backdrop, which ignores fog). Restored on dispose.
  const fog = host.scene.fog as THREE.Fog | null;
  h.fog = fog;
  const was = fog ? [fog.near, fog.far] : null;
  if (fog) [fog.near, fog.far] = [25, 42];
  const dispose = h.dispose.bind(h);
  h.dispose = () => {
    if (fog && was) [fog.near, fog.far] = was as [number, number];
    setStageBase(host, true);
    dispose();
  };
  return h;
}
