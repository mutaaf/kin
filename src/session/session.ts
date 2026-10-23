// Wires the pure crossing machines to a transport, a clock and the app. Owns presence (who is
// nearby), clock-offset estimation and the tick loop. Contains no rules of its own.

import { PROTOCOL_VERSION, type Envelope, type Msg, type PeerInfo } from '../protocol/messages';
import type { Transport } from '../transport/transport';
import { Host, Owner, type HostFx, type HostPolicy, type OwnerFx, type Step } from './cross';
import type { VisitorSnapshot } from '../protocol/messages';
import { randomId } from '../core/rng';

export interface PeerState {
  info: PeerInfo;
  lastSeen: number;
  /** remote clock − local clock (ms), median of recent samples. */
  offset: number;
  rtt: number;
}

const PRESENCE_MS = 1500;
const PEER_TTL = 5000;

export class Session {
  readonly peers = new Map<string, PeerState>();
  readonly owner: Owner;
  readonly host: Host;
  private samples = new Map<string, number[]>();
  private lastHello = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private off: (() => void) | null = null;
  onOwnerFx: (fx: OwnerFx) => void = () => {};
  onHostFx: (fx: HostFx) => void = () => {};
  onPeers: () => void = () => {};

  constructor(
    readonly self: string,
    private transport: Transport,
    private info: () => PeerInfo,
    visitor: () => VisitorSnapshot,
    policy: HostPolicy,
    private now: () => number = Date.now,
  ) {
    this.owner = new Owner(visitor, () => randomId('visit'), (p) => this.peers.get(p)?.offset ?? 0);
    this.host = new Host(policy);
  }

  start() {
    this.off = this.transport.onMessage((e) => this.receive(e));
    this.hello(false);
    this.timer = setInterval(() => this.tick(), 50);
    addEventListener('pagehide', () => this.send('*', { t: 'presence.bye' }));
  }

  stop() {
    this.send('*', { t: 'presence.bye' });
    if (this.timer) clearInterval(this.timer);
    this.off?.();
  }

  /** Announce now (e.g. after the window moved or this KIN left/returned). */
  hello(reply: boolean, to = '*') {
    this.lastHello = this.now();
    this.send(to, { t: 'presence.hello', info: this.info(), reply });
  }

  applyOwner(s: Step<OwnerFx>) {
    for (const o of s.out) this.send(o.to, o.msg);
    for (const f of s.fx) this.onOwnerFx(f);
  }

  applyHost(s: Step<HostFx>) {
    for (const o of s.out) this.send(o.to, o.msg);
    for (const f of s.fx) this.onHostFx(f);
  }

  private send(to: string, msg: Msg) {
    const env: Envelope = { v: PROTOCOL_VERSION, id: randomId('m'), from: this.self, to, at: this.now(), msg };
    this.transport.send(env);
  }

  private receive(e: Envelope) {
    const now = this.now();
    const m = e.msg;
    switch (m.t) {
      case 'presence.hello': {
        const known = this.peers.get(e.from);
        this.peers.set(e.from, { info: m.info, lastSeen: now, offset: known?.offset ?? 0, rtt: known?.rtt ?? 0 });
        if (!known) {
          this.send(e.from, { t: 'clock.ping', t0: now });
          if (!m.reply) this.hello(true, e.from);
        }
        this.onPeers();
        return;
      }
      case 'presence.bye':
        if (this.peers.delete(e.from)) this.onPeers();
        return;
      case 'clock.ping':
        this.send(e.from, { t: 'clock.pong', t0: m.t0, t1: now });
        return;
      case 'clock.pong': {
        // NTP-style: offset ≈ t1 − (t0 + rtt/2). Keep the median of a few samples.
        const rtt = now - m.t0;
        const s = [...(this.samples.get(e.from) ?? []), m.t1 - (m.t0 + rtt / 2)].slice(-7);
        this.samples.set(e.from, s);
        const p = this.peers.get(e.from);
        if (p) {
          p.offset = [...s].sort((a, b) => a - b)[Math.floor(s.length / 2)]!;
          p.rtt = rtt;
        }
        if (s.length < 5) this.send(e.from, { t: 'clock.ping', t0: now });
        return;
      }
      default:
        break;
    }
    const p = this.peers.get(e.from);
    if (p) p.lastSeen = now;
    // Visit traffic: route to whichever machine cares. Owner-bound vs host-bound by message type.
    const toOwner = ['visit.accept', 'visit.decline', 'cross.ready', 'cross.commit', 'visit.heartbeat.ack', 'visit.return.request', 'visit.complete'];
    if (toOwner.includes(m.t)) return this.applyOwner(this.owner.handle(e.from, m, now));
    if (m.t === 'cross.cancel') {
      // Cancels can be for either role; each machine ignores visitIds it doesn't own.
      this.applyOwner(this.owner.handle(e.from, m, now));
      this.applyHost(this.host.handle(e.from, m, now));
      return;
    }
    this.applyHost(this.host.handle(e.from, m, now));
  }

  private tick() {
    const now = this.now();
    this.applyOwner(this.owner.tick(now));
    this.applyHost(this.host.tick(now));
    if (now - this.lastHello > PRESENCE_MS) this.hello(false);
    let changed = false;
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > PEER_TTL) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.onPeers();
  }
}
