// Matter that isn't a rigid body: air, water, snow, flutter and squish. Pure functions over
// plain numbers, so they run headless in tests and the same everywhere. Units: world units
// (a KIN is ~1 tall), seconds. The real weather drives them.

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export interface Air {
  windKmh: number;
  /** Degrees, the direction the wind comes FROM (meteorological). */
  windDir: number;
}

/**
 * Wind at time t as a world-space velocity (units/s), with slow gusts. Depth is damped so things
 * drift across the garden more than in and out of it. Same convention as the grass shader.
 */
export function wind(a: Air, t: number, x = 0): { x: number; z: number; gust: number } {
  const dir = ((a.windDir + 180) * Math.PI) / 180;
  const base = Math.min(3.2, a.windKmh / 12);
  const gust = 0.55 + 0.45 * Math.sin(t * 0.7 + x * 0.15) * Math.sin(t * 0.23 + 1.3);
  const s = base * (0.6 + 0.6 * gust);
  return { x: Math.sin(dir) * s, z: -Math.cos(dir) * s * 0.35, gust };
}

// ── Feather: a light, high-drag body with flutter lift. Floats, drifts, settles, lifts in gusts.
export interface Feather {
  p: V3;
  v: V3;
  phase: number;
  /** Visual roll/yaw. */
  roll: number;
  yaw: number;
  resting: boolean;
}

export function newFeather(x: number, y: number, z: number): Feather {
  return { p: v3(x, y, z), v: v3(), phase: 0, roll: 0, yaw: 0, resting: y <= 0.01 };
}

export function featherStep(f: Feather, dt: number, air: Air, t: number, bounds: { halfW: number; zMin: number; zMax: number }, rand: () => number) {
  const w = wind(air, t, f.p.x);
  if (f.resting) {
    // A strong enough gust lifts it off the ground.
    const lift = Math.hypot(w.x, w.z);
    if (lift > 1.1 && w.gust > 0.8 && rand() < dt * 0.8) {
      f.resting = false;
      f.v.y = 0.8 + lift * 0.25;
    } else {
      f.yaw += Math.sin(t * 3 + f.phase) * 0.002;
      return;
    }
  }
  f.phase += dt * (4 + Math.abs(f.v.y) * 3);
  const drag = 3.2;
  // Relative air velocity drives it (quadratic-ish feel without the instability).
  f.v.x += (w.x - f.v.x) * Math.min(1, drag * dt) + Math.cos(f.phase) * 0.9 * dt;
  f.v.z += (w.z - f.v.z) * Math.min(1, drag * dt);
  f.v.y += (-1.4 - f.v.y * 2.4) * dt + Math.sin(f.phase) * 0.6 * dt; // terminal fall ~0.6 u/s with flutter
  f.p.x += f.v.x * dt;
  f.p.y += f.v.y * dt;
  f.p.z += f.v.z * dt;
  f.roll = Math.sin(f.phase) * 0.6;
  f.yaw += f.v.x * dt * 0.8;
  if (f.p.z < bounds.zMin) (f.p.z = bounds.zMin), (f.v.z = Math.abs(f.v.z) * 0.3);
  if (f.p.z > bounds.zMax) (f.p.z = bounds.zMax), (f.v.z = -Math.abs(f.v.z) * 0.3);
  if (Math.abs(f.p.x) > bounds.halfW) f.p.x = -Math.sign(f.p.x) * bounds.halfW; // drifts back in from the other side
  if (f.p.y <= 0.01) {
    f.p.y = 0.01;
    f.v = v3();
    f.resting = true;
    f.roll = 0;
  }
}

// ── Leaves: tumbling flutter particles that blow in on the wind, settle, then blow away.
export interface Leaf extends Feather {
  life: number;
  hue: number;
  spin: number;
}

export function spawnLeaf(air: Air, halfW: number, rand: () => number, hue: number): Leaf {
  const w = wind(air, 0);
  const fromLeft = w.x >= 0;
  return {
    ...newFeather(fromLeft ? -halfW : halfW, 0.8 + rand() * 1.6, -1 + rand() * 2.2),
    resting: false,
    life: 0,
    hue: hue + (rand() - 0.5) * 18,
    spin: (rand() - 0.5) * 6,
  };
}

export function leafStep(l: Leaf, dt: number, air: Air, t: number, bounds: { halfW: number; zMin: number; zMax: number }, rand: () => number): boolean {
  l.life += dt;
  featherStep(l, dt, air, t, { ...bounds, halfW: bounds.halfW + 2 }, rand);
  l.yaw += l.spin * dt * (l.resting ? 0 : 1);
  // Leaves leave: once settled for a while, or past the far edge.
  return !(Math.abs(l.p.x) > bounds.halfW + 1.5 || l.life > 40);
}

