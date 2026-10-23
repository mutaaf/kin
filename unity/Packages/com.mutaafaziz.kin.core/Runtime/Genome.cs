// A KIN's look and temperament are a pure function of its seed (port of src/core/genome.ts).
// Two devices that receive the same seed render the same creature: this is what makes a crossing
// keep identity and skin without shipping meshes over the wire.
#nullable enable
using System;
using System.Globalization;

namespace Kin.Core
{
    public enum EarKind { Pointed, Round, Long, Tuft }
    public enum TailKind { Plume, Curl, Leaf, Nub }
    public enum Accent { Crystal, Sprout, Ember, None }

    public sealed record Genome(
        uint Seed,
        // Body hue in degrees; saturation/lightness are kept in a soft band on purpose.
        double Hue,
        double Sat,
        double Light,
        // Secondary hue for belly, ear tips and accent glow.
        double AccentHue,
        EarKind Ears,
        TailKind Tail,
        Accent Accent,
        // 0.88–1.12 overall size.
        double Size,
        // 0.92–1.18 eye scale.
        double EyeScale,
        // Body roundness: 0 = bean, 1 = ball.
        double Round);

    public sealed record Traits(double Curiosity, double Bravery, double Playfulness, double Warmth, double Energy);

    public static class Genomes
    {
        // Hues are drawn from curated bands so every creature looks good next to graphite.
        private static readonly (double lo, double hi)[] HueBands =
        {
            (8, 28), // apricot
            (30, 48), // honey
            (150, 175), // mint
            (185, 205), // glacier
            (215, 240), // periwinkle
            (265, 290), // lilac
            (320, 345), // rose
        };
        private static readonly double[] AccentShift = { 40, 150, 180, 200, -40 };
        private static readonly EarKind[] EarKinds = { EarKind.Pointed, EarKind.Round, EarKind.Long, EarKind.Tuft };
        private static readonly TailKind[] TailKinds = { TailKind.Plume, TailKind.Curl, TailKind.Leaf, TailKind.Nub };
        private static readonly Accent[] Accents = { Accent.Crystal, Accent.Sprout, Accent.Ember, Accent.None, Accent.None };

        private static string S(uint seed) => seed.ToString(CultureInfo.InvariantCulture);

        public static Genome Make(uint seed)
        {
            var r = Rng.Create(Rng.Hash("genome:" + S(seed)));
            var band = Rng.Pick(r, HueBands);
            double hue = Rng.Range(r, band.lo, band.hi);
            double sat = Rng.Range(r, 0.42, 0.68);
            double light = Rng.Range(r, 0.62, 0.78);
            double accentHue = (hue + Rng.Pick(r, AccentShift)) % 360; // same sign rule as JS %
            var ears = Rng.Pick(r, EarKinds);
            var tail = Rng.Pick(r, TailKinds);
            var accent = Rng.Pick(r, Accents);
            double size = Rng.Range(r, 0.88, 1.12);
            double eye = Rng.Range(r, 0.92, 1.18);
            double round = Rng.Range(r, 0.35, 0.95);
            return new Genome(seed, hue, sat, light, accentHue, ears, tail, accent, size, eye, round);
        }

        public static Traits MakeTraits(uint seed)
        {
            var r = Rng.Create(Rng.Hash("traits:" + S(seed)));
            // Pull toward the middle so extremes are rare and memorable.
            double T() => Rng.JsRound((0.15 + 0.7 * Math.Pow((r() + r() + r()) / 3, 0.9)) * 100) / 100;
            double curiosity = T(), bravery = T(), playfulness = T(), warmth = T(), energy = T();
            return new Traits(curiosity, bravery, playfulness, warmth, energy);
        }

        private static readonly string[] SylA = { "Lu", "No", "Pi", "Mo", "Ki", "Su", "Ta", "Bo", "Fen", "Ri", "Zu", "Ola", "Mi", "Ve", "Ju" };
        private static readonly string[] SylB = { "mi", "x", "po", "ra", "li", "bo", "ni", "ku", "wen", "sa", "to", "lo", "pa", "vy", "n" };

        public static string SuggestName(uint seed)
        {
            var r = Rng.Create(Rng.Hash("name:" + S(seed)));
            string a = Rng.Pick(r, SylA);
            return a + Rng.Pick(r, SylB);
        }

        // Plain-language temperament, used in the Gather list and Memory Book.
        public static string Temperament(Traits t)
        {
            if (t.Bravery > 0.62 && t.Warmth > 0.55) return "eager";
            if (t.Bravery < 0.38) return "cautious";
            if (t.Playfulness > 0.6) return "playful";
            if (t.Warmth < 0.4) return "aloof";
            return t.Curiosity > 0.55 ? "curious" : "easygoing";
        }
    }
}
