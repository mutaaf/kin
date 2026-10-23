// Procedural gait with planted feet (docs/REALISM.md). Pure: no three.js, no DOM, so the rules
// that keep a KIN from skating are unit-tested (tests/realism.test.ts).
//
// Each back foot runs a stance/swing cycle:
//   STANCE  the foot is planted at a world point and does not move, whatever the body does
//   SWING   it lifts off, travels to a predicted landing spot (where its hip will be half a stride
//           from now), clears any step up, and plants with the ground height found there
// A step starts when the foot has fallen too far behind its hip's "home" (walking), or when the
// body has turned enough that the hips swung away from the feet (turning in place steps the feet).
// Walk alternates feet (one always planted); a fast or bouncy KIN hops: both feet together.
//
// The body follows its feet: height from the ground under it and under the planted feet, a bob
// that rises as a foot swings through, a waddle roll toward the supporting foot, pitch and roll
// from the terrain slope, and a lean into acceleration and turns (applied by KinView).

export type GroundFn = (x: number, z: number, fromY: number) => number;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GaitParams {
  /** Creature size multiplier (genome.size × growth). */
  size: number;
  /** Hip offsets in body space (x = side, z = forward), size 1. */
  hipX: number;
  hipZ: number;
  /** How far a foot may lag its home before it steps (size 1). */
  stride: number;
  /** Peak foot lift during a swing (size 1). */
  lift: number;
  /** 0 calm … 1 bouncy: earlier switch to hopping, springier bob. */
  bounce: number;
}

export const DEFAULT_GAIT: GaitParams = { size: 1, hipX: 0.135, hipZ: 0.03, stride: 0.075, lift: 0.055, bounce: 0.5 };

export interface FootState {
  /** World position of the sole centre. */
  pos: Vec3;
  planted: boolean;
  from: Vec3;
  to: Vec3;
  t: number;
  dur: number;
  /** Height the sole must clear during this swing (step-ups). */
  clear: number;
  /** Seconds since the foot planted (for dust/footfall cues). */
  sincePlant: number;
}

export interface GaitFrame {
  feet: { pos: Vec3; lift: number; planted: boolean }[];
  /** Ground height the body stands on (smoothed). */
  groundY: number;
  /** Extra body height from the step cycle. */
  bob: number;
  /** Waddle roll (rad, + = toward the right foot). */
  roll: number;
  /** Terrain pitch (rad, + = nose up) and roll (rad) under the feet. */
  slopePitch: number;
  slopeRoll: number;
  /** Feet that touched down this frame (for footfall sounds, squash and dust). */
  touchdowns: number[];
  hopping: boolean;
}

export interface GaitInput {
  /** Body position on the ground plane (x, z) and facing. */
  x: number;
  z: number;
  yaw: number;
  /** Body velocity on the ground plane (units/s). */
  vx: number;
  vz: number;
  dt: number;
  ground: GroundFn;
  /** Feet follow the body rigidly (in the air, mid-spin, rolled over). */
  free: boolean;
  /** Body height above its ground while free (feet hang below it). */
  freeHeight?: number;
}

const len2 = (x: number, z: number) => Math.sqrt(x * x + z * z);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => k * k * (3 - 2 * k);

export class Gait {
  feet: FootState[];
  groundY = 0;
  private bodyY = 0;
  private yawAtPlant = [0, 0];
  private lastSwing = 1; // which foot swung last (alternation)
  private wasFree = true;

  constructor(public p: GaitParams = DEFAULT_GAIT) {
    const mk = (): FootState => ({ pos: { x: 0, y: 0, z: 0 }, planted: false, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, t: 1, dur: 0.2, clear: 0, sincePlant: 9 });
    this.feet = [mk(), mk()];
  }

  /** World position of a foot's hip home (where it rests under the body), with optional lead. */
  home(i: number, x: number, z: number, yaw: number, leadX = 0, leadZ = 0): { x: number; z: number } {
    const s = this.p.size;
    const side = i === 0 ? -1 : 1;
    const lx = side * this.p.hipX * s;
    const lz = this.p.hipZ * s;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    // Body space → world: +z is forward along `yaw` (three.js: rotation.y = yaw turns +z to (sin, cos)).
    return { x: x + lx * c + lz * sn + leadX, z: z - lx * sn + lz * c + leadZ };
  }

