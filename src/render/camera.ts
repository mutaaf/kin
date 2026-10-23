// KIN Spotlight: a cinematic camera director. The creature commands the frame: on a phone it
// fills most of the screen, framed slightly low; the camera follows with damped look-ahead,
// leans in for intimate moments (eating, petting), pulls back for throws, makes room for a
// guest, reveals the whole party, and breathes a little when nothing is happening.
//
// It drives the Stage's EXISTING orthographic camera (zoom, target, tilt), so `stage.toWorld`,
// `stage.toScreen`, picking and the crossing math keep working unchanged. A perspective camera is
// also supported through the same rig interface, for a future solo-mode perspective stage.
//
// ── Crossing contract (src/render/choreo.ts) ────────────────────────────────────────────────
// The seam math assumes the BASELINE view: zoom 1, target (0, baseY, 0), tilt 31°, so a world
// unit is exactly `stage.px` CSS px on both screens. Whenever another screen is present (any
// session peer) or a crossing/visit is in progress, call `setMode('crossing')`: the director
// eases to the baseline (≈0.7 s) and `atBaseline` turns true. Solo spotlight resumes with
// `setMode('spotlight')` once no peer remains. Hops read the camera at hop start, so entering
// 'crossing' as soon as a peer appears (not when the hop starts) keeps both screens consistent.
//
// ── Integration for app.ts ──────────────────────────────────────────────────────────────────
//   import { CameraDirector, orthoRig } from './render/camera';
//   // after `const view = new KinView(genome, stage);`
//   const director = new CameraDirector(orthoRig(stage), { reducedMotion: () => settings.reducedMotion });
//   director.follow(() => [{ pos: view.pos, height: view.height, size: genome.size }]);
//   // in frame(), AFTER stage.update(dt, t) / view.update(...) and BEFORE stage.render():
//   director.setMode(session.peers.size || guests.size || kin.placement.kind !== 'home' || embed ? 'crossing' : director.soloMode);
//   director.update(dt, t);
//   // moments (optional, any time):
//   world.world.listeners.add((e) => e.type === 'eaten' ? director.pulse('closeup', 2200) : e.type === 'thrown' ? director.pulse('wide', 2600) : undefined);
//   // petting: in the pointermove pet branch → director.pulse('closeup', 1500)
//   // guest hosting (two-shot):  director.follow(() => [me, ...guests.map(g => ({ pos: g.view.pos }))])
//   // Camera mode (shell): director.soloMode = 'portrait' while the photo UI is open, then 'spotlight'.
//
// ── Integration for stage.ts (after the AR track merges) ────────────────────────────────────
//   None required for the orthographic path. Two optional improvements:
//   1. In `frame()`, don't overwrite camera.position/lookAt when `this.directed` is true (the
//      director sets them every frame anyway; this only avoids a one-frame snap on resize).
//   2. `layoutSky()` places the CSS sun/horizon from toScreen at zoom 1; when a habitat with its
//      own sky dome is mounted (src/habitat), hide `.sky` (the dome replaces it).
// ─────────────────────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';

export type Shot = 'spotlight' | 'closeup' | 'wide' | 'party' | 'crossing' | 'portrait';

export interface Subject {
  pos: THREE.Vector3;
  /** Hop height above the ground (world units). */
  height?: number;
  /** Creature scale (genome.size), ~1. */
  size?: number;
}

/** What the director needs from the stage. */
export interface CameraRig {
  readonly camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  /** CSS size of the view and px per world unit at zoom 1. */
  viewport(): { w: number; h: number; px: number };
}

export interface View {
  target: THREE.Vector3;
  /** Visible height in world units (ortho: via zoom; perspective: via distance). */
  height: number;
  /** Degrees above horizontal the camera looks down. */
  tilt: number;
}

export const BASE_TILT = 31;
const DIST = 20;

/** The Stage's own framing at zoom 1 (mirrors Stage.frame): the crossing contract. */
export function baseline(vp: { w: number; h: number; px: number }): View {
  const hh = vp.h / 2 / vp.px;
  return { target: new THREE.Vector3(0, 0.55 + Math.max(0, hh - 3.2) * 0.35, 0), height: vp.h / vp.px, tilt: BASE_TILT };
}

/** Device class by the short side, so an unfolded or tablet screen frames more habitat. */
export function deviceClass(vp: { w: number; h: number }): 'phone' | 'tablet' | 'desktop' {
  const s = Math.min(vp.w, vp.h);
  if (s < 600) return 'phone';
  if (s < 1000) return 'tablet';
  return 'desktop';
}

