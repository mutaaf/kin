// Rigid-body physics: Rapier 3D (WASM), loaded as a lazy chunk after first paint. A fixed 60 Hz
// step decoupled from rendering (accumulator, at most 4 substeps a frame), sleeping bodies for
// battery, and materials with their own density, friction and bounce.
//
// The KIN is a real character in this world (docs/REALISM.md): a kinematic capsule moved by
// Rapier's character controller. Its walking is filtered through moveKin(), so it slides along
// the mushroom and the plant instead of passing through them, steps up small ledges, and shoves
// light toys with impulses scaled by its mass (heavy things barely budge and stop it).
//
// The ground is queried, never assumed: groundAt()/raycastDown() cast against everything solid
// (the lawn, scenery, resting toys, and any AR surfaces given to setEnvironment()), so feet plant
// on a wooden block, the nest rim or a real table through the same code.
//
// Lessons carried over from COLD GAS (docs/LESSONS.md there): put resting props down a few mm
// above the ground so they spawn asleep; "touching" is impulse > 0 OR within a centimetre.

import type * as R from '@dimforge/rapier3d-compat';
import type { ArEnvironment } from './env';
import type { V3 } from './matter';

export type Material = 'rubber' | 'wood' | 'jelly' | 'berry' | 'stone' | 'shell';

export const MATERIALS: Record<Material, { density: number; friction: number; restitution: number; linDamp: number; angDamp: number }> = {
  rubber: { density: 0.55, friction: 0.75, restitution: 0.72, linDamp: 0.25, angDamp: 0.35 },
  wood: { density: 2.2, friction: 0.9, restitution: 0.12, linDamp: 0.2, angDamp: 0.5 },
  jelly: { density: 1.0, friction: 0.95, restitution: 0.3, linDamp: 0.7, angDamp: 1.6 },
  berry: { density: 1.1, friction: 0.6, restitution: 0.38, linDamp: 0.35, angDamp: 0.6 },
  stone: { density: 2.6, friction: 0.8, restitution: 0.22, linDamp: 0.3, angDamp: 0.6 },
  shell: { density: 1.4, friction: 0.7, restitution: 0.25, linDamp: 0.4, angDamp: 0.8 },
};

export type Shape = { ball: number } | { box: [number, number, number] } | { capsule: [number, number] } | { cylinder: [number, number] };

export interface BodySpec {
  id: string;
  shape: Shape;
  material: Material;
  pos: V3;
}

export const GRAVITY = -22; // a tiny world: snappier than 9.81 m/s² reads right at this scale
export const STEP = 1 / 60;
const PROP_LIFT = 0.005;

/**
 * The KIN's collision capsule (size 1). Its radius is the HEAD's (the widest part, ~0.38 with
 * fur), slightly tucked, so the head can't poke into the mushroom cap or a wall; the bottom sits
 * a hair above the soles so feet, not the capsule, meet the ground.
 */
export const KIN_CAPSULE = { halfHeight: 0.13, radius: 0.33, centerY: 0.48 };
/** The character body's base height: the soles carry it, so it floats this much over the ground. */
const KIN_BASE = 0.015;
/** Its mass for pushing toys (same units as density × volume here: the ball is ~0.003). */
export const KIN_MASS = 0.06;
/** Highest ledge it simply walks up. A fallen block (0.18) is an obstacle it pushes, not a stair. */
export const KIN_STEP = 0.075;

export interface Hit {
  y: number;
  normal: V3;
  /** What it landed on: a body id, 'env:<id>', 'scenery' or 'ground'. */
  on: string;
}

export interface PBody {
  readonly id: string;
  pos(): V3;
  /** Quaternion [x, y, z, w]. */
  rot(): [number, number, number, number];
  vel(): V3;
  /** World up vector's y after rotation: 1 upright, <0.5 toppled. */
  upY(): number;
  impulse(v: V3): void;
  setVel(v: V3): void;
  /** Hold it (dragging / carried): kinematic, moved each frame. Release returns it to dynamic. */
  hold(on: boolean): void;
  moveTo(p: V3): void;
  asleep(): boolean;
  wake(): void;
  mass(): number;
  /** Half its vertical extent at rest (resting centre height above a surface). */
  readonly halfH: number;
}

