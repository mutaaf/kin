// KIN edge Worker. Static assets (the game) are served by Workers Static Assets; only
// /kin/api/* reaches this script.
//
//   GET /kin/api/lobby   WebSocket into the Lobby for this Cloudflare datacenter. Nearby devices
//                        land in the same one. The Lobby pairs devices by stitch swipe and then
//                        relays protocol envelopes within each paired room.
//   POST /kin/api/think  { card, provider, model } (+ x-kin-key for BYOK) → server-sent events:
//                        prompt → token… → done { thought | null, errors, usage, cost, ms, ttft }
//   POST /kin/api/models { provider: 'auto' | id } + x-kin-key → { provider, models, suggested }
//
// The relay is dumb on purpose. It never interprets game state, never stores creatures, and
// forgets a room when its last member leaves. Ownership rules live on the devices
// (src/session/cross.ts).

import { matchStitch, type StitchEvent } from '../stitch/match';
import { cleanCard, parseThought, SYSTEM, userPrompt } from '../ai/schema';
import { detectProvider } from '../ai/detect';
import { costUsd, describeError, EDGE_MODELS, listModels, pickModel, PROVIDERS, stream, type ProviderId, type Usage } from './ai';

// Free edge calls: per player per hour, and per day for everyone (inside Workers AI's free
// 10k-neuron allowance; a thought costs ~10 neurons). BYOK calls are the player's own money,
// so the cap only stops abuse of the Worker itself.
const EDGE_HOURLY_PER_IP = 20;
const EDGE_DAILY = 800;
const BYOK_HOURLY_PER_IP = 90;
const KEY_RE = /^[\w.-]{20,200}$/;
const MODEL_RE = /^[@\w./:-]{2,80}$/;

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  LOBBY: DurableObjectNamespace;
  METER: DurableObjectNamespace;
  AI?: { run(model: string, body: unknown, opts?: unknown): Promise<unknown> };
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
    if (url.pathname === '/kin/api/think' || url.pathname === '/kin/api/models') {
      // The iOS/iPad app (capacitor://localhost) and local dev call the API cross-origin.
      const cors = corsHeaders(request.headers.get('origin'));
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return new Response('method', { status: 405, headers: cors });
      const res = url.pathname === '/kin/api/think' ? await think(request, env) : await models(request);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    if (url.pathname.startsWith('/kin/api/')) return Response.json({ error: 'not found' }, { status: 404 });
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

const ORIGINS = /^(https:\/\/mutaafaziz\.com|capacitor:\/\/localhost|ionic:\/\/localhost|http:\/\/localhost(:\d+)?|http:\/\/127\.0\.0\.1(:\d+)?)$/;
function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ORIGINS.test(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-kin-key',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

// ── AI director ─────────────────────────────────────────────────────────────────────────────

async function ipHash(req: Request): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('kin:' + ip));
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Count against a limit in the Meter DO; true if still under it. */
async function allow(env: Env, key: string, max: number): Promise<boolean> {
  const stub = env.METER.get(env.METER.idFromName('meter'));
  const r = await stub.fetch(`https://meter/bump?k=${encodeURIComponent(key)}`);
  const { n } = (await r.json()) as { n: number };
  return n <= max;
}

const hour = () => new Date().toISOString().slice(0, 13);
const day = () => new Date().toISOString().slice(0, 10);

async function think(req: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  const body = (await req.json().catch(() => null)) as { card?: unknown; provider?: string; model?: string } | null;
  const card = cleanCard(body?.card);
  if (!card) return Response.json({ error: 'card' }, { status: 400 });
  const provider: ProviderId = body?.provider && body.provider in PROVIDERS ? (body.provider as ProviderId) : 'edge';
  const key = req.headers.get('x-kin-key') || '';
  if (PROVIDERS[provider].needsKey && !KEY_RE.test(key)) return Response.json({ error: 'key' }, { status: 400 });
  if (body?.model && !MODEL_RE.test(body.model)) return Response.json({ error: 'model' }, { status: 400 });
  const ip = await ipHash(req);
  const ok = provider === 'edge'
    ? (await allow(env, `edge:${ip}:${hour()}`, EDGE_HOURLY_PER_IP)) && (await allow(env, `edge-day:${day()}`, EDGE_DAILY))
    : await allow(env, `byok:${ip}:${hour()}`, BYOK_HOURLY_PER_IP);
  if (!ok) return Response.json({ error: 'rate' }, { status: 429 });

  const model = provider === 'edge' ? (EDGE_MODELS.includes(body?.model ?? '') ? body!.model! : EDGE_MODELS[0]!) : body?.model || (provider === 'anthropic' ? 'claude-haiku-5-5' : '');
  if (!model) return Response.json({ error: 'model' }, { status: 400 });
  const user = userPrompt(card);
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const send = (event: string, data: unknown) => w.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});
  const colo = (req as Request & { cf?: { colo?: string } }).cf?.colo ?? null;

  (async () => {
    await send('prompt', { provider, model, colo, system: SYSTEM, user });
    let text = '';
    let ttft = 0;
    try {
      const it = stream({ provider, env, key, model, system: SYSTEM, user });
      let usage: Usage = { inTokens: 0, outTokens: 0, neurons: 0 };
      for (;;) {
        const r = await it.next();
        if (r.done) {
          usage = r.value;
          break;
        }
        if (!ttft) ttft = Date.now() - t0;
        text += r.value.text;
        await send('token', { text: r.value.text });
      }
      const parsed = parseThought(text);
      await send('done', {
        thought: parsed.ok ? parsed.value : null,
        errors: parsed.ok ? [] : parsed.errors,
        usage, cost: costUsd(model, usage.inTokens, usage.outTokens), ms: Date.now() - t0, ttft,
      });
    } catch (err) {
      await send('error', { message: describeError(provider, err), fallback: true });
    } finally {
      await w.close().catch(() => {});
    }
  })();
  return new Response(readable, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}

