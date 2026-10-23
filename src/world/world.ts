// The garden as a living system. Every object is an actor with its own controller and cadence
// (src/world/actors.ts), rigid things are real Rapier bodies (src/world/physics.ts), soft and
// airy things are matter sims (src/world/matter.ts), and care is a pure model
// (src/core/care.ts). This file wires them together, draws them, and lets the KIN notice them:
// it fetches what you throw, eats a fallen berry when it's hungry, digs up the day's finds,
// watches butterflies, befriends the ladybug, and shakes off after rain.

import * as THREE from 'three';
import * as care from '../core/care';
import { hash, rng } from '../core/rng';
import type { Traits } from '../core/genome';
import type { KV } from '../persistence/store';
import type { KinView } from '../render/kinView';
import { DECOR, GROUND_Z, type Stage } from '../render/stage';
import { Scheduler, type Actor, type ActorCtx, type WorldEvent } from './actors';
import {
  featherStep, flockStep, leafStep, newFeather, newFlock, newSkin, puddleStep, skinEnergy, skinStep, snowStep, spawnLeaf, v3, wind,
  type Feather, type Flock, type Leaf, type Puddle, type Skin, type V3,
} from './matter';
import type { PBody, Physics, Shape } from './physics';
import * as V from './views';

type Task = Parameters<KinView['script']>[0][number];

export interface Sounds {
  chirp?(pitch?: number): void;
  thump?(): void;
  bell?(): void;
  chime?(): void;
  purr?(): void;
  portal?(): void;
  sad?(): void;
}

export interface WorldDeps {
  stage: Stage;
  view: KinView;
  kinSeed: number;
  kinName: () => string;
  traits: () => Traits;
  /** True when the KIN is home, hatched and on this screen (not visiting, not mid-hop). */
  isHome: () => boolean;
  kv: KV;
  slot: string;
  sfx?: Sounds;
  reducedMotion?: () => boolean;
  now?: () => number;
  /** Something nice happened that's worth a quiet line of text. */
  toast?: (text: string) => void;
}

export type Grab = 'throw' | 'carry' | 'tool' | 'collect';

export interface Entity {
  id: string;
  kind: string;
  obj: THREE.Object3D;
  body?: PBody;
  /** World-space radius for picking. */
  r: number;
  grab?: Grab;
  /** Catalogue id for finds and placed decor. */
  item?: string;
  /** Tools return here after use. */
  home?: V3;
  held?: boolean;
  data: Record<string, unknown>;
}

const SAVE_MS = 15_000;
const CARE_TICK_MS = 4_000;

export class World {
  readonly sched: Scheduler;
  physics: Physics | null = null;
  care: care.CareState;
  readonly entities = new Map<string, Entity>();
  /** Things the UI listens to (care changed, something found…). */
  readonly listeners = new Set<(e: WorldEvent | { type: 'care' }) => void>();
  private rand: () => number;
  private lastCare = 0;
  private lastSave = 0;
  private halfW = 0;
  private night = false;
  private raining = false;
  private snowing = false;
  snowDepth = 0;
  private puddles: (Puddle & { view: ReturnType<typeof V.puddleView> })[] = [];
  private caps: THREE.Mesh[] = [];
  private prints: { m: THREE.Mesh; age: number }[] = [];
  private printIdx = 0;
  private lastPrint = new THREE.Vector3();
  private feather: { f: Feather; e: Entity } | null = null;
  private leaves: Leaf[] = [];
  private leafMesh: THREE.InstancedMesh;
  private butterflies: { flock: Flock; views: ReturnType<typeof V.butterflyView>[] } | null = null;
  private fireflies: { flock: Flock; pts: THREE.Points } | null = null;
  private jelly: { e: Entity; skin: Skin; geo: THREE.BufferGeometry; map: number[]; lastVel: V3 } | null = null;
  private berryViews: ReturnType<typeof V.berryView>[] = [];
  private plots: ReturnType<typeof V.plotView>[] = [];
  private rainbow: THREE.Mesh;
  private rainbowUntil = 0;
  private streak: THREE.Mesh;
  private streakAt = 0;
  /** A toy in the KIN's mouth (fetch): moved to its head before every physics step. */
  private carrying: PBody | null = null;
  /** Contact shadows for every physical object (one instanced draw). */
  private shadows: V.ContactShadows | null = null;
  /** When the KIN last flinched from a hit (cooldown). */
  private hitAt = 0;
  private wetKin = 0;
  private post: { roll: number; wiggle: number } = { roll: 0, wiggle: 0 };
  private blanketOn: THREE.Object3D | null = null;
  private stateKey: string;
  private worldKey: string;
  private ws: { day: string; surprises: string[]; toys: string[]; befriendDay: string };
  private ladybug: { e: Entity; target: V3; onKin: number; heading: number } | null = null;
  private bird: { e: Entity; phase: 'land' | 'peck' | 'leave'; t: number; dropped: boolean } | null = null;
  private seq = 0;