/** How much world (in units of creature height) each shot shows on each device class. */
const FRAME: Record<Exclude<Shot, 'crossing' | 'party'>, Record<'phone' | 'tablet' | 'desktop', number>> = {
  spotlight: { phone: 3.5, tablet: 4.0, desktop: 4.5 },
  closeup: { phone: 2.4, tablet: 3.0, desktop: 3.8 },
  wide: { phone: 5.4, tablet: 6.6, desktop: 7.8 },
  portrait: { phone: 2.7, tablet: 3.3, desktop: 4.1 },
};
// Low angles put the horizon and sky in the upper third (the concept's composition); the
// orthographic camera never goes below 6° so screen→ground picking stays well-conditioned.
const TILT: Record<Exclude<Shot, 'crossing'>, number> = { spotlight: 9, closeup: 7.5, wide: 14, party: 20, portrait: 6.5 };

/**
 * Pure framing: where to look, how much to show, how steep. `vel` is the subjects' smoothed
 * velocity (world units/s), used for look-ahead so a walking KIN leads into open space.
 */
export function frameFor(shot: Shot, subjects: Subject[], vp: { w: number; h: number; px: number }, vel = new THREE.Vector3()): View {
  const base = baseline(vp);
  if (shot === 'crossing' || !subjects.length) return base;
  const dc = deviceClass(vp);
  const size = subjects[0]!.size ?? 1;
  // Head height, so the face (not the feet) sits on the upper third line.
  const centre = new THREE.Vector3();
  for (const s of subjects) centre.add(s.pos);
  centre.divideScalar(subjects.length);
  const lift = (subjects[0]!.height ?? 0) * 0.5;
  if (shot === 'party') {
    // Fit everyone: the spread plus a creature of margin, never tighter than a wide shot.
    let spread = 0;
    for (const s of subjects) spread = Math.max(spread, Math.abs(s.pos.x - centre.x) * 2, Math.abs(s.pos.z - centre.z) * 3);
    const height = Math.max(FRAME.wide[dc] * size, (spread + 2.2) * (vp.h / vp.w) * 1.05, spread + 2.2);
    return { target: new THREE.Vector3(centre.x, 0.45 + lift, centre.z), height: Math.min(height, base.height), tilt: TILT.party };
  }
  let height = FRAME[shot][dc] * size;
  // A second subject (a guest, the ball) widens the frame to keep both in shot.
  if (subjects.length > 1) {
    let d = 0;
    for (const s of subjects) d = Math.max(d, s.pos.distanceTo(subjects[0]!.pos));
    height = Math.max(height, (d + 1.6) * Math.max(1, vp.h / vp.w) * 0.9);
  }
  height = Math.min(height, base.height);
  const lookAhead = vel.clone().setY(0).multiplyScalar(shot === 'closeup' || shot === 'portrait' ? 0.12 : 0.35);
  lookAhead.clampLength(0, height * 0.18);
  // Compose a touch low: the creature's face sits slightly above centre.
  const faceY = (shot === 'closeup' ? 0.5 : shot === 'portrait' ? 0.48 : 0.42) * size + lift;
  const target = centre.clone().add(lookAhead).setY(faceY);
  if (shot === 'portrait') target.x += height * 0.06; // rule of thirds, a little off-centre
  return { target, height, tilt: TILT[shot] };
}

/** Critically damped spring toward a target (stable at any dt). Returns [value, velocity]. */
export function spring(x: number, v: number, to: number, omega: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const nx = det * (f * x + dt * v + hhoo * to);
  const nv = det * (v + hoo * (to - x));
  return [nx, nv];
}

/** A rig for the Stage's orthographic camera (no Stage changes needed). */
export function orthoRig(stage: { camera: THREE.OrthographicCamera; w: number; h: number; px: number }): CameraRig {
  return { camera: stage.camera, viewport: () => ({ w: stage.w, h: stage.h, px: stage.px || 118 }) };
}

export interface DirectorOptions {
  reducedMotion?: () => boolean;
  /** Keep the camera's target inside the habitat (world units). */
  bounds?: () => { minX: number; maxX: number; minZ: number; maxZ: number } | null;
}

export class CameraDirector {
  /** What the camera does when it's just you and your KIN. */
  soloMode: Shot = 'spotlight';
  private mode: Shot = 'spotlight';
  private pulseShot: Shot | null = null;
  private pulseUntil = 0;
  private subjects: () => Subject[] = () => [];
  // Spring state
  private tx = 0;
  private ty = 0.5;
  private tz = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private hgt = 0;
  private vh = 0;
  private tilt = BASE_TILT;
  private vt = 0;
  private vel = new THREE.Vector3();
  private last = new THREE.Vector3();
  private started = false;
  /** True once the view has settled on the crossing baseline. */
  atBaseline = true;
  /** Called when the director cuts instead of moving (reduced motion): the shell may fade. */
  onCut: (() => void) | null = null;

  constructor(private rig: CameraRig, private opts: DirectorOptions = {}) {}

  follow(subjects: () => Subject[]) {
    this.subjects = subjects;
  }

  get current(): Shot {
    return this.pulseShot && performance.now() < this.pulseUntil ? this.pulseShot : this.mode;
  }