async function models(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { provider?: string } | null;
  const key = req.headers.get('x-kin-key') || '';
  const detected = body?.provider === 'auto' ? detectProvider(key) : null;
  const provider = (detected ? detected.provider : body?.provider) as ProviderId | null;
  if (!provider || provider === 'edge' || !(provider in PROVIDERS)) return Response.json({ error: detected?.reason || 'Unknown provider.' }, { status: 400 });
  if (!KEY_RE.test(key)) return Response.json({ error: 'That key looks malformed.' }, { status: 400 });
  try {
    const ids = await listModels(provider, key);
    return Response.json({ provider, models: ids.filter((id) => !/(embed|tts|whisper|dall|image|moderation)/i.test(id)).slice(0, 80), suggested: pickModel(provider, ids) });
  } catch (err) {
    return Response.json({ error: describeError(provider, err) }, { status: 400 });
  }
}

/** Tiny counter store for rate limits. Keys carry their hour/day, so old ones are swept by alarm. */
export class Meter {
  private counts = new Map<string, number>();
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const k = new URL(request.url).searchParams.get('k') ?? '';
    const n = (this.counts.get(k) ?? (await this.state.storage.get<number>(k)) ?? 0) + 1;
    this.counts.set(k, n);
    await this.state.storage.put(k, n);
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(Date.now() + 3_600_000);
    return Response.json({ n });
  }

  async alarm() {
    const keep = [hour(), day()];
    const all = await this.state.storage.list<number>();
    const stale = [...all.keys()].filter((k) => !keep.some((x) => k.endsWith(x)));
    if (stale.length) await this.state.storage.delete(stale.slice(0, 128));
    for (const k of stale) this.counts.delete(k);
    await this.state.storage.setAlarm(Date.now() + 3_600_000);
  }
}
