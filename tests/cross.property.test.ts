// Property test for KIN CROSS: 1,000 randomized crossings over a hostile network (drops,
// duplicates, reordering, latency spikes) with random crashes on both sides, random recalls and
// random "send home". After the network settles, the creature must be in exactly one place.

import { describe, expect, it } from 'vitest';
import { makeTraits } from '../src/core/genome';
import { rng, type Rng } from '../src/core/rng';
import type { Msg, VisitorSnapshot } from '../src/protocol/messages';
import { Host, Owner, T, type HostFx, type OwnerFx, type Step } from '../src/session/cross';

interface Packet {
  at: number;
  to: 'A' | 'B';
  from: 'A' | 'B';
  msg: Msg;
}

const visitor: VisitorSnapshot = { kinId: 'kin_a', seed: 7, name: 'Lumi', traits: makeTraits(7), hue: 200 };

function world(seed: number, faults: { drop: number; dup: number; jitter: number }) {
  const r: Rng = rng(seed);
  let now = 0;
  let ids = 0;
  const net: Packet[] = [];
  let faulty = true;
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
      if (faulty && r() < faults.drop) continue;
      const copies = faulty && r() < faults.dup ? 2 : 1;
      for (let i = 0; i < copies; i++) {
        net.push({ at: now + 2 + (faulty ? r() * faults.jitter : 3), to: from === 'A' ? 'B' : 'A', from, msg: o.msg });
      }
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
  
  // A script of random disturbances.
  const crashA = r() < 0.3 ? 200 + r() * 9000 : -1;
  const crashB = r() < 0.3 ? 200 + r() * 9000 : -1;
  const recallAt = r() < 0.6 ? 500 + r() * 12000 : -1;
  const sendHomeAt = r() < 0.3 ? 500 + r() * 12000 : -1;
  const secondVisitAt = r() < 0.3 ? 6000 + r() * 6000 : -1;
  const done = new Set<string>();
  const once = (k: string, at: number) => at >= 0 && now >= at && !done.has(k) && done.add(k);

  applyA(A.visit('B', 'right', { rect: null, from: { x: 0, y: 0 } }, now));

  const step = 10;
  for (now = 0; now < 45_000; now += step) {
    if (now > 20_000) faulty = false;
    // deliver
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
      A = mkOwner();
      if (persisted.kind === 'away') applyA(A.restore(persisted.visitId, 'B', now));
    }
    if (once('crashB', crashB)) {
      B = mkHost();
      pendingAsk = null;
    }
    if (once('recall', recallAt)) applyA(A.recall(now));
    if (once('sendHome', sendHomeAt)) for (const id of B.guests.keys()) applyB(B.sendHome(id));
    if (once('again', secondVisitAt)) applyA(A.visit('B', 'right', { rect: null, from: { x: 0, y: 0 } }, now));
    applyA(A.tick(now));
    applyB(B.tick(now));
  }
  return { A, B, persisted, net };
}

describe('KIN CROSS invariants', () => {
  it('a happy-path crossing commits, hosts and returns with a memory', () => {
    let now = 0;
    const A = new Owner(() => visitor, () => 'v1');
    const B = new Host({
      mode: () => 'auto', capacity: 4, open: () => true, reaction: () => 'cautious',
      memory: () => ({ hostId: 'kin_b', hostName: 'Nox', hostHue: 280, hostReaction: 'cautious', visitorReaction: 'eager', weather: 'rain' }),
    });
    const fx: string[] = [];
    let q: { to: 'A' | 'B'; msg: Msg }[] = [];
    const pump = () => {
      for (let i = 0; i < 50 && q.length; i++) {
        const batch = q;
        q = [];
        for (const p of batch) {
          if (p.to === 'B') { const s = B.handle('A', p.msg, now); q.push(...s.out.map((o) => ({ to: 'A' as const, msg: o.msg }))); fx.push(...s.fx.map((f) => 'B:' + f.e)); }
          else { const s = A.handle('B', p.msg, now); q.push(...s.out.map((o) => ({ to: 'B' as const, msg: o.msg }))); fx.push(...s.fx.map((f) => 'A:' + f.e)); }
        }
      }
    };
    const run = (until: number) => {
      for (; now < until; now += 10) {
        const a = A.tick(now); q.push(...a.out.map((o) => ({ to: 'B' as const, msg: o.msg }))); fx.push(...a.fx.map((f) => 'A:' + f.e));
        const b = B.tick(now); q.push(...b.out.map((o) => ({ to: 'A' as const, msg: o.msg }))); fx.push(...b.fx.map((f) => 'B:' + f.e));
        pump();
      }
    };
    q.push(...A.visit('B', 'right', { rect: null, from: { x: 0, y: 0 } }, now).out.map((o) => ({ to: 'B' as const, msg: o.msg })));
    pump();
    run(T.LEAD + T.HOP + T.SETTLE + 100);
    expect(A.phase).toBe('away');
    expect([...B.guests.values()][0]?.phase).toBe('hosting');
    run(now + 4000); // heartbeats keep the lease alive
    expect(A.phase).toBe('away');
    const s = A.recall(now);
    q.push(...s.out.map((o) => ({ to: 'B' as const, msg: o.msg })));
    run(now + T.HOP + 500);
    expect(A.phase).toBe('home');
    expect(B.guests.size).toBe(0);
    expect(fx).toContain('A:hop_out');
    expect(fx).toContain('B:hop_in');
    expect(fx).toContain('A:home');
    expect(fx).not.toContain('A:come_back');
  });

  it('settles to exactly one placement across 1,000 hostile runs', () => {
    const outcomes = { home: 0, away: 0 };
    for (let seed = 1; seed <= 1000; seed++) {
      const { A, B, persisted } = world(seed, { drop: 0.2, dup: 0.15, jitter: 400 });
      const hosted = [...B.guests.values()].filter((g) => g.phase === 'arriving' || g.phase === 'hosting' || g.phase === 'leaving');
      const ctx = `seed ${seed}: owner=${A.phase} persisted=${persisted.kind} hosted=${hosted.map((g) => g.phase)}`;
      // Settled: no in-flight phases left on either side.
      expect(['home', 'away'], ctx).toContain(A.phase);
      if (A.phase === 'home') {
        expect(hosted, ctx).toHaveLength(0);
        expect(persisted.kind, ctx).toBe('home');
        outcomes.home++;
      } else {
        expect(hosted, ctx).toHaveLength(1);
        expect(hosted[0]!.visitId, ctx).toBe(A.visitId);
        expect(hosted[0]!.phase, ctx).toBe('hosting');
        expect(persisted, ctx).toEqual({ kind: 'away', visitId: A.visitId });
        outcomes.away++;
      }
    }
    // Sanity: the generator exercises both outcomes, so the test isn't vacuous.
    expect(outcomes.home).toBeGreaterThan(50);
    expect(outcomes.away).toBeGreaterThan(50);
  });
});
