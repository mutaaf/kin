// The actor runtime: every object in the garden is its own small agent. Each actor has its own
// state, its own controller and its own tick rate. Actors that have nothing to do sleep, and
// cost nothing, until an event they listen for wakes them. Actors never call each other: they
// talk through events on a bus. Pure (no DOM, no three, no WASM), so it is tested headless.

export type WorldEvent =
  | { type: 'thrown'; id: string; speed: number }
  | { type: 'landed'; id: string; speed: number }
  | { type: 'touched'; id: string; by: 'kin' | 'player' | 'object' }
  | { type: 'toppled'; id: string }
  | { type: 'squished'; id: string }
  | { type: 'eaten'; id: string; ripeness: number }
  | { type: 'fruit-ripe'; id: string }
  | { type: 'fruit-fell'; id: string }
  | { type: 'rain-started' }
  | { type: 'rain-stopped' }
  | { type: 'snow-started' }
  | { type: 'snow-stopped' }
  | { type: 'gust'; strength: number }
  | { type: 'found'; item: string; x: number; z: number }
  | { type: 'befriended'; id: string }
  | { type: 'arrived'; id: string }
  | { type: 'left'; id: string }
  | { type: 'night' }
  | { type: 'day' };

export type EventType = WorldEvent['type'];

export class Bus {
  private subs = new Map<EventType | '*', Set<(e: WorldEvent) => void>>();
  /** Events emitted during a step are delivered after it, in order (no re-entrancy surprises). */
  private queue: WorldEvent[] = [];
  readonly log: WorldEvent[] = [];

  on<T extends EventType>(type: T | '*', cb: (e: Extract<WorldEvent, { type: T }>) => void): () => void {
    const set = this.subs.get(type) ?? new Set();
    set.add(cb as (e: WorldEvent) => void);
    this.subs.set(type, set);
    return () => set.delete(cb as (e: WorldEvent) => void);
  }

  emit(e: WorldEvent) {
    this.queue.push(e);
  }

  flush() {
    for (let guard = 0; guard < 8 && this.queue.length; guard++) {
      const batch = this.queue.splice(0);
      for (const e of batch) {
        this.log.push(e);
        if (this.log.length > 200) this.log.shift();
        for (const cb of this.subs.get(e.type) ?? []) cb(e);
        for (const cb of this.subs.get('*') ?? []) cb(e);
      }
    }
  }
}

/** What an actor can see and do. The world provides it; tests provide a fake. */
export interface ActorCtx {
  now: number;
  /** Seconds since this actor's previous tick. */
  dt: number;
  bus: Bus;
  rand: () => number;
}

export interface Actor<S = unknown> {
  readonly id: string;
  readonly kind: string;
  state: S;
  /** Ticks per second while awake. */
  hz: number;
  awake: boolean;
  /** Event types that wake this actor up. */
  wakeOn?: EventType[];
  /** The controller: decide and act. Return false to go to sleep. */
  tick(ctx: ActorCtx): boolean | void;
  /** React to an event (also called while asleep, before it wakes). */
  on?(e: WorldEvent, ctx: ActorCtx): void;
}

interface Slot {
  actor: Actor;
  next: number;
  last: number;
}

export class Scheduler {
  private slots = new Map<string, Slot>();
  readonly bus = new Bus();
  ticks = 0;
  /** The time of the step being run (events are delivered at this time). */
  private now = 0;

  constructor(private rand: () => number = Math.random) {
    this.bus.on('*', (e) => {
      for (const s of this.slots.values()) {
        const a = s.actor;
        if (a.on) a.on(e, this.ctxFor(s, this.now));
        if (!a.awake && a.wakeOn?.includes(e.type)) this.wake(a.id);
      }
    });
  }

  add<S>(a: Actor<S>, now = 0) {
    this.slots.set(a.id, { actor: a as Actor, next: now, last: now });
    return a;
  }

  remove(id: string) {
    this.slots.delete(id);
  }

  get(id: string) {
    return this.slots.get(id)?.actor;
  }

  all(kind?: string): Actor[] {
    return [...this.slots.values()].map((s) => s.actor).filter((a) => !kind || a.kind === kind);
  }

  wake(id: string) {
    const s = this.slots.get(id);
    if (s && !s.actor.awake) {
      s.actor.awake = true;
      s.next = this.now;
      s.last = this.now; // a waking actor doesn't integrate the time it slept
    }
  }

  /** Run every actor whose time has come. Each one keeps its own cadence. */
  step(now: number) {
    this.now = now;
    for (const s of this.slots.values()) {
      const a = s.actor;
      if (!a.awake || now < s.next) continue;
      const ctx = this.ctxFor(s, now);
      const keep = a.tick(ctx);
      this.ticks++;
      s.last = now;
      s.next = now + 1000 / Math.max(0.01, a.hz);
      if (keep === false) a.awake = false;
    }
    this.bus.flush();
  }

  private ctxFor(s: Slot, now: number): ActorCtx {
    return { now, dt: Math.min(2, Math.max(0, (now - s.last) / 1000)), bus: this.bus, rand: this.rand };
  }
}
