// KIN CROSS as two pure state machines: the Owner (my KIN leaving) and the Host (guests arriving).
// No timers, no I/O: every input is (message | user intent | tick) plus `now`, every output is
// messages to send and effects to render/persist. That makes the invariant testable under loss,
// duplication, reordering and crashes (tests/cross.property.test.ts).
//
// Invariants
//   1. Ownership never moves. Only the owner persists the creature; a host keeps a lease in memory.
//   2. One placement. After the network settles the KIN is either home, or hosted by exactly one
//      peer that the owner believes it is visiting. Never both, never neither.
//   3. Every step is idempotent. Retries re-send the current step; duplicates are answered, not redone.

import type { Edge } from '../core/brain';
import type { Reaction } from '../core/creature';
import type { Msg, Seam, VisitMemory, VisitorSnapshot } from '../protocol/messages';

export const T = {
  RETRY: 600,
  INVITE_TIMEOUT: 15_000,
  PREPARE_TIMEOUT: 5_000,
  /** Lead time so both screens start the hop on the same frame despite latency. */
  LEAD: 450,
  /** Airborne part of the hop; the seam is crossed at the midpoint. */
  HOP: 1_050,
  /** Landing, squash and the host's first look. Commit is sent after this. */
  SETTLE: 650,
  COMMIT_GRACE: 3_000,
  BEAT: 1_000,
  LEASE: 5_000,
  RETURN_TIMEOUT: 4_500,
  TOMBSTONE: 60_000,
} as const;

