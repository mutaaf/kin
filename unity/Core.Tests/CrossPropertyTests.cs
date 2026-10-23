// Property test for KIN CROSS (port of tests/cross.property.test.ts): 1,000 randomized crossings
// over a hostile network (drops, duplicates, reordering, latency spikes) with random crashes on
// both sides, random recalls and random "send home". After the network settles, the creature
// must be in exactly one place.
using System;
using System.Collections.Generic;
using System.Linq;
using Kin.Core;
using Xunit;

namespace Kin.Core.Tests
{
    public class CrossPropertyTests
    {
        private static readonly VisitorSnapshot Visitor = new VisitorSnapshot("kin_a", 7, "Lumi", Genomes.MakeTraits(7), 200);
        private static readonly Seam NoSeam = new Seam(null, new Point2(0, 0));

        private static HostPolicy Policy(HostMode mode, Reaction reaction = Reaction.Eager) => new HostPolicy(
            () => mode, 4, () => true, (_) => reaction,
            (g) => new VisitMemory("kin_b", "Nox", 280, g.Reaction, Reaction.Playful, "clear"));

        private sealed class Packet
        {
            public double At;
            public char To;
            public Msg Msg = null!;
        }

        private sealed class World
        {
            public Owner A = null!;
            public Host B = null!;
            public string? PersistedAway; // null = home; else the visitId persisted as away
        }

        private static World Run(uint seed, double drop, double dup, double jitter)
        {
            var r = Rng.Create(seed);
            double now = 0;
            int ids = 0;
            var net = new List<Packet>();
            bool faulty = true;
            var w = new World();
            var mode = r() < 0.5 ? HostMode.Auto : HostMode.Ask;
            bool answerYes = r() < 0.8;
            (string id, double at)? pendingAsk = null;

            Owner MkOwner() => new Owner(() => Visitor, () => "v" + seed + "_" + (++ids));
            Host MkHost() => new Host(Policy(mode));
            w.A = MkOwner();
            w.B = MkHost();

            void Send(char from, IEnumerable<Out> outs)
            {
                foreach (var o in outs)
                {
                    if (faulty && r() < drop) continue;
                    int copies = faulty && r() < dup ? 2 : 1;
                    for (int i = 0; i < copies; i++)
                    {
                        var p = new Packet { At = now + 2 + (faulty ? r() * jitter : 3), To = from == 'A' ? 'B' : 'A', Msg = o.Msg };
                        // Stable insertion by delivery time (Array.prototype.sort is stable).
                        int at = net.Count;
                        while (at > 0 && net[at - 1].At > p.At) at--;
                        net.Insert(at, p);
                    }
                }
            }
            void ApplyA(Step<OwnerFx> s)
            {
                Send('A', s.Out);
                foreach (var f in s.Fx)
                {
                    if (f is OwnerAway away) w.PersistedAway = away.VisitId;
                    if (f is OwnerHome || f is OwnerComeBack) w.PersistedAway = null;
                }
            }
            void ApplyB(Step<HostFx> s)
            {
                Send('B', s.Out);
                foreach (var f in s.Fx) if (f is HostAsk ask) pendingAsk = (ask.VisitId, now + 300 + r() * 3000);
            }

            // A script of random disturbances.
            double crashA = r() < 0.3 ? 200 + r() * 9000 : -1;
            double crashB = r() < 0.3 ? 200 + r() * 9000 : -1;
            double recallAt = r() < 0.6 ? 500 + r() * 12000 : -1;
            double sendHomeAt = r() < 0.3 ? 500 + r() * 12000 : -1;
            double secondVisitAt = r() < 0.3 ? 6000 + r() * 6000 : -1;
            var done = new HashSet<string>();
            bool Once(string k, double at) => at >= 0 && now >= at && done.Add(k);

            ApplyA(w.A.Visit("B", Edge.Right, NoSeam, now));

            for (now = 0; now < 45_000; now += 10)
            {
                if (now > 20_000) faulty = false;
                while (net.Count > 0 && net[0].At <= now)
                {
                    var p = net[0];
                    net.RemoveAt(0);
                    if (p.To == 'B') ApplyB(w.B.Handle("A", p.Msg, now));
                    else ApplyA(w.A.Handle("B", p.Msg, now));
                }
                if (pendingAsk is (string askId, double askAt) && now >= askAt)
                {
                    ApplyB(w.B.Answer(askId, answerYes, now));
                    pendingAsk = null;
                }
                if (Once("crashA", crashA))
                {
                    w.A = MkOwner();
                    if (w.PersistedAway is string away) ApplyA(w.A.Restore(away, "B", now));
                }
                if (Once("crashB", crashB))
                {
                    w.B = MkHost();
                    pendingAsk = null;
                }
                if (Once("recall", recallAt)) ApplyA(w.A.Recall(now));
                if (Once("sendHome", sendHomeAt)) foreach (var g in w.B.Guests.ToList()) ApplyB(w.B.SendHome(g.VisitId));
                if (Once("again", secondVisitAt)) ApplyA(w.A.Visit("B", Edge.Right, NoSeam, now));
                ApplyA(w.A.Tick(now));
                ApplyB(w.B.Tick(now));
            }
            return w;
        }

