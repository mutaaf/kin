// Brings a creature to life. The brain says *what* (an Action); this decides *how* it looks and
// sounds: hop-walking with paw paddling, a head that leads and a body that follows, a face built
// from a smoothed expression state (lids, happy arcs, pupils, brows, mouth, blush), soft-body
// squish (belly and cheeks on springs, volume-preserving squash, breathing), ears and a
// multi-segment tail with follow-through, petting that responds by where you touch, personality
// idles, a babbling voice with lip sync, and tasteful emotes. Nothing here changes game state.
//
// ── Integration hooks for app.ts (all optional; existing calls keep working) ─────────────────────
//   view.zoneAt(x, y)            → TouchZone | null for a screen point (CSS px). Use on pointer
//                                  down/move instead of the round screenHit() test.
//   view.touch(zone, strength)   → zone-aware petting (head pat, chin scratch, belly rub, ear tug,
//                                  tail, poke while asleep). `pet(s)` still works (= head).
//   view.say(kind)               → voice + lip sync ('hello','happy','question','sleepy','sad',
//                                  'giggle','hey','grumble','yawn','sneeze','hum','love').
//   view.voice.unlock()          → call once from the first user gesture (next to sfx.unlock()).
//   view.voice.enabled = bool    → mirror the Sound setting.
//   view.emote(kind)             → 'heart','note','zzz','sparkle','sweat','question','cloud','exclaim'.
//   view.idleFlourish(kind?)     → play a personality idle now (otherwise they happen by themselves
//                                  every ~8–16 s when nothing else is going on).
//   view.express(mood, ms)       → hold a facial expression for a while.
//   view.setAge(days)            → baby → young proportions (days since hatch).
//   view.setFurTier(0..3)        → fur quality (0 = no shells). It also self-tunes from frame time.
//   view.reducedMotion = true    → calmer idles (no spins/rolls), same personality.
//
// ── Realism hooks (docs/REALISM.md; the world sets these when physics loads) ───────────────────
//   view.groundAt = (x, z, fromY) => y   the surface under a point (lawn, blocks, AR tables).
//                                        Feet plant on it; the body follows it. Default: y = 0.
//   view.mover = (at, delta) => pos      filters walking through the character controller
//                                        (slides along scenery, shoves toys). Default: none.
//   view.walking                         true on frames where walking moved the body (the world
//                                        then lets the controller own the capsule).
//   view.reach(point | null)             bring the mouth to a point (eating, sniffing): head IK +
//                                        a lean of the body.
//   view.mouthWorld()                    where a carried toy sits (fetch).
//   view.bumped(fromDir, strength)       something hit it: stagger, squash, look at it.
//   view.groundY                         the height it stands at (for shadows, AR anchoring).
// ────────────────────────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { Voice, type Utterance } from '../audio/voice';
import type { Action } from '../core/brain';
import type { Reaction } from '../core/creature';
import { makeTraits, type Genome, type Traits } from '../core/genome';
import { hopAt, toLocal, type Hop, type Rect } from './choreo';
import { DEFAULT_GAIT, Gait, type GaitFrame, type GroundFn } from './creature/gait';
import { buildCreature, type CreatureParts } from './creatureMesh';
import { Emotes, type EmoteKind } from './emotes';
import { GROUND_Z, type Stage } from './stage';

interface Task {
  dur: number;
  enter?: () => void;
  run?: (k: number, dt: number) => void;
  exit?: () => void;
  /** Optional absolute start time (epoch ms). */
  at?: number;
}

export type Mood = 'neutral' | 'happy' | 'sleepy' | 'surprised' | 'sad' | 'content' | 'love' | 'curious' | 'grumpy' | 'giggly';
export type TouchZone = 'head' | 'chin' | 'cheek' | 'belly' | 'ear' | 'tail' | 'back';
export type Flourish =
  | 'yawn' | 'sneeze' | 'shake' | 'tailChase' | 'headTilt' | 'hum' | 'rollOver' | 'stargaze' | 'catch' | 'nod' | 'stretch' | 'wave' | 'sniff';

/** The face, as numbers. Every frame the current face eases toward the target face. */
interface Face {
  lid: number; // 0 open … 1 closed
  lower: number; // lower lid squint
  happy: number; // ^ ^ arcs
  pupil: number; // 0.3 small … 0.62 big
  tilt: number; // brow: + worried (inner up), − cross
  mouth: number; // 0 closed … 1 open
  smile: number; // smile curve width
  blush: number;
  perk: number; // ears: −1 flat … +1 up
  wag: number; // tail energy
  cheek: number; // cheek puff
}

const NEUTRAL: Face = { lid: 0, lower: 0, happy: 0, pupil: 0.44, tilt: 0, mouth: 0, smile: 1, blush: 0.35, perk: 0, wag: 0.3, cheek: 0 };
const FACES: Record<Mood, Partial<Face>> = {
  neutral: {},
  happy: { lower: 0.2, pupil: 0.5, smile: 1.3, blush: 0.55, perk: 0.4, wag: 0.9, mouth: 0.15 },
  love: { happy: 1, smile: 1.35, blush: 0.95, perk: 0.2, wag: 0.8, pupil: 0.6, cheek: 0.6 },
  giggly: { happy: 1, mouth: 0.55, smile: 1.4, blush: 0.8, wag: 1, cheek: 0.4 },
  content: { lid: 0.42, lower: 0.2, smile: 1.15, blush: 0.5, wag: 0.4 },
  sleepy: { lid: 0.62, pupil: 0.5, perk: -0.35, wag: 0.1, smile: 0.9 },
  surprised: { pupil: 0.3, tilt: 0.55, mouth: 0.45, perk: 1, wag: 0.2, smile: 0.6 },
  curious: { pupil: 0.52, tilt: 0.3, perk: 0.7, wag: 0.5, smile: 0.9 },
  sad: { lid: 0.25, tilt: 0.85, pupil: 0.56, perk: -0.9, wag: 0.05, smile: 0.5, blush: 0.2 },
  grumpy: { lid: 0.32, tilt: -0.75, perk: -0.4, wag: 0.1, smile: 0.45, cheek: 0.5 },
};