export const opposite = (e: Edge): Edge => ({ left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const)[e];

export interface Out {
  to: string;
  msg: Msg;
}

// ───────────────────────────── Owner ─────────────────────────────

export type OwnerPhase = 'home' | 'inviting' | 'preparing' | 'exiting' | 'away' | 'returning';

export type OwnerFx =
  | { e: 'phase'; phase: OwnerPhase }
  | { e: 'hop_out'; visitId: string; at: number; edge: Edge; seam: Seam; peer: string }
  /** Commit received: persist placement=away. */
  | { e: 'away'; visitId: string; peer: string }
  /** Creature comes back without a completed visit (declined, cancelled, lease lost). */
  | { e: 'come_back'; visitId: string; reason: string; wasOut: boolean }
  | { e: 'hop_in'; visitId: string; at: number; edge: Edge }
  /** Visit finished: persist placement=home and the memory (may be null if the host vanished). */
  | { e: 'home'; visitId: string; memory: VisitMemory | null };

export interface Step<F> {
  out: Out[];
  fx: F[];
}

export class Owner {
  phase: OwnerPhase = 'home';
  visitId: string | null = null;
  peer: string | null = null;
  edge: Edge = 'right';
  seam: Seam | null = null;
  startAt = 0;
  returnAt = 0;
  private deadline = 0;
  private lastSent = 0;
  private lastAck = 0;
  private lastBeat = 0;

  constructor(
    private visitor: () => VisitorSnapshot,
    private newId: () => string,
    /** remote clock − local clock for a peer, from clock.ping/pong. */
    private offset: (peer: string) => number = () => 0,
  ) {}

  /** User intent: send my KIN to `peer` across `edge`. */
  visit(peer: string, edge: Edge, seam: Seam, now: number): Step<OwnerFx> {
    if (this.phase !== 'home') return none();
    this.visitId = this.newId();
    this.peer = peer;
    this.edge = edge;
    this.seam = seam;
    this.deadline = now + T.INVITE_TIMEOUT;
    return this.go('inviting', now, [this.invite()]);
  }

  /** User intent (or host request): bring my KIN home. */
  recall(now: number, reason = 'recall'): Step<OwnerFx> {
    if (this.phase === 'away') {
      this.returnAt = now + T.LEAD;
      this.deadline = this.returnAt + T.HOP + T.RETURN_TIMEOUT;
      const s = this.go('returning', now, [this.returnMsg()]);
      s.fx.push({ e: 'hop_in', visitId: this.visitId!, at: this.returnAt, edge: this.edge });
      return s;
    }
    if (this.phase === 'inviting' || this.phase === 'preparing' || this.phase === 'exiting') {
      return this.abort(now, reason);
    }
    return none();
  }

  /** After a restart with placement=away persisted: we don't know the host's state, so ask for it back. */
  restore(visitId: string, peer: string, now: number): Step<OwnerFx> {
    this.visitId = visitId;
    this.peer = peer;
    this.phase = 'away';
    return this.recall(now, 'restart');
  }

  handle(from: string, msg: Msg, now: number): Step<OwnerFx> {
    if (!('visitId' in msg)) return none();
    const mine = msg.visitId === this.visitId && from === this.peer;
    switch (msg.t) {
      case 'visit.accept':
        if (mine && this.phase === 'inviting') {
          this.deadline = now + T.PREPARE_TIMEOUT;
          return this.go('preparing', now, [this.prepare()]);
        }
        // A late accept for a visit we gave up on: make sure the host lets go.
        return mine && this.phase !== 'home' ? none() : cancelTo(from, msg.visitId, 'stale');
      case 'visit.decline':
        if (mine && (this.phase === 'inviting' || this.phase === 'preparing')) return this.abort(now, msg.reason, false);
        return none();
      case 'cross.ready':
        if (mine && this.phase === 'preparing') {
          this.startAt = now + T.LEAD;
          this.deadline = this.startAt + T.HOP + T.SETTLE + T.COMMIT_GRACE;
          const s = this.go('exiting', now, [this.start()]);
          s.fx.push({ e: 'hop_out', visitId: this.visitId!, at: this.startAt, edge: this.edge, seam: this.seam!, peer: this.peer! });
          return s;
        }
        return mine ? none() : cancelTo(from, msg.visitId, 'stale');
      case 'cross.commit':
        if (mine && this.phase === 'exiting') {
          this.lastAck = now;
          this.lastBeat = now;
          const s = this.go('away', now, []);
          s.fx.push({ e: 'away', visitId: this.visitId!, peer: this.peer! });
          return s;
        }
        if (mine && (this.phase === 'away' || this.phase === 'returning')) return none();
        // Commit for a visit we already cancelled (our cancel and their commit crossed).
        return cancelTo(from, msg.visitId, 'stale');
      case 'visit.heartbeat.ack':
        if (mine && this.phase === 'away') this.lastAck = now;
        return none();
      case 'visit.return.request':
        return mine && this.phase === 'away' ? this.recall(now, 'host') : none();
      case 'visit.complete':
        if (mine && (this.phase === 'returning' || this.phase === 'away')) return this.finish(now, msg.memory);
        return none();
      case 'cross.cancel':
        if (!mine) return none();
        if (this.phase === 'returning') return this.finish(now, null);
        if (this.phase !== 'home') return this.abort(now, msg.reason, false);
        return none();
      default:
        return none();
    }
  }

  tick(now: number): Step<OwnerFx> {
    switch (this.phase) {
      case 'home':
        return none();
      case 'inviting':
      case 'preparing':
        if (now > this.deadline) return this.abort(now, 'timeout');
        return this.retry(now, this.phase === 'inviting' ? this.invite() : this.prepare());
      case 'exiting':
        if (now > this.deadline) return this.abort(now, 'no-commit');
        return this.retry(now, this.start());
      case 'away': {
        if (now - this.lastAck > T.LEASE) return this.abort(now, 'lease');
        if (now - this.lastBeat < T.BEAT) return none();
        this.lastBeat = now;
        return { out: [{ to: this.peer!, msg: { t: 'visit.heartbeat', visitId: this.visitId! } }], fx: [] };
      }
      case 'returning':
        if (now > this.deadline) return this.finish(now, null);
        return this.retry(now, this.returnMsg());
    }
  }

  // ── helpers
  private go(phase: OwnerPhase, now: number, out: Msg[]): Step<OwnerFx> {
    this.phase = phase;
    this.lastSent = now;
    return { out: out.map((msg) => ({ to: this.peer!, msg })), fx: [{ e: 'phase', phase }] };
  }

  private retry(now: number, msg: Msg): Step<OwnerFx> {
    if (now - this.lastSent < T.RETRY) return none();
    this.lastSent = now;
    return { out: [{ to: this.peer!, msg }], fx: [] };
  }

  private abort(now: number, reason: string, notify = true): Step<OwnerFx> {
    const visitId = this.visitId!;
    const wasOut = this.phase === 'exiting' || this.phase === 'away';
    const out: Out[] = notify && this.peer ? [{ to: this.peer, msg: { t: 'cross.cancel', visitId, reason } }] : [];
    const s = this.go('home', now, []);
    s.out = out;
    s.fx.push({ e: 'come_back', visitId, reason, wasOut });
    this.visitId = null;
    return s;
  }

  private finish(now: number, memory: VisitMemory | null): Step<OwnerFx> {
    const visitId = this.visitId!;
    const s = this.go('home', now, []);
    s.fx.push({ e: 'home', visitId, memory });
    this.visitId = null;
    return s;
  }

  private invite(): Msg {
    return { t: 'visit.invite', visitId: this.visitId!, visitor: this.visitor() };
  }
  private prepare(): Msg {
    return { t: 'cross.prepare', visitId: this.visitId!, visitor: this.visitor() };
  }
  private start(): Msg {
    // startAt travels in the receiver's clock so it can schedule without knowing ours.
    return { t: 'cross.start', visitId: this.visitId!, startAt: this.startAt + this.offset(this.peer!), edge: this.edge, seam: this.seam! };
  }
  private returnMsg(): Msg {
    return { t: 'visit.return', visitId: this.visitId! };
  }
}

// ───────────────────────────── Host ─────────────────────────────

export type GuestPhase = 'asking' | 'accepted' | 'ready' | 'arriving' | 'hosting' | 'leaving';

export interface Guest {
  visitId: string;
  owner: string;
  visitor: VisitorSnapshot;
  phase: GuestPhase;
  deadline: number;
  lastBeat: number;
  arriveAt: number;
  edge: Edge;
  seam: Seam | null;
  reaction: Reaction;
}

export type HostFx =
  | { e: 'ask'; visitId: string; visitor: VisitorSnapshot }
  | { e: 'hop_in'; visitId: string; visitor: VisitorSnapshot; at: number; edge: Edge; seam: Seam; reaction: Reaction }
  | { e: 'hosting'; visitId: string; visitor: VisitorSnapshot }
  | { e: 'hop_out'; visitId: string; at: number; edge: Edge }
  /** Guest disappears without ceremony (cancel or lease expiry): fade, never persist. */
  | { e: 'drop'; visitId: string; reason: string }
  | { e: 'unasked'; visitId: string };

export interface HostPolicy {
  /** 'ask' shows a prompt; 'auto' accepts friends-of-the-room; 'off' declines everything. */
  mode: () => 'ask' | 'auto' | 'off';
  capacity: number;
  /** False while my own KIN is away: a house with nobody home doesn't take visitors. */
  open: () => boolean;
  reaction: (v: VisitorSnapshot) => Reaction;
  memory: (g: Guest) => VisitMemory;
}

export class Host {
  guests = new Map<string, Guest>();
  /** Finished visits, so a retried `visit.return` still gets its memory back exactly once. */
  private done = new Map<string, { at: number; memory: VisitMemory | null; owner: string }>();

  constructor(private policy: HostPolicy) {}

  /** User answered the visit prompt. */
  answer(visitId: string, yes: boolean, now: number): Step<HostFx> {
    const g = this.guests.get(visitId);
    if (!g || g.phase !== 'asking') return none();
    if (!yes) {
      this.guests.delete(visitId);
      return { out: [{ to: g.owner, msg: { t: 'visit.decline', visitId, reason: 'host-declined' } }], fx: [] };
    }
    g.phase = 'accepted';
    g.deadline = now + T.PREPARE_TIMEOUT + T.RETRY * 2;
    return { out: [{ to: g.owner, msg: { t: 'visit.accept', visitId } }], fx: [] };
  }

  /** Host-side "send home" (the visitor's owner still decides; we only ask). */
  sendHome(visitId: string): Step<HostFx> {
    const g = this.guests.get(visitId);
    if (!g || g.phase !== 'hosting') return none();
    return { out: [{ to: g.owner, msg: { t: 'visit.return.request', visitId } }], fx: [] };
  }

  handle(from: string, msg: Msg, now: number): Step<HostFx> {
    if (!('visitId' in msg)) return none();
    const g = this.guests.get(msg.visitId);
    if (g && g.owner !== from) return none(); // only the owner speaks for its KIN
    const reply = (m: Msg): Step<HostFx> => ({ out: [{ to: from, msg: m }], fx: [] });

    switch (msg.t) {
      case 'visit.invite': {
        if (g) return g.phase === 'asking' ? none() : reply({ t: 'visit.accept', visitId: g.visitId });
        if (this.done.has(msg.visitId)) return reply({ t: 'visit.decline', visitId: msg.visitId, reason: 'stale' });
        const mode = this.policy.mode();
        const full = [...this.guests.values()].filter((x) => x.phase !== 'asking').length >= this.policy.capacity;
        const already = [...this.guests.values()].some((x) => x.visitor.kinId === msg.visitor.kinId);
        if (mode === 'off' || !this.policy.open() || full || already) {
          return reply({ t: 'visit.decline', visitId: msg.visitId, reason: mode === 'off' ? 'closed' : full ? 'full' : 'busy' });
        }
        const guest: Guest = {
          visitId: msg.visitId, owner: from, visitor: msg.visitor, phase: 'asking',
          deadline: now + T.INVITE_TIMEOUT - 1_000, lastBeat: now, arriveAt: 0, edge: 'left', seam: null,
          reaction: this.policy.reaction(msg.visitor),
        };
        this.guests.set(msg.visitId, guest);
        if (mode === 'auto') return this.answer(msg.visitId, true, now);
        return { out: [], fx: [{ e: 'ask', visitId: msg.visitId, visitor: msg.visitor }] };
      }
      case 'cross.prepare':
        if (!g) return reply({ t: 'cross.cancel', visitId: msg.visitId, reason: 'unknown' });
        if (g.phase === 'accepted') {
          g.phase = 'ready';
          g.visitor = msg.visitor;
          g.deadline = now + T.PREPARE_TIMEOUT + T.LEAD + T.COMMIT_GRACE;
        }
        return g.phase === 'ready' ? reply({ t: 'cross.ready', visitId: g.visitId }) : none();
      case 'cross.start': {
        if (!g) return reply({ t: 'cross.cancel', visitId: msg.visitId, reason: 'unknown' });
        if (g.phase === 'hosting') return reply({ t: 'cross.commit', visitId: g.visitId });
        if (g.phase !== 'ready') return none();
        // Convert to local clock; if we heard late, join the hop mid-air rather than stall the party.
        g.arriveAt = Math.max(msg.startAt, now - T.HOP * 0.5);
        g.edge = opposite(msg.edge);
        g.seam = msg.seam;
        g.phase = 'arriving';
        g.lastBeat = now;
        return {
          out: [],
          fx: [{ e: 'hop_in', visitId: g.visitId, visitor: g.visitor, at: g.arriveAt, edge: g.edge, seam: msg.seam, reaction: g.reaction }],
        };
      }
      case 'visit.heartbeat':
        if (!g || g.phase === 'leaving') return reply({ t: 'cross.cancel', visitId: msg.visitId, reason: g ? 'leaving' : 'unknown' });
        g.lastBeat = now;
        return reply({ t: 'visit.heartbeat.ack', visitId: g.visitId });
      case 'visit.return': {
        const fin = this.done.get(msg.visitId);
        if (fin) return reply({ t: 'visit.complete', visitId: msg.visitId, memory: fin.memory });
        if (!g) return reply({ t: 'visit.complete', visitId: msg.visitId, memory: null });
        if (g.phase === 'leaving') return none();
        if (g.phase !== 'hosting' && g.phase !== 'arriving') return this.drop(g, now, 'returned');
        g.phase = 'leaving';
        g.deadline = now + T.HOP;
        return { out: [], fx: [{ e: 'hop_out', visitId: g.visitId, at: now, edge: g.edge }] };
      }
      case 'cross.cancel':
        return g ? this.drop(g, now, msg.reason, false) : none();
      default:
        return none();
    }
  }

  tick(now: number): Step<HostFx> {
    const step: Step<HostFx> = { out: [], fx: [] };
    for (const g of [...this.guests.values()]) {
      const merge = (s: Step<HostFx>) => {
        step.out.push(...s.out);
        step.fx.push(...s.fx);
      };
      switch (g.phase) {
        case 'asking':
          if (now > g.deadline) {
            this.guests.delete(g.visitId);
            step.out.push({ to: g.owner, msg: { t: 'visit.decline', visitId: g.visitId, reason: 'no-answer' } });
            step.fx.push({ e: 'unasked', visitId: g.visitId });
          }
          break;
        case 'accepted':
        case 'ready':
          if (now > g.deadline) merge(this.drop(g, now, 'timeout'));
          break;
        case 'arriving':
          if (now >= g.arriveAt + T.HOP + T.SETTLE) {
            g.phase = 'hosting';
            g.lastBeat = now;
            step.out.push({ to: g.owner, msg: { t: 'cross.commit', visitId: g.visitId } });
            step.fx.push({ e: 'hosting', visitId: g.visitId, visitor: g.visitor });
          }
          break;
        case 'hosting':
          if (now - g.lastBeat > T.LEASE) merge(this.drop(g, now, 'lease'));
          break;
        case 'leaving':
          if (now >= g.deadline) {
            const memory = this.policy.memory(g);
            this.guests.delete(g.visitId);
            this.done.set(g.visitId, { at: now, memory, owner: g.owner });
            step.out.push({ to: g.owner, msg: { t: 'visit.complete', visitId: g.visitId, memory } });
          }
          break;
      }
    }
    for (const [id, d] of this.done) if (now - d.at > T.TOMBSTONE) this.done.delete(id);
    return step;
  }

  private drop(g: Guest, now: number, reason: string, notify = true): Step<HostFx> {
    this.guests.delete(g.visitId);
    this.done.set(g.visitId, { at: now, memory: null, owner: g.owner });
    return {
      out: notify ? [{ to: g.owner, msg: { t: 'cross.cancel', visitId: g.visitId, reason } }] : [],
      fx: [{ e: 'drop', visitId: g.visitId, reason }],
    };
  }
}

const none = <F>(): Step<F> => ({ out: [], fx: [] });
const cancelTo = <F>(to: string, visitId: string, reason: string): Step<F> => ({
  out: [{ to, msg: { t: 'cross.cancel', visitId, reason } }],
  fx: [],
});