// ── Boids: butterflies by day, fireflies at night.
export interface Flock {
  p: V3[];
  v: V3[];
  /** Per-member phase (wing beat / glow pulse). */
  ph: number[];
}

export interface FlockParams {
  speed: number;
  /** Where they like to be (the plant, the flowers). */
  home: V3;
  homePull: number;
  /** Something to keep away from (the KIN when it's running at them). */
  avoid: V3 | null;
  avoidR: number;
  yMin: number;
  yMax: number;
  halfW: number;
  zMin: number;
  zMax: number;
  wind: { x: number; z: number };
}

export function newFlock(n: number, around: V3, rand: () => number): Flock {
  const p: V3[] = [];
  const v: V3[] = [];
  const ph: number[] = [];
  for (let i = 0; i < n; i++) {
    p.push(v3(around.x + (rand() - 0.5) * 2, around.y + rand() * 0.8, around.z + (rand() - 0.5) * 1.2));
    v.push(v3((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4));
    ph.push(rand() * 10);
  }
  return { p, v, ph };
}

export function flockStep(f: Flock, dt: number, q: FlockParams, rand: () => number) {
  const n = f.p.length;
  for (let i = 0; i < n; i++) {
    const p = f.p[i]!;
    const v = f.v[i]!;
    let cx = 0, cy = 0, cz = 0, sx = 0, sy = 0, sz = 0, ax = 0, az = 0, k = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const o = f.p[j]!;
      const dx = o.x - p.x, dy = o.y - p.y, dz = o.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 1.2) continue;
      k++;
      cx += dx; cy += dy; cz += dz;
      ax += f.v[j]!.x; az += f.v[j]!.z;
      if (d2 < 0.06) (sx -= dx / (d2 + 0.01)), (sy -= dy / (d2 + 0.01)), (sz -= dz / (d2 + 0.01));
    }
    if (k) {
      v.x += (cx / k) * 0.4 * dt + sx * 0.02 * dt + (ax / k - v.x) * 0.5 * dt;
      v.y += (cy / k) * 0.4 * dt + sy * 0.02 * dt;
      v.z += (cz / k) * 0.4 * dt + sz * 0.02 * dt + (az / k - v.z) * 0.5 * dt;
    }
    // Wander, a pull home, the wind, and fleeing.
    v.x += ((rand() - 0.5) * 2.2 + (q.home.x - p.x) * q.homePull + q.wind.x * 0.3) * dt;
    v.y += ((rand() - 0.5) * 1.6 + (q.home.y - p.y) * q.homePull * 0.5) * dt;
    v.z += ((rand() - 0.5) * 2.2 + (q.home.z - p.z) * q.homePull + q.wind.z * 0.3) * dt;
    if (q.avoid) {
      const dx = p.x - q.avoid.x, dz = p.z - q.avoid.z, dy = p.y - q.avoid.y;
      const d = Math.hypot(dx, dy, dz);
      if (d < q.avoidR && d > 1e-4) {
        const push = ((q.avoidR - d) / q.avoidR) * 6 * dt;
        v.x += (dx / d) * push;
        v.y += Math.abs(dy / d) * push + push * 0.6;
        v.z += (dz / d) * push;
      }
    }
    const sp = Math.hypot(v.x, v.y, v.z);
    const max = q.speed * (q.avoid ? 2 : 1);
    if (sp > max) (v.x *= max / sp), (v.y *= max / sp), (v.z *= max / sp);
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    if (p.y < q.yMin) (p.y = q.yMin), (v.y = Math.abs(v.y));
    if (p.y > q.yMax) (p.y = q.yMax), (v.y = -Math.abs(v.y));
    if (p.z < q.zMin) (p.z = q.zMin), (v.z = Math.abs(v.z));
    if (p.z > q.zMax) (p.z = q.zMax), (v.z = -Math.abs(v.z));
    if (p.x < -q.halfW) (p.x = -q.halfW), (v.x = Math.abs(v.x));
    if (p.x > q.halfW) (p.x = q.halfW), (v.x = -Math.abs(v.x));
    f.ph[i] = f.ph[i]! + dt * (8 + sp * 4);
  }
}

// ── Puddles: appear in the low spots in real rain, dry in sun and warmth.
export interface Puddle {
  x: number;
  z: number;
  /** Current radius and the radius this spot can hold. */
  r: number;
  max: number;
}