const shadowTex = (() => {
  let tex: THREE.Texture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(10,14,20,0.5)');
    grd.addColorStop(1, 'rgba(10,14,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

/** Self-tuning fur quality shared by every KinView on the page. */
const furGovernor = { tier: -1, max: 3, slow: 0, fast: 0 };

export class KinView {
  readonly parts: CreatureParts;
  readonly pos = new THREE.Vector3();
  readonly voice: Voice;
  readonly traits: Traits;
  yaw = 0;
  height = 0;
  mood: Mood = 'neutral';
  action: Action = 'idle';
  /** Where the head wants to look (world), or null for idle glances. */
  look: THREE.Vector3 | null = null;
  petting = 0;
  visible = true;
  reducedMotion = false;
  /** The surface under a point. Physics (and AR) replace the flat lawn. */
  groundAt: GroundFn = () => 0;
  /** Walking goes through this (the physics character controller) when set. */
  mover: ((at: { x: number; y: number; z: number }, delta: { x: number; y: number; z: number }) => { x: number; y: number; z: number }) | null = null;
  /** True on frames in which walking moved the body. */
  walking = false;
  /** Height of the surface it stands on. */
  groundY = 0;

  private shadow: THREE.Mesh;
  private emotes: Emotes;
  private queue: Task[] = [];
  private cur: { task: Task; t: number; started: boolean } | null = null;
  private target: THREE.Vector3 | null = null;
  private stepPhase = 0;
  private sq = { v: 1, vel: 0 };
  private ear = [{ a: 0, v: 0, x: 0, xv: 0 }, { a: 0, v: 0, x: 0, xv: 0 }];
  private tailSpring = { x: 0, v: 0 };
  private belly = { p: new THREE.Vector3(), v: new THREE.Vector3() };
  private lastWorld = new THREE.Vector3();
  private lastVel = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private headYaw = 0;
  private headPitch = 0;
  private extraPitch = 0;
  private extraRoll = 0;
  private lastHeadYaw = 0;
  private blinkAt = 0;
  private blinkK = 0;
  private blinkSpeed = 7;
  private glanceAt = 0;
  private glance = new THREE.Vector3();
  private saccade = new THREE.Vector2();
  private saccadeAt = 0;
  private appear = 1;
  private shiver = 0;
  private face: Face = { ...NEUTRAL };
  private hold: { mood: Mood; until: number } | null = null;
  private mouthCurve: { fn: (ms: number) => number; at: number } | null = null;
  private breathPhase = Math.random() * 10;
  private nextFlourish = 0;
  private lastFlourish: Flourish | null = null;
  private zzzAt = 0;
  private wasWet = false;
  private touchCool: Partial<Record<TouchZone, number>> = {};
  private touchSum: Partial<Record<TouchZone, number>> = {};
  private oneEyeOpen = 0;
  private spin = 0; // extra yaw from tail chase / roll
  private roll = 0; // body roll (belly rub, roll over)
  private pawPose = [0, 0]; // 0 rest … 1 raised
  private pawWave = 0;
  private age = 0;
  private frameAvg = 1 / 60;
  private gait: Gait;
  private gf: GaitFrame | null = null;
  /** This frame's gait state (feet, contacts), for debug overlays and the world's footfall cues. */
  get gaitFrame(): GaitFrame | null {
    return this.gf;
  }
  private physY = 0;
  private stuck = 0;
  private lastYaw = 0;
  private lean = { pitch: 0, roll: 0 };
  private reachAt: THREE.Vector3 | null = null;
  private reachK = 0;
  private stagger = { x: 0, z: 0, k: 0 };
  private wasWalking = false;
  /** Set by any walking step since the last update (consumed at the end of update). */
  private walked = false;

  constructor(readonly genome: Genome, private stage: Stage) {
    this.parts = buildCreature(genome);
    this.traits = makeTraits(genome.seed);
    this.voice = new Voice(genome);
    this.emotes = new Emotes(stage.world);
    // Bouncier, more energetic KIN switch to hopping sooner and bob more.
    this.gait = new Gait({ ...DEFAULT_GAIT, size: genome.size, bounce: Math.min(1, this.traits.playfulness * 0.6 + this.traits.energy * 0.4) });
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    stage.world.add(this.parts.root, this.shadow);
    if (furGovernor.tier >= 0) this.parts.setFurTier(furGovernor.tier);
    this.nextFlourish = Date.now() + 5000 + Math.random() * 6000;
  }

  dispose() {
    this.stage.world.remove(this.parts.root, this.shadow);
    this.emotes.dispose();
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
    this.reachAt = null; // a new intent straightens up (an interrupted meal never leaves it bent)
    // Task lists come from several systems (brain, world actors, crossing); never queue a hole.
    this.queue = tasks.filter(Boolean);
  }

  then(tasks: Task[]) {
    this.queue.push(...tasks.filter(Boolean));
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
        this.mood = Math.random() < 0.4 ? 'curious' : 'neutral';
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
        this.target = this.stage.ballPosition();
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
        this.mood = 'curious';
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
      { dur: 220, enter: () => ((this.mood = 'surprised'), this.earFlick(1.2), this.emote('exclaim')) },
      this.moveTo(spot, 1.6),
      { dur: 500, enter: () => ((this.look = new THREE.Vector3(ex * 3, 0.5, spot.z)), (this.mood = 'curious')) },
      { dur: 140, enter: () => this.earFlick(1.6) },
      { dur: 700, enter: () => ((this.look = this.camLook()), this.say('question'), (this.extraRoll = 0.18)), exit: () => (this.extraRoll = 0) },
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
        if (side === 'out') {
          this.squashImpulse(0.45);
          this.say('happy');
        }
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
        // Paws reach forward mid-air, like a little superhero.
        const air = Math.sin(k * Math.PI);
        this.pawPose = [air, air];
      },
      exit: () => {
        this.pawPose = [0, 0];
        this.height = 0;
        if (side === 'in') {
          this.squashImpulse(-0.6);
          this.dust();
          this.say('hello');
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
          { dur: 200, enter: () => (lookOther(), (this.mood = 'surprised'), this.earFlick(1.8), this.emote('exclaim')) },
          { dur: 1, enter: () => this.queue.unshift(this.moveTo(toward(Math.max(0, other().distanceTo(this.pos) - 0.7)), 2.4)) },
          { dur: 380, enter: () => ((this.mood = 'happy'), this.squashImpulse(0.5), this.say('hello')) },
          { dur: 600, enter: () => (this.squashImpulse(0.5), this.wave(), this.emote('heart')) },
        ];
      case 'playful':
        return [
          { dur: 250, enter: () => (lookOther(), (this.mood = 'giggly'), this.say('giggle')) },
          {
            dur: 700,
            enter: () => this.squashImpulse(0.6),
            run: (k) => ((this.spin = k * Math.PI * 2), (this.height = Math.sin(k * Math.PI) * 0.35)),
            exit: () => ((this.spin = 0), (this.height = 0), this.squashImpulse(-0.4), this.emote('note')),
          },
          { dur: 300, enter: lookOther },
        ];
      case 'cautious':
        return [
          { dur: 260, enter: () => (lookOther(), (this.mood = 'surprised'), this.earFlat(), this.emote('sweat')) },
          { dur: 1, enter: () => this.queue.unshift(this.moveTo(toward(-0.35), 1.2)) },
          { dur: 900, enter: () => (lookOther(), (this.mood = 'sad'), this.say('question')) },
          { dur: 1, enter: () => this.queue.unshift(this.moveTo(toward(0.2), 0.5)) },
          { dur: 400, enter: () => ((this.mood = 'happy'), this.earFlick(1), this.say('happy')) },
        ];
      case 'aloof':
        return [
          { dur: 450, enter: () => (lookOther(), (this.mood = 'neutral')) },
          { dur: 900, enter: () => ((this.look = this.camLook()), (this.mood = 'content'), this.say('hum')) },
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
    // Stand on whatever is there, both feet planted under the hips.
    this.gait.plantAll(x, z, this.yaw, this.groundAt);
    this.groundY = this.gait.groundY;
    this.lastWorld.set(x, this.groundY, z);
    this.physY = this.groundY;
  }

  // ───────────── physical interactions

  /** Bring the mouth to a world point (eat, sniff), or null to straighten up. */
  reach(point: THREE.Vector3 | null) {
    this.reachAt = point ? point.clone() : null;
  }

  /** World position of the mouth: where a carried toy sits. */
  mouthWorld(): THREE.Vector3 {
    const p = new THREE.Vector3();
    this.parts.mouth.open.getWorldPosition(p);
    // A toy held in the mouth sits just in front of the lips, not inside the head.
    const fwd = new THREE.Vector3(Math.sin(this.yaw), -0.25, Math.cos(this.yaw)).normalize();
    return p.addScaledVector(fwd, 0.07 * this.genome.size);
  }

  /** Something hit it (a thrown ball): stagger away from the hit, squash, look at what did it. */
  bumped(from: THREE.Vector3, strength: number) {
    const s = Math.max(0, Math.min(1, strength));
    const away = this.pos.clone().sub(from).setY(0);
    if (away.lengthSq() < 1e-6) away.set(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI));
    away.normalize();
    this.stagger = { x: away.x * (0.35 + s * 0.5), z: away.z * (0.35 + s * 0.5), k: 1 };
    this.squashImpulse(-0.35 - s * 0.35);
    this.earFlick(1 + s);
    this.look = from.clone().setY(this.groundY + 0.3);
    this.express(s > 0.5 ? 'surprised' : 'curious', 900);
    if (s > 0.35) this.say('hey');
    setTimeout(() => {
      if (this.look && this.look.distanceTo(from) < 0.6) this.look = null;
    }, 1400);
  }

  // ───────────── expression, voice, emotes, growth

  /** Hold a facial expression for a while (the brain's mood resumes afterwards). */
  express(mood: Mood, ms = 1200) {
    this.hold = { mood, until: Date.now() + ms };
  }

  say(kind: Utterance) {
    this.mouthCurve = { fn: this.voice.say(kind), at: Date.now() };
  }

  emote(kind: EmoteKind) {
    this.emotes.show(kind, this.headTop(), Date.now());
  }

  setAge(days: number) {
    this.age = Math.max(0, Math.min(1, days / 45));
  }

  setFurTier(tier: number) {
    furGovernor.tier = furGovernor.max = tier;
    this.parts.setFurTier(tier);
  }

  // ───────────── touch

  pet(strength: number) {
    this.touch('head', strength);
  }

  /** Which part of the creature is under a screen point (CSS px), or null if none. */
  zoneAt(x: number, y: number): TouchZone | null {
    const P = this.parts;
    P.root.updateMatrixWorld(true);
    const S = this.genome.size;
    const pts: [TouchZone, THREE.Vector3, number][] = [
      ['ear', P.ears[0]!.localToWorld(new THREE.Vector3(0, 0.16, 0)), 0.09],
      ['ear', P.ears[1]!.localToWorld(new THREE.Vector3(0, 0.16, 0)), 0.09],
      ['head', P.head.localToWorld(new THREE.Vector3(0, P.form.head.y - P.form.neckY + 0.2, -0.02)), 0.2],
      ['cheek', P.head.localToWorld(new THREE.Vector3(-0.22, P.form.head.y - P.form.neckY - 0.1, 0.25)), 0.1],
      ['cheek', P.head.localToWorld(new THREE.Vector3(0.22, P.form.head.y - P.form.neckY - 0.1, 0.25)), 0.1],
      ['chin', P.head.localToWorld(new THREE.Vector3(0, P.form.head.y - P.form.neckY - 0.24, 0.24)), 0.1],
      ['belly', P.squash.localToWorld(new THREE.Vector3(0, 0.2, 0.2)), 0.16],
      ['tail', P.tail[P.tail.length - 1]!.localToWorld(new THREE.Vector3(0, 0, -0.04)), 0.12],
      ['back', P.squash.localToWorld(new THREE.Vector3(0, 0.3, -0.2)), 0.18],
    ];
    let best: TouchZone | null = null;
    let bd = Infinity;
    for (const [z, w, r] of pts) {
      const s = this.stage.toScreen(w);
      const d = Math.hypot(s.x - x, s.y - y) / (r * S * this.stage.px);
      if (d < 1 && d < bd) {
        bd = d;
        best = z;
      }
    }
    if (best) return best;
    // Anywhere else on the silhouette counts as the head/back.
    const h = this.screenHit();
    return Math.hypot(x - h.x, (y - h.y) * 0.9) < h.r ? 'head' : null;
  }

  /** Zone-aware response to a stroke or tap. `strength` ~0.05 per pointer move, ~0.4 for a tap. */
  touch(zone: TouchZone, strength: number) {
    const now = Date.now();
    this.touchSum[zone] = (this.touchSum[zone] ?? 0) + strength;
    const sum = this.touchSum[zone]!;
    const ready = now > (this.touchCool[zone] ?? 0);
    const cool = (ms: number) => (this.touchCool[zone] = now + ms);
    const asleep = this.action === 'sleep' && !this.target;
    this.petting = Math.min(1, this.petting + strength * (zone === 'head' || zone === 'chin' || zone === 'cheek' ? 1 : 0.5));

    if (asleep) {
      if (ready) {
        this.say('grumble');
        this.oneEyeOpen = 1;
        this.express('grumpy', 900);
        cool(2500);
      }
      return;
    }
    switch (zone) {
      case 'head':
        this.express(this.petting > 0.35 ? 'love' : 'happy', 700);
        this.extraPitch = 0.12; // lean into the hand
        if (sum > 1.2 && ready) {
          this.say('love');
          this.emote('heart');
          this.touchSum.head = 0;
          cool(2200);
        }
        break;
      case 'chin':
      case 'cheek':
        this.express('content', 900);
        this.extraPitch = -0.28; // chin up
        this.extraRoll = zone === 'cheek' ? 0.25 : 0.1;
        if (sum > 0.8 && ready) {
          // The happy leg kick.
          this.pawPose = [0.9, 0];
          setTimeout(() => (this.pawPose = [0, 0]), 380);
          this.squashImpulse(0.25);
          this.say('happy');
          this.touchSum[zone] = 0;
          cool(1800);
        }
        break;
      case 'belly':
        this.express('giggly', 900);
        this.roll = Math.sin(now / 70) * 0.22;
        if (ready) {
          this.say('giggle');
          cool(1400);
        }
        if (sum > 2.2 && !this.busy && !this.reducedMotion) {
          this.touchSum.belly = 0;
          this.idleFlourish('rollOver');
        }
        break;
      case 'ear':
        if (ready) {
          this.earFlick(2.2);
          this.say('hey');
          this.express('grumpy', 700);
          this.emote('exclaim');
          cool(1600);
        }
        break;
      case 'tail':
        if (ready && !this.busy) {
          this.emote('question');
          this.idleFlourish(this.reducedMotion ? 'headTilt' : 'tailChase');
          cool(3000);
        }
        break;
      case 'back':
        this.express('content', 700);
        this.squashImpulse(-0.05);
        if (sum > 1.5 && ready) {
          this.say('hum');
          this.emote('note');
          this.touchSum.back = 0;
          cool(2500);
        }
        break;
    }
  }

  // ───────────── personality idles

  /** Play a short idle flourish now; picks one that suits the moment when no kind is given. */
  idleFlourish(kind?: Flourish) {
    const k = kind ?? this.chooseFlourish();
    if (!k) return;
    this.lastFlourish = k;
    const camLook = () => (this.look = this.camLook());
    const up = () => (this.look = this.pos.clone().add(new THREE.Vector3(0.1, 4, 0.6)));
    const done = () => {
      this.look = null;
      this.extraPitch = 0;
      this.extraRoll = 0;
      this.spin = 0;
      this.roll = 0;
    };
    switch (k) {
      case 'yawn':
        this.script([
          { dur: 900, enter: () => (this.express('sleepy', 1600), this.say('yawn')), run: (q) => ((this.mouthCurve = null), (this.face.mouth = Math.sin(q * Math.PI) * 0.95), (this.extraPitch = -0.25 * Math.sin(q * Math.PI))) },
          { dur: 500, run: (q) => (this.pawPose = [Math.sin(q * Math.PI) * 0.8, Math.sin(q * Math.PI) * 0.8]), exit: done },
        ]);
        break;
      case 'stretch':
        this.script([
          { dur: 900, enter: () => this.express('content', 1200), run: (q) => ((this.sq.v = 1 - 0.18 * Math.sin(q * Math.PI)), (this.extraPitch = -0.3 * Math.sin(q * Math.PI)), (this.pawPose = [Math.sin(q * Math.PI), Math.sin(q * Math.PI)])), exit: done },
        ]);
        break;
      case 'sneeze':
        this.script([
          { dur: 520, enter: () => (this.express('surprised', 600), this.say('sneeze')), run: (q) => (this.extraPitch = -0.3 * q) },
          { dur: 260, enter: () => (this.squashImpulse(0.7), this.earFlick(2), (this.extraPitch = 0.3)) },
          { dur: 500, enter: () => (this.express('happy', 600), this.emote('sparkle')), exit: done },
        ]);
        break;
      case 'shake':
        this.script([
          { dur: 800, enter: () => this.express('grumpy', 800), run: (q) => ((this.roll = Math.sin(q * 40) * 0.2 * (1 - q)), (this.extraRoll = Math.sin(q * 40 + 1) * 0.35 * (1 - q))) },
          { dur: 300, enter: () => (this.express('happy', 500), this.emote('sparkle')), exit: done },
        ]);
        break;
      case 'tailChase':
        this.script([
          { dur: 300, enter: () => (this.express('curious', 2000), this.emote('question')) },
          { dur: 1500, enter: () => this.say('giggle'), run: (q) => ((this.spin = q * Math.PI * 4), (this.height = Math.abs(Math.sin(q * Math.PI * 8)) * 0.05)), exit: () => ((this.height = 0), this.squashImpulse(-0.3)) },
          { dur: 500, enter: () => (this.express('giggly', 700), camLook()), exit: done },
        ]);
        break;
      case 'headTilt':
        this.script([
          { dur: 1100, enter: () => (camLook(), this.express('curious', 1100), this.say('question')), run: (q) => (this.extraRoll = Math.sin(q * Math.PI) * 0.42), exit: done },
        ]);
        break;
      case 'hum':
        this.script([
          { dur: 2200, enter: () => (this.express('content', 2200), this.say('hum'), this.emote('note')), run: (q) => (this.extraRoll = Math.sin(q * Math.PI * 4) * 0.14), exit: done },
        ]);
        break;
      case 'rollOver':
        this.script([
          { dur: 500, enter: () => (this.express('giggly', 1600), this.say('giggle')), run: (q) => (this.roll = q * Math.PI * 0.55) },
          { dur: 700, run: (q) => ((this.pawPose = [0.6 + Math.sin(q * 20) * 0.3, 0.6 + Math.cos(q * 20) * 0.3]), (this.roll = Math.PI * 0.55)) },
          { dur: 500, run: (q) => (this.roll = (1 - q) * Math.PI * 0.55), exit: () => ((this.pawPose = [0, 0]), done(), this.emote('heart')) },
        ]);
        break;
      case 'stargaze':
        this.script([{ dur: 2600, enter: () => (up(), this.express('content', 2600), this.emote('sparkle')), exit: done }]);
        break;
      case 'catch': {
        const snow = !!this.stage.sky?.snow;
        this.script([
          { dur: 900, enter: () => (up(), this.express('curious', 1600)) },
          { dur: 600, enter: () => ((this.look = this.pos.clone().add(new THREE.Vector3(0, 0.75, 0.6))), (this.face.pupil = 0.6), this.squashImpulse(0.3)) },
          snow
            ? { dur: 600, enter: () => (this.say('sneeze'), this.squashImpulse(0.6), this.emote('sparkle')), exit: done }
            : { dur: 600, enter: () => (this.express('happy', 700), this.say('happy'), this.emote('sparkle')), exit: done },
        ]);
        break;
      }
      case 'nod':
        this.script([
          { dur: 2000, enter: () => this.express('sleepy', 2200), run: (q) => (this.extraPitch = Math.max(0, Math.sin(q * Math.PI * 2.5)) * 0.35) },
          { dur: 400, enter: () => (this.express('surprised', 400), this.earFlick(1.5), this.squashImpulse(0.3)), exit: done },
        ]);
        break;
      case 'wave':
        this.script([{ dur: 1100, enter: () => (camLook(), this.express('happy', 1200), this.say('hello'), this.wave()), exit: done }]);
        break;
      case 'sniff':
        this.script([
          { dur: 1200, enter: () => ((this.look = this.pos.clone().add(new THREE.Vector3(0.2, 0, 0.5))), this.express('curious', 1200)), run: (q) => (this.face.cheek = 0.4 + Math.sin(q * 50) * 0.3) },
          { dur: 300, enter: () => this.emote('question'), exit: done },
        ]);
        break;
    }
  }

  private chooseFlourish(): Flourish | null {
    const sky = this.stage.sky;
    const T = this.traits;
    const night = (sky?.sunElev ?? 30) < -4;
    const r = Math.random();
    const opts: [Flourish, number][] = [
      ['headTilt', 1 + T.curiosity],
      ['hum', 0.6 + T.warmth],
      ['stretch', 0.6],
      ['sniff', 0.5 + T.curiosity],
      ['wave', 0.4 + T.warmth * 0.8],
      ['tailChase', this.reducedMotion ? 0 : T.playfulness * 1.6],
      ['rollOver', this.reducedMotion ? 0 : T.playfulness * 0.8],
      ['yawn', night || this.mood === 'sleepy' ? 1.6 : 0.3],
      ['nod', night ? 1 : 0.1],
      ['stargaze', night && (sky?.cloud ?? 1) < 0.6 ? 1.5 : 0],
      ['sneeze', sky && sky.tempC < 6 ? 1.2 : 0.05],
      ['catch', sky && sky.precipMm > 0.1 ? (sky.snow ? 1.8 : 0.6) : 0],
    ];
    const pool = opts.filter(([k, w]) => w > 0 && k !== this.lastFlourish);
    const total = pool.reduce((a, [, w]) => a + w, 0);
    let x = r * total;
    for (const [k, w] of pool) if ((x -= w) <= 0) return k;
    return null;
  }

  private wave() {
    this.pawWave = 1;
  }

  // ───────────── legacy micro-expressions

  squashImpulse(v: number) {
    this.sq.vel += v * 6;
  }

  earFlick(v = 1) {
    this.ear[0]!.v += 9 * v;
    this.ear[1]!.v -= 9 * v;
  }

  earFlat() {
    this.ear[0]!.xv -= 6;
    this.ear[1]!.xv -= 6;
  }

  private camLook() {
    return new THREE.Vector3(this.pos.x * 0.6, 2.2, 6);
  }

  private headTop() {
    return this.pos.clone().setY(this.height + (this.parts.form.head.y + 0.45) * this.genome.size);
  }

  private dust() {
    const n = 8;
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
    const geo = new THREE.SphereGeometry(0.035, 10, 8);
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      const a = (i / n) * Math.PI * 2;
      m.position.copy(this.pos).add(new THREE.Vector3(Math.cos(a) * 0.15, 0.03, Math.sin(a) * 0.1));
      m.userData.v = new THREE.Vector3(Math.cos(a) * 0.6, 0.15, Math.sin(a) * 0.35);
      puffs.push(m);
      this.stage.world.add(m);
    }
    const t0 = performance.now();
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      for (const m of puffs) {
        m.position.addScaledVector(m.userData.v as THREE.Vector3, 1 / 60);
        m.scale.setScalar(1 + t * 3);
      }
      mat.opacity = 0.5 * (1 - t / 0.5);
      if (t < 0.5) requestAnimationFrame(step);
      else {
        puffs.forEach((m) => this.stage.world.remove(m));
        geo.dispose();
        mat.dispose();
      }
    };
    requestAnimationFrame(step);
  }

  /**
   * Walk toward a point. The body turns first when the target is behind (feet step around), then
   * moves through the physics character controller when one is attached, so it slides along the
   * mushroom and nudges toys instead of passing through them. The feet and the bob come from the
   * gait (planted feet, never skating). Returns true on arrival, or when it's been blocked for a
   * while (an unreachable spot: give up rather than walk in place).
   */
  /**
   * One frame of walking toward a point, stopping `stop` short of it (chasing a toy, reaching a
   * berry). For systems that drive the KIN from their own tasks (src/world). True on arrival.
   */
  walkToward(to: THREE.Vector3, speed: number, dt: number, stop = 0.03): boolean {
    return this.stepToward(to, speed, dt, stop);
  }

  private stepToward(to: THREE.Vector3, speed: number, dt: number, stop = 0.03) {
    const d = to.clone().sub(this.pos).setY(0);
    const dist = d.length() - Math.max(0, stop - 0.03);
    this.height = 0;
    if (dist < 0.03) {
      this.stuck = 0;
      return true;
    }
    const want = Math.atan2(d.x, d.z);
    const off = Math.abs(wrap(want - this.yaw));
    this.yaw = turn(this.yaw, want, dt * (off > 1.2 ? 6 : 10));
    // Ease into the walk: slow while still facing away (it turns, stepping, before it strides).
    const facing = Math.max(0.15, Math.cos(Math.min(Math.PI / 2, off)));
    const v = Math.min(dist, speed * dt * facing);
    const step = d.normalize().multiplyScalar(v);
    let moved = v;
    if (this.mover) {
      const r = this.mover({ x: this.pos.x, y: this.physY, z: this.pos.z }, { x: step.x, y: -0.02, z: step.z });
      moved = Math.hypot(r.x - this.pos.x, r.z - this.pos.z);
      this.pos.x = r.x;
      this.pos.z = r.z;
      this.physY = r.y;
    } else {
      this.pos.add(step);
    }
    this.walked = true;
    this.stepPhase += dt * (3.2 + speed * 1.5);
    this.stuck = moved < v * 0.25 && facing > 0.6 ? this.stuck + dt : 0;
    if (this.stuck > 0.7) {
      this.stuck = 0;
      return true;
    }
    return false;
  }

  // ───────────── per-frame

  update(dt: number, now: number, t: number) {
    const P = this.parts;
    this.tuneFur(dt);

    // Script runner. Beats run on the wall clock, not frame time, so a slow device stays in
    // sync with the other screen (and a late start joins mid-beat instead of drifting).
    while (!this.cur && this.queue.length) {
      const task = this.queue.shift();
      if (task) this.cur = { task, t: 0, started: false };
    }
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
      if (this.action === 'play') this.target.copy(this.stage.ballPosition());
      if (this.stepToward(this.target, speed, dt)) {
        if (this.action === 'play') {
          const dir = this.stage.ballPosition().sub(this.pos);
          this.stage.kickBall(dir, 1.6 + Math.random());
          this.squashImpulse(0.4);
          if (Math.random() < 0.35) this.say('giggle');
        } else {
          this.target = null;
          this.pawPose = [0, 0];
        }
      }
    } else if (this.visible && now > this.nextFlourish && this.action !== 'sleep' && this.action !== 'look_edge' && this.action !== 'greet_guest') {
      this.nextFlourish = now + 8000 + Math.random() * 8000;
      this.idleFlourish();
    }

    // Weather moments: shake off when the rain stops.
    const sky = this.stage.sky;
    const wet = !!sky && sky.precipMm > 0.1 && !sky.snow;
    if (this.wasWet && !wet && !this.busy) this.idleFlourish('shake');
    this.wasWet = wet;

    // Velocity / acceleration (for squish, fur lag and follow-through)
    const world = this.pos.clone().setY(this.groundY + this.height);
    this.vel.copy(world).sub(this.lastWorld).divideScalar(Math.max(dt, 1e-3));
    const acc = this.vel.clone().sub(this.lastVel).divideScalar(Math.max(dt, 1e-3));
    this.lastWorld.copy(world);
    this.lastVel.copy(this.vel);
    const toLocalDir = (v: THREE.Vector3) => v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    const accL = toLocalDir(acc).clampLength(0, 30);

    // ── Stagger: something hit it. A short shove through the controller, decaying fast.
    if (this.stagger.k > 0.01) {
      const k = this.stagger.k;
      const d = { x: this.stagger.x * k * dt * 2.2, y: -0.02, z: this.stagger.z * k * dt * 2.2 };
      if (this.mover) {
        const r = this.mover({ x: this.pos.x, y: this.physY, z: this.pos.z }, d);
        this.pos.x = r.x;
        this.pos.z = r.z;
        this.physY = r.y;
      } else {
        this.pos.x += d.x;
        this.pos.z += d.z;
      }
      this.walked = true;
      this.stagger.k *= Math.pow(0.02, dt);
    }

    // ── Gait: planted feet, stepping, and the body riding on them (src/render/creature/gait.ts).
    // In the air, mid-spin or rolled over, the feet ride with the body; they re-plant on landing.
    const free = this.height > 0.02 || Math.abs(this.spin) > 0.01 || Math.abs(this.roll) > 0.35 || !this.visible || this.appear < 0.5;
    const gf = this.gait.update({
      x: this.pos.x, z: this.pos.z, yaw: this.yaw + this.spin, vx: this.walked ? this.vel.x : 0, vz: this.walked ? this.vel.z : 0, dt,
      ground: this.groundAt, free, freeHeight: this.height,
    });
    this.gf = gf;
    this.groundY = gf.groundY;
    if (gf.touchdowns.length && !free) this.squashImpulse(gf.hopping ? -0.32 : -0.07);
    // Front paws swing opposite the back feet while walking (arms counter the legs).
    if (this.walked) {
      const l0 = gf.feet[0]!.lift;
      const l1 = gf.feet[1]!.lift;
      this.pawPose = gf.hopping ? [0.35 * Math.max(l0, l1), 0.35 * Math.max(l0, l1)] : [l1 * 0.32, l0 * 0.32];
      this.wasWalking = true;
    } else if (this.wasWalking) {
      this.wasWalking = false;
      this.pawPose = [0, 0];
    }
    // Lean: forward into acceleration, back when braking, into turns (centripetal), all soft.
    const yawRate = wrap(this.yaw - this.lastYaw) / Math.max(dt, 1e-3);
    this.lastYaw = this.yaw;
    const fwdSpeed = this.walked ? Math.hypot(this.vel.x, this.vel.z) : 0;
    const leanPitch = Math.max(-0.16, Math.min(0.2, accL.z * 0.012 + fwdSpeed * 0.05));
    const leanRoll = Math.max(-0.18, Math.min(0.18, -yawRate * fwdSpeed * 0.08));
    this.lean.pitch += (leanPitch - this.lean.pitch) * Math.min(1, dt * 7);
    this.lean.roll += (leanRoll - this.lean.roll) * Math.min(1, dt * 6);
    // Reach: lower the head and lean the body until the mouth meets the point (eating, sniffing).
    this.reachK += ((this.reachAt ? 1 : 0) - this.reachK) * Math.min(1, dt * 6);

    // Head look: target, or idle glances around the diorama.
    let lookAt = this.reachAt ?? this.look;
    if (!lookAt) {
      if (now > this.glanceAt) {
        this.glanceAt = now + 1400 + Math.random() * 2600;
        this.glance.set(this.pos.x + (Math.random() - 0.5) * 4, 0.3 + Math.random() * 0.8, this.pos.z + 1 + Math.random() * 3);
      }
      lookAt = this.glance;
    }
    const rel = lookAt.clone().sub(this.pos);
    rel.y -= this.groundY;
    const wantYaw = Math.atan2(rel.x, rel.z) - this.yaw - this.spin;
    const yawRel = Math.max(-1.0, Math.min(1.0, wrap(wantYaw)));
    // Reaching (eating, sniffing) lets the head tip much further down to bring the mouth to it.
    const pitchMax = 0.4 + this.reachK * 0.35;
    const wantPitch = Math.max(-0.4, Math.min(pitchMax, -Math.atan2(rel.y - 0.7, Math.hypot(rel.x, rel.z))));
    this.headYaw += (yawRel - this.headYaw) * Math.min(1, dt * 7);
    this.headPitch += (wantPitch - this.headPitch) * Math.min(1, dt * 5);
    if (Math.abs(this.headYaw) > 0.8 && !this.cur?.task.run) this.yaw = turn(this.yaw, this.yaw + this.headYaw * 0.5, dt * 2);
    const headVel = (this.headYaw - this.lastHeadYaw) / Math.max(dt, 1e-3);
    this.lastHeadYaw = this.headYaw;
    this.extraPitch *= Math.pow(0.15, dt);
    this.extraRoll *= Math.pow(0.15, dt);

    // Squash spring (volume-preserving)
    const sq = this.sq;
    sq.vel += (-(sq.v - 1) * 160 - sq.vel * 10 - accL.y * 0.02) * dt;
    sq.v += sq.vel * dt;

    // Breathing, shiver, sleep pose
    const asleep = this.action === 'sleep' && !this.target;
    this.breathPhase += dt * (asleep ? 1.3 : 2.4);
    const breath = Math.sin(this.breathPhase);
    this.shiver = this.action === 'shiver' ? Math.min(1, this.shiver + dt * 3) : Math.max(0, this.shiver - dt * 3);
    const shake = this.shiver * Math.sin(t * 60) * 0.012;
    const curl = asleep ? 1 : 0;

    const growY = 1 + this.age * 0.08;
    const sy = sq.v * growY * (1 - curl * 0.12);
    const sxz = 1 / Math.sqrt(Math.max(0.4, sq.v));
    P.squash.scale.set(sxz, sy, sxz);
    this.petting = Math.max(0, this.petting - dt * 0.9);
    this.roll *= this.cur ? 1 : Math.pow(0.05, dt);
    P.squash.rotation.set(0, 0, Math.sin(t * 2.2) * 0.05 * this.petting + shake + this.roll);

    // Belly + cheeks: soft-body springs driven by acceleration.
    const b = this.belly;
    const force = new THREE.Vector3(-accL.x, -accL.y, -accL.z).multiplyScalar(0.0009);
    b.v.addScaledVector(b.p, -260 * dt).addScaledVector(b.v, -9 * dt).addScaledVector(force, 60);
    b.p.addScaledVector(b.v, dt).clampLength(0, 0.03);
    P.deform.uBelly.value.copy(b.p);
    P.deform.uBreath.value = breath * (asleep ? 1.4 : 0.8);

    // Face: ease toward the target expression.
    const held = this.hold && now < this.hold.until ? this.hold.mood : null;
    if (this.hold && !held) this.hold = null;
    const mood: Mood = held ?? (this.petting > 0.35 ? 'love' : asleep ? 'sleepy' : this.mood);
    const target: Face = { ...NEUTRAL, ...FACES[mood] };
    if (asleep) Object.assign(target, { lid: 1, lower: 0.2, perk: -0.5, wag: 0.05 });
    // Pupils follow the light: small in bright sun, big at night.
    if (sky) {
      const bright = Math.max(0, Math.min(1, sky.sunElev / 30)) * (1 - sky.cloud * 0.6);
      target.pupil += 0.1 - bright * 0.14;
    }
    const f = this.face;
    const ease = (k: keyof Face, rate: number) => (f[k] += (target[k] - f[k]) * Math.min(1, dt * rate));
    ease('lid', 10);
    ease('lower', 8);
    ease('happy', 12);
    ease('pupil', 5);
    ease('tilt', 8);
    ease('smile', 8);
    ease('blush', 4);
    ease('perk', 6);
    ease('wag', 3);
    ease('cheek', 6);
    if (this.mouthCurve) {
      const m = this.mouthCurve.fn(now - this.mouthCurve.at);
      f.mouth += (Math.max(target.mouth, m * 0.9) - f.mouth) * Math.min(1, dt * 25);
      if (now - this.mouthCurve.at > 3000) this.mouthCurve = null;
    } else ease('mouth', 10);

    // Blinks: random, sometimes double, slow when sleepy.
    if (now > this.blinkAt) {
      const sleepy = mood === 'sleepy' || mood === 'content';
      this.blinkAt = now + (Math.random() < 0.18 ? 180 : 2200 + Math.random() * 4000);
      this.blinkK = 1;
      this.blinkSpeed = sleepy ? 3 : 7.5;
    }
    this.blinkK = Math.max(0, this.blinkK - dt * this.blinkSpeed);
    const blink = this.blinkK > 0 ? Math.sin(this.blinkK * Math.PI) : 0;

    // Saccades: little darts while looking around.
    if (now > this.saccadeAt) {
      this.saccadeAt = now + 350 + Math.random() * 1300;
      this.saccade.set((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.25);
    }
    // Eye aim: target direction in head space.
    P.root.updateMatrixWorld(true);
    const lookLocal = P.head.worldToLocal(lookAt.clone());
    const eyeDir = lookLocal.sub(new THREE.Vector3(0, P.form.head.y - P.form.neckY, 0.3)).normalize();
    const aim = new THREE.Vector2(eyeDir.x * 1.6, eyeDir.y * 1.6).add(this.look ? new THREE.Vector2() : this.saccade);
    if (aim.length() > 1) aim.normalize();
    this.oneEyeOpen = Math.max(0, this.oneEyeOpen - dt * 0.6);
    for (const [i, e] of P.eyes.entries()) {
      const u = e.u;
      u.uLook.value.lerp(aim, Math.min(1, dt * 18));
      let lid = Math.max(f.lid, blink);
      if (i === 1 && this.oneEyeOpen > 0) lid = Math.min(lid, 0.55); // peeks with one eye
      u.uLid.value = lid;
      u.uLower.value = f.lower;
      u.uHappy.value = f.happy;
      u.uPupil.value = f.pupil;
      u.uTilt.value = f.tilt;
    }
    for (const [i, br] of P.brows.entries()) {
      const side = i === 0 ? -1 : 1;
      br.rotation.z = side * f.tilt * 0.45;
      br.position.y = 0.012 * (f.tilt > 0 ? f.tilt : f.tilt * 0.4) + (mood === 'surprised' ? 0.012 : 0);
    }
    // Mouth: the smile widens with joy; the open mouth (and tongue) for talking and laughing.
    P.mouth.smile.scale.set(f.smile, Math.max(0.5, f.smile * 0.9), 1);
    P.mouth.smile.visible = f.mouth < 0.35;
    P.mouth.open.scale.set(0.8 + f.mouth * 0.4, Math.max(0.001, f.mouth), 1);
    P.mouth.open.visible = f.mouth > 0.04;
    for (const c of P.cheeks) (c.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, f.blush + this.petting * 0.3);
    P.deform.uCheek.value = f.cheek;

    // Head pose → shader + head group (same rotation, same pivot).
    const pitch = this.headPitch + this.extraPitch + curl * 0.35;
    const yawH = this.headYaw;
    const rollH = Math.sin(t * 0.9) * 0.035 + this.petting * 0.12 + this.extraRoll + curl * 0.2;
    P.head.rotation.set(pitch, yawH, rollH);
    P.deform.uHeadEuler.value.set(pitch, yawH, rollH);
    const ageHead = 1 - this.age * 0.07;
    P.head.scale.setScalar(ageHead);

    // Ears: two springs each (flop and tilt), excited by head turns, hops, wind and mood.
    const wind = sky ? Math.min(1, sky.windKmh / 40) : 0;
    for (const [i, e] of this.ear.entries()) {
      const side = i === 0 ? -1 : 1;
      const gust = wind * (0.16 * Math.sin(t * (5 + i) + i) + 0.1);
      e.v += (-e.a * 90 - e.v * 8 + headVel * side * 0.9 - accL.y * 0.04 * side) * dt;
      e.a += e.v * dt;
      e.xv += (-(e.x - f.perk * 0.35) * 80 - e.xv * 9 - accL.y * 0.05) * dt;
      e.x += e.xv * dt;
      const ear = P.ears[i]!;
      const long = this.genome.ears === 'long' ? 1.6 : 1;
      ear.rotation.x = (ear.userData.x0 as number) - e.x * long + gust;
      ear.rotation.y = e.a * 0.25;
      ear.rotation.z = (ear.userData.z0 as number) + e.a * 0.3 * long - side * Math.min(0, f.perk) * 0.5;
    }

    // Tail: a phase-lagged wag down the chain (follow-through) plus a bounce spring.
    const ts = this.tailSpring;
    ts.v += (-ts.x * 120 - ts.v * 8 + accL.y * 0.06) * dt;
    ts.x += ts.v * dt;
    const wagF = 6 + f.wag * 7;
    for (const [i, j] of P.tail.entries()) {
      const lag = i * 0.11;
      j.rotation.y = Math.sin((t - lag) * wagF) * (0.18 + f.wag * 0.38) * (1 + i * 0.15) + (curl ? 0.5 : 0);
      j.rotation.x = (j.userData.x0 as number) + ts.x * (1 + i * 0.4) + wind * 0.08 * Math.sin(t * 3 + i);
    }

    // Paws: walk paddling, waves, kicks, grooming.
    const groom = this.action === 'groom' && !this.target && !this.busy ? 1 : 0;
    this.pawWave = Math.max(0, this.pawWave - dt * 0.9);
    for (const [i, p] of P.paws.entries()) {
      let lift = this.pawPose[i]!;
      if (groom && i === 0) lift = Math.max(lift, 1);
      if (this.pawWave > 0 && i === 1) lift = 1;
      p.rotation.x = -lift * 1.3;
      p.rotation.z = this.pawWave > 0 && i === 1 ? Math.sin(t * 14) * 0.5 : 0;
      p.position.y = 0.13 + lift * 0.05;
    }
    if (groom) {
      this.headPitch += (0.32 - this.headPitch) * dt * 4;
      f.mouth = 0.2 + Math.max(0, Math.sin(t * 9)) * 0.25;
    }

    // Zzz while asleep.
    if (asleep && now > this.zzzAt) {
      this.zzzAt = now + 2600;
      this.emote('zzz');
    }

    // Accent glow breathes; stronger at night.
    if (P.accentMat) P.accentMat.emissiveIntensity = (0.5 + 0.35 * Math.sin(t * 2.4)) * this.stage.glow * (this.genome.accent === 'ember' ? 1.6 : 1);
    if (P.accent && this.genome.accent === 'ember') P.accent.scale.set(1, 1 + Math.sin(t * 13) * 0.12, 1);

    // Fur flow: gravity, wind and lag behind motion, in body space.
    const windDir = sky ? THREE.MathUtils.degToRad(sky.windDir + 180) : 0;
    const windL = toLocalDir(new THREE.Vector3(Math.sin(windDir), 0, -Math.cos(windDir))).multiplyScalar(wind * (0.6 + 0.4 * Math.sin(t * 2.3)));
    const lagL = toLocalDir(this.vel).multiplyScalar(-0.35).clampLength(0, 0.9);
    P.fur.uFlow.value.set(windL.x + lagL.x, -0.55 + lagL.y * 0.5, windL.z + lagL.z);
    P.fur.uFurLen.value = 0.02 * P.form.fluff * (1.12 - this.age * 0.2);

    // Compose transform
    // The body stands on the ground under it (lawn, a block, a real table), rides the step bob,
    // follows the terrain slope, and leans into motion. Order YXZ: yaw first, then pitch and roll
    // in the body's own frame.
    const R = P.root;
    R.visible = this.visible && this.appear > 0.01;
    R.position.set(this.pos.x + shake, this.groundY + this.height + gf.bob, this.pos.z);
    R.rotation.order = 'YXZ';
    R.rotation.set(
      gf.slopePitch + this.lean.pitch + this.reachK * 0.3,
      this.yaw + this.spin,
      gf.slopeRoll + gf.roll + this.lean.roll,
    );
    R.scale.setScalar(this.genome.size * easeOutBack(this.appear));
    // Feet: placed in world space (planted feet stay put), expressed in the root's local frame.
    R.updateMatrixWorld(true);
    const inv = R.matrixWorld.clone().invert();
    for (const [i, ft] of P.feet.entries()) {
      const f = gf.feet[i]!;
      const local = new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z).applyMatrix4(inv);
      ft.group.position.copy(local);
      // Undo the body's pitch/roll on a planted foot so the sole lies flat on its surface; a
      // swinging foot points its toe down a little.
      ft.group.rotation.set(f.planted ? -R.rotation.x : -R.rotation.x + f.lift * 0.45, 0, f.planted ? -R.rotation.z : -R.rotation.z * 0.5);
    }
    // Contact shadow on the surface it stands on: tighter and darker in contact, soft when airborne.
    this.shadow.visible = R.visible;
    this.shadow.position.set(this.pos.x, this.groundY + 0.006, this.pos.z);
    const air = this.height + gf.bob;
    const sh = 0.78 * this.genome.size * (1 - Math.min(0.6, air * 0.9)) * this.appear;
    this.shadow.scale.set(sh, sh * 0.8, 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - Math.min(0.75, air * 1.6);

    this.emotes.update(now, this.headTop());
    // Walking this frame (from inside update, or by a caller just before it) is reported for the
    // world (which then lets the character controller own the capsule) and then consumed.
    this.walking = this.walked;
    this.walked = false;
  }

  /** Measure frame time and walk the fur quality ladder (shared by all creatures on the page). */
  private tuneFur(dt: number) {
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    const G = furGovernor;
    if (G.tier < 0) {
      // Start from (and never climb above) the creature's configured quality.
      const n = this.parts.furMeshes[0]?.count ?? 0;
      G.tier = G.max = n >= 12 ? 3 : n >= 8 ? 2 : n >= 4 ? 1 : 0;
    }
    if (this.frameAvg > 1 / 42) {
      G.slow += dt;
      G.fast = 0;
    } else if (this.frameAvg < 1 / 56) {
      G.fast += dt;
      G.slow = 0;
    }
    if (G.slow > 2 && G.tier > Math.min(1, G.max)) {
      G.tier--;
      G.slow = 0;
    }
    if (G.fast > 12 && G.tier < G.max) {
      G.tier++;
      G.fast = 0;
    }
    const want = [0, 4, 8, 12][G.tier]!;
    if (this.parts.furMeshes[0] && this.parts.furMeshes[0].count !== want) this.parts.setFurTier(G.tier);
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