        [Fact]
        public void HappyPathCommitsHostsAndReturnsWithAMemory()
        {
            double now = 0;
            var a = new Owner(() => Visitor, () => "v1");
            var b = new Host(Policy(HostMode.Auto, Reaction.Cautious));
            var fx = new List<string>();
            var q = new List<(char to, Msg msg)>();
            void Pump()
            {
                for (int i = 0; i < 50 && q.Count > 0; i++)
                {
                    var batch = q.ToList();
                    q.Clear();
                    foreach (var (to, msg) in batch)
                    {
                        if (to == 'B')
                        {
                            var s = b.Handle("A", msg, now);
                            q.AddRange(s.Out.Select((o) => ('A', o.Msg)));
                            fx.AddRange(s.Fx.Select((f) => "B:" + f.GetType().Name));
                        }
                        else
                        {
                            var s = a.Handle("B", msg, now);
                            q.AddRange(s.Out.Select((o) => ('B', o.Msg)));
                            fx.AddRange(s.Fx.Select((f) => "A:" + f.GetType().Name));
                        }
                    }
                }
            }
            void RunUntil(double until)
            {
                for (; now < until; now += 10)
                {
                    var sa = a.Tick(now);
                    q.AddRange(sa.Out.Select((o) => ('B', o.Msg)));
                    fx.AddRange(sa.Fx.Select((f) => "A:" + f.GetType().Name));
                    var sb = b.Tick(now);
                    q.AddRange(sb.Out.Select((o) => ('A', o.Msg)));
                    fx.AddRange(sb.Fx.Select((f) => "B:" + f.GetType().Name));
                    Pump();
                }
            }
            q.AddRange(a.Visit("B", Edge.Right, NoSeam, now).Out.Select((o) => ('B', o.Msg)));
            Pump();
            RunUntil(CrossTiming.Lead + CrossTiming.Hop + CrossTiming.Settle + 100);
            Assert.Equal(OwnerPhase.Away, a.Phase);
            Assert.Equal(GuestPhase.Hosting, b.Guests[0].Phase);
            RunUntil(now + 4000); // heartbeats keep the lease alive
            Assert.Equal(OwnerPhase.Away, a.Phase);
            q.AddRange(a.Recall(now).Out.Select((o) => ('B', o.Msg)));
            RunUntil(now + CrossTiming.Hop + 500);
            Assert.Equal(OwnerPhase.Home, a.Phase);
            Assert.Empty(b.Guests);
            Assert.Contains("A:OwnerHopOut", fx);
            Assert.Contains("B:HostHopIn", fx);
            Assert.Contains("A:OwnerHome", fx);
            Assert.DoesNotContain("A:OwnerComeBack", fx);
        }

        [Fact]
        public void SettlesToExactlyOnePlacementAcross1000HostileRuns()
        {
            int home = 0, away = 0;
            for (uint seed = 1; seed <= 1000; seed++)
            {
                var w = Run(seed, 0.2, 0.15, 400);
                var hosted = w.B.Guests.Where((g) => g.Phase == GuestPhase.Arriving || g.Phase == GuestPhase.Hosting || g.Phase == GuestPhase.Leaving).ToList();
                string ctx = $"seed {seed}: owner={w.A.Phase} persisted={(w.PersistedAway ?? "home")} hosted=[{string.Join(",", hosted.Select((g) => g.Phase))}]";
                // Settled: no in-flight phases left on either side.
                Assert.True(w.A.Phase == OwnerPhase.Home || w.A.Phase == OwnerPhase.Away, ctx);
                if (w.A.Phase == OwnerPhase.Home)
                {
                    Assert.True(hosted.Count == 0, ctx);
                    Assert.True(w.PersistedAway == null, ctx);
                    home++;
                }
                else
                {
                    Assert.True(hosted.Count == 1, ctx);
                    Assert.True(hosted[0].VisitId == w.A.VisitId, ctx);
                    Assert.True(hosted[0].Phase == GuestPhase.Hosting, ctx);
                    Assert.True(w.PersistedAway == w.A.VisitId, ctx);
                    away++;
                }
            }
            // Sanity: the generator exercises both outcomes, so the test isn't vacuous.
            Assert.True(home > 50, $"home={home}");
            Assert.True(away > 50, $"away={away}");
        }

        [Fact]
        public void IgnoresMessagesFromSomeoneOtherThanTheOwner()
        {
            var b = new Host(Policy(HostMode.Auto));
            b.Handle("A", new VisitInvite("v1", Visitor), 0);
            var s = b.Handle("MALLORY", new CrossCancel("v1", "x"), 1);
            Assert.Empty(s.Out);
            Assert.Single(b.Guests);
        }
    }
}