  /** Snap both feet under the hips (placement, landing, teleport). */
  plantAll(x: number, z: number, yaw: number, ground: GroundFn) {
    const g = ground(x, z, this.bodyY + 0.6);
    this.groundY = this.bodyY = Number.isFinite(g) ? g : this.bodyY;
    for (let i = 0; i < 2; i++) {
      const h = this.home(i, x, z, yaw);
      const y = ground(h.x, h.z, this.bodyY + 0.3);
      const f = this.feet[i]!;
      f.pos = { x: h.x, y: Number.isFinite(y) ? y : this.bodyY, z: h.z };
      f.planted = true;
      f.t = 1;
      f.sincePlant = 9;
      this.yawAtPlant[i] = yaw;
    }
  }

  update(inp: GaitInput): GaitFrame {
    const { x, z, yaw, vx, vz, dt, ground } = inp;
    const s = this.p.size;
    const speed = len2(vx, vz);
    const touchdowns: number[] = [];

    // ── Body ground: the surface under the body, looked up from just above where it stands.
    const gb = ground(x, z, this.bodyY + 0.35 * s);
    const under = Number.isFinite(gb) ? gb : this.bodyY;

    if (inp.free) {
      // Airborne / tumbling: the feet ride with the body, tucked a little under the hips.
      const hang = inp.freeHeight ?? 0;
      for (let i = 0; i < 2; i++) {
        const h = this.home(i, x, z, yaw);
        const f = this.feet[i]!;
        f.planted = false;
        f.t = 1;
        f.pos = { x: h.x, y: this.bodyY + hang + Math.min(0.03 * s, hang * 0.25), z: h.z };
      }
      this.wasFree = true;
      this.bodyY = mix(this.bodyY, under, Math.min(1, dt * 12));
      this.groundY = this.bodyY;
      return this.frame([], false, 0, 0);
    }
    if (this.wasFree) {
      // Touchdown: plant where the hips are now.
      this.bodyY = under;
      this.plantAll(x, z, yaw, ground);
      this.wasFree = false;
      touchdowns.push(0, 1);
    }

    // Gait choice: hop when fast (sooner for a bouncy personality).
    const hopping = speed > (1.75 - this.p.bounce * 0.5) * s;
    // Small creatures take quick, short steps: cadence rises with speed so the stride stays about
    // a third of the body length instead of lunging.
    const swingDur = Math.max(0.09, Math.min(0.26, (hopping ? 0.24 : 0.14) / (0.5 + (speed * 0.6) / s)));
    const leadT = swingDur * (hopping ? 0.9 : 0.75);

    // ── Swinging feet travel; planted feet stay exactly where they are.
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i]!;
      if (f.planted) {
        f.sincePlant += dt;
        continue;
      }
      f.t = Math.min(1, f.t + dt / f.dur);
      // Retarget toward the moving home so a long swing still lands under the hip.
      const h = this.home(i, x, z, yaw, vx * leadT * (1 - f.t), vz * leadT * (1 - f.t));
      f.to.x = mix(f.to.x, h.x, Math.min(1, dt * 6));
      f.to.z = mix(f.to.z, h.z, Math.min(1, dt * 6));
      // Stepping UP, the foot rises before it travels over the edge; stepping DOWN, it travels out
      // before it drops. And never below the real surface under it (one ray per swinging foot).
      const up = f.to.y > f.from.y + 0.005;
      const down = f.to.y < f.from.y - 0.005;
      const kx = smooth(up ? Math.max(0, (f.t - 0.25) / 0.75) : f.t);
      const ky = smooth(up ? Math.min(1, f.t / 0.6) : down ? Math.max(0, (f.t - 0.45) / 0.55) : f.t);
      const arc = 4 * f.t * (1 - f.t) * (this.p.lift * s * (hopping ? 1.3 : 1) + f.clear);
      const px = mix(f.from.x, f.to.x, kx);
      const pz = mix(f.from.z, f.to.z, kx);
      const floorY = ground(px, pz, Math.max(f.from.y, f.to.y) + 0.25 * s);
      const y = Math.max(mix(f.from.y, f.to.y, ky) + arc, Number.isFinite(floorY) ? floorY + 0.004 : -Infinity);
      f.pos = { x: px, y, z: pz };
      if (f.t >= 1) {
        const gy = ground(f.to.x, f.to.z, Math.max(f.from.y, f.to.y) + 0.25 * s);
        f.pos = { x: f.to.x, y: Number.isFinite(gy) ? gy : f.to.y, z: f.to.z };
        f.planted = true;
        f.sincePlant = 0;
        this.yawAtPlant[i] = yaw;
        touchdowns.push(i);
      }
    }

    // ── Step triggers.
    const need = (i: number) => {
      const f = this.feet[i]!;
      if (!f.planted) return 0;
      const h = this.home(i, x, z, yaw);
      const lag = len2(f.pos.x - h.x, f.pos.z - h.z);
      const turned = Math.abs(wrap(yaw - this.yawAtPlant[i]!));
      const moving = speed > 0.05 * s;
      // Moving: step when the hip has outrun the foot by a stride. Still: tidy up a sloppy stance
      // (the settle step after stopping) and step when the body has turned.
      const limit = moving ? this.p.stride * s : 0.045 * s;
      return Math.max(lag / limit, turned / 0.55);
    };
    const begin = (i: number) => {
      const f = this.feet[i]!;
      const h = this.home(i, x, z, yaw, vx * leadT, vz * leadT);
      const gy = ground(h.x, h.z, f.pos.y + 0.25 * s);
      const toY = Number.isFinite(gy) ? gy : f.pos.y;
      f.from = { ...f.pos };
      f.to = { x: h.x, y: toY, z: h.z };
      // Clear the higher of start and end plus any bump on the way (sampled at the midpoint).
      const gm = ground((f.from.x + h.x) / 2, (f.from.z + h.z) / 2, Math.max(f.pos.y, toY) + 0.25 * s);
      const mid = Number.isFinite(gm) ? gm : toY;
      f.clear = Math.max(0, mid - Math.max(f.from.y, toY)) + Math.max(0, toY - f.from.y) * 0.5;
      f.dur = swingDur;
      f.t = 0;
      f.planted = false;
      this.lastSwing = i;
    };

    if (hopping) {
      // Both feet leave and land together.
      if (this.feet[0]!.planted && this.feet[1]!.planted && Math.max(need(0), need(1)) >= 1) {
        begin(0);
        begin(1);
      }
    } else if (this.feet[0]!.planted && this.feet[1]!.planted) {
      // Walk: one foot at a time (one is always planted); the one that needs it most, alternating
      // on ties.
      const n0 = need(0);
      const n1 = need(1);
      if (Math.max(n0, n1) >= 1) {
        const pick = Math.abs(n0 - n1) < 0.15 ? 1 - this.lastSwing : n0 > n1 ? 0 : 1;
        begin(pick);
      }
    }

    // ── Body height follows the ground under it and under the planted feet.
    const planted = this.feet.filter((f) => f.planted);
    const feetY = planted.length ? planted.reduce((a, f) => a + f.pos.y, 0) / planted.length : under;
    const targetY = Math.max(under, mix(under, feetY, 0.6));
    this.bodyY = mix(this.bodyY, targetY, Math.min(1, dt * (targetY > this.bodyY ? 14 : 9)));
    this.groundY = this.bodyY;

    // ── Bob and waddle from the swing.
    let bob = 0;
    let roll = 0;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i]!;
      if (f.planted) continue;
      const w = Math.sin(Math.PI * f.t);
      if (hopping) {
        bob = Math.max(bob, w * (0.05 + 0.04 * this.p.bounce) * s);
      } else {
        bob = Math.max(bob, w * (0.012 + 0.01 * this.p.bounce) * s);
        // Lean over the supporting foot: the swinging foot's opposite side.
        roll += (i === 0 ? -1 : 1) * w * 0.07;
      }
    }

    // ── Terrain slope from the feet (roll) and ahead/behind the body (pitch).
    const f0 = this.feet[0]!.pos;
    const f1 = this.feet[1]!.pos;
    const slopeRoll = Math.atan2(f0.y - f1.y, Math.max(0.05, 2 * this.p.hipX * s)) * 0.6;
    const ax = Math.sin(yaw) * 0.16 * s;
    const az = Math.cos(yaw) * 0.16 * s;
    const ga = ground(x + ax, z + az, this.bodyY + 0.3 * s);
    const gbk = ground(x - ax, z - az, this.bodyY + 0.3 * s);
    const slopePitch = Number.isFinite(ga) && Number.isFinite(gbk) ? -Math.atan2(ga - gbk, 0.32 * s) * 0.6 : 0;

    return this.frame(touchdowns, hopping, bob, roll, slopePitch, slopeRoll);
  }

  private frame(touchdowns: number[], hopping: boolean, bob: number, roll: number, slopePitch = 0, slopeRoll = 0): GaitFrame {
    return {
      feet: this.feet.map((f) => ({ pos: { ...f.pos }, lift: f.planted ? 0 : Math.sin(Math.PI * f.t), planted: f.planted })),
      groundY: this.groundY,
      bob,
      roll,
      slopePitch,
      slopeRoll,
      touchdowns,
      hopping,
    };
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