  setMode(m: Shot) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'crossing') this.pulseShot = null;
    if (this.opts.reducedMotion?.()) this.snap();
  }

  /** A temporary reframe for a moment (eating → closeup, throw → wide). Ignored while crossing. */
  pulse(shot: Shot, ms: number) {
    if (this.mode === 'crossing' || this.mode === 'portrait') return;
    this.pulseShot = shot;
    this.pulseUntil = performance.now() + ms;
  }

  private goal(dt: number): View {
    const vp = this.rig.viewport();
    const subs = this.subjects();
    // Smoothed subject velocity for look-ahead.
    if (subs[0]) {
      const p = subs[0].pos;
      if (this.started && dt > 0) {
        const inst = p.clone().sub(this.last).divideScalar(dt);
        if (inst.length() < 12) this.vel.lerp(inst, Math.min(1, dt * 3));
      }
      this.last.copy(p);
    }
    const v = frameFor(this.current, subs, vp, this.vel);
    const b = this.opts.bounds?.();
    if (b && this.current !== 'crossing') {
      v.target.x = THREE.MathUtils.clamp(v.target.x, b.minX, b.maxX);
      v.target.z = THREE.MathUtils.clamp(v.target.z, b.minZ, b.maxZ);
    }
    return v;
  }

  /** Jump straight to the goal (first frame, reduced motion, resize). */
  snap() {
    const g = this.goal(0);
    [this.tx, this.ty, this.tz, this.hgt, this.tilt] = [g.target.x, g.target.y, g.target.z, g.height, g.tilt];
    this.vx = this.vy = this.vz = this.vh = this.vt = 0;
    this.started = true;
    this.onCut?.();
    this.apply(0);
  }

  update(dt: number, t: number) {
    if (!this.started) return this.snap();
    const g = this.goal(dt);
    const reduced = !!this.opts.reducedMotion?.();
    if (reduced) {
      // No camera moves: cut when the framing changes meaningfully, otherwise hold still.
      const far = Math.abs(g.height - this.hgt) > this.hgt * 0.25 || Math.hypot(g.target.x - this.tx, g.target.z - this.tz) > this.hgt * 0.3;
      if (far) this.snap();
      else this.apply(t, false);
      return;
    }
    // Crossing eases faster so the baseline is reached before any hop can start.
    const w = this.current === 'crossing' ? 7 : this.current === 'closeup' ? 3.2 : 2.4;
    [this.tx, this.vx] = spring(this.tx, this.vx, g.target.x, w, dt);
    [this.ty, this.vy] = spring(this.ty, this.vy, g.target.y, w, dt);
    [this.tz, this.vz] = spring(this.tz, this.vz, g.target.z, w, dt);
    [this.hgt, this.vh] = spring(this.hgt, this.vh, g.height, w * 0.8, dt);
    [this.tilt, this.vt] = spring(this.tilt, this.vt, g.tilt, w * 0.8, dt);
    this.apply(t);
  }

  private apply(t: number, breathe = true) {
    const cam = this.rig.camera;
    const vp = this.rig.viewport();
    const crossing = this.current === 'crossing';
    // Idle breathing: a slow, tiny drift so a still frame never looks frozen (never while crossing).
    const b = breathe && !crossing ? 1 : 0;
    const dx = b * Math.sin(t * 0.21) * 0.018 * this.hgt;
    const dy = b * Math.sin(t * 0.17 + 1.3) * 0.01 * this.hgt;
    const tilt = THREE.MathUtils.degToRad(this.tilt + b * Math.sin(t * 0.13) * 0.35);
    const target = new THREE.Vector3(this.tx + dx, this.ty + dy, this.tz);
    const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const oc = cam as THREE.OrthographicCamera;
      oc.position.copy(target).addScaledVector(dir, DIST);
      oc.lookAt(target);
      oc.zoom = Math.max(1, vp.h / vp.px / Math.max(0.5, this.hgt));
      oc.updateProjectionMatrix();
    } else {
      const pc = cam as THREE.PerspectiveCamera;
      const dist = this.hgt / 2 / Math.tan(THREE.MathUtils.degToRad(pc.fov) / 2);
      pc.position.copy(target).addScaledVector(dir, dist);
      pc.lookAt(target);
      pc.updateProjectionMatrix();
    }
    const base = baseline(vp);
    this.atBaseline =
      crossing && Math.abs(this.hgt - base.height) < 0.02 && Math.hypot(this.tx - base.target.x, this.ty - base.target.y, this.tz) < 0.01 && Math.abs(this.tilt - BASE_TILT) < 0.1;
    // Exactly the contract once settled: no residual spring drift on the seam.
    if (this.atBaseline && (cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const oc = cam as THREE.OrthographicCamera;
      const d0 = THREE.MathUtils.degToRad(BASE_TILT);
      oc.position.copy(base.target).add(new THREE.Vector3(0, Math.sin(d0) * DIST, Math.cos(d0) * DIST));
      oc.lookAt(base.target);
      oc.zoom = 1;
      oc.updateProjectionMatrix();
    }
  }
}
