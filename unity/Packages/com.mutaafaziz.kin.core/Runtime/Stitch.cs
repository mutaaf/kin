// Stitch matching (port of src/stitch/match.ts): pairing that nobody can see. One finger slides off
// the edge of screen A and onto screen B. A reports "out at my right edge, height yA, at time t";
// B reports "in at my left edge, height yB, at t′". If exactly one such pair lines up in time,
// they're paired, and the same gesture calibrates the seam (which edges touch, how the screens
// are offset vertically). No camera, no microphone, no visible code, no permission prompt.
#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace Kin.Core
{
    public enum StitchDir { Out, In }

    /// <summary>
    /// Y: CSS px from the top of the reporting screen where the finger crossed the edge.
    /// T: server time of the crossing (receive time − client-reported age). V: swipe speed, px/ms.
    /// </summary>
    public sealed record StitchEvent(string Peer, StitchDir Dir, Edge Edge, double Y, double T, double V);

    /// <summary>Dy: the in-screen's top relative to the out-screen's top, in CSS px.</summary>
    public sealed record Pairing(StitchEvent Out, StitchEvent In, double Dy);

    /// <summary>Exactly one of: a pairing, ambiguous (two pairs swiped at once), or neither (keep waiting).</summary>
    public readonly struct StitchResult
    {
        public Pairing? Pairing { get; }
        public bool Ambiguous { get; }
        public StitchResult(Pairing? pairing, bool ambiguous)
        {
            Pairing = pairing;
            Ambiguous = ambiguous;
        }
        public bool Waiting => Pairing == null && !Ambiguous;
    }

    public static class Stitch
    {
        /// <summary>A finger needs ~20–250 ms to cross two bezels and the gap; allow for network jitter.</summary>
        public const double WindowMinMs = -180, WindowMaxMs = 650;

        private static Edge Opposite(Edge e) => e == Edge.Left ? Edge.Right : Edge.Left;

        public static StitchResult Match(StitchEvent ev, IReadOnlyList<StitchEvent> pending)
        {
            (StitchEvent o, StitchEvent i) Order(StitchEvent p) => ev.Dir == StitchDir.Out ? (ev, p) : (p, ev);
            var cands = pending.Where((p) =>
            {
                if (p.Peer == ev.Peer || p.Dir == ev.Dir || p.Edge != Opposite(ev.Edge)) return false;
                var (o, i) = Order(p);
                double dt = i.T - o.T;
                return dt >= WindowMinMs && dt <= WindowMaxMs;
            }).ToList();
            if (cands.Count == 0) return new StitchResult(null, false);
            // Rank by how well the delay matches the expected bezel-crossing time at the swipe's speed.
            double Score(StitchEvent p)
            {
                var (o, i) = Order(p);
                double expected = Math.Min(250, 48 / Math.Max(0.2, o.V));
                return Math.Abs(i.T - o.T - expected);
            }
            var ranked = cands.Select((c) => (c, s: Score(c))).OrderBy((x) => x.s).ToList(); // stable, like JS sort
            if (ranked.Count > 1 && ranked[1].s - ranked[0].s < 120) return new StitchResult(null, true);
            var (bo, bi) = Order(ranked[0].c);
            return new StitchResult(new Pairing(bo, bi, bo.Y - bi.Y), false);
        }
    }
}
