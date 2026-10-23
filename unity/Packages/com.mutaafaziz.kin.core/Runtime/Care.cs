// Care and progression: the relationship model (port of src/core/care.ts). Pure and
// deterministic (time is an input), so it is fully testable and the same on every device.
//
// House rules (VISION.md): no anxiety-inducing decay, no sickness, no death, no pay-to-win.
// Needs drift gently and floor well above zero. A neglected KIN is simply hungry, sleepy and
// overjoyed to see you. Progress (bond, tricks, collection, garden) only ever goes up.
#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Kin.Core
{
    public enum Need { Fullness, Fun, Clean, Rest, Affection }
    public enum Trick { Sit, Spin, Highfive, Fetch, Roll, Dance }
    public enum ItemKind { Pebble, Shell, Seed, Feather, Leaf, Crystal, Acorn }
    public enum Season { Spring, Summer, Autumn, Winter }
    public enum Verb { Feed, Bath, Brush, Play, Pet, Tuck, Trick, Plant, Water, Find, Befriend }
    public enum SurpriseKind { Bird, LostToy, ButterflySwarm, ShootingStar, ShellWash, GoldenFind }

    /// <summary>Rarity: 1 common … 4 rare. Shown honestly in the Garden Book; nothing is for sale.</summary>
    public sealed record CatalogItem(string Id, ItemKind Kind, string Name, int Rarity, Season? Season = null);

    /// <summary>Growth: 0 = seed … 1 = in bloom. Water: 0..1, rain and watering fill it; it slowly dries.</summary>
    public sealed record Plot(string? Seed, double PlantedAt, double Growth, double Water);

    /// <summary>The plant: growth accumulates with daylight; berries ripen on it.</summary>
    public sealed record PlantState(double Size, double Water, IReadOnlyList<double> Berries, double Bloom);

    public sealed record Placed(string Id, double X, double Z);

    public sealed record CareStats(int Fed, int Baths, int Throws, int Fetches, int Finds, int Friends);

    /// <summary>Environment the model reads (no rendering): sun elevation in degrees, temperature, precipitation.</summary>
    public sealed record CareEnv(double SunElev, double TempC, double PrecipMm, bool Snow);

    public sealed record Surprise(SurpriseKind Kind, int Hour);

    public sealed record BondInfo(int Level, string Name, double Into, double Need);

    public sealed class CareState
    {
        public double[] Needs { get; internal set; } = new double[5];
        public double BondXp { get; internal set; }
        /// <summary>XP earned per verb in the current hour (diminishing returns).</summary>
        public long XpHour { get; internal set; }
        public Dictionary<Verb, int> XpByVerb { get; internal set; } = new Dictionary<Verb, int>();
        public double[] Skills { get; internal set; } = new double[6];
        public int[] Attempts { get; internal set; } = new int[6];
        /// <summary>Item id → count found.</summary>
        public Dictionary<string, int> Collection { get; internal set; } = new Dictionary<string, int>();
        public Dictionary<string, double> FirstFound { get; internal set; } = new Dictionary<string, double>();
        public IReadOnlyList<Plot> Plots { get; internal set; } = Array.Empty<Plot>();
        public PlantState Plant { get; internal set; } = new PlantState(0.4, 0.7, new[] { 0.6 }, 0);
        public IReadOnlyList<Placed> PlacedItems { get; internal set; } = Array.Empty<Placed>();
        /// <summary>Days (YYYY-MM-DD) whose finds were already dug up, and how many.</summary>
        public Dictionary<string, int> Dug { get; internal set; } = new Dictionary<string, int>();
        public bool AsleepUnderBlanket { get; internal set; }
        public double LastAt { get; internal set; }
        public CareStats Stats { get; internal set; } = new CareStats(0, 0, 0, 0, 0, 0);

        public double this[Need n] => Needs[(int)n];
        public double Skill(Trick t) => Skills[(int)t];

        internal CareState Clone() => new CareState
        {
            Needs = (double[])Needs.Clone(), BondXp = BondXp, XpHour = XpHour, XpByVerb = new Dictionary<Verb, int>(XpByVerb),
            Skills = (double[])Skills.Clone(), Attempts = (int[])Attempts.Clone(), Collection = new Dictionary<string, int>(Collection),
            FirstFound = new Dictionary<string, double>(FirstFound), Plots = Plots, Plant = Plant, PlacedItems = PlacedItems,
            Dug = new Dictionary<string, int>(Dug), AsleepUnderBlanket = AsleepUnderBlanket, LastAt = LastAt, Stats = Stats,
        };
    }

    /// <summary>Result of a verb: the new state, XP earned, whether a trick landed, and a new bond level if one was reached.</summary>
    public sealed record Outcome(CareState Care, double Xp, bool? Success = null, int? LevelUp = null);

    public static class Care
    {
        public static readonly Need[] Needs = { Need.Fullness, Need.Fun, Need.Clean, Need.Rest, Need.Affection };
        public static readonly Trick[] Tricks = { Trick.Sit, Trick.Spin, Trick.Highfive, Trick.Fetch, Trick.Roll, Trick.Dance };

        /// <summary>Bond level at which each trick can be taught.</summary>
        public static int TrickUnlock(Trick t) => t switch
        {
            Trick.Sit => 1, Trick.Fetch => 1, Trick.Spin => 2, Trick.Highfive => 3, Trick.Roll => 5, _ => 7,
        };

        public static readonly IReadOnlyList<CatalogItem> Catalog = new[]
        {
            new CatalogItem("pebble-round", ItemKind.Pebble, "Round pebble", 1),
            new CatalogItem("pebble-striped", ItemKind.Pebble, "Striped pebble", 2),
            new CatalogItem("pebble-heart", ItemKind.Pebble, "Heart-shaped pebble", 3),
            new CatalogItem("shell-spiral", ItemKind.Shell, "Spiral shell", 2),
            new CatalogItem("shell-fan", ItemKind.Shell, "Fan shell", 2),
            new CatalogItem("shell-pearl", ItemKind.Shell, "Pearly shell", 4),
            new CatalogItem("seed-mint", ItemKind.Seed, "Mint bell seed", 1),
            new CatalogItem("seed-sun", ItemKind.Seed, "Sunburst seed", 2, Season.Summer),
            new CatalogItem("seed-moon", ItemKind.Seed, "Moonpetal seed", 3),
            new CatalogItem("seed-frost", ItemKind.Seed, "Frost lily seed", 3, Season.Winter),
            new CatalogItem("feather-blue", ItemKind.Feather, "Blue feather", 2),
            new CatalogItem("feather-gold", ItemKind.Feather, "Golden feather", 4),
            new CatalogItem("leaf-maple", ItemKind.Leaf, "Maple leaf", 1, Season.Autumn),
            new CatalogItem("leaf-heart", ItemKind.Leaf, "Heart leaf", 3),
            new CatalogItem("acorn", ItemKind.Acorn, "Acorn with a hat", 2, Season.Autumn),
            new CatalogItem("crystal-mint", ItemKind.Crystal, "Mint crystal", 3),
            new CatalogItem("crystal-dusk", ItemKind.Crystal, "Dusk crystal", 4),
        };
        public static CatalogItem? ItemById(string id) => Catalog.FirstOrDefault((c) => c.Id == id);

        public const double NeedFloor = 0.15;
        private const double Hour = 3_600_000;
        private static double Clamp(double x, double lo = 0, double hi = 1) => x < lo ? lo : x > hi ? hi : x;

        /// <summary>Gentle drift per hour (awake).</summary>
        private static readonly double[] Drift = { -0.06, -0.08, -0.03, -0.05, -0.04 };

        private static Plot EmptyPlot() => new Plot(null, 0, 0, 0.5);

        public static CareState New(double now) => new CareState
        {
            Needs = new[] { 0.75, 0.7, 0.9, 0.85, 0.7 },
            XpHour = (long)Math.Floor(now / Hour),
            Plots = new[] { EmptyPlot(), EmptyPlot(), EmptyPlot() },
            Plant = new PlantState(0.4, 0.7, new[] { 0.6 }, 0),
            LastAt = now,
        };

        /// <summary>
        /// Advance time. Needs drift (slower while asleep, rest refills), the plant grows with daylight
        /// and drinks rain, berries ripen, garden plots grow. Long absences are capped and gentle.
        /// Fallen: overripe berries that dropped (the world spawns them).
        /// </summary>
        public static (CareState care, int fallen) Tick(CareState c, double now, CareEnv env, bool asleep)
        {
            double dtH = Math.Min(48, Math.Max(0, (now - c.LastAt) / Hour));
            if (dtH <= 0) return (c, 0);
            var next = c.Clone();
            var needs = next.Needs;
            for (int i = 0; i < 5; i++)
            {
                double d = Drift[i] * dtH;
                if (asleep) d = i == (int)Need.Rest ? 0.3 * dtH : d * 0.35;
                needs[i] = Clamp(needs[i] + d, NeedFloor, 1);
            }
            double daylight = env.SunElev > 0 ? Math.Min(1, env.SunElev / 30) : 0;
            bool raining = env.PrecipMm > 0.1 && !env.Snow;
            // Out in the rain counts as a (gentle) bath.
            if (raining && !asleep) needs[(int)Need.Clean] = Clamp(needs[(int)Need.Clean] + 0.4 * dtH, NeedFloor, 1);

            double plantWater = Clamp(c.Plant.Water + (raining ? 0.5 : -0.04) * dtH);
            double thirst = plantWater < 0.2 ? 0.3 : 1; // a dry plant grows slowly; it never dies
            double size = Clamp(c.Plant.Size + 0.03 * daylight * thirst * dtH, 0.2, 1);
            // A berry ripens over ~3 h of daylight; a new one sets every ~2 h of daylight, up to 3.
            var grown = c.Plant.Berries.Select((b) => Clamp(b + (0.33 * daylight * thirst + 0.02) * dtH, 0, 1.4)).ToList();
            int fallen = grown.Count((b) => b >= 1.4);
            var berries = grown.Where((b) => b < 1.4).ToList();
            double bloom = c.Plant.Bloom + 0.5 * (0.25 + daylight) * thirst * dtH;
            while (bloom >= 1)
            {
                bloom -= 1;
                if (berries.Count < 3 && size > 0.35) berries.Add(0);
            }
            next.Plots = c.Plots.Select((p) =>
            {
                if (p.Seed == null) return p;
                double water = Clamp(p.Water + (raining ? 0.6 : -0.08) * dtH);
                double rate = water > 0.15 ? 1.0 / 48 : 1.0 / 160; // ~2 real days to bloom when watered
                return p with { Water = water, Growth = Clamp(p.Growth + rate * dtH * (0.4 + 0.6 * daylight)) };
            }).ToList();
            next.Plant = new PlantState(size, plantWater, berries, bloom);
            next.LastAt = now;
            return (next, fallen);
        }

        /// <summary>True when the KIN has been away from you long enough to deserve a reunion.</summary>
        public static bool IsReunion(double prevLastAt, double now) => now - prevLastAt > 6 * Hour;

        // ── Verbs
        private static double VerbXp(Verb v) => v switch
        {
            Verb.Feed => 6, Verb.Bath => 6, Verb.Brush => 4, Verb.Play => 5, Verb.Pet => 2, Verb.Tuck => 5,
            Verb.Trick => 7, Verb.Plant => 8, Verb.Water => 3, Verb.Find => 4, _ => 10,
        };

        private static Outcome Gain(CareState c, Verb verb, double now, params (Need n, double d)[] needs)
        {
            long hour = (long)Math.Floor(now / Hour);
            var next = c.Clone();
            if (next.XpHour != hour)
            {
                next.XpHour = hour;
                next.XpByVerb = new Dictionary<Verb, int>();
            }
            next.XpByVerb.TryGetValue(verb, out int n);
            // XP from one verb within an hour: full for the first 5, then halving. Never zero.
            double xp = Math.Max(0.5, VerbXp(verb) * (n < 5 ? 1 : Math.Pow(0.5, n - 4)));
            next.XpByVerb[verb] = n + 1;
            foreach (var (need, d) in needs) next.Needs[(int)need] = Clamp(next.Needs[(int)need] + d, NeedFloor, 1);
            int before = BondLevel(c.BondXp).Level;
            next.BondXp = c.BondXp + xp;
            int after = BondLevel(next.BondXp).Level;
            return new Outcome(next, xp, null, after > before ? after : (int?)null);
        }

        private static Outcome WithStats(Outcome o, Func<CareStats, CareStats> f)
        {
            o.Care.Stats = f(o.Care.Stats);
            return o;
        }

        public static Outcome Feed(CareState c, double now, double ripeness = 1) =>
            WithStats(Gain(c, Verb.Feed, now, (Need.Fullness, 0.3 + 0.1 * Math.Min(1, ripeness)), (Need.Affection, 0.04)), (s) => s with { Fed = s.Fed + 1 });

        public static Outcome Bath(CareState c, double now) =>
            WithStats(Gain(c, Verb.Bath, now, (Need.Clean, 0.55), (Need.Fun, 0.05)), (s) => s with { Baths = s.Baths + 1 });

        public static Outcome Brush(CareState c, double now) => Gain(c, Verb.Brush, now, (Need.Clean, 0.12), (Need.Affection, 0.08));
        public static Outcome Pet(CareState c, double now) => Gain(c, Verb.Pet, now, (Need.Affection, 0.06));

        /// <summary>Kind: throw | fetch | toy.</summary>
        public static Outcome Play(CareState c, double now, string kind) =>
            WithStats(Gain(c, Verb.Play, now, (Need.Fun, kind == "fetch" ? 0.18 : 0.1), (Need.Rest, -0.02), (Need.Fullness, -0.01)),
                (s) => s with { Throws = s.Throws + (kind == "throw" ? 1 : 0), Fetches = s.Fetches + (kind == "fetch" ? 1 : 0) });

        public static Outcome Tuck(CareState c, double now)
        {
            var o = Gain(c, Verb.Tuck, now, (Need.Affection, 0.1));
            o.Care.AsleepUnderBlanket = true;
            return o;
        }

        public static CareState Wake(CareState c)
        {
            var n = c.Clone();
            n.AsleepUnderBlanket = false;
            return n;
        }

        /// <summary>Mood multiplier for tricks: a happy, fed, rested KIN performs better.</summary>
        public static double Mood(CareState c) =>
            Clamp(0.45 + 0.55 * ((c[Need.Fun] + c[Need.Rest] + c[Need.Affection] + c[Need.Fullness]) / 4), 0.4, 1);

        public static bool CanTeach(CareState c, Trick t) => BondLevel(c.BondXp).Level >= TrickUnlock(t);

        /// <summary>Ask for a trick. Practice always teaches; success is skill × mood, with a seeded roll.</summary>
        public static Outcome DoTrick(CareState c, double now, Trick t, double roll)
        {
            double skill = c.Skill(t);
            double p = 0.12 + 0.8 * skill * Mood(c);
            bool success = roll < p;
            double learned = Clamp(skill + (success ? 0.08 : 0.05) * (1 - skill));
            var o = Gain(c, Verb.Trick, now, (Need.Fun, 0.06), (Need.Affection, success ? 0.04 : 0.01));
            o.Care.Skills[(int)t] = learned;
            o.Care.Attempts[(int)t] += 1;
            return o with { Success = success };
        }

        public static Outcome Collect(CareState c, double now, string id)
        {
            var o = WithStats(Gain(c, Verb.Find, now, (Need.Fun, 0.05)), (s) => s with { Finds = s.Finds + 1 });
            o.Care.Collection.TryGetValue(id, out int count);
            o.Care.Collection[id] = count + 1;
            if (!(o.Care.FirstFound.TryGetValue(id, out var at) && at != 0)) o.Care.FirstFound[id] = now; // TS: falsy check
            return o;
        }

        public static Outcome Befriend(CareState c, double now) =>
            WithStats(Gain(c, Verb.Befriend, now, (Need.Fun, 0.1), (Need.Affection, 0.05)), (s) => s with { Friends = s.Friends + 1 });

        /// <summary>Plant a seed from the collection in a free plot; null if that isn't possible.</summary>
        public static Outcome? PlantSeed(CareState c, double now, int plot, string seedId)
        {
            if (plot < 0 || plot >= c.Plots.Count) return null;
            var p = c.Plots[plot];
            if (p.Seed != null || !(c.Collection.TryGetValue(seedId, out int have) && have > 0) || ItemById(seedId)?.Kind != ItemKind.Seed) return null;
            var o = Gain(c, Verb.Plant, now, (Need.Fun, 0.05));
            o.Care.Plots = o.Care.Plots.Select((x, i) => i == plot ? new Plot(seedId, now, 0, 0.6) : x).ToList();
            o.Care.Collection[seedId] = have - 1;
            return o;
        }

        public static Outcome WaterPlant(CareState c, double now)
        {
            var o = Gain(c, Verb.Water, now);
            o.Care.Plant = o.Care.Plant with { Water = 1 };
            return o;
        }

        public static Outcome WaterPlot(CareState c, double now, int plot)
        {
            var o = Gain(c, Verb.Water, now);
            o.Care.Plots = o.Care.Plots.Select((p, i) => i == plot ? p with { Water = 1 } : p).ToList();
            return o;
        }

        /// <summary>Pick the ripest berry from the plant. Null if there is none.</summary>
        public static (CareState care, double ripeness)? PickBerry(CareState c)
        {
            if (c.Plant.Berries.Count == 0) return null;
            double max = c.Plant.Berries.Max();
            int i = c.Plant.Berries.ToList().IndexOf(max);
            var next = c.Clone();
            next.Plant = c.Plant with { Berries = c.Plant.Berries.Where((_, j) => j != i).ToList() };
            return (next, max);
        }

        /// <summary>More garden plots open as the bond grows (3, then +1 every 3 levels, up to 8).</summary>
        public static int PlotCount(CareState c) => Math.Min(8, 3 + BondLevel(c.BondXp).Level / 3);

        public static CareState EnsurePlots(CareState c)
        {
            int n = PlotCount(c);
            if (c.Plots.Count >= n) return c;
            var next = c.Clone();
            next.Plots = c.Plots.Concat(Enumerable.Range(0, n - c.Plots.Count).Select((_) => EmptyPlot())).ToList();
            return next;
        }

        // ── Bond: infinite levels
        private static readonly string[] BondNames = { "New friends", "Curious", "Trusting", "Pals", "Close", "Best friends", "Inseparable", "Kindred" };

        public static BondInfo BondLevel(double xp)
        {
            int level = 1;
            double need = 60;
            double left = xp;
            while (left >= need)
            {
                left -= need;
                level++;
                need = Rng.JsRound(60 * Math.Pow(level, 1.35));
            }
            string name = level <= BondNames.Length ? BondNames[level - 1] : "Kindred " + (level - BondNames.Length + 1).ToString(CultureInfo.InvariantCulture);
            return new BondInfo(level, name, left, need);
        }

        // ── Time: seasons and daily surprises. Dates are the player's LOCAL calendar (as in the TS).
        public static Season SeasonOf(DateTime date, double lat)
        {
            int m = date.Month - 1; // 0..11
            var north = m < 2 || m == 11 ? Season.Winter : m < 5 ? Season.Spring : m < 8 ? Season.Summer : Season.Autumn;
            if (lat >= 0) return north;
            return north switch { Season.Winter => Season.Summer, Season.Spring => Season.Autumn, Season.Summer => Season.Winter, _ => Season.Spring };
        }

        public static string DayKey(DateTime d) =>
            d.Year.ToString("D4", CultureInfo.InvariantCulture) + "-" + d.Month.ToString("D2", CultureInfo.InvariantCulture) + "-" + d.Day.ToString("D2", CultureInfo.InvariantCulture);

        /// <summary>The day's surprises: a pure function of the date and the KIN, so it's stable all day.</summary>
        public static IReadOnlyList<Surprise> SurprisesFor(DateTime date, uint kinSeed)
        {
            var r = Rng.Create(Rng.Hash("surprise:" + DayKey(date) + ":" + kinSeed.ToString(CultureInfo.InvariantCulture)));
            int F(double x) => (int)Math.Floor(x);
            var pool = new List<Surprise>
            {
                new Surprise(SurpriseKind.Bird, 7 + F(r() * 4)),
                new Surprise(SurpriseKind.LostToy, 10 + F(r() * 6)),
                new Surprise(SurpriseKind.ButterflySwarm, 11 + F(r() * 4)),
                new Surprise(SurpriseKind.ShootingStar, 21 + F(r() * 2)),
                new Surprise(SurpriseKind.ShellWash, 8 + F(r() * 8)),
                new Surprise(SurpriseKind.GoldenFind, 9 + F(r() * 9)),
            };
            int n = 1 + (r() < 0.55 ? 1 : 0);
            var outList = new List<Surprise>();
            while (outList.Count < n)
            {
                int i = F(r() * pool.Count);
                var s = pool[i];
                pool.RemoveAt(i);
                if (s.Kind == SurpriseKind.GoldenFind && r() < 0.6) continue; // rarer
                outList.Add(s);
            }
            return outList.OrderBy((s) => s.Hour).ToList(); // stable
        }

        /// <summary>What a dig turns up today: seeded by date + KIN + how many digs so far; seasonal items weighted.</summary>
        public static CatalogItem? Dig(DateTime date, uint kinSeed, int nth, Season s, bool golden = false)
        {
            if (nth >= 4 && !golden) return null; // a few finds a day keeps them special
            var r = Rng.Create(Rng.Hash("dig:" + DayKey(date) + ":" + kinSeed.ToString(CultureInfo.InvariantCulture) + ":" + nth.ToString(CultureInfo.InvariantCulture)));
            if (golden) return ItemById(r() < 0.5 ? "feather-gold" : "crystal-dusk");
            double[] byRarity = { 0, 10, 4, 1.4, 0.4 };
            var weights = Catalog.Select((c) =>
            {
                if (c.Season != null && c.Season != s) return 0.0;
                double b = byRarity[c.Rarity];
                return c.Season == s ? b * 2 : b;
            }).ToList();
            double total = weights.Sum();
            double x = r() * total;
            for (int i = 0; i < Catalog.Count; i++)
            {
                x -= weights[i];
                if (x <= 0) return Catalog[i];
            }
            return Catalog[0];
        }

        /// <summary>The lowest needs, if they're low enough to show a soft glyph.</summary>
        public static IReadOnlyList<Need> Wants(CareState c) =>
            Needs.Where((n) => c[n] < 0.38).OrderBy((n) => c[n]).Take(2).ToList();

        // ── Persistence (same JSON keys as the web client's kin:v1:<slot>:care)

        public static string Wire(Need n) => n.ToString().ToLowerInvariant();
        public static string Wire(Trick t) => t.ToString().ToLowerInvariant();

        private static bool Num(JsonElement o, string name, out double d)
        {
            d = 0;
            return o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out d) && !double.IsNaN(d) && !double.IsInfinity(d);
        }

        /// <summary>Repair a stored state from an older or partial version. Never throws.</summary>
        public static CareState Revive(string? json, double now)
        {
            if (json == null) return New(now);
            try
            {
                using var doc = JsonDocument.Parse(json);
                return Revive(doc.RootElement, now);
            }
            catch (JsonException)
            {
                return New(now);
            }
        }

        public static CareState Revive(JsonElement r, double now)
        {
            var c = New(now);
            if (r.ValueKind != JsonValueKind.Object || !Num(r, "v", out var v) || v != 1) return c;
            if (r.TryGetProperty("needs", out var needs)) foreach (var n in Needs) if (Num(needs, Wire(n), out var x)) c.Needs[(int)n] = x;
            if (Num(r, "bondXp", out var bx)) c.BondXp = bx;
            if (Num(r, "lastAt", out var la)) c.LastAt = la;
            if (r.TryGetProperty("skills", out var sk)) foreach (var t in Tricks) if (Num(sk, Wire(t), out var x)) c.Skills[(int)t] = x;
            if (r.TryGetProperty("attempts", out var at)) foreach (var t in Tricks) if (Num(at, Wire(t), out var x)) c.Attempts[(int)t] = (int)x;
            if (r.TryGetProperty("collection", out var col) && col.ValueKind == JsonValueKind.Object)
                foreach (var p in col.EnumerateObject()) if (p.Value.ValueKind == JsonValueKind.Number) c.Collection[p.Name] = p.Value.GetInt32();
            if (r.TryGetProperty("firstFound", out var ff) && ff.ValueKind == JsonValueKind.Object)
                foreach (var p in ff.EnumerateObject()) if (p.Value.ValueKind == JsonValueKind.Number) c.FirstFound[p.Name] = p.Value.GetDouble();
            if (r.TryGetProperty("dug", out var dug) && dug.ValueKind == JsonValueKind.Object)
                foreach (var p in dug.EnumerateObject()) if (p.Value.ValueKind == JsonValueKind.Number) c.Dug[p.Name] = p.Value.GetInt32();
            if (r.TryGetProperty("asleepUnderBlanket", out var ab) && (ab.ValueKind == JsonValueKind.True || ab.ValueKind == JsonValueKind.False)) c.AsleepUnderBlanket = ab.GetBoolean();
            if (r.TryGetProperty("plant", out var pl) && pl.ValueKind == JsonValueKind.Object)
            {
                var berries = pl.TryGetProperty("berries", out var bs) && bs.ValueKind == JsonValueKind.Array
                    ? bs.EnumerateArray().Where((b) => b.ValueKind == JsonValueKind.Number).Select((b) => b.GetDouble()).ToList()
                    : c.Plant.Berries.ToList();
                c.Plant = new PlantState(Num(pl, "size", out var sz) ? sz : c.Plant.Size, Num(pl, "water", out var w) ? w : c.Plant.Water, berries, Num(pl, "bloom", out var bl) ? bl : c.Plant.Bloom);
            }
            if (r.TryGetProperty("plots", out var plots) && plots.ValueKind == JsonValueKind.Array && plots.GetArrayLength() > 0)
            {
                c.Plots = plots.EnumerateArray().Select((p) => new Plot(
                    p.ValueKind == JsonValueKind.Object && p.TryGetProperty("seed", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null,
                    Num(p, "plantedAt", out var pa) ? pa : 0, Num(p, "growth", out var g) ? g : 0, Num(p, "water", out var wt) ? wt : 0.5)).ToList();
            }
            if (r.TryGetProperty("placed", out var placed) && placed.ValueKind == JsonValueKind.Array)
                c.PlacedItems = placed.EnumerateArray().Where((p) => p.ValueKind == JsonValueKind.Object && p.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                    .Select((p) => new Placed(p.GetProperty("id").GetString()!, Num(p, "x", out var x) ? x : 0, Num(p, "z", out var z) ? z : 0)).ToList();
            if (r.TryGetProperty("stats", out var st))
            {
                int S(string k, int d) => Num(st, k, out var x) ? (int)x : d;
                c.Stats = new CareStats(S("fed", 0), S("baths", 0), S("throws", 0), S("fetches", 0), S("finds", 0), S("friends", 0));
            }
            if (r.TryGetProperty("hourXp", out var hx) && Num(hx, "hour", out var hour))
            {
                c.XpHour = (long)hour;
                if (hx.TryGetProperty("byVerb", out var bv) && bv.ValueKind == JsonValueKind.Object)
                    foreach (var p in bv.EnumerateObject())
                        if (Enum.TryParse<Verb>(p.Name, true, out var verb) && p.Value.ValueKind == JsonValueKind.Number) c.XpByVerb[verb] = p.Value.GetInt32();
            }
            return c;
        }

        public static string ToJson(CareState c)
        {
            JsonObject Map<T>(IEnumerable<KeyValuePair<string, T>> xs)
            {
                var o = new JsonObject();
                foreach (var kv in xs) o[kv.Key] = JsonValue.Create(kv.Value);
                return o;
            }
            var o = new JsonObject
            {
                ["v"] = 1,
                ["needs"] = Map(Needs.Select((n) => new KeyValuePair<string, double>(Wire(n), c[n]))),
                ["bondXp"] = c.BondXp,
                ["hourXp"] = new JsonObject { ["hour"] = c.XpHour, ["byVerb"] = Map(c.XpByVerb.Select((kv) => new KeyValuePair<string, int>(kv.Key.ToString().ToLowerInvariant(), kv.Value))) },
                ["skills"] = Map(Tricks.Select((t) => new KeyValuePair<string, double>(Wire(t), c.Skill(t)))),
                ["attempts"] = Map(Tricks.Select((t) => new KeyValuePair<string, int>(Wire(t), c.Attempts[(int)t]))),
                ["collection"] = Map(c.Collection),
                ["firstFound"] = Map(c.FirstFound),
                ["plots"] = new JsonArray(c.Plots.Select((p) => (JsonNode)new JsonObject { ["seed"] = p.Seed, ["plantedAt"] = p.PlantedAt, ["growth"] = p.Growth, ["water"] = p.Water }).ToArray()),
                ["plant"] = new JsonObject { ["size"] = c.Plant.Size, ["water"] = c.Plant.Water, ["berries"] = new JsonArray(c.Plant.Berries.Select((b) => (JsonNode?)b).ToArray()), ["bloom"] = c.Plant.Bloom },
                ["placed"] = new JsonArray(c.PlacedItems.Select((p) => (JsonNode)new JsonObject { ["id"] = p.Id, ["x"] = p.X, ["z"] = p.Z }).ToArray()),
                ["dug"] = Map(c.Dug),
                ["asleepUnderBlanket"] = c.AsleepUnderBlanket,
                ["lastAt"] = c.LastAt,
                ["stats"] = new JsonObject { ["fed"] = c.Stats.Fed, ["baths"] = c.Stats.Baths, ["throws"] = c.Stats.Throws, ["fetches"] = c.Stats.Fetches, ["finds"] = c.Stats.Finds, ["friends"] = c.Stats.Friends },
            };
            return o.ToJsonString();
        }
    }
}