export interface Weather {
  precipMm: number;
  snow: boolean;
  tempC: number;
  sunElev: number;
  cloud: number;
}

export function puddleStep(ps: Puddle[], dt: number, w: Weather) {
  const raining = w.precipMm > 0.1 && !w.snow;
  for (const p of ps) {
    if (raining) p.r = Math.min(p.max, p.r + dt * 0.004 * (0.5 + w.precipMm));
    else {
      const sun = Math.max(0, w.sunElev) / 60 * (1 - w.cloud * 0.7);
      const evap = 0.0005 + 0.0025 * sun + Math.max(0, w.tempC - 10) * 0.00008;
      p.r = Math.max(0, p.r - dt * evap);
    }
  }
}

/** Snow depth 0..1: builds while it snows, melts above freezing (faster in sun). */
export function snowStep(depth: number, dt: number, w: Weather): number {
  if (w.precipMm > 0.05 && w.snow) return Math.min(1, depth + dt * 0.0012 * (0.5 + w.precipMm));
  if (w.tempC > 1) return Math.max(0, depth - dt * (0.0002 + 0.00004 * (w.tempC - 1) + 0.0003 * Math.max(0, w.sunElev) / 60));
  return depth;
}

// ── Jelly skin: a soft body as springs on a rigid core. Each vertex is a mass on a spring to
// its rest position (relative to the core), smoothed with its neighbours, pushed by the core's
// acceleration (inertia) and flattened against the ground (squash that keeps volume-ish).
export interface Skin {
  rest: Float32Array; // rest offsets (n*3)
  off: Float32Array; // current offset from rest (n*3)
  vel: Float32Array;
  nbr: number[][];
}

export function newSkin(rest: Float32Array, nbr: number[][]): Skin {
  return { rest, off: new Float32Array(rest.length), vel: new Float32Array(rest.length), nbr };
}

/**
 * @param accel the core's acceleration this step (world), drives the wobble
 * @param coreY height of the core above the ground (for the floor squash)
 */
export function skinStep(s: Skin, dt: number, accel: V3, coreY: number, k = 120, damp = 7, squishK = 1) {
  const n = s.rest.length / 3;
  const h = Math.min(dt, 1 / 30);
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    // Laplacian smoothing keeps the surface coherent (it wobbles as a whole, not as noise).
    let lx = 0, ly = 0, lz = 0;
    const nb = s.nbr[i]!;
    for (const m of nb) (lx += s.off[m * 3]! - s.off[j]!), (ly += s.off[m * 3 + 1]! - s.off[j + 1]!), (lz += s.off[m * 3 + 2]! - s.off[j + 2]!);
    const c = nb.length ? 18 / nb.length : 0;
    s.vel[j] = s.vel[j]! + (-k * s.off[j]! - damp * s.vel[j]! + lx * c - accel.x * 0.08) * h;
    s.vel[j + 1] = s.vel[j + 1]! + (-k * s.off[j + 1]! - damp * s.vel[j + 1]! + ly * c - accel.y * 0.08) * h;
    s.vel[j + 2] = s.vel[j + 2]! + (-k * s.off[j + 2]! - damp * s.vel[j + 2]! + lz * c - accel.z * 0.08) * h;
    s.off[j] = s.off[j]! + s.vel[j]! * h;
    s.off[j + 1] = s.off[j + 1]! + s.vel[j + 1]! * h;
    s.off[j + 2] = s.off[j + 2]! + s.vel[j + 2]! * h;
    // The floor: a vertex below ground is pushed up and its excess bulges outward.
    const wy = coreY + s.rest[j + 1]! + s.off[j + 1]!;
    if (wy < 0) {
      const pen = -wy * squishK;
      s.off[j + 1] = s.off[j + 1]! + pen;
      const rx = s.rest[j]!, rz = s.rest[j + 2]!;
      const rl = Math.hypot(rx, rz) || 1;
      s.off[j] = s.off[j]! + (rx / rl) * pen * 0.6;
      s.off[j + 2] = s.off[j + 2]! + (rz / rl) * pen * 0.6;
      s.vel[j + 1] = Math.max(0, s.vel[j + 1]!);
    }
  }
}

/** Kinetic-ish energy of the skin: lets the jelly's actor sleep when it's still. */
export function skinEnergy(s: Skin): number {
  let e = 0;
  for (let i = 0; i < s.vel.length; i++) e += s.vel[i]! * s.vel[i]!;
  return e / (s.vel.length / 3);
}