export class Physics {
  private world: R.World;
  private bodies = new Map<string, { rb: R.RigidBody; held: boolean; halfH: number }>();
  private byCollider = new Map<number, string>();
  private kin: R.RigidBody;
  private kinCol: R.Collider;
  private controller: R.KinematicCharacterController;
  private kinPos: V3 = { x: 0, y: -5, z: 0 };
  private kinActive = false;
  private ground: R.Collider;
  private statics: { shape: Shape; pos: V3; col: R.Collider | null; passable: boolean }[] = [];
  /** Scenery the body walks through but feet stand on (the nest's woven rim). */
  private soft = new Set<number>();
  private env: R.Collider[] = [];
  private envMode: 'augment' | 'replace' = 'augment';
  private walls: R.Collider[] = [];
  private wallSet = new Set<number>();
  private bounds: [number, number, number] = [3, -1.25, 1.35];
  private acc = 0;
  halfW = 3;
  /** Average milliseconds per fixed step (measured). */
  stepMs = 0;
  steps = 0;
  /** Average milliseconds per character move (measured). */
  moveMs = 0;
  /** Toys the character bumped during its last move. */
  kinBumps: string[] = [];

  private constructor(private R: typeof import('@dimforge/rapier3d-compat')) {
    this.world = new R.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = STEP;
    // Tuned for this world's scale (measured, tests/world.perf.test.ts): toys are ~0.1 units, so
    // tell Rapier its length unit is small (tolerances scale with it), and two solver iterations
    // are plenty for toys. Worst case (the KIN wading through a dozen resting finds) went from
    // 0.33 to 0.05 ms per step.
    this.world.lengthUnit = 0.2;
    this.world.numSolverIterations = 2;
    this.ground = this.makeGround();
    // The KIN: a kinematic capsule moved by a character controller.
    this.kin = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -5, 0));
    // A flat-bottomed cylinder, not a capsule: a capsule's rounded bottom meets a ledge's edge at
    // a steep angle and the controller won't step up (measured: stuck at a 6 cm stone); a flat
    // base meets it square-on and autostep lifts it, as a creature lifts its feet.
    const kinHalf = (KIN_CAPSULE.centerY + KIN_CAPSULE.halfHeight + KIN_CAPSULE.radius - KIN_BASE) / 2;
    this.kinCol = this.world.createCollider(
      R.ColliderDesc.cylinder(kinHalf, KIN_CAPSULE.radius).setTranslation(0, KIN_BASE + kinHalf, 0).setFriction(0.6),
      this.kin,
    );
    this.controller = this.world.createCharacterController(0.01);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(KIN_STEP, 0.05, false);
    this.controller.enableSnapToGround(0.08);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(KIN_MASS);
    this.setBounds(3, -1.25, 1.35);
    this.refreshQueries();
  }

  /**
   * Ray and shape queries only see colliders the broad phase has indexed, which happens during a
   * step. After adding scenery or AR surfaces, index them now (a zero-length step: nothing moves).
   */
  private refreshQueries() {
    this.world.timestep = 0;
    this.world.step();
    this.world.timestep = STEP;
  }

  /** Load the WASM (lazy chunk) and build the world. */
  static async load(): Promise<Physics> {
    const mod = await import('@dimforge/rapier3d-compat');
    const RR = (mod as unknown as { default?: typeof mod }).default ?? mod;
    await RR.init();
    return new Physics(RR);
  }

  private makeGround(): R.Collider {
    return this.world.createCollider(this.R.ColliderDesc.cuboid(60, 0.5, 30).setTranslation(0, -0.5, 0).setFriction(0.9).setRestitution(0.3));
  }

  /** Soft garden walls just outside the visible band, so thrown toys stay in view. */
  setBounds(halfW: number, zMin: number, zMax: number) {
    for (const c of this.walls) this.world.removeCollider(c, false);
    this.walls = [];
    this.wallSet.clear();
    this.bounds = [halfW, zMin, zMax];
    this.halfW = halfW;
    if (this.envMode === 'replace') return; // in AR, the real room is the boundary
    const R = this.R;
    const mk = (x: number, z: number, hx: number, hz: number) =>
      this.world.createCollider(R.ColliderDesc.cuboid(hx, 4, hz).setTranslation(x, 4, z).setRestitution(0.4).setFriction(0.3));
    this.walls = [mk(-halfW - 0.2, 0, 0.2, 10), mk(halfW + 0.2, 0, 0.2, 10), mk(0, zMin - 0.25, halfW + 1, 0.2), mk(0, zMax + 0.25, halfW + 1, 0.2)];
    for (const c of this.walls) this.wallSet.add(c.handle);
    for (const b of this.bodies.values()) b.rb.wakeUp();
  }

  /**
   * Fixed scenery (mushroom stalk and cap, the nest's rim, the plant). `passable`: toys bounce off
   * it and feet stand on it, but the KIN's body walks over it (it climbs into its nest).
   */
  addStatic(shape: Shape, pos: V3, opts: { passable?: boolean } = {}) {
    const st = { shape, pos, col: null as R.Collider | null, passable: !!opts.passable };
    if (this.envMode !== 'replace') st.col = this.makeStatic(st);
    this.statics.push(st);
    this.queriesStale = true;
  }

  private queriesStale = false;

  private makeStatic(st: { shape: Shape; pos: V3; passable: boolean }) {
    const col = this.world.createCollider(this.colliderDesc(st.shape).setTranslation(st.pos.x, st.pos.y, st.pos.z).setFriction(0.8).setRestitution(0.3));
    if (st.passable) this.soft.add(col.handle);
    return col;
  }

  /**
   * Surroundings beyond the diorama (AR: ARKit planes + scene meshes, in world units; see env.ts).
   * 'replace' drops the lawn, the garden walls and the scenery so only the real room holds things
   * up; 'augment' adds to the diorama. Pass null to go back to the diorama alone.
   */
  setEnvironment(env: ArEnvironment | null) {
    const R = this.R;
    for (const c of this.env) {
      this.byCollider.delete(c.handle);
      this.world.removeCollider(c, false);
    }
    this.env = [];
    const replace = !!env && env.mode === 'replace';
    if (!replace && this.envMode === 'replace') {
      this.ground = this.makeGround();
      for (const st of this.statics) st.col = this.makeStatic(st);
    } else if (replace && this.envMode !== 'replace') {
      this.world.removeCollider(this.ground, false);
      for (const st of this.statics) {
        if (st.col) {
          this.soft.delete(st.col.handle);
          this.world.removeCollider(st.col, false);
        }
        st.col = null;
      }
    }
    this.envMode = replace ? 'replace' : 'augment';
    this.setBounds(...this.bounds);
    for (const p of env?.planes ?? []) {
      // A thin slab whose TOP face is the detected plane (the plane's normal is its local +Y).
      const q = p.rotation;
      const n = { x: 2 * (q[0] * q[1] - q[3] * q[2]), y: 1 - 2 * (q[0] * q[0] + q[2] * q[2]), z: 2 * (q[1] * q[2] + q[3] * q[0]) };
      const t = 0.02;
      const col = this.world.createCollider(
        R.ColliderDesc.cuboid(Math.max(0.01, p.extent[0] / 2), t, Math.max(0.01, p.extent[1] / 2))
          .setTranslation(p.position.x - n.x * t, p.position.y - n.y * t, p.position.z - n.z * t)
          .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
          .setFriction(0.85)
          .setRestitution(0.25),
      );
      this.env.push(col);
      this.byCollider.set(col.handle, 'env:' + p.id);
    }
    for (const m of env?.meshes ?? []) {
      if (m.indices.length < 3) continue;
      const col = this.world.createCollider(
        R.ColliderDesc.trimesh(Float32Array.from(m.positions), Uint32Array.from(m.indices)).setFriction(0.85).setRestitution(0.2),
      );
      this.env.push(col);
      this.byCollider.set(col.handle, 'env:' + m.id);
    }
    for (const b of this.bodies.values()) b.rb.wakeUp();
    this.refreshQueries();
  }

  get mode() {
    return this.envMode;
  }

  /**
   * The surface below `pos`, searched straight down (so the mushroom's cap above a paw doesn't
   * count). Ignores the KIN itself, toys being held, and the invisible garden walls. Null over a
   * void (AR: off the edge of a table).
   */
  raycastDown(pos: V3, maxDrop = 4): Hit | null {
    const R = this.R;
    if (this.queriesStale) {
      this.queriesStale = false;
      this.refreshQueries();
    }
    const ray = new R.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(ray, maxDrop, true, undefined, undefined, undefined, this.kin, (c) => this.solid(c));
    if (!hit) return null;
    const on = this.byCollider.get(hit.collider.handle) ?? (hit.collider.handle === this.ground.handle ? 'ground' : 'scenery');
    return { y: pos.y - hit.timeOfImpact, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z }, on };
  }

  /** Height of the walkable surface at (x, z), looking down from `fromY`. */
  groundAt(x: number, z: number, fromY = 0.6): number {
    return this.raycastDown({ x, y: fromY, z })?.y ?? (this.envMode === 'replace' ? -Infinity : 0);
  }

  private solid(c: R.Collider): boolean {
    if (this.wallSet.has(c.handle)) return false;
    const id = this.byCollider.get(c.handle);
    return !(id && this.bodies.get(id)?.held);
  }

  /**
   * Move the KIN's body by `delta` through the character controller: it slides along scenery,
   * steps up small ledges, and shoves light toys. `at` is where the animation believes the body
   * is; if it jumped (placed, hopped home) the capsule is resynced first. Returns the corrected
   * body position (feet level).
   */
  moveKin(at: V3, delta: V3): V3 {
    const t0 = performance.now();
    if (this.queriesStale) {
      this.queriesStale = false;
      this.refreshQueries();
    }
    const jumped = !this.kinActive || Math.hypot(at.x - this.kinPos.x, at.z - this.kinPos.z) > 0.25 || Math.abs(at.y - this.kinPos.y) > 0.4;
    if (jumped) {
      this.kinPos = { x: at.x, y: at.y, z: at.z };
      this.kin.setTranslation(this.kinPos, true);
      this.world.propagateModifiedBodyPositionsToColliders();
      this.kinActive = true;
    }
    this.controller.computeColliderMovement(this.kinCol, delta, undefined, undefined, (c) => this.solid(c) && !this.soft.has(c.handle));
    const m = this.controller.computedMovement();
    this.kinBumps = [];
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const c = this.controller.computedCollision(i);
      const id = c?.collider ? this.byCollider.get(c.collider.handle) : undefined;
      if (id && this.bodies.has(id) && !this.kinBumps.includes(id)) this.kinBumps.push(id);
    }
    this.kinPos = { x: this.kinPos.x + m.x, y: this.kinPos.y + m.y, z: this.kinPos.z + m.z };
    this.kin.setNextKinematicTranslation(this.kinPos);
    // The kinematic body only moves at the next step; keep queries this frame consistent.
    this.kin.setTranslation(this.kinPos, true);
    this.world.propagateModifiedBodyPositionsToColliders();
    this.moveMs += (performance.now() - t0 - this.moveMs) * 0.05;
    return { ...this.kinPos };
  }

  add(spec: BodySpec): PBody {
    const R = this.R;
    const m = MATERIALS[spec.material];
    const rb = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spec.pos.x, spec.pos.y + PROP_LIFT, spec.pos.z)
        .setLinearDamping(m.linDamp)
        .setAngularDamping(m.angDamp)
        .setCcdEnabled('ball' in spec.shape && spec.shape.ball < 0.08),
    );
    const col = this.world.createCollider(this.colliderDesc(spec.shape).setDensity(m.density).setFriction(m.friction).setRestitution(m.restitution), rb);
    const rec = { rb, held: false, halfH: halfHeight(spec.shape) };
    this.bodies.set(spec.id, rec);
    this.byCollider.set(col.handle, spec.id);
    const self = this;
    return {
      id: spec.id,
      halfH: rec.halfH,
      pos: () => rb.translation(),
      rot: () => {
        const q = rb.rotation();
        return [q.x, q.y, q.z, q.w];
      },
      vel: () => rb.linvel(),
      upY() {
        const q = rb.rotation();
        return 1 - 2 * (q.x * q.x + q.z * q.z);
      },
      impulse: (v) => {
        rb.wakeUp();
        rb.applyImpulse(v, true);
      },
      setVel: (v) => {
        rb.wakeUp();
        rb.setLinvel(v, true);
      },
      hold(on) {
        if (rec.held === on) return;
        rec.held = on;
        rb.setBodyType(on ? self.R.RigidBodyType.KinematicPositionBased : self.R.RigidBodyType.Dynamic, true);
        if (!on) rb.wakeUp();
      },
      // A held toy can't be pushed into the ground or into something resting: clamp it to the surface.
      moveTo: (p) => {
        const floor = self.raycastDown({ x: p.x, y: p.y + rec.halfH + 0.3, z: p.z });
        const q = { x: p.x, y: floor ? Math.max(p.y, floor.y + rec.halfH) : p.y, z: p.z };
        if (rec.held) rb.setNextKinematicTranslation(q);
        else rb.setTranslation(q, true);
      },
      asleep: () => rb.isSleeping(),
      wake: () => rb.wakeUp(),
      mass: () => rb.mass(),
    };
  }

  remove(id: string) {
    const b = this.bodies.get(id);
    if (!b) return;
    for (const [h, bid] of this.byCollider) if (bid === id) this.byCollider.delete(h);
    this.world.removeRigidBody(b.rb);
    this.bodies.delete(id);
  }

  /**
   * Place the capsule directly (hopping across the seam, scripted spins: anything not walked
   * through moveKin), or null to park it out of the world (away visiting, hidden).
   */
  setKin(p: V3 | null, scale = 1) {
    if (p) {
      this.kinPos = { x: p.x, y: p.y, z: p.z };
      this.kinActive = true;
    } else {
      this.kinPos = { x: 0, y: -5, z: 0 };
      this.kinActive = false;
    }
    this.kin.setNextKinematicTranslation(this.kinPos);
    void scale;
  }

  /** Can the KIN's body stand at (x, z) without overlapping scenery or a toy? */
  kinFits(x: number, z: number, y = 0): boolean {
    const shape = new this.R.Capsule(KIN_CAPSULE.halfHeight, KIN_CAPSULE.radius);
    let blocked = false;
    this.world.intersectionsWithShape({ x, y: y + KIN_CAPSULE.centerY + 0.02, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => {
      if (c.handle === this.kinCol.handle || this.wallSet.has(c.handle)) return true;
      blocked = true;
      return false;
    });
    return !blocked;
  }

  /** Body ids whose centres are within `r` of a point (broad check for "the ball hit me"). */
  bodiesNear(p: V3, r: number): string[] {
    const out: string[] = [];
    for (const [id, b] of this.bodies) {
      const q = b.rb.translation();
      if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2 < r * r) out.push(id);
    }
    return out;
  }

  /** Advance by a frame's worth of time in fixed steps. Returns substeps taken. */
  step(frameDt: number): number {
    this.acc = Math.min(this.acc + frameDt, STEP * 4);
    let n = 0;
    while (this.acc >= STEP) {
      const t0 = performance.now();
      this.world.step();
      const ms = performance.now() - t0;
      this.steps++;
      this.stepMs += (ms - this.stepMs) * 0.05;
      this.acc -= STEP;
      n++;
    }
    return n;
  }

  /** Fraction of a step left in the accumulator (for render interpolation if wanted). */
  get alpha() {
    return this.acc / STEP;
  }

  awakeCount(): number {
    let n = 0;
    for (const b of this.bodies.values()) if (!b.rb.isSleeping()) n++;
    return n;
  }

  private colliderDesc(s: Shape): R.ColliderDesc {
    const C = this.R.ColliderDesc;
    if ('ball' in s) return C.ball(s.ball);
    if ('box' in s) return C.cuboid(...s.box);
    if ('capsule' in s) return C.capsule(s.capsule[0], s.capsule[1]);
    return C.cylinder(s.cylinder[0], s.cylinder[1]);
  }
}

/** Half the vertical extent of a shape at rest. */
function halfHeight(s: Shape): number {
  if ('ball' in s) return s.ball;
  if ('box' in s) return s.box[1];
  if ('capsule' in s) return s.capsule[0] + s.capsule[1];
  return s.cylinder[0];
}
