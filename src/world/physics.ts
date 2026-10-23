// Rigid-body physics: Rapier 3D (WASM), loaded as a lazy chunk after first paint. A fixed 60 Hz
// step decoupled from rendering (accumulator, at most 4 substeps a frame), sleeping bodies for
// battery, and materials with their own density, friction and bounce. The KIN is a kinematic
// capsule that follows the animated creature and pushes things out of its way.
//
// Lessons carried over from COLD GAS (docs/LESSONS.md there): put resting props down a few mm
// above the ground so they spawn asleep; "touching" is impulse > 0 OR within a centimetre.

import type * as R from '@dimforge/rapier3d-compat';
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
}

export class Physics {
  private world: R.World;
  private bodies = new Map<string, { rb: R.RigidBody; held: boolean }>();
  private kin: R.RigidBody;
  private walls: R.Collider[] = [];
  private acc = 0;
  halfW = 3;
  /** Average milliseconds per fixed step (measured). */
  stepMs = 0;
  steps = 0;

  private constructor(private R: typeof import('@dimforge/rapier3d-compat')) {
    this.world = new R.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = STEP;
    // Tuned for this world's scale (measured, tests/world.perf.test.ts): toys are ~0.1 units, so
    // tell Rapier its length unit is small (tolerances scale with it), and two solver iterations
    // are plenty for toys. Worst case (the KIN wading through a dozen resting finds) went from
    // 0.33 to 0.05 ms per step.
    this.world.lengthUnit = 0.2;
    this.world.numSolverIterations = 2;
    // Ground: a big slab whose top is y = 0.
    this.world.createCollider(R.ColliderDesc.cuboid(60, 0.5, 30).setTranslation(0, -0.5, 0).setFriction(0.9).setRestitution(0.3));
    // The KIN: a kinematic capsule that follows the creature.
    this.kin = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -5, 0));
    this.world.createCollider(R.ColliderDesc.capsule(0.16, 0.27).setTranslation(0, 0.45, 0).setFriction(0.6), this.kin);
    this.setBounds(3, -1.25, 1.35);
  }

  /** Load the WASM (lazy chunk) and build the world. */
  static async load(): Promise<Physics> {
    const mod = await import('@dimforge/rapier3d-compat');
    const RR = (mod as unknown as { default?: typeof mod }).default ?? mod;
    await RR.init();
    return new Physics(RR);
  }

  /** Soft garden walls just outside the visible band, so thrown toys stay in view. */
  setBounds(halfW: number, zMin: number, zMax: number) {
    for (const c of this.walls) this.world.removeCollider(c, false);
    const R = this.R;
    const mk = (x: number, z: number, hx: number, hz: number) =>
      this.world.createCollider(R.ColliderDesc.cuboid(hx, 4, hz).setTranslation(x, 4, z).setRestitution(0.4).setFriction(0.3));
    this.walls = [mk(-halfW - 0.2, 0, 0.2, 10), mk(halfW + 0.2, 0, 0.2, 10), mk(0, zMin - 0.25, halfW + 1, 0.2), mk(0, zMax + 0.25, halfW + 1, 0.2)];
    this.halfW = halfW;
    for (const b of this.bodies.values()) b.rb.wakeUp();
  }

  /** Fixed scenery (mushroom stalk and cap, the nest's rim, the plant). */
  addStatic(shape: Shape, pos: V3) {
    this.world.createCollider(this.colliderDesc(shape).setTranslation(pos.x, pos.y, pos.z).setFriction(0.8).setRestitution(0.3));
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
    this.world.createCollider(this.colliderDesc(spec.shape).setDensity(m.density).setFriction(m.friction).setRestitution(m.restitution), rb);
    const rec = { rb, held: false };
    this.bodies.set(spec.id, rec);
    const self = this;
    return {
      id: spec.id,
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
      moveTo: (p) => (rec.held ? rb.setNextKinematicTranslation(p) : rb.setTranslation(p, true)),
      asleep: () => rb.isSleeping(),
      wake: () => rb.wakeUp(),
      mass: () => rb.mass(),
    };
  }

  remove(id: string) {
    const b = this.bodies.get(id);
    if (!b) return;
    this.world.removeRigidBody(b.rb);
    this.bodies.delete(id);
  }

  /** Where the creature is this frame (null hides it, e.g. while away or hopping). */
  setKin(p: V3 | null, scale = 1) {
    this.kin.setNextKinematicTranslation(p ? { x: p.x, y: p.y, z: p.z } : { x: 0, y: -5, z: 0 });
    void scale;
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
