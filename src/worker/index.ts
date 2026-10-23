// KIN edge Worker. Static assets (the game) are served by Workers Static Assets; only
// /kin/api/* reaches this script.
//
//   GET /kin/api/lobby   WebSocket into the Lobby for this Cloudflare datacenter. Nearby devices
//                        land in the same one. The Lobby pairs devices by stitch swipe and then
//                        relays protocol envelopes within each paired room.
//
// The relay is dumb on purpose. It never interprets game state, never stores creatures, and
// forgets a room when its last member leaves. Ownership rules live on the devices
// (src/session/cross.ts).

import { matchStitch, type StitchEvent } from '../stitch/match';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  LOBBY: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/kin/api/lobby') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      // One lobby per datacenter: people standing together share a colo. `?pool=` lets tests isolate.
      const cf = (request as Request & { cf?: { colo?: string } }).cf;
      const pool = (url.searchParams.get('pool') || cf?.colo || 'default').slice(0, 24);
      const stub = env.LOBBY.get(env.LOBBY.idFromName('pool:' + pool));
      return stub.fetch(request);
    }
    if (url.pathname === '/kin/api/health') return Response.json({ ok: true });
    return env.ASSETS.fetch(request);
  },
};

interface Attach {
  peer: string;
  room: string | null;
  joined: number;
}

type ClientMsg =
  | { k: 'hello'; peer: string }
  | { k: 'stitch'; dir: 'out' | 'in'; edge: 'left' | 'right'; y: number; age: number; v: number }
  | { k: 'env'; env: unknown }
  | { k: 'leave' }
  | { k: 'ping' };

const MAX_MSG = 8 * 1024;
const PENDING_MS = 1500;

export class Lobby {
  private pending: (StitchEvent & { ws: WebSocket })[] = [];
  private rate = new WeakMap<WebSocket, { n: number; at: number }>();

  constructor(private state: DurableObjectState) {}

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ peer: '', room: null, joined: Date.now() } satisfies Attach);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG || !this.allow(ws)) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    const a = ws.deserializeAttachment() as Attach;
    switch (m.k) {
      case 'hello':
        if (typeof m.peer === 'string' && /^[\w-]{3,64}$/.test(m.peer)) ws.serializeAttachment({ ...a, peer: m.peer });
        return;
      case 'ping':
        ws.send('{"k":"pong"}');
        return;
      case 'stitch': {
        if (!a.peer || (m.dir !== 'out' && m.dir !== 'in') || (m.edge !== 'left' && m.edge !== 'right')) return;
        const now = Date.now();
        const ev = { peer: a.peer, dir: m.dir, edge: m.edge, y: +m.y || 0, v: +m.v || 0.5, t: now - Math.max(0, Math.min(1500, +m.age || 0)), ws };
        this.pending = this.pending.filter((p) => now - p.t < PENDING_MS && p.peer !== a.peer);
        const r = matchStitch(ev, this.pending);
        if (r === 'ambiguous') {
          for (const p of [ev, ...this.pending.filter((x) => Math.abs(x.t - ev.t) < 700)]) send(p.ws, { k: 'stitch-miss', reason: 'crowded' });
          this.pending = this.pending.filter((x) => Math.abs(x.t - ev.t) >= 700);
          return;
        }
        if (!r) {
          this.pending.push(ev);
          return;
        }
        const other = this.pending.find((p) => p.peer === (r.out.peer === a.peer ? r.in.peer : r.out.peer))!;
        this.pending = this.pending.filter((p) => p !== other);
        this.pair(r.out.peer === a.peer ? ws : other.ws, r.in.peer === a.peer ? ws : other.ws, r.out.edge, r.dy);
        return;
      }
      case 'env': {
        if (!a.room) return;
        const env = m.env as { to?: string } | null;
        if (!env || typeof env !== 'object') return;
        const msg = JSON.stringify({ k: 'env', env });
        for (const s of this.room(a.room)) {
          if (s === ws) continue;
          const b = s.deserializeAttachment() as Attach;
          if (env.to === '*' || env.to === b.peer) s.send(msg);
        }
        return;
      }
      case 'leave':
        this.leave(ws);
        return;
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.leave(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.leave(ws);
  }

  private pair(outWs: WebSocket, inWs: WebSocket, outEdge: 'left' | 'right', dy: number) {
    const ao = outWs.deserializeAttachment() as Attach;
    const ai = inWs.deserializeAttachment() as Attach;
    // Joining a party: a newcomer stitched onto someone already in a room joins that room.
    const room = ao.room ?? ai.room ?? crypto.randomUUID().slice(0, 12);
    for (const [ws, att] of [[outWs, ao], [inWs, ai]] as const) {
      if (att.room && att.room !== room) this.leave(ws, false);
      ws.serializeAttachment({ ...(ws.deserializeAttachment() as Attach), room });
    }
    const inEdge = outEdge === 'right' ? 'left' : 'right';
    // offsetY: the peer's top relative to mine, in CSS px, so both can lay out one shared space.
    send(outWs, { k: 'paired', room, peer: ai.peer, edge: outEdge, offsetY: dy });
    send(inWs, { k: 'paired', room, peer: ao.peer, edge: inEdge, offsetY: -dy });
    this.members(room);
  }

  private leave(ws: WebSocket, notify = true) {
    const a = ws.deserializeAttachment() as Attach | null;
    if (!a?.room) return;
    const room = a.room;
    try {
      ws.serializeAttachment({ ...a, room: null });
    } catch {
      /* socket already gone */
    }
    if (notify) for (const s of this.room(room)) send(s, { k: 'peer-left', peer: a.peer });
    this.members(room);
  }

  private room(room: string): WebSocket[] {
    return this.state.getWebSockets().filter((s) => {
      try {
        return (s.deserializeAttachment() as Attach).room === room;
      } catch {
        return false;
      }
    });
  }

  private members(room: string) {
    const socks = this.room(room);
    const peers = socks.map((s) => (s.deserializeAttachment() as Attach).peer);
    for (const s of socks) send(s, { k: 'members', room, peers });
  }

  /** 40 messages/second per socket is plenty for presence, heartbeats and a party. */
  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const r = this.rate.get(ws) ?? { n: 0, at: now };
    if (now - r.at > 1000) {
      r.n = 0;
      r.at = now;
    }
    r.n++;
    this.rate.set(ws, r);
    return r.n <= 40;
  }
}

function send(ws: WebSocket, m: unknown) {
  try {
    ws.send(JSON.stringify(m));
  } catch {
    /* closed */
  }
}
