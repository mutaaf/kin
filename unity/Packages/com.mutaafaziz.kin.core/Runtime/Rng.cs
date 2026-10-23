// Deterministic randomness, bit-exact with src/core/rng.ts. Everything that must replay
// identically on every device (genome, brain variation, race outcomes later) draws from a seeded
// stream, never System.Random.
#nullable enable
using System;
using System.Collections.Generic;
using System.Security.Cryptography;

namespace Kin.Core
{
    /// <summary>A seeded random stream: <see cref="Next"/> returns a double in [0, 1).</summary>
    public delegate double RandomStream();

    public static class Rng
    {
        /// <summary>mulberry32: tiny, fast, good enough for gameplay; not for security.</summary>
        public static RandomStream Create(uint seed)
        {
            uint a = seed;
            return () =>
            {
                unchecked
                {
                    a += 0x6D2B79F5u;
                    uint t = a;
                    t = (t ^ (t >> 15)) * (t | 1u);
                    t ^= t + (t ^ (t >> 7)) * (t | 61u);
                    return (t ^ (t >> 14)) / 4294967296.0;
                }
            };
        }

        /// <summary>FNV-1a over UTF-16 code units (same as JS charCodeAt), used to derive sub-seeds.</summary>
        public static uint Hash(string s)
        {
            unchecked
            {
                uint h = 0x811C9DC5u;
                foreach (char c in s)
                {
                    h ^= c;
                    h *= 0x01000193u;
                }
                return h;
            }
        }

        public static T Pick<T>(RandomStream r, IReadOnlyList<T> xs) => xs[(int)Math.Floor(r() * xs.Count)];
        public static double Range(RandomStream r, double lo, double hi) => lo + (hi - lo) * r();
        public static double Clamp01(double x) => x < 0 ? 0 : x > 1 ? 1 : x;

        /// <summary>JavaScript Math.round: halves round toward +∞ (C#'s default is banker's rounding).</summary>
        public static double JsRound(double x) => Math.Floor(x + 0.5);

        /// <summary>A random, pseudonymous id like "kin_x3k9…" (14 base-36 chars).</summary>
        public static string RandomId(string prefix)
        {
            var bytes = new byte[9];
            using (var g = RandomNumberGenerator.Create()) g.GetBytes(bytes);
            var sb = new System.Text.StringBuilder();
            foreach (var b in bytes) sb.Append(ToBase36(b).PadLeft(2, '0'));
            var body = sb.ToString();
            return prefix + "_" + body.Substring(0, Math.Min(14, body.Length));
        }

        private static string ToBase36(int n)
        {
            const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
            if (n == 0) return "0";
            var s = "";
            while (n > 0)
            {
                s = digits[n % 36] + s;
                n /= 36;
            }
            return s;
        }
    }
}