  constructor(private d: WorldDeps) {
    const now = this.now();
    this.rand = rng(hash('world:' + d.kinSeed + ':' + now));
    this.sched = new Scheduler(this.rand);
    this.stateKey = `kin:v1:${d.slot}:care`;
    this.worldKey = `kin:v1:${d.slot}:world`;
    let saved: unknown = null;
    try {
      saved = JSON.parse(d.kv.get(this.stateKey) ?? 'null');
    } catch {
      saved = null;
    }
    this.care = care.ensurePlots(care.reviveCare(saved, now));
    let ws: Partial<World['ws']> = {};
    try {
      ws = JSON.parse(d.kv.get(this.worldKey) ?? '{}') as Partial<World['ws']>;
    } catch {
      ws = {};
    }
    this.ws = { day: ws.day ?? '', surprises: ws.surprises ?? [], toys: ws.toys ?? ['ball', 'blocks', 'feather'], befriendDay: ws.befriendDay ?? '' };

    this.leafMesh = new THREE.InstancedMesh(V.leafGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }), 28);
    this.leafMesh.count = 0;
    this.leafMesh.frustumCulled = false;
    d.stage.world.add(this.leafMesh);
    this.rainbow = V.rainbowView();
    this.streak = V.streakView();
    d.stage.world.add(this.rainbow, this.streak);

    this.buildAmbient();
    this.buildActors();
  }

  now() {
    return this.d.now?.() ?? Date.now();
  }

  emit(e: WorldEvent) {
    this.sched.bus.emit(e);
  }

  // ───────────────────────────── setup

  /** Usable half-width for placing things: a phone shows ~1.6 units each side, a laptop ~2.5+. */
  private get span() {
    return Math.max(1.25, Math.min(2.4, this.d.stage.halfWidth - 0.32));
  }

  private buildAmbient() {
    const st = this.d.stage;
    const span = this.span;
    // Puddle spots: the low places of the lawn (seeded so a garden keeps its puddles).
    const r = rng(hash('puddles:' + this.d.kinSeed));
    for (let i = 0; i < 4; i++) {
      const v = V.puddleView();
      const p = { x: -span + 0.2 + (i / 3) * (span * 2 - 0.4) + (r() - 0.5) * 0.25, z: 0.5 + r() * 0.75, r: 0, max: 0.2 + r() * 0.18, view: v };
      v.group.position.set(p.x, 0, p.z);
      v.group.visible = false;
      st.world.add(v.group);
      this.puddles.push(p);
    }
    // Snow caps on the mushroom and the nest; footprints pool.
    const mc = V.snowCap(DECOR.mushroom.capR * 1.02, 0.001);
    mc.position.set(DECOR.mushroom.x, DECOR.mushroom.capY + DECOR.mushroom.capH - 0.02, DECOR.mushroom.z);
    const nc = V.snowCap(DECOR.nest.ringR + DECOR.nest.tubeR, 0.001);
    nc.position.set(DECOR.nest.x, 0.1, DECOR.nest.z);
    nc.scale.z = 0.8;
    for (const c of [mc, nc]) {
      c.visible = false;
      st.world.add(c);
      this.caps.push(c);
    }
    for (let i = 0; i < 14; i++) {
      const m = V.footprint();
      st.world.add(m);
      this.prints.push({ m, age: 99 });
    }
    // Garden plots.
    this.syncPlots();
    // Berries hanging on the plant.
    for (let i = 0; i < 3; i++) {
      const b = V.berryView();
      b.group.visible = false;
      st.plant.add(b.group);
      this.berryViews.push(b);
    }
    // The feather lives on the lawn from day one (a matter sim, not a rigid body).
    const fv = V.featherView();
    const f = newFeather(-0.2, 0.01, 0.95);
    const fe: Entity = { id: 'feather', kind: 'feather', obj: fv, r: 0.14, grab: 'carry', data: {} };
    st.world.add(fv);
    this.entities.set(fe.id, fe);
    this.feather = { f, e: fe };
    // Tools: the water bowl by the plant, the brush by the nest, the blanket (night only).
    const bowl = V.bowlView();
    bowl.position.set(DECOR.plant.x + 0.42, 0, DECOR.plant.z + 0.18);
    st.world.add(bowl);
    this.entities.set('bowl', { id: 'bowl', kind: 'bowl', obj: bowl, r: 0.14, grab: 'tool', home: v3(bowl.position.x, 0, bowl.position.z), data: {} });
    const brush = V.brushView();
    brush.position.set(DECOR.nest.x - 0.55, 0.02, DECOR.nest.z + 0.35);
    brush.rotation.y = 0.6;
    st.world.add(brush);
    this.entities.set('brush', { id: 'brush', kind: 'brush', obj: brush, r: 0.13, grab: 'tool', home: v3(brush.position.x, 0.02, brush.position.z), data: {} });
    const bl = V.blanketView();
    bl.group.position.set(DECOR.nest.x + 0.05, 0.02, DECOR.nest.z + 0.42);
    bl.group.scale.setScalar(0.55);
    bl.group.visible = false;
    st.world.add(bl.group);
    this.entities.set('blanket', { id: 'blanket', kind: 'blanket', obj: bl.group, r: 0.18, grab: 'tool', home: v3(bl.group.position.x, 0.02, bl.group.position.z), data: { geo: bl.geo } });
    // The ladybug.
    const lb = V.ladybugView();
    lb.position.set(-0.3, 0, 1.05);
    st.world.add(lb);
    const le: Entity = { id: 'ladybug', kind: 'ladybug', obj: lb, r: 0.08, data: {} };
    this.entities.set(le.id, le);
    this.ladybug = { e: le, target: v3(-0.3, 0, 1.05), onKin: 0, heading: 0 };
  }

  private buildActors() {
    const s = this.sched;
    // Weather watcher: turns the real sky into events (rain started, night fell, a gust).
    s.add<{ gustAt: number }>({
      id: 'weather', kind: 'weather', state: { gustAt: 0 }, hz: 1, awake: true,
      tick: (c) => {
        const sky = this.d.stage.sky;
        if (!sky) return;
        const wet = sky.precipMm > 0.1;
        const raining = wet && !sky.snow;
        const snowing = wet && sky.snow;
        if (raining !== this.raining) c.bus.emit({ type: raining ? 'rain-started' : 'rain-stopped' });
        if (snowing !== this.snowing) c.bus.emit({ type: snowing ? 'snow-started' : 'snow-stopped' });
        this.raining = raining;
        this.snowing = snowing;
        const night = (this.d.stage.palette?.night ?? 0) > 0.6;
        if (night !== this.night) c.bus.emit({ type: night ? 'night' : 'day' });
        this.night = night;
        const w = wind(sky, c.now / 1000);
        if (w.gust > 0.93 && sky.windKmh > 18 && c.now - this.actorState<{ gustAt: number }>('weather').gustAt > 8000) {
          this.actorState<{ gustAt: number }>('weather').gustAt = c.now;
          c.bus.emit({ type: 'gust', strength: sky.windKmh });
        }
      },
    });
    // Puddles: fill in real rain, dry in sun.
    s.add({
      id: 'puddles', kind: 'puddles', state: null, hz: 1, awake: true,
      tick: (c) => {
        const sky = this.d.stage.sky;
        if (!sky) return;
        puddleStep(this.puddles, c.dt * 6, sky); // garden time runs a little fast so rain is visible within a minute
        return this.raining || this.puddles.some((p) => p.r > 0);
      },
      wakeOn: ['rain-started'],
    } as Actor);
    // Snow: builds while it snows, melts above freezing.
    s.add({
      id: 'snow', kind: 'snow', state: null, hz: 1, awake: true,
      tick: (c) => {
        const sky = this.d.stage.sky;
        if (!sky) return;
        this.snowDepth = snowStep(this.snowDepth, c.dt * 6, sky);
        return this.snowing || this.snowDepth > 0;
      },
      wakeOn: ['snow-started'],
    } as Actor);
    // The plant: reads its care state, droops when dry, announces ripe fruit.
    s.add<{ ripe: number }>({
      id: 'plant', kind: 'plant', state: { ripe: 0 }, hz: 0.5, awake: true,
      tick: (c) => {
        const ripe = this.care.plant.berries.filter((b) => b >= 1).length;
        if (ripe > this.actorState<{ ripe: number }>('plant').ripe) c.bus.emit({ type: 'fruit-ripe', id: 'plant' });
        this.actorState<{ ripe: number }>('plant').ripe = ripe;
      },
    });
    // The ball: wants to be chased. Ignored long enough, it rolls itself over to the KIN.
    s.add<{ touched: number }>({
      id: 'ball', kind: 'ball', state: { touched: this.now() }, hz: 4, awake: true,
      on: (e, c) => {
        if ((e.type === 'touched' || e.type === 'thrown') && 'id' in e && e.id === 'ball') this.actorState<{ touched: number }>('ball').touched = c.now;
      },
      tick: (c) => {
        const b = this.entities.get('ball')?.body;
        const st = this.actorState<{ touched: number }>('ball');
        if (!b || !this.d.isHome() || this.d.view.busy) return;
        if (c.now - st.touched < 50_000 || !b.asleep()) return;
        const kp = this.d.view.pos;
        const p = b.pos();
        const dx = kp.x - p.x, dz = kp.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.6 || dist > 3) return;
        // A shy little roll toward the KIN: "play with me?"
        b.impulse({ x: (dx / dist) * 0.032, y: 0.006, z: (dz / dist) * 0.032 });
        st.touched = c.now - 30_000;
        c.bus.emit({ type: 'touched', id: 'ball', by: 'object' });
      },
    });
    // Butterflies by day, fireflies by night.
    s.add({
      id: 'flocks', kind: 'flocks', state: null, hz: 20, awake: true,
      tick: (c) => this.flockTick(c),
    } as Actor);
    // Leaves: blow in on strong wind, and always a few in autumn.
    s.add<{ next: number }>({
      id: 'leaves', kind: 'leaves', state: { next: 0 }, hz: 2, awake: true,
      tick: (c) => {
        const sky = this.d.stage.sky;
        if (!sky) return;
        const st = this.actorState<{ next: number }>('leaves');
        const autumn = this.season() === 'autumn';
        const windy = sky.windKmh > 22;
        if ((autumn || windy) && c.now > st.next && this.leaves.length < 24) {
          const hue = autumn ? 18 + c.rand() * 30 : 95 + c.rand() * 40;
          this.leaves.push(spawnLeaf(sky, this.halfW, c.rand, hue));
          st.next = c.now + (windy ? 1200 : 5000) * (0.5 + c.rand());
        }
      },
    });
    // The ladybug crawls, and befriends a calm, curious KIN.
    s.add({ id: 'ladybug', kind: 'ladybug', state: null, hz: 10, awake: true, tick: (c) => this.ladybugTick(c) } as Actor);
    // The bird (a daily surprise).
    s.add({ id: 'bird', kind: 'bird', state: null, hz: 10, awake: false, tick: (c) => this.birdTick(c) } as Actor);
    // The day's surprises.
    s.add({ id: 'surprises', kind: 'surprises', state: null, hz: 0.1, awake: true, tick: () => this.surpriseTick() } as Actor);
    // The rainbow: rain stopped with the sun out.
    this.sched.bus.on('rain-stopped', () => {
      const sky = this.d.stage.sky;
      if (sky && sky.sunElev > 4 && sky.cloud < 0.85) this.rainbowUntil = this.now() + 8 * 60_000;
      if (this.wetKin > 0.2 && this.d.isHome()) this.shakeOff();
    });
    // Blocks: notice being knocked over.
    this.sched.bus.on('toppled', () => this.notice('blocks'));
    this.sched.bus.on('*', (e) => {
      for (const l of this.listeners) l(e);
    });
  }

  private actorState<S>(id: string): S {
    return this.sched.get(id)!.state as S;
  }

  /** Called once Rapier has loaded: the rigid toys come alive. */
  attachPhysics(p: Physics) {
    this.physics = p;
    const st = this.d.stage;
    // Scenery colliders.
    const m = DECOR.mushroom;
    p.addStatic({ cylinder: [m.stalkH / 2, m.stalkR] }, { x: m.x, y: m.stalkH / 2, z: m.z });
    p.addStatic({ cylinder: [m.capH / 2, m.capR * 0.95] }, { x: m.x, y: m.capY + m.capH / 2, z: m.z });
    const n = DECOR.nest;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      // The woven rim: toys bounce off it and feet stand on it, but the KIN climbs over it.
      p.addStatic({ ball: n.tubeR * 0.9 }, { x: n.x + Math.cos(a) * n.ringR, y: 0.07, z: n.z + Math.sin(a) * n.ringR * 0.8 }, { passable: true });
    }
    p.addStatic({ cylinder: [0.3, 0.07] }, { x: DECOR.plant.x, y: 0.3, z: DECOR.plant.z });
    // The KIN becomes a physical character: its feet find surfaces through physics, and walking
    // goes through the character controller (src/world/physics.ts moveKin).
    const view = this.d.view;
    view.groundAt = (x, z, fromY) => p.groundAt(x, z, fromY);
    view.mover = (at, d) => p.moveKin(at, d);
    this.shadows = new V.ContactShadows();
    st.world.add(this.shadows.mesh);
    this.halfW = 0;
    // The ball becomes a rubber rigid body; the stage hands its motion to us.
    const bp = st.ball.position;
    const ball = p.add({ id: 'ball', shape: { ball: 0.11 }, material: 'rubber', pos: { x: bp.x, y: 0.11, z: bp.z } });
    this.entities.set('ball', { id: 'ball', kind: 'ball', obj: st.ball, body: ball, r: 0.16, grab: 'throw', data: {} });
    st.toyDriver = {
      position: () => {
        const q = ball.pos();
        return new THREE.Vector3(q.x, q.y, q.z);
      },
      kick: (dir, s) => {
        const d = dir.clone().setY(0).normalize();
        // The old roller's units were velocity; give the same feel as an impulse.
        ball.impulse({ x: d.x * s * 0.05, y: 0.012 * s, z: d.z * s * 0.05 });
        this.emit({ type: 'touched', id: 'ball', by: 'kin' });
      },
    };
    // Wood blocks, one stacked on the other (made to be knocked over).
    const bx = Math.min(1.3, this.span - 0.15);
    for (const [i, y] of [[0, 0.09], [1, 0.27]] as const) {
      const view = V.blockView(0.09, i);
      const body = p.add({ id: 'block' + i, shape: { box: [0.09, 0.09, 0.09] }, material: 'wood', pos: { x: bx, y, z: 0.95 } });
      st.world.add(view);
      this.entities.set('block' + i, { id: 'block' + i, kind: 'block', obj: view, body, r: 0.15, grab: 'throw', data: { up: 1 } });
      this.sched.add<{ up: number }>({
        id: 'block' + i, kind: 'block', state: { up: 1 }, hz: 2, awake: true, wakeOn: ['touched', 'thrown'],
        tick: (c) => {
          const s = this.actorState<{ up: number }>('block' + i);
          const up = body.upY();
          if (s.up >= 0.5 && up < 0.5) c.bus.emit({ type: 'toppled', id: 'block' + i });
          s.up = up;
          return !body.asleep();
        },
      });
    }
    if (this.ws.toys.includes('jelly') || care.bondLevel(this.care.bondXp).level >= 2) this.addJelly();
    // Decor the player has placed from the Garden Book.
    for (const pl of this.care.placed) this.spawnItem(pl.id, { x: pl.x, y: 0.05, z: pl.z }, 'placed');
    // Berries that fell while we were away lie on the ground.
  }

  private addJelly() {
    const p = this.physics;
    if (!p || this.jelly) return;
    const r = 0.14;
    const body = p.add({ id: 'jelly', shape: { ball: r }, material: 'jelly', pos: { x: -0.95, y: r, z: 0.85 } });
    const v = V.jellyView(r);
    this.d.stage.world.add(v.group);
    const w = V.weld(v.geo);
    const e: Entity = { id: 'jelly', kind: 'jelly', obj: v.group, body, r: 0.2, grab: 'throw', data: {} };
    this.entities.set('jelly', e);
    this.jelly = { e, skin: newSkin(w.rest, w.nbr), geo: v.geo, map: w.map, lastVel: v3() };
    this.sched.add({
      id: 'jelly', kind: 'jelly', state: null, hz: 30, awake: true, wakeOn: ['touched', 'thrown'],
      tick: () => !body.asleep() || skinEnergy(this.jelly!.skin) > 1e-4,
    } as Actor);
    if (!this.ws.toys.includes('jelly')) {
      this.ws.toys.push('jelly');
      this.saveWorld();
    }
  }

  // ───────────────────────────── per frame

  update(dt: number, now: number, t: number) {
    const st = this.d.stage;
    const view = this.d.view;
    const home = this.d.isHome();
    // Garden walls track the visible width.
    const hw = Math.max(1.4, st.halfWidth - 0.12);
    if (this.physics && Math.abs(hw - this.halfW) > 0.05) this.physics.setBounds(hw, GROUND_Z[0] - 0.05, GROUND_Z[1] + 0.05);
    this.halfW = hw;

    if (this.carrying) {
      // Held in the mouth, not hovering by the head.
      const h = view.mouthWorld();
      this.carrying.moveTo({ x: h.x, y: h.y, z: h.z });
    }
    if (this.physics) {
      const kp = view.pos;
      // When it walked this frame the character controller already placed the capsule (and
      // shoved toys); otherwise follow the animation (hops, spins) or park it (away).
      if (!(view.walking && home && view.visible)) this.physics.setKin(home && view.visible ? { x: kp.x, y: view.groundY + view.height, z: kp.z } : null);
      for (const id of this.physics.kinBumps) this.emit({ type: 'touched', id, by: 'kin' });
      this.physics.step(dt);
      if (home && view.visible) this.checkHit(now);
    }
    if (this.carrying && !view.busy) {
      this.carrying.hold(false);
      this.carrying = null;
    }
    this.sched.step(now);
    this.syncBodies();
    this.matterFrame(dt, t);
    this.kinFrame(dt, now, t);

    if (now - this.lastCare > CARE_TICK_MS) this.tickCare(now);
    if (now - this.lastSave > SAVE_MS) this.save();
  }

  /**
   * A thrown toy that reaches the KIN fast and heading at it makes it flinch: a stagger away, a
   * squash, ears, and a look at what hit it. Its own kicks move toys AWAY, so they don't count.
   */
  private checkHit(now: number) {
    const p = this.physics;
    if (!p || now - this.hitAt < 900) return;
    const v = this.d.view;
    const s = v.genome.size;
    const c = { x: v.pos.x, y: v.groundY + 0.45 * s, z: v.pos.z };
    for (const id of p.bodiesNear(c, 0.5 * s)) {
      const e = this.entities.get(id);
      if (!e?.body || e.held || e.body === this.carrying) continue;
      const bp = e.body.pos();
      const bv = e.body.vel();
      const speed = Math.hypot(bv.x, bv.y, bv.z);
      const toward = (c.x - bp.x) * bv.x + (c.y - bp.y) * bv.y + (c.z - bp.z) * bv.z;
      if (speed > 1.3 && toward > 0) {
        this.hitAt = now;
        v.bumped(new THREE.Vector3(bp.x, bp.y, bp.z), Math.min(1, (speed * e.body.mass()) / 0.01));
        this.emit({ type: 'touched', id, by: 'kin' });
        break;
      }
    }
  }

  private syncBodies() {
    const sh = this.shadows;
    sh?.begin();
    const tmp = new THREE.Vector3();
    const qq = new THREE.Quaternion();
    for (const e of this.entities.values()) {
      if (!e.body) continue;
      const p = e.body.pos();
      const q = e.body.rot();
      // Every physical thing casts a contact shadow on whatever is under it.
      if (sh && this.physics) {
        const under = this.physics.raycastDown({ x: p.x, y: p.y, z: p.z }, 3);
        if (under) sh.add(p.x, under.y, p.z, Math.max(0.04, e.body.halfH * 1.05), p.y - e.body.halfH - under.y);
      }
      if (e.kind === 'jelly') {
        e.obj.position.set(p.x, p.y, p.z);
        continue; // the skin shows the squish; the core's spin would smear the highlight
      }
      qq.set(q[0], q[1], q[2], q[3]);
      if (e.kind === 'block' || e.kind === 'ball' || e.kind === 'berry') {
        // Views centred on their body.
        e.obj.position.set(p.x, p.y, p.z);
      } else {
        // Views whose origin sits on the ground: put that origin at the body's (rotated) bottom,
        // so a resting find touches the surface exactly and a tumbling one turns about its centre.
        tmp.set(0, -e.body.halfH, 0).applyQuaternion(qq);
        e.obj.position.set(p.x + tmp.x, p.y + tmp.y, p.z + tmp.z);
      }
      e.obj.quaternion.copy(qq);
      if (e.kind === 'ball' && e.data.wobble) {
        const w = e.data.wobble as number;
        e.obj.scale.set(1 + w * 0.12, 1 - w * 0.18, 1 + w * 0.12);
        e.data.wobble = Math.max(0, w - 0.06);
      }
    }
    sh?.end();
  }

  private matterFrame(dt: number, t: number) {
    const st = this.d.stage;
    const sky = st.sky;
    const bounds = { halfW: this.halfW, zMin: GROUND_Z[0], zMax: GROUND_Z[1] };
    // Feather.
    if (this.feather && sky && !this.feather.e.held) {
      const f = this.feather.f;
      featherStep(f, dt, sky, t, bounds, this.rand);
      const o = this.feather.e.obj;
      o.position.set(f.p.x, f.p.y, f.p.z);
      o.rotation.set(f.roll * 0.6, f.yaw, f.roll);
    }
    // Leaves.
    if (sky) {
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const col = new THREE.Color();
      this.leaves = this.leaves.filter((l) => leafStep(l, dt, sky, t, bounds, this.rand));
      this.leaves.forEach((l, i) => {
        q.setFromEuler(new THREE.Euler(l.roll, l.yaw, l.roll * 0.5));
        m4.compose(new THREE.Vector3(l.p.x, l.p.y + 0.004, l.p.z), q, new THREE.Vector3(1, 1, 1));
        this.leafMesh.setMatrixAt(i, m4);
        this.leafMesh.setColorAt(i, col.setHSL(l.hue / 360, 0.62, 0.5));
      });
      this.leafMesh.count = this.leaves.length;
      this.leafMesh.instanceMatrix.needsUpdate = true;
      if (this.leafMesh.instanceColor) this.leafMesh.instanceColor.needsUpdate = true;
    }
    // Puddles: size, sky tint, ripples while raining.
    const pal = st.palette;
    for (const p of this.puddles) {
      const v = p.view;
      v.group.visible = p.r > 0.01;
      if (!v.group.visible) continue;
      v.surface.scale.set(p.r, p.r * 0.62, 1);
      if (pal) (v.surface.material as THREE.MeshPhysicalMaterial).color.set(pal.horizon).lerp(new THREE.Color(pal.top), 0.35);
      v.ripples.forEach((rp, i) => {
        const k = ((t * 0.7 + i / 3 + p.x) % 1 + 1) % 1;
        const rr = p.r * 0.25 + k * p.r * 0.55;
        rp.scale.set(rr, rr * 0.62, 1);
        rp.position.x = Math.sin(i * 2.1 + Math.floor(t * 0.7 + i / 3) * 1.7) * p.r * 0.3;
        rp.position.z = Math.cos(i * 1.3 + Math.floor(t * 0.7 + i / 3) * 2.3) * p.r * 0.15;
        (rp.material as THREE.MeshBasicMaterial).opacity = this.raining ? 0.5 * (1 - k) : 0;
      });
    }
    // Snow.
    st.setSnowCover(this.snowDepth);
    const capH = this.snowDepth * 0.06;
    this.caps.forEach((c, i) => {
      c.visible = this.snowDepth > 0.02;
      const r = i === 0 ? DECOR.mushroom.capR * 1.02 : DECOR.nest.ringR + DECOR.nest.tubeR;
      c.scale.y = Math.max(0.001, capH + (i === 0 ? 0.01 : 0)) / r;
    });
    for (const fp of this.prints) {
      fp.age += dt;
      (fp.m.material as THREE.MeshBasicMaterial).opacity = this.snowDepth > 0.15 ? Math.max(0, 0.55 - fp.age / 40) : 0;
    }
    // Jelly skin.
    if (this.jelly) {
      const j = this.jelly;
      const b = j.e.body!;
      const v = b.vel();
      const acc = { x: (v.x - j.lastVel.x) / Math.max(dt, 1e-3), y: (v.y - j.lastVel.y) / Math.max(dt, 1e-3), z: (v.z - j.lastVel.z) / Math.max(dt, 1e-3) };
      j.lastVel = { ...v };
      const kin = this.d.view.pos;
      const p = b.pos();
      // The KIN sitting on / pressing into it squishes it.
      const press = Math.max(0, 0.38 - Math.hypot(kin.x - p.x, kin.z - p.z));
      skinStep(j.skin, dt, acc, p.y - press * 0.4);
      if (press > 0.05 && !j.e.data.squished) {
        j.e.data.squished = true;
        this.emit({ type: 'squished', id: 'jelly' });
      } else if (press <= 0.02) j.e.data.squished = false;
      const pos = j.geo.getAttribute('position') as THREE.BufferAttribute;
      const rest = j.skin.rest;
      const off = j.skin.off;
      for (let i = 0; i < j.map.length; i++) {
        const u = j.map[i]! * 3;
        pos.setXYZ(i, rest[u]! + off[u]!, rest[u + 1]! + off[u + 1]!, rest[u + 2]! + off[u + 2]!);
      }
      pos.needsUpdate = true;
      j.geo.computeVertexNormals();
    }
    // Plant: size with growth, droop when dry, berries by ripeness.
    const pl = this.care.plant;
    const droop = pl.water < 0.2 ? (0.2 - pl.water) * 1.5 : 0;
    st.plant.scale.setScalar(0.75 + pl.size * 0.45);
    st.plant.rotation.z = droop * Math.sin(t * 0.3) * 0.2 + droop * 0.25;
    this.berryViews.forEach((bv, i) => {
      const r = pl.berries[i];
      bv.group.visible = r !== undefined;
      if (r === undefined) return;
      V.berryColor(r, bv.mat.color);
      bv.group.position.set((i - 1) * 0.09, 0.2 + i * 0.07, 0.06 + (i % 2) * 0.03);
      bv.group.scale.setScalar(0.6 + Math.min(1, r) * 0.45);
    });
    // Rainbow and shooting star.
    const rb = this.rainbowUntil - this.now();
    (this.rainbow.material as THREE.MeshBasicMaterial).opacity = rb > 0 ? Math.min(0.32, rb / 20000, (8 * 60_000 - rb) / 8000) : 0;
    this.rainbow.visible = rb > 0;
    const sa = (this.now() - this.streakAt) / 1000;
    this.streak.visible = sa >= 0 && sa < 1.2;
    if (this.streak.visible) {
      this.streak.position.set(-1.5 + sa * 3.4, 3.4 - sa * 0.9, -3.2);
      this.streak.rotation.z = -0.25;
      (this.streak.material as THREE.MeshBasicMaterial).opacity = Math.sin((sa / 1.2) * Math.PI) * 0.9;
    }
    // Finds sparkle until picked up.
    for (const e of this.entities.values()) {
      const glint = e.data.glint as THREE.Sprite | undefined;
      if (glint) (glint.material as THREE.SpriteMaterial).opacity = 0.35 + 0.55 * Math.max(0, Math.sin(t * 3 + e.obj.position.x * 5)) ** 4;
    }
  }

  // ───────────────────────────── flocks, critters, surprises

  private flockTick(c: ActorCtx) {
    const st = this.d.stage;
    const sky = st.sky;
    if (!sky) return;
    const dt = c.dt;
    const night = this.night;
    const day = !night && sky.precipMm < 0.1 && sky.tempC > 10 && sky.windKmh < 32;
    const swarm = this.ws.surprises.includes('butterfly-swarm:on');
    const wantB = day ? (this.season() === 'spring' || swarm ? 5 : 3) : 0;
    const kin = this.d.view.pos;
    const running = this.d.view.busy;
    const w = wind(sky, c.now / 1000);
    // Butterflies.
    if (wantB && !this.butterflies) {
      const colors = ['#E9AF6B', '#9EA8FF', '#6EE5CA', '#F6F6F3', '#F2A7C3'];
      const flock = newFlock(wantB, v3(DECOR.plant.x, 0.9, DECOR.plant.z + 0.4), c.rand);
      const views = flock.p.map((_, i) => {
        const v = V.butterflyView(colors[i % colors.length]!);
        v.group.scale.setScalar(0.9);
        st.world.add(v.group);
        return v;
      });
      this.butterflies = { flock, views };
      c.bus.emit({ type: 'arrived', id: 'butterflies' });
    } else if (!wantB && this.butterflies) {
      for (const v of this.butterflies.views) st.world.remove(v.group);
      this.butterflies = null;
    }
    if (this.butterflies) {
      const fl = this.butterflies.flock;
      const flowers = this.care.plots.map((p, i) => ({ p, i })).filter((x) => x.p.growth >= 1);
      const home = flowers.length ? this.plotPos(flowers[Math.floor((c.now / 20000) % flowers.length)]!.i).setY(0.6) : new THREE.Vector3(DECOR.plant.x, 0.9, DECOR.plant.z + 0.3);
      flockStep(fl, dt, {
        speed: 0.75, home: { x: home.x, y: home.y, z: home.z }, homePull: 0.35,
        avoid: running ? { x: kin.x, y: 0.5, z: kin.z } : null, avoidR: 0.7,
        yMin: 0.25, yMax: 2.2, halfW: this.halfW, zMin: GROUND_Z[0], zMax: GROUND_Z[1], wind: w,
      }, c.rand);
      this.butterflies.views.forEach((v, i) => {
        const p = fl.p[i]!;
        const vel = fl.v[i]!;
        v.group.position.set(p.x, p.y, p.z);
        v.group.rotation.y = Math.atan2(vel.x, vel.z);
        const flap = Math.sin(fl.ph[i]!) * 1.0;
        v.left.rotation.z = flap;
        v.right.rotation.z = -flap;
      });
    }
    // Fireflies.
    if (night && !this.fireflies) {
      const n = this.season() === 'summer' ? 22 : 14;
      const flock = newFlock(n, v3(0, 0.7, 0), c.rand);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#C8FFE9', size: 9, sizeAttenuation: false, map: V.glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      pts.frustumCulled = false;
      st.world.add(pts);
      this.fireflies = { flock, pts };
      st.fireflies = true;
    } else if (!night && this.fireflies) {
      st.world.remove(this.fireflies.pts);
      this.fireflies = null;
      st.fireflies = false;
    }
    if (this.fireflies) {
      const fl = this.fireflies.flock;
      flockStep(fl, dt, {
        speed: 0.35, home: { x: kin.x * 0.3, y: 0.8, z: 0.1 }, homePull: 0.08, avoid: null, avoidR: 0,
        yMin: 0.15, yMax: 2.4, halfW: this.halfW, zMin: GROUND_Z[0], zMax: GROUND_Z[1], wind: { x: w.x * 0.2, z: w.z * 0.2 },
      }, c.rand);
      const a = this.fireflies.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      fl.p.forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z));
      a.needsUpdate = true;
      (this.fireflies.pts.material as THREE.PointsMaterial).opacity = 0.55 + 0.35 * Math.sin(c.now / 700) ** 2;
    }
  }

  private ladybugTick(c: ActorCtx) {
    const lb = this.ladybug;
    if (!lb) return;
    const o = lb.e.obj;
    const view = this.d.view;
    if (lb.onKin > 0) {
      // Riding on the KIN's head: the friendship moment.
      lb.onKin -= c.dt;
      const head = this.kinHead(0.95);
      o.position.lerp(head, 0.5);
      if (lb.onKin <= 0) {
        lb.target = v3(view.pos.x + (c.rand() - 0.5) * 1.2, 0, Math.min(GROUND_Z[1] - 0.1, view.pos.z + 0.3));
        o.position.y = 0;
      }
      return;
    }
    const p = o.position;
    const dx = lb.target.x - p.x, dz = lb.target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05 || c.rand() < 0.01) {
      lb.target = v3(Math.max(-this.halfW + 0.3, Math.min(this.halfW - 0.3, p.x + (c.rand() - 0.5) * 1.4)), 0, Math.max(GROUND_Z[0] + 0.2, Math.min(GROUND_Z[1] - 0.05, p.z + (c.rand() - 0.5) * 0.8)));
    } else {
      const sp = 0.12;
      lb.heading = Math.atan2(dx, dz);
      p.x += (dx / dist) * sp * c.dt;
      p.z += (dz / dist) * sp * c.dt;
      p.y = 0;
      o.rotation.y = lb.heading;
    }
    // A calm KIN nearby, curious enough, and not befriended yet today: the ladybug flies up.
    const today = care.dayKey(new Date(this.now()));
    const kd = Math.hypot(view.pos.x - p.x, view.pos.z - p.z);
    if (this.d.isHome() && !view.busy && kd < 0.55 && this.ws.befriendDay !== today && this.d.traits().curiosity > 0.3 && c.rand() < c.dt * 0.25) {
      lb.onKin = 18;
      this.ws.befriendDay = today;
      this.saveWorld();
      this.apply(care.befriend(this.care, this.now()));
      c.bus.emit({ type: 'befriended', id: 'ladybug' });
      this.d.sfx?.chime?.();
      this.d.toast?.(`A ladybug landed on ${this.d.kinName()}. Friends now.`);
      const look = this.kinHead(1.4);
      view.script([
        { dur: 400, enter: () => ((view.look = look), (view.mood = 'surprised'), view.earFlick(1.2)) },
        { dur: 1600, enter: () => ((view.mood = 'happy'), this.emote('heart')) },
      ] as Task[]);
    }
  }

  private birdTick(c: ActorCtx) {
    const b = this.bird;
    if (!b) return false;
    const o = b.e.obj;
    b.t += c.dt;
    const kin = this.d.view.pos;
    const kd = Math.hypot(kin.x - o.position.x, kin.z - o.position.z);
    if (b.phase === 'land') {
      const k = Math.min(1, b.t / 1.6);
      o.position.y = (1 - k) ** 2 * 2.2;
      o.position.x = (b.e.data.tx as number) + (1 - k) * 2;
      if (k >= 1) (b.phase = 'peck'), (b.t = 0), this.d.sfx?.chirp?.(1.6);
    } else if (b.phase === 'peck') {
      const head = (o.userData.head as THREE.Object3D | undefined);
      if (head) head.rotation.x = Math.max(0, Math.sin(b.t * 7)) * 0.6;
      if (b.t > 0.4 && Math.floor(b.t * 1.3) !== Math.floor((b.t - c.dt) * 1.3)) {
        o.position.x += (c.rand() - 0.5) * 0.12;
        o.position.y = 0.04;
      } else o.position.y = Math.max(0, o.position.y - c.dt * 0.4);
      if (!b.dropped && b.t > 6) {
        b.dropped = true;
        this.spawnItem('feather-blue', { x: o.position.x + 0.1, y: 0.05, z: o.position.z + 0.08 }, 'find');
      }
      if (kd < 0.5 || b.t > 75) (b.phase = 'leave'), (b.t = 0), this.d.sfx?.chirp?.(1.8);
    } else {
      o.position.y += c.dt * 2.2;
      o.position.x += c.dt * 2.6;
      const wing = Math.sin(b.t * 30) * 0.8;
      (o.userData.wingL as THREE.Object3D).rotation.z = wing;
      (o.userData.wingR as THREE.Object3D).rotation.z = -wing;
      if (b.t > 2.5) {
        this.d.stage.world.remove(o);
        this.entities.delete(b.e.id);
        this.bird = null;
        c.bus.emit({ type: 'left', id: 'bird' });
        return false;
      }
    }
  }

  private surpriseTick() {
    const now = new Date(this.now());
    const day = care.dayKey(now);
    if (this.ws.day !== day) {
      this.ws = { ...this.ws, day, surprises: [] };
      this.saveWorld();
    }
    const hour = now.getHours() + now.getMinutes() / 60;
    for (const s of care.surprisesFor(now, this.d.kinSeed)) {
      if (hour < s.hour || this.ws.surprises.includes(s.kind)) continue;
      if (s.kind === 'shooting-star' && !this.night) continue;
      if (!this.d.isHome()) continue;
      this.ws.surprises.push(s.kind);
      this.saveWorld();
      this.surprise(s.kind);
      break; // one at a time
    }
  }

  /** Make a surprise happen now (also used by the dev harness: ?surprise=bird). */
  surprise(kind: care.SurpriseKind) {
    const st = this.d.stage;
    switch (kind) {
      case 'bird': {
        if (this.bird) return;
        const v = V.birdView();
        v.group.userData = { head: v.head, wingL: v.wingL, wingR: v.wingR };
        const tx = Math.max(-this.halfW + 0.6, Math.min(this.halfW - 0.6, this.d.view.pos.x + (this.rand() < 0.5 ? -1 : 1) * 1.1));
        v.group.position.set(tx + 2, 2.2, 0.75);
        v.group.rotation.y = -Math.PI / 2;
        st.world.add(v.group);
        const e: Entity = { id: 'bird', kind: 'bird', obj: v.group, r: 0.15, data: { tx } };
        this.entities.set('bird', e);
        this.bird = { e, phase: 'land', t: 0, dropped: false };
        this.sched.wake('bird');
        this.notice('bird');
        break;
      }
      case 'lost-toy':
        if (!this.jelly) {
          this.addJelly();
          this.d.toast?.('A wobbly jelly toy rolled into the garden.');
          this.notice('jelly');
        } else this.spawnItem('acorn', { x: 0.4, y: 0.4, z: 0.9 }, 'find');
        break;
      case 'butterfly-swarm':
        this.ws.surprises.push('butterfly-swarm:on');
        if (this.butterflies) {
          for (const v of this.butterflies.views) st.world.remove(v.group);
          this.butterflies = null;
        }
        setTimeout(() => {
          this.ws.surprises = this.ws.surprises.filter((x) => x !== 'butterfly-swarm:on');
        }, 120_000);
        break;
      case 'shooting-star':
        this.streakAt = this.now();
        this.d.sfx?.chime?.();
        this.d.view.look = new THREE.Vector3(0, 4, -3);
        setTimeout(() => (this.d.view.look = null), 2500);
        break;
      case 'shell-wash':
        for (let i = 0; i < 2; i++) this.spawnItem(this.rand() < 0.15 ? 'shell-pearl' : i ? 'shell-fan' : 'shell-spiral', { x: -1.2 + i * 1.6, y: 0.06, z: 1.05 }, 'find');
        this.d.toast?.('The rain washed some shells into the garden.');
        break;
      case 'golden-find':
        this.ws.surprises.push('golden-next');
        break;
    }
  }

  // ───────────────────────────── the KIN noticing things

  private kinHead(lift = 0.75): THREE.Vector3 {
    const v = this.d.view;
    const s = v.genome.size;
    return new THREE.Vector3(v.pos.x + Math.sin(v.yaw) * 0.12 * s, v.height + lift * s, v.pos.z + Math.cos(v.yaw) * 0.12 * s);
  }

  /** The KIN glances at something interesting, if it isn't busy. Autonomy, made visible. */
  notice(id: string) {
    const v = this.d.view;
    if (!this.d.isHome() || v.busy) return;
    const e = this.entities.get(id) ?? [...this.entities.values()].find((x) => x.kind === id);
    if (!e) return;
    const p = e.obj.position.clone().setY(Math.max(0.3, e.obj.position.y));
    v.script([{ dur: 1400, enter: () => ((v.look = p), (v.mood = 'surprised'), v.earFlick(1)) }, { dur: 200, enter: () => (v.look = null) }] as Task[]);
  }

  private emote(kind: string) {
    (this.d.view as unknown as { emote?: (k: string) => void }).emote?.(kind);
  }

  private say(kind: string) {
    (this.d.view as unknown as { say?: (k: string) => void }).say?.(kind);
  }

  /** A hop-walk toward a moving target; ends when close, lost or after a timeout. */
  private chase(target: () => THREE.Vector3 | null, speed: number, stop: number, maxMs = 6000): Task {
    const v = this.d.view;
    // Walks like any other walk: planted feet from the gait, and through the physics character
    // controller (it goes around the mushroom and shoves what's in the way instead of ghosting).
    const task: Task = {
      dur: maxMs,
      run: (_k: number, dt: number) => {
        const t = target();
        if (!t) return void (task.dur = 1);
        const goal = t.clone();
        goal.z = Math.max(GROUND_Z[0], Math.min(GROUND_Z[1], goal.z));
        if (v.walkToward(goal, speed, dt, stop)) task.dur = 1;
        v.look = t.clone().setY(v.groundY + 0.3);
      },
      exit: () => (v.height = 0),
    } as Task;
    return task;
  }

  /**
   * A throw deserves an answer: fetch now, or as soon as the KIN finishes what it's doing (it may
   * be watching a butterfly). Gives up after 3 s, or if someone else picked the toy up.
   */
  requestFetch(id: string) {
    const t0 = this.now();
    const tryNow = () => {
      const e = this.entities.get(id);
      if (!e?.body || e.held || !this.d.isHome() || this.now() - t0 > 3000) return;
      if (this.d.view.busy || this.blanketOn) return void setTimeout(tryNow, 250);
      this.fetch(id);
    };
    setTimeout(tryNow, 180);
  }

  /** Fetch: chase the thrown toy, carry it back to you, drop it, wait for praise. */
  fetch(id: string) {
    const v = this.d.view;
    const e = this.entities.get(id);
    if (!e?.body || !this.d.isHome()) return;
    const body = e.body;
    const pos = () => {
      const p = body.pos();
      return new THREE.Vector3(p.x, 0, p.z);
    };
    const before = this.care.skills.fetch;
    const r = this.rand();
    const o = care.trick(this.care, this.now(), 'fetch', r);
    this.apply(o);
    const back = new THREE.Vector3(Math.max(-this.halfW + 0.5, Math.min(this.halfW - 0.5, v.pos.x * 0.5)), 0, GROUND_Z[1] - 0.25);
    const pickUp = () => {
      body.hold(true);
      this.carrying = body;
      v.squashImpulse(0.45);
      this.d.sfx?.chirp?.(1.2);
    };
    const drop = () => {
      this.carrying = null;
      body.hold(false);
      body.setVel({ x: 0, y: 0.6, z: 0.9 });
      v.squashImpulse(0.4);
    };
    const settle: Task = { dur: 4000, run: () => { if (body.vel && Math.hypot(body.vel().x, body.vel().z) < 0.8) settle.dur = 1; } } as Task;
    v.script([
      { dur: 250, enter: () => ((v.look = pos().setY(0.3)), (v.mood = 'surprised'), v.earFlick(1.6)) },
      settle,
      // Stop where the ball sits just under the chin (body-to-ball contact is ~0.44 apart).
      this.chase(pos, 2.4, 0.47),
      ...(o.success || before > 0.15
        ? ([
            { dur: 200, enter: pickUp },
            this.chase(() => back, 1.6, 0.1, 5000),
            { dur: 250, enter: drop },
            { dur: 1200, enter: () => ((v.look = new THREE.Vector3(v.pos.x * 0.6, 2.2, 6)), (v.mood = 'happy'), this.emote('heart'), this.say('happy')) },
          ] as Task[])
        : ([
            // Not learned yet: it boops the toy instead and looks at you, a bit unsure. Cute, and practice counts.
            { dur: 300, enter: () => { this.d.stage.kickBall(pos().sub(v.pos), 1.2); v.squashImpulse(0.3); } },
            { dur: 1200, enter: () => ((v.look = new THREE.Vector3(v.pos.x * 0.6, 2.2, 6)), (v.mood = 'neutral'), v.earFlick(0.8)) },
          ] as Task[])),
    ] as Task[]);
    this.apply(care.play(this.care, this.now(), 'fetch'));
  }

  /** Eat: chomp chomp, a happy wiggle. */
  eat(ripeness: number, at?: THREE.Vector3, then?: () => void) {
    const v = this.d.view;
    // Up to the berry (contact ~0.38 from its centre); the reach then brings the mouth down to it.
    const go = at ? [this.chase(() => at, 1.4, 0.4)] : [];
    v.script([
      ...go,
      // Mouth to the food: the head tips down and the body leans until it's at the berry.
      {
        dur: 320,
        enter: () => {
          v.mood = 'surprised';
          const food = (at ?? this.kinHead(0.3)).clone();
          food.y = v.groundY + 0.06;
          v.reach(food);
        },
      },
      ...[0, 1, 2].map(() => ({ dur: 180, enter: () => (v.squashImpulse(-0.35), this.d.sfx?.thump?.()) })),
      { dur: 900, enter: () => (v.reach(null), (v.mood = 'happy'), this.emote('heart'), this.say('nom'), then?.()) },
    ] as Task[]);
    this.apply(care.feed(this.care, this.now(), ripeness));
    this.emit({ type: 'eaten', id: 'berry', ripeness });
  }

  /** Bath done (rain or a water drop): a full-body shake that throws droplets. */
  shakeOff() {
    const v = this.d.view;
    this.wetKin = 0;
    const drops: THREE.Mesh[] = [];
    v.script([
      { dur: 200, enter: () => ((v.mood = 'surprised'), v.earFlat()) },
      {
        dur: 700,
        enter: () => {
          for (let i = 0; i < 14; i++) {
            const m = V.dropView();
            m.scale.multiplyScalar(0.35);
            m.position.copy(this.kinHead(0.45));
            const a = (i / 14) * Math.PI * 2;
            m.userData.v = new THREE.Vector3(Math.cos(a) * 1.6, 1.2 + Math.random(), Math.sin(a) * 0.8);
            this.d.stage.world.add(m);
            drops.push(m);
          }
        },
        run: (_k: number, dt: number) => {
          v.yaw += Math.sin(this.now() / 30) * 0.2;
          for (const m of drops) {
            const vel = m.userData.v as THREE.Vector3;
            vel.y -= 9 * dt;
            m.position.addScaledVector(vel, dt);
          }
        },
        exit: () => drops.forEach((m) => this.d.stage.world.remove(m)),
      },
      { dur: 700, enter: () => ((v.mood = 'happy'), this.say('happy')) },
    ] as Task[]);
  }

  /** Dig up today's find where the KIN is standing. */
  dig() {
    const v = this.d.view;
    const now = new Date(this.now());
    const day = care.dayKey(now);
    const nth = this.care.dug[day] ?? 0;
    const golden = this.ws.surprises.includes('golden-next');
    const item = care.dig(now, this.d.kinSeed, nth, this.season(), golden);
    if (!item) return false;
    if (golden) this.ws.surprises = this.ws.surprises.filter((x) => x !== 'golden-next');
    this.care = { ...this.care, dug: { [day]: nth + 1 } };
    const spot = { x: v.pos.x + Math.sin(v.yaw) * 0.3, y: 0.05, z: Math.max(GROUND_Z[0], Math.min(GROUND_Z[1], v.pos.z + Math.cos(v.yaw) * 0.3)) };
    const dirt: THREE.Mesh[] = [];
    v.script([
      { dur: 250, enter: () => ((v.look = new THREE.Vector3(spot.x, 0, spot.z)), (v.mood = 'surprised'), v.earFlick(1)) },
      {
        dur: 1100,
        run: () => {
          if (this.rand() < 0.3) {
            const m = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), new THREE.MeshStandardMaterial({ color: '#7A5A44' }));
            m.position.set(spot.x, 0.02, spot.z);
            m.userData.v = new THREE.Vector3((this.rand() - 0.5) * 1.5, 1 + this.rand(), (this.rand() - 0.5) * 0.8);
            this.d.stage.world.add(m);
            dirt.push(m);
          }
          v.squashImpulse(-0.08);
          for (const m of dirt) {
            const vel = m.userData.v as THREE.Vector3;
            vel.y -= 0.15;
            m.position.addScaledVector(vel, 1 / 60);
            if (m.position.y < 0) m.position.y = 0;
          }
        },
        exit: () => {
          dirt.forEach((m) => this.d.stage.world.remove(m));
          this.spawnItem(item.id, spot, 'find');
          this.d.sfx?.chime?.();
        },
      },
      { dur: 1000, enter: () => ((v.look = new THREE.Vector3(v.pos.x * 0.6, 2.2, 6)), (v.mood = 'happy'), this.say('found')) },
    ] as Task[]);
    this.emit({ type: 'found', item: item.id, x: spot.x, z: spot.z });
    this.saveWorld();
    return true;
  }

  /** Perform a trick on request. Practice always counts; skill shows in how well it lands. */
  performTrick(t: care.Trick) {
    const v = this.d.view;
    if (t === 'fetch') {
      const ball = this.entities.get('ball');
      if (ball?.body) {
        const dir = new THREE.Vector3((this.rand() - 0.5) * 2, 0, -0.6 - this.rand() * 0.4).normalize();
        ball.body.setVel({ x: dir.x * 3.5, y: 2.2, z: dir.z * 2 });
        this.emit({ type: 'thrown', id: 'ball', speed: 3.5 });
        setTimeout(() => this.fetch('ball'), 150);
      }
      return;
    }
    const o = care.trick(this.care, this.now(), t, this.rand());
    this.apply(o);
    const s = this.care.skills[t];
    const ok = o.success;
    const camLook = () => new THREE.Vector3(v.pos.x * 0.6, 2.2, 6);
    const tasks: Task[] = [{ dur: 250, enter: () => ((v.look = camLook()), v.earFlick(0.8)) } as Task];
    if (!ok) {
      // A charming miss: a head tilt and a little "hm?", never a failure state.
      tasks.push({ dur: 900, enter: () => ((v.mood = 'neutral'), this.say('hm')), run: (k: number) => (this.post.roll = Math.sin(k * Math.PI) * 0.25) } as Task);
    } else if (t === 'sit') {
      tasks.push({ dur: 1200, enter: () => (v.squashImpulse(-0.5), (v.mood = 'content')), run: () => v.squashImpulse(-0.02) } as Task);
    } else if (t === 'spin') {
      const y0 = v.yaw;
      tasks.push({ dur: 800 - s * 250, enter: () => v.squashImpulse(0.5), run: (k: number) => ((v.yaw = y0 + k * Math.PI * 2), (v.height = Math.sin(k * Math.PI) * (0.15 + s * 0.2))), exit: () => ((v.height = 0), v.squashImpulse(-0.4)) } as Task);
    } else if (t === 'highfive') {
      tasks.push({ dur: 900, enter: () => (v.squashImpulse(0.6), (v.mood = 'happy')), run: (k: number) => ((v.height = Math.sin(k * Math.PI) * 0.22), (this.post.roll = -Math.sin(k * Math.PI) * 0.35)) } as Task);
    } else if (t === 'roll') {
      tasks.push({ dur: 1000 - s * 300, run: (k: number) => (this.post.roll = k * Math.PI * 2), exit: () => (this.post.roll = 0) } as Task);
    } else if (t === 'dance') {
      tasks.push({ dur: 2400, enter: () => (v.mood = 'happy'), run: (k: number) => ((this.post.wiggle = Math.sin(k * Math.PI * 8) * (0.2 + s * 0.2)), (v.height = Math.abs(Math.sin(k * Math.PI * 4)) * 0.1)), exit: () => ((this.post.wiggle = 0), (v.height = 0)) } as Task);
    }
    tasks.push({ dur: 700, enter: () => (ok ? (this.emote('sparkle'), this.say('happy'), this.d.sfx?.chime?.()) : undefined), exit: () => ((this.post.roll = 0), (v.look = null)) } as Task);
    v.script(tasks);
    return ok;
  }

  /** Tuck in: the KIN curls up in the nest under the blanket. */
  tuckIn() {
    const v = this.d.view;
    const nest = new THREE.Vector3(DECOR.nest.x, 0, DECOR.nest.z);
    const bl = this.entities.get('blanket')!;
    this.apply(care.tuck(this.care, this.now()));
    v.script([
      this.chase(() => nest, 1.0, 0.06, 6000),
      {
        dur: 1,
        enter: () => {
          v.applyAction('sleep');
          this.blanketOn = bl.obj;
          bl.obj.visible = true;
        },
      },
    ] as Task[]);
    this.d.sfx?.purr?.();
  }

  private kinFrame(dt: number, now: number, t: number) {
    const v = this.d.view;
    const home = this.d.isHome();
    // Post-transforms layered over the creature's own animation (rolls, dances, tilts).
    const R = v.parts.root;
    if (this.post.roll) R.rotateOnAxis(new THREE.Vector3(0, 0, 1), this.post.roll);
    if (this.post.wiggle) R.rotateOnAxis(new THREE.Vector3(0, 0, 1), this.post.wiggle);
    // Blanket drapes over the sleeping KIN; it comes off when it wakes.
    if (this.blanketOn) {
      if (v.action !== 'sleep' && !v.busy) {
        this.blanketOn = null;
        this.care = care.wake(this.care);
        const bl = this.entities.get('blanket')!;
        bl.obj.position.copy(bl.home as unknown as THREE.Vector3);
        bl.obj.scale.setScalar(0.55);
      } else {
        const b = this.blanketOn;
        b.position.set(v.pos.x, 0.32 * v.genome.size, v.pos.z);
        b.scale.set(1.1, 1, 1.1);
        const geo = (this.entities.get('blanket')!.data.geo as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < geo.count; i++) {
          const x = geo.getX(i), z = geo.getZ(i);
          const r = Math.hypot(x / 0.25, z / 0.21);
          geo.setY(i, -Math.max(0, r - 0.45) * 0.28 + Math.sin(t * 1.3 + x * 4) * 0.004);
        }
        geo.needsUpdate = true;
      }
    }
    if (!home) return;
    // Out in the rain (not under the mushroom): gets wet; shakes off when it stops.
    const sky = this.d.stage.sky;
    const sheltered = Math.hypot(v.pos.x - DECOR.mushroom.x, v.pos.z - DECOR.mushroom.z) < 0.6;
    if (sky && this.raining && !sheltered) this.wetKin = Math.min(1, this.wetKin + dt * 0.05);
    // Footprints in snow.
    if (this.snowDepth > 0.15 && v.pos.distanceTo(this.lastPrint) > 0.16 && v.height < 0.02) {
      const fp = this.prints[this.printIdx++ % this.prints.length]!;
      const side = this.printIdx % 2 ? 1 : -1;
      fp.m.position.set(v.pos.x + Math.cos(v.yaw) * 0.06 * side, 0.007, v.pos.z - Math.sin(v.yaw) * 0.06 * side);
      fp.m.rotation.z = v.yaw;
      fp.age = 0;
      this.lastPrint.copy(v.pos);
    }
    // Autonomy that's about the world (the brain handles the rest):
    if (v.busy || this.blanketOn) return;
    // Hungry and a berry lies on the ground → go eat it.
    if (this.care.needs.fullness < 0.5) {
      const berry = [...this.entities.values()].find((e) => e.kind === 'berry' && !e.held);
      if (berry && this.rand() < dt * 0.3) {
        const at = berry.obj.position.clone().setY(0);
        const ripe = (berry.data.ripeness as number) ?? 1;
        this.eat(ripe, at, () => this.removeEntity(berry.id));
        return;
      }
    }
    // Wandering and curious → sometimes stops to dig (a few finds a day).
    if (v.action === 'wander' && this.rand() < dt * 0.012 * (0.5 + this.d.traits().curiosity)) {
      if (this.dig()) return;
    }
    // Butterflies passing close → watch them.
    if (this.butterflies && this.rand() < dt * 0.15) {
      const near = this.butterflies.flock.p.find((p) => Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < 1.2);
      if (near) {
        const n = near;
        v.script([{ dur: 1800, run: () => (v.look = new THREE.Vector3(n.x, n.y, n.z)), enter: () => ((v.mood = 'surprised'), v.earFlick(0.6)) }, { dur: 1, enter: () => (v.look = null) }] as Task[]);
      }
    }
    void now;
  }

  // ───────────────────────────── items and interaction (used by the care UI)

  /** The feather in your fingers. */
  holdFeather(at: THREE.Vector3) {
    if (!this.feather) return;
    const f = this.feather.f;
    f.p = { x: at.x, y: at.y, z: at.z };
    f.v = v3();
    f.resting = false;
    this.feather.e.obj.position.copy(at);
  }

  /** Let go: it floats again on the real wind. */
  releaseFeather(vel: V3) {
    if (!this.feather) return;
    this.feather.e.held = false;
    this.feather.f.v = { ...vel };
    this.feather.f.resting = false;
  }

  /** A feather brushed past the KIN: a giggle-wiggle. */
  tickle() {
    const v = this.d.view;
    if (!this.d.isHome()) return;
    this.apply(care.play(this.care, this.now(), 'toy'));
    v.script([
      { dur: 700, enter: () => ((v.mood = 'happy'), v.earFlick(1.8), this.say('giggle'), this.d.sfx?.chirp?.(1.5)), run: (k: number) => (this.post.wiggle = Math.sin(k * Math.PI * 6) * 0.12 * (1 - k)), exit: () => (this.post.wiggle = 0) },
    ] as Task[]);
  }

  private lastBrush = 0;
  brushStroke() {
    const v = this.d.view;
    if (!this.d.isHome()) return;
    const now = this.now();
    this.apply(care.brush(this.care, now));
    v.pet(0.25);
    if (now - this.lastBrush > 1200) {
      this.lastBrush = now;
      this.d.sfx?.purr?.();
      this.emote('sparkle');
    }
  }

  /** A drop of water on the KIN: splash, then the shake. */
  bath() {
    if (!this.d.isHome()) return;
    this.apply(care.bath(this.care, this.now()));
    this.wetKin = 1;
    this.d.sfx?.chirp?.(0.8);
    setTimeout(() => this.shakeOff(), 500);
  }

  waterTarget(t: 'plant' | number) {
    this.apply(care.water(this.care, this.now(), t));
    this.syncPlots();
    this.d.toast?.(t === 'plant' ? 'The plant perks up.' : 'Watered.');
  }

  /** Take an item out of the collection and put it in the garden (it stays, physically). */
  placeItem(id: string, x: number, z: number): boolean {
    const n = this.care.collection[id] ?? 0;
    if (n < 1) return false;
    const e = this.spawnItem(id, { x, y: 0.3, z }, 'placed');
    if (!e) return false;
    this.care = { ...this.care, collection: { ...this.care.collection, [id]: n - 1 }, placed: [...this.care.placed, { id, x, z }] };
    e.data.placedIdx = this.care.placed.length - 1;
    this.save();
    return true;
  }

  /** Put a catalogue item in the garden as a physical object. */
  spawnItem(id: string, at: V3, as: 'find' | 'placed') {
    const def = care.itemById(id);
    if (!def) return null;
    const v = V.itemView(def.kind, id);
    const eid = `${as}:${id}:${++this.seq}`;
    v.group.position.set(at.x, at.y, at.z);
    this.d.stage.world.add(v.group);
    const e: Entity = { id: eid, kind: as, obj: v.group, r: 0.12, grab: as === 'find' ? 'collect' : 'throw', item: id, data: { glint: as === 'find' ? v.glint : undefined } };
    if (as === 'placed') v.glint.visible = false;
    if (this.physics && def.kind !== 'feather' && def.kind !== 'leaf') {
      // Colliders match what you see: a flat pebble or shell rests flat and slides (it doesn't roll
      // like a marble); round things (seed, acorn) roll; the crystal stands on its point-ish box.
      const shape: Shape =
        def.kind === 'crystal' ? { box: [0.04, 0.08, 0.04] }
          : def.kind === 'pebble' ? { cylinder: [0.035, 0.055] }
            : def.kind === 'shell' ? { cylinder: [0.035, 0.05] }
              : def.kind === 'acorn' ? { ball: 0.045 }
                : { ball: 0.03 };
      e.body = this.physics.add({ id: eid, shape, material: def.kind === 'shell' ? 'shell' : 'stone', pos: { x: at.x, y: at.y + 0.05, z: at.z } });
      e.body.impulse({ x: (this.rand() - 0.5) * 0.004, y: 0.01, z: 0.003 });
    }
    this.entities.set(eid, e);
    return e;
  }

  removeEntity(id: string) {
    const e = this.entities.get(id);
    if (!e) return;
    this.d.stage.world.remove(e.obj);
    if (e.body) this.physics?.remove(id);
    this.entities.delete(id);
  }

  /** Pick a berry from the plant: it becomes a physical berry in your hand. */
  pickBerry(at: V3): Entity | null {
    const r = care.pickBerry(this.care);
    if (!r) return null;
    this.care = r.care;
    return this.spawnBerry(at, r.ripeness);
  }

  private spawnBerry(at: V3, ripeness: number): Entity {
    const v = V.berryView();
    V.berryColor(ripeness, v.mat.color);
    v.group.position.set(at.x, at.y, at.z);
    this.d.stage.world.add(v.group);
    const id = `berry:${++this.seq}`;
    const e: Entity = { id, kind: 'berry', obj: v.group, r: 0.12, grab: 'carry', data: { ripeness } };
    if (this.physics) e.body = this.physics.add({ id, shape: { ball: 0.045 }, material: 'berry', pos: at });
    this.entities.set(id, e);
    return e;
  }

  /** Plots line the front-left of the garden, wrapping into a second row as more open up. */
  plotPos(i: number) {
    const span = this.span;
    const perRow = Math.max(3, Math.floor((span * 2 - 0.4) / 0.48));
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    return new THREE.Vector3(-span + 0.25 + col * 0.48, 0, 1.12 - row * 0.32 - (col % 2) * 0.08);
  }

  syncPlots() {
    const st = this.d.stage;
    while (this.plots.length < this.care.plots.length) {
      const pv = V.plotView();
      const i = this.plots.length;
      pv.group.position.copy(this.plotPos(i));
      st.world.add(pv.group);
      this.plots.push(pv);
    }
    this.care.plots.forEach((p, i) => {
      const pv = this.plots[i]!;
      pv.sprout.visible = !!p.seed;
      const gr = p.growth;
      pv.sprout.scale.setScalar(0.25 + gr * 0.85);
      pv.bloom.visible = gr >= 1;
      const hue: Record<string, string> = { 'seed-mint': '#6EE5CA', 'seed-sun': '#F2C14E', 'seed-moon': '#C9D0FF', 'seed-frost': '#DDF1FF' };
      pv.petalMat.color.set(hue[p.seed ?? ''] ?? '#F6F6F3');
    });
  }

  // ───────────────────────────── care plumbing

  apply(o: care.Outcome) {
    this.care = care.ensurePlots(o.care);
    if (o.levelUp) {
      this.d.toast?.(`${this.d.kinName()} and you: ${care.bondLevel(this.care.bondXp).name}.`);
      this.d.sfx?.chime?.();
      if (o.levelUp === 2) this.addJelly();
      this.syncPlots();
    }
    for (const l of this.listeners) l({ type: 'care' });
  }

  private tickCare(now: number) {
    const sky = this.d.stage.sky;
    this.lastCare = now;
    if (!sky) return;
    const asleep = this.d.view.action === 'sleep' || this.care.asleepUnderBlanket;
    const r = care.tick(this.care, now, sky, asleep);
    this.care = r.care;
    for (let i = 0; i < r.fallen; i++) {
      const e = this.spawnBerry({ x: DECOR.plant.x + (this.rand() - 0.5) * 0.3, y: 0.55, z: DECOR.plant.z + 0.2 }, 1.2);
      this.emit({ type: 'fruit-fell', id: e.id });
    }
    this.syncPlots();
    for (const l of this.listeners) l({ type: 'care' });
  }

  season(): care.Season {
    return care.season(new Date(this.now()), this.d.stage.sky?.lat ?? 30);
  }

  save() {
    this.lastSave = this.now();
    // Placed decor is only live (and so only re-saved) once physics has spawned it.
    if (this.physics) {
      const placed = [...this.entities.values()].filter((e) => e.kind === 'placed' && e.item).map((e) => ({ id: e.item!, x: +e.obj.position.x.toFixed(3), z: +e.obj.position.z.toFixed(3) }));
      this.care = { ...this.care, placed };
    }
    try {
      this.d.kv.set(this.stateKey, JSON.stringify(this.care));
    } catch {
      /* storage full or blocked: the garden still works this session */
    }
    this.saveWorld();
  }

  private saveWorld() {
    try {
      this.d.kv.set(this.worldKey, JSON.stringify(this.ws));
    } catch {
      /* ignore */
    }
  }

  /** Reunion: back after a long while, the KIN is overjoyed. */
  reunion() {
    const v = this.d.view;
    if (!this.d.isHome()) return;
    v.script([
      { dur: 300, enter: () => ((v.look = new THREE.Vector3(v.pos.x * 0.6, 2.2, 6)), (v.mood = 'surprised'), v.earFlick(2)) },
      ...[0, 1, 2].map(() => ({ dur: 330, enter: () => (v.squashImpulse(0.6), this.d.sfx?.chirp?.(1.3)), run: (k: number) => (v.height = Math.sin(k * Math.PI) * 0.25), exit: () => (v.height = 0) })),
      { dur: 1500, enter: () => ((v.mood = 'happy'), this.emote('heart'), this.say('happy')) },
    ] as Task[]);
  }

  dispose() {
    this.save();
    this.d.stage.toyDriver = null;
    this.d.stage.fireflies = false;
  }
}
