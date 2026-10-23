// The durable creature record and its reducers (port of src/core/creature.ts). The home owner is
// the only authority over this record (SYSTEM_DESIGN "State authority model"); a host never
// persists a visitor. All reducers are pure: they return a new record.
#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace Kin.Core
{
    /// <summary>Energy: 1 = rested. Social: desire for company. Curious: desire for novelty. Comfort: physical comfort.</summary>
    public sealed record Drives(double Energy, double Social, double Curious, double Comfort);

    public enum Reaction { Eager, Cautious, Playful, Aloof }

    public enum MemoryKind { Hatched, Visited, Hosted, ReturnedEarly, Thought }

    /// <summary>The other KIN in a memory, by alias only. No owner identity is ever stored.</summary>
    public sealed record OtherKin(string Id, string Name, double Hue);

    public sealed record Memory(string Id, double At, MemoryKind Kind, string Note, OtherKin? Other = null, Reaction? Reaction = null, string? Weather = null);

    /// <summary>Affinity: -1 rival … +1 friend. Bounded and slow-moving.</summary>
    public sealed record Friend(string Name, double Hue, int Meets, double LastAt, double Affinity);

    public abstract record Placement
    {
        public sealed record Home : Placement;
        public sealed record Away(string VisitId, string HostPeer, string HostId, string HostName, double Since) : Placement;
    }

    public sealed record KinRecord(
        string Id,
        uint Seed,
        string Name,
        double BornAt,
        bool Hatched,
        Traits Traits,
        Drives Drives,
        double Bond,
        IReadOnlyList<Memory> Memories,
        IReadOnlyDictionary<string, Friend> Friends,
        Placement Placement,
        double LastSeenAt)
    {
        public int V => 1;
    }

    public static class Creature
    {
        public const int MaxMemories = 60;

        public static KinRecord NewKin(double now, uint seed) => new KinRecord(
            Rng.RandomId("kin"), seed, Genomes.SuggestName(seed), now, false, Genomes.MakeTraits(seed),
            new Drives(0.8, 0.5, 0.6, 0.8), 0, Array.Empty<Memory>(), new Dictionary<string, Friend>(), new Placement.Home(), now);

        public static Genome GenomeOf(KinRecord k) => Genomes.Make(k.Seed);

        /// <summary>Idempotent by (kind, other, at-second): replays of the same event don't double-log.</summary>
        public static KinRecord Remember(KinRecord k, Memory m)
        {
            bool dupe = k.Memories.Any((x) => x.Kind == m.Kind && x.Other?.Id == m.Other?.Id && Math.Abs(x.At - m.At) < 1000);
            if (dupe) return k;
            var memories = new List<Memory> { m with { Id = Rng.RandomId("mem") } };
            memories.AddRange(k.Memories);
            return k with { Memories = memories.Take(MaxMemories).ToList() };
        }

        public static KinRecord Meet(KinRecord k, OtherKin other, double now, double delta)
        {
            k.Friends.TryGetValue(other.Id, out var prev);
            double affinity = Math.Max(-1, Math.Min(1, (prev?.Affinity ?? 0) + delta));
            var friends = new Dictionary<string, Friend>(k.Friends.Count + 1);
            foreach (var kv in k.Friends) friends[kv.Key] = kv.Value;
            friends[other.Id] = new Friend(other.Name, other.Hue, (prev?.Meets ?? 0) + 1, now, affinity);
            return k with { Friends = friends };
        }

        /// <summary>
        /// Coarse catch-up after the app was closed: bounded, never punishing. (No decay timers: a
        /// KIN left alone for a month is simply rested and a bit lonely.)
        /// </summary>
        public static KinRecord CatchUp(KinRecord k, double now)
        {
            double hours = Math.Min(48, Math.Max(0, (now - k.LastSeenAt) / 3_600_000));
            if (hours < 0.01) return k with { LastSeenAt = now };
            var d = k.Drives;
            return k with
            {
                LastSeenAt = now,
                Drives = new Drives(
                    Rng.Clamp01(d.Energy + hours * 0.15),
                    Rng.Clamp01(d.Social + hours * 0.05),
                    Rng.Clamp01(d.Curious + hours * 0.08),
                    Rng.Clamp01(d.Comfort + (0.8 - d.Comfort) * Math.Min(1, hours / 4))),
            };
        }
    }
}
