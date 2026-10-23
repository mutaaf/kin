// "Never lost, never duplicated", proven live in the visitor's browser. The same hostile world as
// tests/cross.property.test.ts (drops, duplicates, reordering, latency spikes, crashes on both
// sides, random recalls) runs against the real Owner/Host state machines from src/session/cross.ts.

import { makeTraits } from '../core/genome';
import { rng, type Rng } from '../core/rng';
import type { Msg, VisitorSnapshot } from '../protocol/messages';
import { Host, Owner, type HostFx, type OwnerFx, type Step } from '../session/cross';

interface Packet {
  at: number;
  to: 'A' | 'B';
  msg: Msg;
}

const visitor: VisitorSnapshot = { kinId: 'kin_a', seed: 7, name: 'Lumi', traits: makeTraits(7), hue: 200 };

export interface Outcome {
  settled: 'home' | 'away';
  ok: boolean;
  /** Invariant failures, by kind: shown nowhere (lost) or in two places at once (twin). */
  lost: boolean;
  twin: boolean;
  /** Messages the network dropped / duplicated during the run (how hostile it was). */
  dropped: number;
  dupMsgs: number;
  crashes: number;
}

export function runWorld(seed: number, faults = { drop: 0.2, dup: 0.15, jitter: 400 }): Outcome {
  const r: Rng = rng(seed);
  let now = 0;
  let ids = 0;
  const net: Packet[] = [];
  let faulty = true;
  let dropped = 0;
  let dupMsgs = 0;
  let crashes = 0;
  let persisted = { kind: 'home' } as { kind: 'home' } | { kind: 'away'; visitId: string };
  const mode = r() < 0.5 ? 'auto' : 'ask';
  const answerYes = r() < 0.8;
  const mkOwner = () => new Owner(() => visitor, () => `v${seed}_${++ids}`);
  const mkHost = () =>
    new Host({
      mode: () => mode,
      capacity: 4,
      open: () => true,
      reaction: () => 'eager',
      memory: (g) => ({ hostId: 'kin_b', hostName: 'Nox', hostHue: 280, hostReaction: g.reaction, visitorReaction: 'playful', weather: 'clear' }),
    });
  let pendingAsk = null as { id: string; at: number } | null;
  let A = mkOwner();
  let B = mkHost();
  const send = (from: 'A' | 'B', out: { msg: Msg }[]) => {
    for (const o of out) {
      if (faulty && r() < faults.drop) {
        dropped++;
        continue;
      }
      const copies = faulty && r() < faults.dup ? 2 : 1;
      if (copies > 1) dupMsgs++;
      for (let i = 0; i < copies; i++) net.push({ at: now + 2 + (faulty ? r() * faults.jitter : 3), to: from === 'A' ? 'B' : 'A', msg: o.msg });
    }
  };
  const applyA = (s: Step<OwnerFx>) => {
    send('A', s.out);
    for (const f of s.fx) {
      if (f.e === 'away') persisted = { kind: 'away', visitId: f.visitId };
      if (f.e === 'home' || f.e === 'come_back') persisted = { kind: 'home' };
    }
  };
  const applyB = (s: Step<HostFx>) => {
    send('B', s.out);
    for (const f of s.fx) if (f.e === 'ask') pendingAsk = { id: f.visitId, at: now + 300 + r() * 3000 };
  };
  const crashA = r() < 0.3 ? 200 + r() * 9000 : -1;
  const crashB = r() < 0.3 ? 200 + r() * 9000 : -1;
  const recallAt = r() < 0.6 ? 500 + r() * 12000 : -1;
  const sendHomeAt = r() < 0.3 ? 500 + r() * 12000 : -1;
  const secondVisitAt = r() < 0.3 ? 6000 + r() * 6000 : -1;
  const done = new Set<string>();
  const once = (k: string, at: number) => at >= 0 && now >= at && !done.has(k) && !!done.add(k);
  const seam = { rect: null, from: { x: 0, y: 0 } };
  applyA(A.visit('B', 'right', seam, now));
  for (now = 0; now < 45_000; now += 10) {
    if (now > 20_000) faulty = false;
    net.sort((x, y) => x.at - y.at);
    while (net.length && net[0]!.at <= now) {
      const p = net.shift()!;
      if (p.to === 'B') applyB(B.handle('A', p.msg, now));
      else applyA(A.handle('B', p.msg, now));
    }
    if (pendingAsk && now >= pendingAsk.at) {
      applyB(B.answer(pendingAsk.id, answerYes, now));
      pendingAsk = null;
    }
    if (once('crashA', crashA)) {
      crashes++;
      A = mkOwner();
      if (persisted.kind === 'away') applyA(A.restore(persisted.visitId, 'B', now));
    }
    if (once('crashB', crashB)) {
      crashes++;
      B = mkHost();
      pendingAsk = null;
    }
    if (once('recall', recallAt)) applyA(A.recall(now));
    if (once('sendHome', sendHomeAt)) for (const id of B.guests.keys()) applyB(B.sendHome(id));
    if (once('again', secondVisitAt)) applyA(A.visit('B', 'right', seam, now));
    applyA(A.tick(now));
    applyB(B.tick(now));
  }
  const hosted = [...B.guests.values()].filter((g) => g.phase === 'arriving' || g.phase === 'hosting' || g.phase === 'leaving');
  const home = A.phase === 'home';
  const ok = home
    ? hosted.length === 0 && persisted.kind === 'home'
    : A.phase === 'away' && hosted.length === 1 && hosted[0]!.visitId === A.visitId && hosted[0]!.phase === 'hosting' && persisted.kind === 'away';
  const lost = !home && hosted.length === 0;
  return { settled: home ? 'home' : 'away', ok, lost, twin: !ok && !lost, dropped, dupMsgs, crashes };
}

export interface Tally {
  runs: number;
  ok: number;
  broken: number;
  lost: number;
  twins: number;
  home: number;
  away: number;
  dropped: number;
  dupMsgs: number;
  crashes: number;
  ms: number;
}

/** Run `total` worlds in small slices so the page stays at 60 fps. Returns a cancel function. */
export function runMany(total: number, onTick: (t: Tally) => void, onDone: (t: Tally) => void, offset = 1): () => void {
  const t: Tally = { runs: 0, ok: 0, broken: 0, lost: 0, twins: 0, home: 0, away: 0, dropped: 0, dupMsgs: 0, crashes: 0, ms: 0 };
  let cancelled = false;
  const start = performance.now();
  const slice = () => {
    if (cancelled) return;
    const until = performance.now() + 9;
    while (t.runs < total && performance.now() < until) {
      const o = runWorld(offset + t.runs);
      t.runs++;
      if (o.ok) t.ok++;
      else t.broken++;
      t[o.settled]++;
      t.dropped += o.dropped;
      t.dupMsgs += o.dupMsgs;
      if (o.lost) t.lost++;
      if (o.twin) t.twins++;
      t.crashes += o.crashes;
    }
    t.ms = performance.now() - start;
    onTick(t);
    if (t.runs < total) setTimeout(slice, 0);
    else onDone(t);
  };
  setTimeout(slice, 0);
  return () => (cancelled = true);
}
