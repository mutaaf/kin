// Utility AI (port of src/core/brain.ts). Runs a few times a second, never per frame, never in
// the cloud. The brain picks *which* safe action to do; the renderer decides only *how* it looks.
// Every choice carries a `why` so a dev HUD can explain it.
//
// score(goal) = needs + context + trait_bias + relationship_bias - repetition - safety + variation
#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Kin.Core
{
    public enum KinAction { Idle, Wander, Sit, Groom, Sleep, Play, LookEdge, Shiver, Shelter, Bask, GreetGuest }

    public enum Edge { Left, Right, Top, Bottom }

    /// <summary>Real sky as the creature feels it. SunElev in degrees; negative = night. Cloud 0..1.</summary>
    public sealed record Weather(double TempC, double WindKmh, double PrecipMm, bool Snow, double Cloud, double SunElev);

    public sealed record GuestRef(string Id, string Name);

    /// <summary>PeerEdge: a peer with an open invitation sits beyond this edge.</summary>
    public sealed record BrainContext(double Now, Weather Weather, bool Petting, Edge? PeerEdge, GuestRef? Guest);

    public sealed record Decision(KinAction Action, double DurationMs, IReadOnlyList<string> Why, IReadOnlyList<(KinAction action, double score)> Scores);

    public static class Brain
    {
        /// <summary>Wire/debug names, identical to the TypeScript Action strings.</summary>
        public static string Name(KinAction a) => a switch
        {
            KinAction.LookEdge => "look_edge",
            KinAction.GreetGuest => "greet_guest",
            _ => a.ToString().ToLowerInvariant(),
        };

        public static string Name(Edge e) => e.ToString().ToLowerInvariant();

        private static (double lo, double hi) Duration(KinAction a) => a switch
        {
            KinAction.Idle => (1800, 4000),
            KinAction.Wander => (2500, 5000),
            KinAction.Sit => (3000, 7000),
            KinAction.Groom => (2200, 3500),
            KinAction.Sleep => (9000, 20000),
            KinAction.Play => (3000, 5000),
            KinAction.LookEdge => (1600, 2600),
            KinAction.Shiver => (1500, 2500),
            KinAction.Shelter => (4000, 8000),
            KinAction.Bask => (4000, 8000),
            _ => (2200, 3200),
        };

        private static string Num(double x) => x.ToString(CultureInfo.InvariantCulture);
        private static string Fixed(double x, int digits) => x.ToString("F" + digits, CultureInfo.InvariantCulture);

        public static Decision Decide(KinRecord k, BrainContext ctx, IReadOnlyList<KinAction> recent, int tick)
        {
            var r = Rng.Create(Rng.Hash("brain:" + k.Seed.ToString(CultureInfo.InvariantCulture) + ":" + tick.ToString(CultureInfo.InvariantCulture)));
            var d = k.Drives;
            var t = k.Traits;
            var w = ctx.Weather;
            bool night = w.SunElev < -4;
            bool cold = w.TempC < 6;
            bool hot = w.TempC > 31;
            bool wet = w.PrecipMm > 0.15;

            // Insertion-ordered scores, like the JS object: order decides which r() each entry draws.
            var order = new List<KinAction>(11);
            var score = new Dictionary<KinAction, (double v, string why)>(11);
            void Add(KinAction a, double v, string why)
            {
                if (score.TryGetValue(a, out var cur)) score[a] = (cur.v + v, cur.why + ", " + why);
                else
                {
                    score[a] = (v, why);
                    order.Add(a);
                }
            }

            Add(KinAction.Idle, 0.25, "baseline");
            Add(KinAction.Wander, 0.2 + d.Curious * 0.5 + t.Curiosity * 0.25, "curious " + Fixed(d.Curious, 2));
            Add(KinAction.Sit, 0.15 + (1 - d.Energy) * 0.35, "energy " + Fixed(d.Energy, 2));
            Add(KinAction.Groom, 0.12 + (1 - d.Comfort) * 0.3, "comfort " + Fixed(d.Comfort, 2));
            Add(KinAction.Sleep, Math.Pow(1 - d.Energy, 2) * 1.4 + (night ? 0.35 : 0), night ? "night, tired" : "tired");
            Add(KinAction.Play, 0.1 + t.Playfulness * 0.4 + d.Energy * 0.25 - (night ? 0.2 : 0), "playful " + Num(t.Playfulness));

            // Weather is felt, not displayed: the creature reacts to the real sky outside.
            if (cold) Add(KinAction.Shiver, 0.35 + (6 - w.TempC) * 0.04, Fixed(w.TempC, 0) + "°C");
            if (wet || w.WindKmh > 35) Add(KinAction.Shelter, 0.3 + w.PrecipMm * 0.15 + w.WindKmh / 120, wet ? "rain" : "strong wind");
            if (!night && w.Cloud < 0.45 && !hot && !wet) Add(KinAction.Bask, 0.25 + (1 - d.Comfort) * 0.2, "sun out");
            if (hot) Add(KinAction.Sit, 0.3, "hot, conserving");

            if (ctx.PeerEdge is Edge pe) Add(KinAction.LookEdge, 0.8 + t.Curiosity * 0.5, "a friend waits " + Name(pe));
            if (ctx.Guest is GuestRef g)
            {
                k.Friends.TryGetValue(g.Id, out var rel);
                Add(KinAction.GreetGuest, 0.7 + t.Warmth * 0.4 + (rel != null ? rel.Affinity * 0.3 : 0), rel != null ? "knows " + g.Name : "new guest");
            }
            // Being petted pins attention; sleep is never interrupted into play.
            if (ctx.Petting) Add(KinAction.Sit, 0.9, "being petted");

            // Repetition penalty keeps it from looking like a loop.
            int from = Math.Max(0, recent.Count - 4);
            for (int i = 0; i < recent.Count - from; i++) Add(recent[from + i], -0.12 * (i + 1) * 0.5, "did recently");

            var scores = new List<(KinAction action, double score)>(order.Count);
            foreach (var a in order) scores.Add((a, score[a].v + (r() - 0.5) * 0.18));
            // Stable sort, like Array.prototype.sort.
            scores = scores.OrderByDescending((x) => x.score).ToList();
            var best = scores[0].action;
            var (lo, hi) = Duration(best);
            return new Decision(best, lo + (hi - lo) * r(), new[] { score[best].why }, scores);
        }

        /// <summary>Drives drift each brain tick according to what the creature is doing. dt in seconds.</summary>
        public static Drives Drift(Drives d, KinAction a, double dt, bool petting, GuestRef? guest, Weather w)
        {
            double k = dt / 60; // per-minute rates keep the numbers readable
            bool active = a == KinAction.Wander || a == KinAction.Play || a == KinAction.GreetGuest;
            double comfortTarget = 0.85;
            if (w.TempC < 6 || w.TempC > 31) comfortTarget -= 0.25;
            if (w.PrecipMm > 0.15 && a != KinAction.Shelter) comfortTarget -= 0.2;
            if (petting) comfortTarget = 1;
            return new Drives(
                Rng.Clamp01(d.Energy + (a == KinAction.Sleep ? 0.35 : active ? -0.06 : -0.015) * k),
                Rng.Clamp01(d.Social + (petting || guest != null ? -0.5 : 0.02) * k),
                Rng.Clamp01(d.Curious + (a == KinAction.Wander || a == KinAction.Play ? -0.25 : 0.05) * k),
                Rng.Clamp01(d.Comfort + (comfortTarget - d.Comfort) * Math.Min(1, 0.6 * k * 10)));
        }

        /// <summary>
        /// How a KIN reacts when another one arrives (beat 5 of KIN CROSS). Trait-weighted but varied:
        /// the same pair won't greet identically every time, and familiarity softens caution.
        /// </summary>
        public static Reaction ArrivalReaction(Traits t, Drives drives, IReadOnlyDictionary<string, Friend> friends, string visitorId, RandomStream r)
        {
            friends.TryGetValue(visitorId, out var rel);
            double familiar = rel != null ? Math.Min(1, rel.Meets / 4.0) * 0.5 + rel.Affinity * 0.3 : 0;
            var w = new (Reaction reaction, double v)[]
            {
                (Reaction.Eager, t.Warmth * 0.6 + t.Bravery * 0.5 + familiar + drives.Social * 0.3),
                (Reaction.Playful, t.Playfulness * 0.9 + drives.Energy * 0.3 + familiar * 0.4),
                (Reaction.Cautious, (1 - t.Bravery) * 0.9 - familiar * 0.8 + (1 - drives.Energy) * 0.1),
                (Reaction.Aloof, (1 - t.Warmth) * 0.7 - familiar * 0.5 + (1 - drives.Social) * 0.2),
            };
            double total = 0;
            foreach (var x in w) total += Math.Max(0.02, x.v);
            double pick = r() * total;
            foreach (var x in w)
            {
                pick -= Math.Max(0.02, x.v);
                if (pick <= 0) return x.reaction;
            }
            return Reaction.Eager;
        }
    }
}
