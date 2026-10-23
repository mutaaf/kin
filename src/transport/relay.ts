// Relay transport: a WebSocket to the Lobby for this datacenter (src/worker). It opens lazily,
// only when the player makes a stitch gesture, so a KIN isn't discoverable until someone means it.
// Once paired, envelopes flow through the room; the relay never interprets them.

import { parseEnvelope, type Envelope } from '../protocol/messages';
import type { Transport } from './transport';

export interface Paired {
  room: string;
  peer: string;
  edge: 'left' | 'right';
  /** The peer screen's top relative to mine (CSS px), from the stitch gesture. */
  offsetY: number;
}

type ServerMsg =
  | { k: 'paired'; room: string; peer: string; edge: 'left' | 'right'; offsetY: number }
  | { k: 'members'; room: string; peers: string[] }
  | { k: 'peer-left'; peer: string }
  | { k: 'stitch-miss'; reason: string }
  | { k: 'env'; env: unknown }
  | { k: 'pong' };

export class RelayTransport implements Transport {
  readonly kind = 'relay';
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private subs = new Set<(env: Envelope) => void>();
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry = 0;
  room: string | null = null;
  onPaired: (p: Paired) => void = () => {};
  onMiss: (reason: string) => void = () => {};
  onMembers: (peers: string[]) => void = () => {};
  onPeerLeft: (peer: string) => void = () => {};
  onState: (s: 'idle' | 'connecting' | 'open' | 'closed') => void = () => {};

  constructor(private self: string, private url: string) {}

  /** Open (idempotently) and say who we are. */
  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.onState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ k: 'hello', peer: this.self }));
      for (const m of this.queue.splice(0)) ws.send(m);
      this.onState('open');
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"k":"ping"}'), 20_000);
    };
    ws.onmessage = (ev) => this.receive(String(ev.data));
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      this.onState('closed');
      // Stay in the room through brief drops (phone sleeps, Wi-Fi handoff) with backoff.
      // Rooms are server-side per socket, so after reconnecting a new stitch is needed to rejoin.
      if (this.room && this.retry < 5) setTimeout(() => this.connect(), 500 * 2 ** this.retry++);
      this.room = null;
    };
  }

  /** Report a stitch half. `age` = ms since the finger crossed the edge. */
  stitch(dir: 'out' | 'in', edge: 'left' | 'right', y: number, age: number, v: number) {
    this.connect();
    this.raw({ k: 'stitch', dir, edge, y: Math.round(y), age: Math.round(age), v: +v.toFixed(3) });
  }

  send(env: Envelope) {
    if (!this.room) return; // nothing to relay to until paired
    this.raw({ k: 'env', env });
  }

  onMessage(cb: (env: Envelope) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  leave() {
    this.raw({ k: 'leave' });
    this.room = null;
  }

  close() {
    this.room = null;
    this.ws?.close();
    this.subs.clear();
  }

  private raw(m: unknown) {
    const s = JSON.stringify(m);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else {
      this.queue.push(s);
      this.connect();
    }
  }

  private receive(raw: string) {
    let m: ServerMsg;
    try {
      m = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (m.k) {
      case 'paired':
        this.room = m.room;
        this.onPaired(m);
        return;
      case 'members':
        this.onMembers(m.peers);
        return;
      case 'peer-left':
        this.onPeerLeft(m.peer);
        return;
      case 'stitch-miss':
        this.onMiss(m.reason);
        return;
      case 'env': {
        const env = parseEnvelope(m.env);
        if (!env || env.from === this.self) return;
        for (const cb of this.subs) cb(env);
        return;
      }
    }
  }
}

/** Fan out over several transports; receive from all, de-duplicating by envelope id. */
export class MultiTransport implements Transport {
  readonly kind = 'multi';
  private seen = new Map<string, number>();
  constructor(private parts: Transport[]) {}

  send(env: Envelope) {
    for (const t of this.parts) t.send(env);
  }

  onMessage(cb: (env: Envelope) => void) {
    const offs = this.parts.map((t) =>
      t.onMessage((env) => {
        const now = Date.now();
        if (this.seen.has(env.id)) return;
        this.seen.set(env.id, now);
        if (this.seen.size > 2000) for (const [k, at] of this.seen) if (now - at > 30_000) this.seen.delete(k);
        cb(env);
      }),
    );
    return () => offs.forEach((o) => o());
  }

  close() {
    this.parts.forEach((t) => t.close());
  }
}

export function relayUrl(native: boolean): string {
  const q = new URLSearchParams(location.search).get('relay');
  if (q) return q;
  // Native apps and local dev talk to production; the deployed site talks to itself.
  if (native || /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname)) return 'wss://mutaafaziz.com/kin/api/lobby';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/kin/api/lobby`;
}
