// Personality that grows (port of src/core/persona.ts). A KIN isn't a class picked from a menu:
// it's a blend over a few archetypes that drifts, slowly and explainably, with what it lives
// through: what you feed it, how you play, the tricks it practises, when it's awake, who it
// visits, the weather, and what you talk about. A sporty brat and a royal scholar are both normal
// outcomes. Pure, deterministic, bounded (every level stays in 0..1), reversible (levels relax
// toward the KIN's own baseline, and you can steer), and it keeps a readable history of why.
//
// No IP: "Pop Star" means generic show-biz, trend-savvy energy; no real people, brands or games.
#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Kin.Core
{
    public enum Archetype { Popstar, Scholar, Gamer, Athlete, Brat, Royal, Explorer, Artist }

    /// <summary>One level per archetype, 0..1, in the canonical archetype order.</summary>
    public sealed class Levels
    {
        private readonly double[] _v = new double[8];
        public double this[Archetype a] { get => _v[(int)a]; set => _v[(int)a] = value; }
        public Levels Clone()
        {
            var c = new Levels();
            Array.Copy(_v, c._v, 8);
            return c;
        }
    }

    /// <summary>
    /// A partial level change in insertion order (like a JS object literal), keyed by wire name so
    /// unknown keys from untrusted JSON can be carried and ignored exactly as the TS does.
    /// </summary>
    public sealed class Deltas : List<KeyValuePair<string, double>>
    {
        public Deltas() { }
        public Deltas(IEnumerable<KeyValuePair<string, double>> items) : base(items) { }
        public static Deltas Of(params (Archetype a, double d)[] xs) => new Deltas(xs.Select((x) => new KeyValuePair<string, double>(Personas.Wire(x.a), x.d)));
        public double Get(Archetype a)
        {
            string k = Personas.Wire(a);
            foreach (var kv in this) if (kv.Key == k) return kv.Value;
            return 0;
        }
        /// <summary>Set or replace, keeping the original position (JS object semantics).</summary>
        public void Set(Archetype a, double v)
        {
            string k = Personas.Wire(a);
            for (int i = 0; i < Count; i++) if (this[i].Key == k) { this[i] = new KeyValuePair<string, double>(k, v); return; }
            Add(new KeyValuePair<string, double>(k, v));
        }
    }

    public sealed record HistoryEntry(double At, Archetype A, double D, string Why);

    public sealed class Persona
    {
        public Levels Levels { get; internal set; } = new Levels();
        /// <summary>Where it relaxes back to: the KIN's own nature, from its seed traits.</summary>
        public Levels Base { get; internal set; } = new Levels();
        public IReadOnlyList<HistoryEntry> History { get; internal set; } = Array.Empty<HistoryEntry>();
        /// <summary>Diminishing returns: how much each archetype has gained today (UTC day key).</summary>
        public string DayKey { get; internal set; } = "";
        public Deltas DayGained { get; internal set; } = new Deltas();
        /// <summary>Last time Settle ran (decay and habits are time-based).</summary>
        public double SettledAt { get; internal set; }
        /// <summary>Optional gentle steer the player chose; null = let it grow.</summary>
        public Archetype? Steer { get; internal set; }

        internal Persona Clone() => new Persona
        {
            Levels = Levels.Clone(), Base = Base, History = History, DayKey = DayKey, DayGained = new Deltas(DayGained), SettledAt = SettledAt, Steer = Steer,
        };
    }

    public abstract record Experience
    {
        public sealed record Fed(string Snack, Deltas Deltas, string? Label = null) : Experience;
        /// <summary>Kind: fetch | throw | toy | chase.</summary>
        public sealed record Play(string Kind) : Experience;
        public sealed record Trick(string Name) : Experience;
        public sealed record Groomed : Experience;
        public sealed record Bath : Experience;
        public sealed record Found(bool Rare = false) : Experience;
        public sealed record Dig : Experience;
        public sealed record Decorated : Experience;
        public sealed record Garden : Experience;
        public sealed record Visit(Archetype? Friend = null, string? FriendName = null) : Experience;
        public sealed record Hosted(Archetype? Friend = null, string? FriendName = null) : Experience;
        public sealed record Ignored : Experience;
        public sealed record Talk(string Text) : Experience;
        public sealed record SteerTo(Archetype? A) : Experience;
    }

    public sealed record GearItem(string Id, string Label, Archetype Archetype);

    public sealed record VoiceShape(double Pitch, double Tempo);

    public sealed record Expression(
        string Title, Archetype Dominant, double Hue, IReadOnlyDictionary<Archetype, int> Tiers,
        IReadOnlyList<string> Emotes, IReadOnlyList<string> Idles, IReadOnlyList<GearItem> Accessories,
        VoiceShape Voice, string Speech);

    public sealed record PersonaCardData(string Title, IReadOnlyList<(Archetype a, double share)> Blend, string Style, IReadOnlyList<string> Why);

    public static class Personas
    {
        public static readonly Archetype[] Archetypes =
            { Archetype.Popstar, Archetype.Scholar, Archetype.Gamer, Archetype.Athlete, Archetype.Brat, Archetype.Royal, Archetype.Explorer, Archetype.Artist };

        public static string Wire(Archetype a) => a.ToString().ToLowerInvariant();
        public static Archetype? FromWire(string? s)
        {
            if (s == null) return null;
            foreach (var a in Archetypes) if (Wire(a) == s) return a;
            return null;
        }

        public static string Noun(Archetype a) => a switch
        {
            Archetype.Popstar => "Pop Star", Archetype.Scholar => "Scholar", Archetype.Gamer => "Gamer", Archetype.Athlete => "Athlete",
            Archetype.Brat => "Brat", Archetype.Royal => "Royal", Archetype.Explorer => "Explorer", _ => "Artist",
        };
        public static string Adj(Archetype a) => a switch
        {
            Archetype.Popstar => "Starry", Archetype.Scholar => "Bookish", Archetype.Gamer => "Gamer", Archetype.Athlete => "Sporty",
            Archetype.Brat => "Bratty", Archetype.Royal => "Royal", Archetype.Explorer => "Wandering", _ => "Arty",
        };
        /// <summary>Accent hue per archetype, for titles, chips and speech styling.</summary>
        public static double Hue(Archetype a) => a switch
        {
            Archetype.Popstar => 320, Archetype.Scholar => 205, Archetype.Gamer => 265, Archetype.Athlete => 25,
            Archetype.Brat => 345, Archetype.Royal => 45, Archetype.Explorer => 150, _ => 185,
        };

        private const double DayCap = 0.12; // the most any one archetype can grow in a day, so change stays gradual
        private const int HistoryMax = 40;
        private const double RelaxPerDay = 0.02; // fraction of the gap to baseline that closes per day without input

        private static double Clamp01(double x) => x < 0 ? 0 : x > 1 ? 1 : x;
        private static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        /// <summary>UTC calendar day (the TS uses toISOString().slice(0, 10)).</summary>
        public static string DayKey(double t) => Epoch.AddMilliseconds(t).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        /// <summary>A KIN's nature, from its traits: small leanings, never a destiny.</summary>
        public static Levels Baseline(Traits t)
        {
            var b = new Levels();
            b[Archetype.Athlete] = 0.02 + 0.06 * t.Energy * t.Bravery;
            b[Archetype.Gamer] = 0.02 + 0.06 * t.Playfulness * t.Curiosity;
            b[Archetype.Popstar] = 0.02 + 0.06 * t.Warmth * t.Playfulness;
            b[Archetype.Scholar] = 0.02 + 0.06 * t.Curiosity * (1 - t.Playfulness * 0.5);
            b[Archetype.Explorer] = 0.02 + 0.06 * t.Bravery * t.Curiosity;
            b[Archetype.Brat] = 0.01 + 0.05 * (1 - t.Warmth) * t.Playfulness;
            b[Archetype.Royal] = 0.01 + 0.05 * (1 - t.Warmth) * (1 - t.Playfulness * 0.5);
            b[Archetype.Artist] = 0.02 + 0.05 * t.Curiosity * t.Warmth;
            foreach (var a in Archetypes) b[a] = Rng.JsRound(b[a] * 1000) / 1000;
            return b;
        }

        public static Persona New(Traits traits, double now)
        {
            var b = Baseline(traits);
            return new Persona { Levels = b.Clone(), Base = b, DayKey = DayKey(now), DayGained = new Deltas(), SettledAt = now, Steer = null };
        }

        // What each experience nudges, and how to say why. Deltas are small; a week of the same kind
        // of care visibly changes a KIN, a single snack only flavours it.
        private static (Deltas, string) Rule(Experience e) => e switch
        {
            Experience.Groomed => (Deltas.Of((Archetype.Royal, 0.012), (Archetype.Popstar, 0.004)), "loves being groomed"),
            Experience.Bath => (Deltas.Of((Archetype.Royal, 0.006), (Archetype.Athlete, 0.003)), "enjoys a fresh bath"),
            Experience.Dig => (Deltas.Of((Archetype.Explorer, 0.01), (Archetype.Athlete, 0.003)), "keeps digging for treasure"),
            Experience.Decorated => (Deltas.Of((Archetype.Artist, 0.014), (Archetype.Royal, 0.004)), "decorates the garden"),
            Experience.Garden => (Deltas.Of((Archetype.Artist, 0.008), (Archetype.Scholar, 0.004)), "tends the garden"),
            _ => (Deltas.Of((Archetype.Brat, 0.01)), "was left waiting"), // ignored
        };

        private static (Deltas, string) TrickRule(string trick) => trick switch
        {
            "dance" => (Deltas.Of((Archetype.Popstar, 0.016)), "practises its dance"),
            "spin" => (Deltas.Of((Archetype.Popstar, 0.008), (Archetype.Athlete, 0.006)), "practises spins"),
            "highfive" => (Deltas.Of((Archetype.Athlete, 0.008), (Archetype.Popstar, 0.004)), "loves a high-five"),
            "fetch" => (Deltas.Of((Archetype.Athlete, 0.012)), "trains at fetch"),
            "roll" => (Deltas.Of((Archetype.Gamer, 0.006), (Archetype.Brat, 0.004)), "shows off a roll"),
            "sit" => (Deltas.Of((Archetype.Royal, 0.006), (Archetype.Scholar, 0.004)), "practises sitting nicely"),
            _ => (Deltas.Of((Archetype.Popstar, 0.004)), "learns tricks"),
        };

        private static (Deltas, string) PlayRule(string kind) => kind switch
        {
            "fetch" => (Deltas.Of((Archetype.Athlete, 0.01), (Archetype.Gamer, 0.003)), "plays fetch"),
            "throw" => (Deltas.Of((Archetype.Athlete, 0.006)), "chases what you throw"),
            "toy" => (Deltas.Of((Archetype.Gamer, 0.008)), "plays with toys"),
            "chase" => (Deltas.Of((Archetype.Athlete, 0.008), (Archetype.Explorer, 0.003)), "chases things"),
            _ => (new Deltas(), ""),
        };

        // Talking: a tiny keyword lexicon maps a sentence to the worlds it touches. Generic words only.
        private const RegexOptions Ci = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;
        public static readonly IReadOnlyDictionary<Archetype, Regex> Lexicon = new Dictionary<Archetype, Regex>
        {
            [Archetype.Popstar] = new Regex(@"\b(sing|song|music|dance|star|stage|concert|fashion|trend|famous|camera|show|party|glitter|style|pop)\w*", Ci),
            [Archetype.Scholar] = new Regex(@"\b(why|how|fact|learn|book|read|science|space|planet|history|math|wiki|know|study|school|ocean|dinosaur|atom|brain)\w*", Ci),
            [Archetype.Gamer] = new Regex(@"\b(game|play|level|boss|quest|score|pixel|controller|arcade|puzzle|speedrun|win|loot|console|joystick)\w*", Ci),
            [Archetype.Athlete] = new Regex(@"\b(run|sport|ball|soccer|football|basketball|tennis|swim|race|gym|jump|team|goal|train|fast|strong)\w*", Ci),
            [Archetype.Brat] = new Regex(@"\b(no+|mine|whatever|boring|ugh|nope|meh|sass|rude|bossy|grumpy|demand)\w*", Ci),
            [Archetype.Royal] = new Regex(@"\b(king|queen|crown|castle|prince|princess|royal|palace|throne|fancy|tea|jewel|gold|velvet)\w*", Ci),
            [Archetype.Explorer] = new Regex(@"\b(explore|adventure|map|mountain|forest|travel|camp|hike|cave|island|treasure|journey|wild)\w*", Ci),
            [Archetype.Artist] = new Regex(@"\b(draw|paint|art|color|colour|craft|build|design|poem|story|sculpt|doodle|create)\w*", Ci),
        };

        public static IReadOnlyList<Archetype> Classify(string text)
        {
            string t = text.Length > 200 ? text.Substring(0, 200) : text;
            return Archetypes.Where((a) => Lexicon[a].IsMatch(t)).ToList();
        }

        /// <summary>Apply one experience (TS: experience()). Pure: returns a new persona.</summary>
        public static Persona Apply(Persona p, Experience ev, double now)
        {
            Deltas deltas;
            string why;
            switch (ev)
            {
                case Experience.Fed f:
                    deltas = f.Deltas;
                    why = "ate " + (f.Label ?? "a snack");
                    break;
                case Experience.Play pl:
                    (deltas, why) = PlayRule(pl.Kind);
                    break;
                case Experience.Trick tr:
                    (deltas, why) = TrickRule(tr.Name);
                    break;
                case Experience.Found fo:
                    deltas = Deltas.Of((Archetype.Explorer, fo.Rare ? 0.016 : 0.008));
                    why = fo.Rare ? "found something rare" : "finds little treasures";
                    break;
                case Experience.Visit _:
                case Experience.Hosted _:
                {
                    bool visit = ev is Experience.Visit;
                    Archetype? friend = ev is Experience.Visit v ? v.Friend : ((Experience.Hosted)ev).Friend;
                    string? friendName = ev is Experience.Visit v2 ? v2.FriendName : ((Experience.Hosted)ev).FriendName;
                    deltas = Deltas.Of((Archetype.Explorer, visit ? 0.01 : 0.002), (Archetype.Popstar, 0.004));
                    if (friend is Archetype fa) deltas.Set(fa, deltas.Get(fa) + 0.01);
                    why = friendName != null ? (visit ? "visited " : "hosted ") + friendName : visit ? "went visiting" : "had a visitor";
                    break;
                }
                case Experience.Talk talk:
                {
                    var hits = Classify(talk.Text);
                    deltas = new Deltas();
                    foreach (var a in hits) deltas.Set(a, 0.01 / Math.Max(1, hits.Count));
                    why = "talked with you";
                    break;
                }
                case Experience.SteerTo s:
                {
                    var c = p.Clone();
                    c.Steer = s.A;
                    return c;
                }
                default:
                    (deltas, why) = Rule(ev);
                    break;
            }
            return Grow(p, deltas, why, now);
        }

        /// <summary>Add deltas with diminishing returns (per-day cap, saturation near 1), and log why.</summary>
        public static Persona Grow(Persona p, Deltas deltas, string why, double now)
        {
            string key = DayKey(now);
            var gained = key == p.DayKey ? new Deltas(p.DayGained) : new Deltas();
            var levels = p.Levels.Clone();
            var log = new List<HistoryEntry>();
            foreach (var kv in deltas)
            {
                var maybe = FromWire(kv.Key);
                double raw = kv.Value;
                if (maybe is not Archetype a || double.IsNaN(raw) || double.IsInfinity(raw) || raw == 0) continue;
                double d = Math.Max(-0.08, Math.Min(0.08, raw));
                if (p.Steer == a && d > 0) d *= 1.5;
                if (d > 0)
                {
                    double room = Math.Max(0, DayCap - gained.Get(a));
                    d = Math.Min(d, room) * (1 - levels[a]); // saturates toward 1
                    gained.Set(a, gained.Get(a) + d);
                }
                else
                {
                    d *= levels[a];
                }
                if (Math.Abs(d) < 1e-5) continue;
                levels[a] = Clamp01(levels[a] + d);
                // Gentle lateral pull: growing one side of a personality slightly quiets the strongest other.
                if (d > 0)
                {
                    Archetype top = a == Archetype.Popstar ? Archetype.Scholar : Archetype.Popstar;
                    foreach (var x in Archetypes) if (x != a && levels[x] > levels[top]) top = x;
                    levels[top] = Clamp01(levels[top] - d * 0.15);
                }
                log.Add(new HistoryEntry(now, a, Rng.JsRound(d * 10000) / 10000, why));
            }
            var next = p.Clone();
            next.DayKey = key;
            next.DayGained = gained;
            if (log.Count == 0) return next;
            next.Levels = levels;
            next.History = log.Concat(p.History).Take(HistoryMax).ToList();
            return next;
        }

        /// <summary>
        /// Time-based drift: levels relax toward the KIN's own nature (so it's always reversible), and
        /// habits leave a trace (night owls lean gamer, early risers lean athlete, snow days make
        /// explorers). Call about once a minute; it's idempotent over short intervals.
        /// </summary>
        public static Persona Settle(Persona p, double now, int? hour = null, string? weather = null, bool active = false)
        {
            double days = Math.Max(0, Math.Min(30, (now - p.SettledAt) / 86_400_000));
            if (days < 1.0 / 1440) return p; // under a minute
            var levels = p.Levels.Clone();
            double k = 1 - Math.Pow(1 - RelaxPerDay, days);
            foreach (var a in Archetypes)
            {
                if (p.Steer == a) continue; // the steered archetype doesn't fade
                levels[a] = Clamp01(levels[a] + (p.Base[a] - levels[a]) * k);
            }
            var next = p.Clone();
            next.Levels = levels;
            next.SettledAt = now;
            if (active && hour is int h)
            {
                double mins = days * 1440;
                double per = 0.0004 * Math.Min(10, mins);
                if (h >= 22 || h < 4) next = Grow(next, Deltas.Of((Archetype.Gamer, per)), "stays up late", now);
                else if (h >= 5 && h < 8) next = Grow(next, Deltas.Of((Archetype.Athlete, per)), "is an early riser", now);
                if (weather == "snowy" || weather == "windy") next = Grow(next, Deltas.Of((Archetype.Explorer, per * 0.5)), "loves " + weather + " days", now);
                if (weather == "sunny") next = Grow(next, Deltas.Of((Archetype.Athlete, per * 0.3), (Archetype.Popstar, per * 0.2)), "soaks up the sun", now);
            }
            return next;
        }

        // ── Reading the persona

        /// <summary>Shares of each archetype above baseline, strongest first.</summary>
        public static IReadOnlyList<(Archetype a, double share)> Blend(Persona p)
        {
            var above = Archetypes.Select((a) => (a, v: Math.Max(0, p.Levels[a] - p.Base[a] * 0.5))).ToList();
            double total = above.Sum((x) => x.v);
            if (total == 0) total = 1;
            return above.Select((x) => (x.a, x.v / total)).OrderByDescending((x) => x.Item2).ToList();
        }

        /// <summary>0 (a trace) … 4 (fully that).</summary>
        public static int Tier(double level) => level >= 0.85 ? 4 : level >= 0.6 ? 3 : level >= 0.35 ? 2 : level >= 0.15 ? 1 : 0;

        public static string Title(Persona p)
        {
            var ranked = Archetypes.Select((a) => (a, l: p.Levels[a])).OrderByDescending((x) => x.l).ToList();
            var (a1, l1) = ranked[0];
            var (a2, l2) = ranked[1];
            if (l1 < 0.15) return "Little One";
            if (l2 < 0.15 || l2 < l1 * 0.55) return (Tier(l1) >= 3 ? "True " : "") + Noun(a1);
            return Adj(a2) + " " + Noun(a1);
        }

        public static Archetype Dominant(Persona p)
        {
            var m = Archetype.Popstar;
            foreach (var a in Archetypes) if (p.Levels[a] > p.Levels[m]) m = a;
            return m;
        }

        private static string[] Emotes(Archetype a) => a switch
        {
            Archetype.Popstar => new[] { "sparkle", "note", "heart" }, Archetype.Scholar => new[] { "question", "exclaim" },
            Archetype.Gamer => new[] { "exclaim", "sparkle" }, Archetype.Athlete => new[] { "exclaim", "sweat" },
            Archetype.Brat => new[] { "cloud", "exclaim" }, Archetype.Royal => new[] { "sparkle", "heart" },
            Archetype.Explorer => new[] { "question", "sparkle" }, _ => new[] { "heart", "note" },
        };
        private static string[] Idles(Archetype a) => a switch
        {
            Archetype.Popstar => new[] { "hum", "spin" }, Archetype.Scholar => new[] { "headTilt", "stargaze" },
            Archetype.Gamer => new[] { "tailChase", "roll" }, Archetype.Athlete => new[] { "stretch", "tailChase" },
            Archetype.Brat => new[] { "shake", "roll" }, Archetype.Royal => new[] { "sway", "groom" },
            Archetype.Explorer => new[] { "headTilt", "stargaze" }, _ => new[] { "hum", "sway" },
        };
        private static (int tier, string id, string label)[] Gear(Archetype a) => a switch
        {
            Archetype.Popstar => new[] { (1, "sparkle-clip", "a sparkly hair clip"), (3, "star-shades", "star-shaped shades") },
            Archetype.Scholar => new[] { (1, "tiny-glasses", "tiny round glasses"), (3, "scroll", "a little scroll") },
            Archetype.Gamer => new[] { (1, "headset", "a tiny headset"), (3, "cap-backwards", "a backwards cap") },
            Archetype.Athlete => new[] { (1, "headband", "a sweatband"), (3, "jersey", "a team jersey") },
            Archetype.Brat => new[] { (1, "bow-tilt", "a tilted bow"), (3, "bubblegum", "a bubblegum bubble") },
            Archetype.Royal => new[] { (1, "crown-tiny", "a tiny crown"), (3, "cape", "a velvet cape") },
            Archetype.Explorer => new[] { (1, "scarf", "a trail scarf"), (3, "backpack", "a tiny backpack") },
            _ => new[] { (1, "beret", "a beret"), (3, "paint-smudge", "a paint smudge") },
        };

        public static Expression Express(Persona p)
        {
            var tiers = Archetypes.ToDictionary((a) => a, (a) => Tier(p.Levels[a]));
            var top = Blend(p).Where((x) => tiers[x.a] >= 1).Select((x) => x.a).Take(2).ToList();
            var dom = Dominant(p);
            var accessories = Archetypes.SelectMany((a) => Gear(a).Where((g) => tiers[a] >= g.tier).Select((g) => new GearItem(g.id, g.label, a))).ToList();
            var lv = p.Levels;
            return new Expression(
                Title(p), dom, Hue(dom), tiers,
                top.SelectMany(Emotes).Distinct().ToList(), // Distinct keeps first-seen order, like a JS Set
                top.SelectMany(Idles).Distinct().ToList(),
                accessories,
                new VoiceShape(
                    1 + 0.12 * lv[Archetype.Popstar] - 0.1 * lv[Archetype.Royal] + 0.08 * lv[Archetype.Brat],
                    1 + 0.15 * lv[Archetype.Gamer] + 0.12 * lv[Archetype.Athlete] - 0.12 * lv[Archetype.Royal] - 0.05 * lv[Archetype.Scholar]),
                tiers[dom] >= 1 ? Wire(dom) : "neutral");
        }

        /// <summary>The most important reasons, aggregated: "ate trivia tart (3×) → more Scholar".</summary>
        public static IReadOnlyList<string> Why(Persona p, int n = 4)
        {
            var keys = new List<string>();
            var agg = new Dictionary<string, (Archetype a, double d, int count, string why)>();
            foreach (var h in p.History)
            {
                if (h.D <= 0) continue;
                string k = Wire(h.A) + "|" + h.Why;
                if (!agg.TryGetValue(k, out var cur))
                {
                    keys.Add(k);
                    cur = (h.A, 0, 0, h.Why);
                }
                agg[k] = (h.A, cur.d + h.D, cur.count + 1, h.Why);
            }
            return keys.Select((k) => agg[k]).OrderByDescending((v) => v.d).Take(n)
                .Select((v) => v.why + (v.count > 1 ? " (" + v.count.ToString(CultureInfo.InvariantCulture) + "×)" : "") + " → more " + Noun(v.a)).ToList();
        }

        private static string Style(Archetype a) => a switch
        {
            Archetype.Popstar => "bubbly show-biz sparkle, loves an audience, little catchphrases",
            Archetype.Scholar => "curious and precise, loves a fun fact, gentle \"did you know\"",
            Archetype.Gamer => "playful game talk (levels, quests, high scores), upbeat and quick",
            Archetype.Athlete => "energetic coach-talk, pep and teamwork, loves a challenge",
            Archetype.Brat => "sassy and dramatic but never mean, playful pouts, secretly sweet",
            Archetype.Royal => "grand and courteous, a little fancy, says \"we\" and \"most delightful\"",
            Archetype.Explorer => "adventurous and wondering, talks about maps, trails and treasure",
            _ => "dreamy and colourful, notices shapes and colours, makes little poems",
        };

        /// <summary>How the AI should write for this blend: a short style brief, generic and IP-free.</summary>
        public static string DialogueStyle(Persona p)
        {
            var b = Blend(p).Where((x) => p.Levels[x.a] >= 0.15).Take(2).ToList();
            if (b.Count == 0) return "a small, curious baby creature, simple sweet words";
            return string.Join("; ", b.Select((x) => Rng.JsRound(x.share * 100).ToString(CultureInfo.InvariantCulture) + "% " + Noun(x.a) + ": " + Style(x.a)));
        }

        /// <summary>The persona as it travels to the AI director (the server re-sanitises).</summary>
        public static PersonaCardData Card(Persona p) => new PersonaCardData(
            Title(p),
            Blend(p).Take(3).Select((x) => (x.a, Rng.JsRound(x.share * 100) / 100)).ToList(),
            DialogueStyle(p),
            Why(p, 3));

        // ── Persistence (same JSON as the web client stores under kin:v1:<slot>:persona)

        private static JsonObject LevelsJson(Levels l)
        {
            var o = new JsonObject();
            foreach (var a in Archetypes) o[Wire(a)] = l[a];
            return o;
        }

        public static string ToJson(Persona p)
        {
            var gained = new JsonObject();
            foreach (var kv in p.DayGained) gained[kv.Key] = kv.Value;
            var history = new JsonArray();
            foreach (var h in p.History) history.Add(new JsonObject { ["at"] = h.At, ["a"] = Wire(h.A), ["d"] = h.D, ["why"] = h.Why });
            var o = new JsonObject
            {
                ["v"] = 1,
                ["levels"] = LevelsJson(p.Levels),
                ["base"] = LevelsJson(p.Base),
                ["history"] = history,
                ["day"] = new JsonObject { ["key"] = p.DayKey, ["gained"] = gained },
                ["settledAt"] = p.SettledAt,
                ["steer"] = p.Steer is Archetype s ? Wire(s) : null,
            };
            return o.ToJsonString();
        }

        private static bool Finite(JsonElement e, out double d)
        {
            d = 0;
            return e.ValueKind == JsonValueKind.Number && e.TryGetDouble(out d) && !double.IsNaN(d) && !double.IsInfinity(d);
        }

        /// <summary>Restore a stored persona. Junk, unknown archetypes and out-of-range levels are repaired, never thrown.</summary>
        public static Persona Revive(string? json, Traits traits, double now)
        {
            if (json == null) return New(traits, now);
            try
            {
                using var doc = JsonDocument.Parse(json);
                return Revive(doc.RootElement, traits, now);
            }
            catch (JsonException)
            {
                return New(traits, now);
            }
        }

        public static Persona Revive(JsonElement raw, Traits traits, double now)
        {
            var fresh = New(traits, now);
            if (raw.ValueKind != JsonValueKind.Object || !raw.TryGetProperty("v", out var v) || v.ValueKind != JsonValueKind.Number || v.GetDouble() != 1
                || !raw.TryGetProperty("levels", out var lv) || lv.ValueKind != JsonValueKind.Object) return fresh;
            var levels = fresh.Levels.Clone();
            foreach (var a in Archetypes) if (lv.TryGetProperty(Wire(a), out var x) && Finite(x, out var d)) levels[a] = Clamp01(d);
            var history = new List<HistoryEntry>();
            if (raw.TryGetProperty("history", out var hs) && hs.ValueKind == JsonValueKind.Array)
            {
                foreach (var h in hs.EnumerateArray())
                {
                    if (h.ValueKind != JsonValueKind.Object || !h.TryGetProperty("a", out var ha) || ha.ValueKind != JsonValueKind.String) continue;
                    if (FromWire(ha.GetString()) is not Archetype a) continue;
                    double at = h.TryGetProperty("at", out var hat) && Finite(hat, out var t1) ? t1 : 0;
                    double dd = h.TryGetProperty("d", out var hd) && Finite(hd, out var t2) ? t2 : 0;
                    string why = h.TryGetProperty("why", out var hw) && hw.ValueKind == JsonValueKind.String ? hw.GetString()! : "";
                    history.Add(new HistoryEntry(at, a, dd, why));
                    if (history.Count == HistoryMax) break;
                }
            }
            string dayKey = fresh.DayKey;
            var gained = new Deltas();
            if (raw.TryGetProperty("day", out var day) && day.ValueKind == JsonValueKind.Object && day.TryGetProperty("key", out var dk) && dk.ValueKind == JsonValueKind.String)
            {
                dayKey = dk.GetString()!;
                if (day.TryGetProperty("gained", out var g) && g.ValueKind == JsonValueKind.Object)
                    foreach (var prop in g.EnumerateObject()) if (Finite(prop.Value, out var gv)) gained.Add(new KeyValuePair<string, double>(prop.Name, gv));
            }
            double settledAt = raw.TryGetProperty("settledAt", out var sa) && Finite(sa, out var sad) ? Math.Min(now, sad) : now;
            Archetype? steer = raw.TryGetProperty("steer", out var st) && st.ValueKind == JsonValueKind.String ? FromWire(st.GetString()) : null;
            return new Persona { Levels = levels, Base = fresh.Base, History = history, DayKey = dayKey, DayGained = gained, SettledAt = settledAt, Steer = steer };
        }
    }
}
