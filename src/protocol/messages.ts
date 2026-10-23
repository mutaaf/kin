// One versioned envelope for every transport (BroadcastChannel today; Durable Object relay,
// WebRTC and native peers later). Keep payloads minimal: a visitor travels as its seed, name
// and traits, never as owner data.

import type { Edge } from '../core/brain';
import type { Reaction } from '../core/creature';
import type { Traits } from '../core/genome';

export const PROTOCOL_VERSION = 1;
export const MAX_ENVELOPE_BYTES = 8 * 1024;

/** Window rectangle in screen pixels. Lets two windows on one display line the seam up exactly. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Screen size, used to decide whether two rects share a coordinate space. */
  sw: number;
  sh: number;
  /** Mouse/trackpad device. Two fine-pointer windows on one screen share real screen geometry. */
  fine: boolean;
}

export interface PeerInfo {
  peer: string;
  kinId: string;
  name: string;
  hue: number;
  temperament: string;
  /** False while this KIN is away (it can't receive visitors) or visits are off. */
  open: boolean;
  rect: ScreenRect | null;
}

export interface VisitorSnapshot {
  kinId: string;
  seed: number;
  name: string;
  traits: Traits;
  hue: number;
}

export interface VisitMemory {
  hostId: string;
  hostName: string;
  hostHue: number;
  hostReaction: Reaction;
  visitorReaction: Reaction;
  weather: string;
}

export type Msg =
  | { t: 'presence.hello'; info: PeerInfo; reply?: boolean }
  | { t: 'presence.bye' }
  | { t: 'clock.ping'; t0: number }
  | { t: 'clock.pong'; t0: number; t1: number }
  | { t: 'visit.invite'; visitId: string; visitor: VisitorSnapshot }
  | { t: 'visit.accept'; visitId: string }
  | { t: 'visit.decline'; visitId: string; reason: string }
  | { t: 'cross.prepare'; visitId: string; visitor: VisitorSnapshot }
  | { t: 'cross.ready'; visitId: string }
  | { t: 'cross.start'; visitId: string; startAt: number; edge: Edge; seam: Seam }
  | { t: 'cross.commit'; visitId: string }
  | { t: 'cross.cancel'; visitId: string; reason: string }
  | { t: 'visit.heartbeat'; visitId: string }
  | { t: 'visit.heartbeat.ack'; visitId: string }
  | { t: 'visit.return.request'; visitId: string }
  | { t: 'visit.return'; visitId: string }
  | { t: 'visit.complete'; visitId: string; memory: VisitMemory | null };

/**
 * Where the hop starts. Both screens rebuild the same arc from this plus each other's rect
 * (render/choreo.ts), so the creature crosses the seam at the same height and depth on both.
 */
export interface Seam {
  /** Source window rect (screen px). */
  rect: ScreenRect | null;
  /** Hop start in source-window CSS px. */
  from: { x: number; y: number };
}

export interface Envelope {
  v: typeof PROTOCOL_VERSION;
  id: string;
  from: string;
  to: string; // peer id or '*'
  at: number;
  msg: Msg;
}

const TYPES = new Set<Msg['t']>([
  'presence.hello', 'presence.bye', 'clock.ping', 'clock.pong', 'visit.invite', 'visit.accept',
  'visit.decline', 'cross.prepare', 'cross.ready', 'cross.start', 'cross.commit', 'cross.cancel',
  'visit.heartbeat', 'visit.heartbeat.ack', 'visit.return.request', 'visit.return', 'visit.complete',
]);

const isStr = (x: unknown, max = 64): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Schema check at every ingress. Unknown, oversized or malformed envelopes are dropped. */
export function parseEnvelope(raw: unknown): Envelope | null {
  if (typeof raw === 'string') {
    if (raw.length > MAX_ENVELOPE_BYTES) return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<Envelope>;
  if (e.v !== PROTOCOL_VERSION || !isStr(e.id) || !isStr(e.from) || !isStr(e.to) || !isNum(e.at)) return null;
  const m = e.msg as Partial<Msg> | undefined;
  if (!m || typeof m !== 'object' || !TYPES.has(m.t as Msg['t'])) return null;
  if ('visitId' in m && !isStr(m.visitId)) return null;
  if (m.t === 'cross.start' && (!isNum(m.startAt) || !m.seam || !m.seam.from || !isNum(m.seam.from.x) || !isNum(m.seam.from.y))) return null;
  if ((m.t === 'visit.invite' || m.t === 'cross.prepare') && !validVisitor(m.visitor)) return null;
  if (m.t === 'presence.hello' && (!m.info || !isStr(m.info.peer) || !isStr(m.info.name, 24))) return null;
  return e as Envelope;
}

function validVisitor(v: unknown): v is VisitorSnapshot {
  const x = v as Partial<VisitorSnapshot> | undefined;
  return !!x && isStr(x.kinId) && isNum(x.seed) && isStr(x.name, 24) && isNum(x.hue) && !!x.traits && typeof x.traits === 'object';
}
