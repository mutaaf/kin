// Brings a creature mesh to life. The brain says *what* (an Action); this decides *how* it looks:
// hop-walking, anticipation and squash, a head that leads and a body that follows, ears on
// springs, blinks, breath, and the scripted beats of a crossing. Nothing here changes game state.

import * as THREE from 'three';
import type { Action } from '../core/brain';
import type { Reaction } from '../core/creature';
import type { Genome } from '../core/genome';
import { hopAt, toLocal, type Hop, type Rect } from './choreo';
import { buildCreature, type CreatureParts } from './creatureMesh';
import { GROUND_Z, type Stage } from './stage';

interface Task {
  dur: number;
  enter?: () => void;
  run?: (k: number, dt: number) => void;
  exit?: () => void;
  /** Optional absolute start time (performance-independent epoch ms). */
  at?: number;
}

type Mood = 'neutral' | 'happy' | 'sleepy' | 'surprised' | 'sad' | 'content';

const shadowTex = (() => {
  let tex: THREE.Texture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(10,14,20,0.55)');
    grd.addColorStop(1, 'rgba(10,14,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

export class KinView {
  readonly parts: CreatureParts;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  height = 0;
  mood: Mood = 'neutral';
  action: Action = 'idle';
  /** Where the head wants to look (world), or null for idle glances. */
  look: THREE.Vector3 | null = null;
  petting = 0;
  visible = true;
  private shadow: THREE.Mesh;
  private queue: Task[] = [];
  private cur: { task: Task; t: number; started: boolean } | null = null;
  private target: THREE.Vector3 | null = null;
  private stepPhase = 0;
  private sq = { v: 1, vel: 0 };
  private ear = [{ a: 0, v: 0 }, { a: 0, v: 0 }];
  private headYaw = 0;
  private headPitch = 0;
  private lastHeadYaw = 0;
  private blinkAt = 0;
  private blinkK = 0;
  private glanceAt = 0;
  private glance = new THREE.Vector3();
  private appear = 1;
  private shiver = 0;
  private wag = 0.2;
  private eyeR: number;
  private breathPhase = Math.random() * 10;

  constructor(readonly genome: Genome, private stage: Stage) {
    this.parts = buildCreature(genome);
    this.eyeR = 0.083 * genome.eyeScale;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    stage.world.add(this.parts.root, this.shadow);
  }

  dispose() {
    this.stage.world.remove(this.parts.root, this.shadow);
    this.parts.dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
  }

  get busy() {
    return !!this.cur || this.queue.length > 0;
  }

  /** Replace any running script. */
  script(tasks: Task[]) {
    if (this.cur?.started) this.cur.task.exit?.();
    this.cur = null;
    this.queue = [...tasks];
  }

  then(tasks: Task[]) {
    this.queue.push(...tasks);
  }

  // ───────────── brain-level behaviour (only when no script runs)

  applyAction(a: Action, opts: { edgeX?: number; guest?: THREE.Vector3 | null } = {}) {
    this.action = a;
    const A = this.stage.anchors;
    const jitter = () => new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.3);
    this.mood = 'neutral';
    this.target = null;
    switch (a) {
      case 'wander': {
        const lim = Math.min(2.6, this.stage.w / 2 / this.stage.px - 0.6);
        this.target = new THREE.Vector3((Math.random() * 2 - 1) * lim, 0, GROUND_Z[0] + 0.2 + Math.random() * (GROUND_Z[1] - GROUND_Z[0] - 0.4));
        break;
      }
      case 'sleep':
        this.target = A.nest.clone();
        this.mood = 'sleepy';
        break;
      case 'shelter':
        this.target = A.shelter.clone().add(new THREE.Vector3(0.1, 0, 0.15));
        break;
      case 'bask':
        this.target = A.sunny.clone().add(jitter());
        this.mood = 'content';
        break;
      case 'play':
        this.target = this.stage.ball.position.clone().setY(0);
        this.mood = 'happy';
        break;
      case 'sit':
      case 'groom':
        this.mood = a === 'groom' ? 'content' : 'neutral';
        break;
      case 'shiver':
        this.mood = 'sad';
        break;
      case 'look_edge':
        if (opts.edgeX !== undefined) {
          this.target = new THREE.Vector3(opts.edgeX - Math.sign(opts.edgeX) * 1.0, 0, this.pos.z);
          this.look = new THREE.Vector3(opts.edgeX * 2, 0.5, this.pos.z);
        }
        this.mood = 'surprised';
        break;
      case 'greet_guest':
        if (opts.guest) {
          const dir = opts.guest.clone().sub(this.pos).setY(0);
          const d = dir.length();
          if (d > 0.9) this.target = this.pos.clone().addScaledVector(dir.normalize(), d - 0.75);
          this.look = opts.guest.clone().setY(0.6);
        }
        this.mood = 'happy';
        break;
      default:
        break;
    }
  }

  // ───────────── scripted beats

  wait(ms: number, run?: (k: number) => void): Task {
    return { dur: ms, run: (k) => run?.(k) };
  }

  /** Peek at the edge, then glance back at the player: "are you coming?" */
  approachEdge(edge: 'left' | 'right') {
    const ex = this.stage.edgeX(edge, this.pos.z, 0);
    const spot = new THREE.Vector3(ex - Math.sign(ex) * 0.55, 0, Math.max(GROUND_Z[0] + 0.2, Math.min(GROUND_Z[1] - 0.2, this.pos.z)));
    this.script([
      { dur: 220, enter: () => ((this.mood = 'surprised'), this.earFlick(1.2)) },
      this.moveTo(spot, 1.6),
      { dur: 500, enter: () => (this.look = new THREE.Vector3(ex * 3, 0.5, spot.z)) },
      { dur: 140, enter: () => this.earFlick(1.6) },
      { dur: 650, enter: () => (this.look = this.camLook()) },
      { dur: 99_999, enter: () => ((this.look = new THREE.Vector3(ex * 3, 0.5, spot.z)), (this.mood = 'happy')) },
    ]);
  }

  /** Move to a point at a speed, as one task whose duration is computed on entry. */
  moveTo(to: THREE.Vector3, speed = 1.1): Task {
    const task: Task = {
      dur: 1,
      enter: () => {
        task.dur = Math.max(120, (this.pos.distanceTo(to) / speed) * 1000);
      },
      run: (_k, dt) => this.stepToward(to, speed, dt),
    };
    return task;
  }

  /**
   * The crossing hop. `hop` is in global px; `mine` is this window's rect in that space.
   * Both screens run this with the same hop and start time; each sees its own slice.
   */
  hopTask(hop: Hop, mine: Rect, at: number, dur: number, side: 'out' | 'in', onDone?: () => void): Task[] {
    const pre: Task = {
      dur: 0,
      at,
      enter: () => {
        if (side === 'out') this.squashImpulse(-0.35);
      },
    };
    let lastX = 0;
    const fly: Task = {
      dur,
      at,
      enter: () => {
        this.visible = true;
        this.appear = 1;
        this.mood = 'happy';
        this.look = null;
        if (side === 'out') this.squashImpulse(0.45);
        lastX = this.pos.x;
      },
      run: (k) => {
        const { p, height } = hopAt(hop, k);
        const g = this.stage.toWorld(toLocal(p, mine), 0);
        this.pos.set(g.x, 0, Math.max(GROUND_Z[0] - 0.5, Math.min(GROUND_Z[1] + 0.5, g.z)));
        this.height = height;
        const dx = this.pos.x - lastX;
        if (Math.abs(dx) > 1e-4) this.yaw = Math.atan2(dx, 0.0001 + (g.z - this.pos.z));
        lastX = this.pos.x;
        // tuck legs mid-air
        for (const l of this.parts.legs) l.scale.y = 0.6 + 0.4 * Math.abs(1 - 2 * k);
      },
      exit: () => {
        for (const l of this.parts.legs) l.scale.y = 1;
        this.height = 0;
        if (side === 'in') {
          this.squashImpulse(-0.55);
          this.dust();
        } else {
          this.visible = false;
        }
        onDone?.();
      },
    };
    return [pre, fly];
  }

  /** Beat 5: the host's KIN reacts in its own way. */
  reactTo(r: Reaction, other: () => THREE.Vector3): Task[] {
    const toward = (d: number) => {
      const o = other();
      const dir = o.clone().sub(this.pos).setY(0).normalize();
      return this.pos.clone().addScaledVector(dir, d);
    };
    const lookOther = () => (this.look = other().clone().setY(0.6));
    switch (r) {
      case 'eager':
        return [
          { dur: 200, enter: () => (lookOther(), (this.mood = 'surprised'), this.earFlick(1.8)) },
          { dur: 1, enter: () => this.queue.unshift(this.moveTo(toward(Math.max(0, other().distanceTo(this.pos) - 0.7)), 2.4)) },
          { dur: 380, enter: () => ((this.mood = 'happy'), this.squashImpulse(0.5)) },
          { dur: 380, enter: () => this.squashImpulse(0.5) },
        ];
      case 'playful':
        return [
          { dur: 250, enter: () => (lookOther(), (this.mood = 'happy')) },
          { dur: 700, enter: () => this.squashImpulse(0.6), run: (k) => ((this.yaw += 0.21), (this.height = Math.sin(k * Math.PI) * 0.35)), exit: () => ((this.height = 0), this.squashImpulse(-0.4)) },
          { dur: 300, enter: lookOther },
        ];
      case 'cautious':
        return [
          { dur: 260, enter: () => (lookOther(), (this.mood = 'surprised'), this.earFlat()) },
          { dur: 1, enter: () => this.queue.unshift(this.moveTo(toward(-0.35), 1.2)) },
          { dur: 900, enter: () => (lookOther(), (this.mood = 'neutral')) },
          { dur: 1, enter: () => this.queue.unshift(this.moveTo(toward(0.2), 0.5)) },
          { dur: 300, enter: () => ((this.mood = 'happy'), this.earFlick(1)) },
        ];
      case 'aloof':
        return [
          { dur: 450, enter: () => (lookOther(), (this.mood = 'neutral')) },
          { dur: 900, enter: () => ((this.look = this.camLook()), (this.mood = 'content')) },
          { dur: 400, enter: lookOther },
        ];
    }
  }

  /** Portal-style vanish/appear for non-ceremonial exits (cancel, lease expiry, reduced motion). */
  fade(out: boolean, ms = 520, onDone?: () => void): Task {
    return {
      dur: ms,
      enter: () => (this.visible = true),
      run: (k) => (this.appear = out ? 1 - k : k),
      exit: () => {
        this.appear = out ? 0 : 1;
        this.visible = !out;
        onDone?.();
      },
    };
  }

  placeAt(x: number, z: number) {
    this.pos.set(x, 0, z);
    this.target = null;
  }

  // ───────────── micro-expressions

  pet(strength: number) {
    this.petting = Math.min(1, this.petting + strength);
    this.mood = 'happy';
  }

  squashImpulse(v: number) {
    this.sq.vel += v * 6;
  }

  earFlick(v = 1) {
    this.ear[0]!.v += 9 * v;
    this.ear[1]!.v -= 9 * v;
  }

  earFlat() {
    this.ear[0]!.v -= 7;
    this.ear[1]!.v += 7;
  }

  private camLook() {
    return new THREE.Vector3(this.pos.x * 0.6, 2.2, 6);
  }

  private dust() {
    const n = 7;
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false });
    const geo = new THREE.SphereGeometry(0.035, 8, 6);
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      const a = (i / n) * Math.PI * 2;
      m.position.copy(this.pos).add(new THREE.Vector3(Math.cos(a) * 0.15, 0.03, Math.sin(a) * 0.1));
      m.userData.v = new THREE.Vector3(Math.cos(a) * 0.6, 0.15, Math.sin(a) * 0.35);
      puffs.push(m);
      this.stage.world.add(m);
    }
    let t = 0;
    const step = () => {
      t += 1 / 60;
      for (const m of puffs) {
        m.position.addScaledVector(m.userData.v as THREE.Vector3, 1 / 60);
        m.scale.setScalar(1 + t * 3);
      }
      mat.opacity = 0.55 * (1 - t / 0.5);
      if (t < 0.5) requestAnimationFrame(step);
      else {
        puffs.forEach((m) => this.stage.world.remove(m));
        geo.dispose();
        mat.dispose();
      }
    };
    requestAnimationFrame(step);
  }

  private stepToward(to: THREE.Vector3, speed: number, dt: number) {
    const d = to.clone().sub(this.pos).setY(0);
    const dist = d.length();
    if (dist < 0.03) {
      this.height = 0;
      return true;
    }
    const v = Math.min(dist, speed * dt);
    this.pos.addScaledVector(d.normalize(), v);
    this.yaw = turn(this.yaw, Math.atan2(d.x, d.z), dt * 10);
    // Hop-walk: little bounces, squash on each landing.
    const prev = this.stepPhase;
    this.stepPhase += dt * (3.2 + speed * 1.5);
    this.height = Math.abs(Math.sin(this.stepPhase * Math.PI)) * 0.07 * Math.min(1, speed);
    if (Math.floor(prev) !== Math.floor(this.stepPhase)) this.squashImpulse(-0.12);
    return false;
  }

  // ───────────── per-frame

  update(dt: number, now: number, t: number) {
    const P = this.parts;
    // Script runner. Beats run on the wall clock, not frame time, so a slow device stays in
    // sync with the other screen (and a late start joins mid-beat instead of drifting).
    if (!this.cur && this.queue.length) this.cur = { task: this.queue.shift()!, t: 0, started: false };
    if (this.cur) {
      const c = this.cur;
      if (!c.started && (c.task.at === undefined || now >= c.task.at)) {
        c.started = true;
        c.t = c.task.at !== undefined ? c.task.at : now;
        c.task.enter?.();
      }
      if (c.started) {
        const k = Math.min(1, (now - c.t) / Math.max(1, c.task.dur));
        c.task.run?.(k, dt);
        if (k >= 1) {
          c.task.exit?.();
          this.cur = null;
        }
      }
    } else if (this.target) {
      const speed = this.action === 'play' ? 1.6 : this.action === 'sleep' || this.action === 'shelter' ? 0.9 : 0.75;
      if (this.action === 'play') this.target.copy(this.stage.ball.position).setY(0);
      if (this.stepToward(this.target, speed, dt)) {
        if (this.action === 'play') {
          // boop the ball
          const b = this.stage.ball.position;
          const dir = b.clone().sub(this.pos).setY(0).normalize();
          this.stage.ballVel.addScaledVector(dir, 1.6 + Math.random());
          this.squashImpulse(0.4);
        } else {
          this.target = null;
        }
      }
    }

    // Head look: target, or idle glances around the diorama.
    let lookAt = this.look;
    if (!lookAt) {
      if (now > this.glanceAt) {
        this.glanceAt = now + 1400 + Math.random() * 2600;
        this.glance.set(this.pos.x + (Math.random() - 0.5) * 4, 0.3 + Math.random() * 0.8, this.pos.z + 1 + Math.random() * 3);
      }
      lookAt = this.glance;
    }
    const rel = lookAt.clone().sub(this.pos);
    const wantYaw = Math.atan2(rel.x, rel.z) - this.yaw;
    const yawRel = Math.max(-1.1, Math.min(1.1, wrap(wantYaw)));
    const wantPitch = Math.max(-0.35, Math.min(0.45, -Math.atan2(rel.y - 0.7, Math.hypot(rel.x, rel.z))));
    this.headYaw += (yawRel - this.headYaw) * Math.min(1, dt * 8);
    this.headPitch += (wantPitch - this.headPitch) * Math.min(1, dt * 6);
    // Body follows the head when it turns far.
    if (Math.abs(this.headYaw) > 0.8 && !this.cur?.task.run) this.yaw = turn(this.yaw, this.yaw + this.headYaw * 0.5, dt * 2);
    const headVel = (this.headYaw - this.lastHeadYaw) / Math.max(dt, 1e-3);
    this.lastHeadYaw = this.headYaw;

    // Squash spring
    const sq = this.sq;
    sq.vel += (-(sq.v - 1) * 160 - sq.vel * 11) * dt;
    sq.v += sq.vel * dt;

    // Breathing, shiver, sleep pose
    this.breathPhase += dt * (this.action === 'sleep' ? 1.4 : 2.6);
    const breath = Math.sin(this.breathPhase) * (this.action === 'sleep' ? 0.03 : 0.015);
    this.shiver = this.action === 'shiver' ? Math.min(1, this.shiver + dt * 3) : Math.max(0, this.shiver - dt * 3);
    const shake = this.shiver * Math.sin(t * 60) * 0.012;
    const lying = this.action === 'sleep' && !this.target ? 1 : 0;

    const sy = sq.v * (1 + breath) * (1 - lying * 0.12);
    const sxz = 1 / Math.sqrt(Math.max(0.4, sq.v));
    P.squash.scale.set(sxz * (1 - breath * 0.4), sy, sxz);

    // Petting: lean into the hand, eyes squeeze shut with joy.
    this.petting = Math.max(0, this.petting - dt * 0.9);
    P.squash.rotation.z = Math.sin(t * 2.2) * 0.06 * this.petting + shake;

    P.head.rotation.set(this.headPitch + lying * 0.25, this.headYaw, Math.sin(t * 0.9) * 0.04 + this.petting * 0.15);

    // Eyes: blink, mood shapes
    if (now > this.blinkAt) {
      this.blinkAt = now + 2200 + Math.random() * 3800;
      this.blinkK = 1;
    }
    this.blinkK = Math.max(0, this.blinkK - dt * 7);
    const blink = this.blinkK > 0 ? Math.sin(this.blinkK * Math.PI) : 0;
    let lid = blink;
    let eyeY = 1;
    let eyeS = 1;
    if (this.mood === 'sleepy' || this.action === 'sleep') lid = Math.max(lid, lying ? 1 : 0.55);
    if (this.mood === 'content') lid = Math.max(lid, 0.4);
    if (this.mood === 'happy' && this.petting > 0.25) eyeY = 0.35;
    if (this.mood === 'surprised') eyeS = 1.12;
    for (const [i, e] of P.eyes.entries()) {
      e.scale.set(eyeS, eyeS * eyeY, eyeS);
      const l = P.lids[i]!;
      l.visible = lid > 0.03;
      l.scale.y = this.eyeR * 1.25 * Math.max(0.03, lid);
      l.position.y = this.eyeR * 1.15 * (1 - lid);
    }
    for (const s of P.shine) s.visible = eyeY > 0.5 && lid < 0.8;
    P.mouth.scale.set(1, this.mood === 'happy' || this.mood === 'surprised' ? 1.4 : 1, 1);
    for (const c of P.cheeks) (c.material as THREE.MeshBasicMaterial).opacity = 0.35 + this.petting * 0.45;

    // Ears: springs excited by head turns, wind, mood.
    const wind = this.stage.sky ? Math.min(1, this.stage.sky.windKmh / 40) : 0;
    const droop = this.mood === 'sad' || this.action === 'shelter' ? -0.35 : this.mood === 'surprised' ? 0.2 : 0;
    for (const [i, e] of this.ear.entries()) {
      const side = i === 0 ? -1 : 1;
      const gust = wind * 0.18 * Math.sin(t * (5 + i) + i) + wind * 0.12;
      e.v += (-e.a * 90 - e.v * 9 + headVel * side * 0.8) * dt;
      e.a += e.v * dt;
      const ear = P.ears[i]!;
      ear.rotation.x = -droop * 0.9 + gust;
      ear.rotation.y = e.a * 0.25;
      ear.rotation.z = (ear.userData.z0 ??= ear.rotation.z) + e.a * 0.3 - side * droop * 0.6;
    }

    // Tail wag
    const wagTarget = this.mood === 'happy' ? 0.9 : this.mood === 'sad' ? 0.05 : 0.25;
    this.wag += (wagTarget - this.wag) * dt * 2;
    P.tail.rotation.y = Math.sin(t * (6 + this.wag * 6)) * 0.45 * this.wag;
    P.tail.rotation.x = -0.2 + wind * 0.2;

    // Groom: lift a paw and nuzzle it
    const groom = this.action === 'groom' && !this.target ? 1 : 0;
    P.legs[0]!.position.y = 0.085 + groom * (0.08 + Math.sin(t * 9) * 0.02);
    if (groom) this.headPitch += (0.35 - this.headPitch) * dt * 4;

    // Accent glow breathes; stronger at night.
    if (P.accentMat) P.accentMat.emissiveIntensity = (0.5 + 0.35 * Math.sin(t * 2.4)) * this.stage.glow * (this.genome.accent === 'ember' ? 1.6 : 1);
    if (P.accent && this.genome.accent === 'ember') P.accent.scale.set(1, 1 + Math.sin(t * 13) * 0.12, 1);

    // Compose transform
    const R = P.root;
    R.visible = this.visible && this.appear > 0.01;
    R.position.set(this.pos.x + shake, this.height, this.pos.z);
    R.rotation.set(0, this.yaw, lying * 0.0);
    R.scale.setScalar(this.genome.size * easeOutBack(this.appear));
    this.shadow.visible = R.visible;
    this.shadow.position.set(this.pos.x, 0.006, this.pos.z);
    const sh = 0.75 * this.genome.size * (1 - Math.min(0.6, this.height * 0.5)) * this.appear;
    this.shadow.scale.set(sh, sh * 0.8, 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - Math.min(0.7, this.height * 0.6);
  }

  /** Head-centre screen position, for hit-testing taps and pets. */
  screenHit(): { x: number; y: number; r: number } {
    const c = this.stage.toScreen(this.pos.clone().setY(this.height + 0.55 * this.genome.size));
    return { ...c, r: 0.55 * this.genome.size * this.stage.px };
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const turn = (from: number, to: number, k: number) => from + wrap(to - from) * Math.min(1, k);
const easeOutBack = (x: number) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
