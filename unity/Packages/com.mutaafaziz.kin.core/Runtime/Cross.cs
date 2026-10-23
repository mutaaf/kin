// KIN CROSS as two pure state machines (port of src/session/cross.ts): the Owner (my KIN leaving)
// and the Host (guests arriving). No timers, no I/O: every input is (message | user intent | tick)
// plus `now` (epoch ms), every output is messages to send and effects to render/persist. That
// makes the invariants testable under loss, duplication, reordering and crashes.
//
// Invariants
//   1. Ownership never moves. Only the owner persists the creature; a host keeps a lease in memory.
//   2. One placement. After the network settles the KIN is either home, or hosted by exactly one
//      peer that the owner believes it is visiting. Never both, never neither.
//   3. Every step is idempotent. Retries re-send the current step; duplicates are answered, not redone.
#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace Kin.Core
{
    /// <summary>Timing constants (ms), identical to the TypeScript T.</summary>
    public static class CrossTiming
    {
        public const double Retry = 600;
        public const double InviteTimeout = 15_000;
        public const double PrepareTimeout = 5_000;
        /// <summary>Lead time so both screens start the hop on the same frame despite latency.</summary>
        public const double Lead = 450;
        /// <summary>Airborne part of the hop; the seam is crossed at the midpoint.</summary>
        public const double Hop = 1_050;
        /// <summary>Landing, squash and the host's first look. Commit is sent after this.</summary>
        public const double Settle = 650;
        public const double CommitGrace = 3_000;
        public const double Beat = 1_000;
        public const double Lease = 5_000;
        public const double ReturnTimeout = 4_500;
        public const double Tombstone = 60_000;
    }

    public sealed record Out(string To, Msg Msg);

    public sealed class Step<TFx>
    {
        public List<Out> Out { get; set; } = new List<Out>();
        public List<TFx> Fx { get; } = new List<TFx>();
    }

    public static class CrossEdges
    {
        public static Edge Opposite(Edge e) => e switch
        {
            Edge.Left => Edge.Right,
            Edge.Right => Edge.Left,
            Edge.Top => Edge.Bottom,
            _ => Edge.Top,
        };
    }

    // ───────────────────────────── Owner ─────────────────────────────

    public enum OwnerPhase { Home, Inviting, Preparing, Exiting, Away, Returning }

    public abstract record OwnerFx;
    public sealed record OwnerPhaseFx(OwnerPhase Phase) : OwnerFx;
    public sealed record OwnerHopOut(string VisitId, double At, Edge Edge, Seam Seam, string Peer) : OwnerFx;
    /// <summary>Commit received: persist placement = away.</summary>
    public sealed record OwnerAway(string VisitId, string Peer) : OwnerFx;
    /// <summary>The creature comes back without a completed visit (declined, cancelled, lease lost).</summary>
    public sealed record OwnerComeBack(string VisitId, string Reason, bool WasOut) : OwnerFx;
    public sealed record OwnerHopIn(string VisitId, double At, Edge Edge) : OwnerFx;
    /// <summary>Visit finished: persist placement = home and the memory (null if the host vanished).</summary>
    public sealed record OwnerHome(string VisitId, VisitMemory? Memory) : OwnerFx;

    public sealed class Owner
    {
        public OwnerPhase Phase { get; private set; } = OwnerPhase.Home;
        public string? VisitId { get; private set; }
        public string? Peer { get; private set; }
        public Edge Edge { get; private set; } = Edge.Right;
        public Seam? Seam { get; private set; }
        public double StartAt { get; private set; }
        public double ReturnAt { get; private set; }
        private double _deadline, _lastSent, _lastAck, _lastBeat;

        private readonly Func<VisitorSnapshot> _visitor;
        private readonly Func<string> _newId;
        /// <summary>remote clock − local clock for a peer, from clock.ping/pong.</summary>
        private readonly Func<string, double> _offset;

        public Owner(Func<VisitorSnapshot> visitor, Func<string> newId, Func<string, double>? offset = null)
        {
            _visitor = visitor;
            _newId = newId;
            _offset = offset ?? ((_) => 0);
        }

        private static Step<OwnerFx> None() => new Step<OwnerFx>();

        /// <summary>User intent: send my KIN to <paramref name="peer"/> across <paramref name="edge"/>.</summary>
        public Step<OwnerFx> Visit(string peer, Edge edge, Seam seam, double now)
        {
            if (Phase != OwnerPhase.Home) return None();
            VisitId = _newId();
            Peer = peer;
            Edge = edge;
            Seam = seam;
            _deadline = now + CrossTiming.InviteTimeout;
            return Go(OwnerPhase.Inviting, now, Invite());
        }

        /// <summary>User intent (or host request): bring my KIN home.</summary>
        public Step<OwnerFx> Recall(double now, string reason = "recall")
        {
            if (Phase == OwnerPhase.Away)
            {
                ReturnAt = now + CrossTiming.Lead;
                _deadline = ReturnAt + CrossTiming.Hop + CrossTiming.ReturnTimeout;
                var s = Go(OwnerPhase.Returning, now, ReturnMsg());
                s.Fx.Add(new OwnerHopIn(VisitId!, ReturnAt, Edge));
                return s;
            }
            if (Phase == OwnerPhase.Inviting || Phase == OwnerPhase.Preparing || Phase == OwnerPhase.Exiting) return Abort(now, reason);
            return None();
        }

        /// <summary>After a restart with placement = away persisted: we don't know the host's state, so ask for it back.</summary>
        public Step<OwnerFx> Restore(string visitId, string peer, double now)
        {
            VisitId = visitId;
            Peer = peer;
            Phase = OwnerPhase.Away;
            return Recall(now, "restart");
        }

        public Step<OwnerFx> Handle(string from, Msg msg, double now)
        {
            if (msg is not VisitMsg vm) return None();
            bool mine = vm.VisitId == VisitId && from == Peer;
            switch (msg)
            {
                case VisitAccept:
                    if (mine && Phase == OwnerPhase.Inviting)
                    {
                        _deadline = now + CrossTiming.PrepareTimeout;
                        return Go(OwnerPhase.Preparing, now, Prepare());
                    }
                    // A late accept for a visit we gave up on: make sure the host lets go.
                    return mine && Phase != OwnerPhase.Home ? None() : CancelTo(from, vm.VisitId, "stale");
                case VisitDecline d:
                    if (mine && (Phase == OwnerPhase.Inviting || Phase == OwnerPhase.Preparing)) return Abort(now, d.Reason, false);
                    return None();
                case CrossReady:
                    if (mine && Phase == OwnerPhase.Preparing)
                    {
                        StartAt = now + CrossTiming.Lead;
                        _deadline = StartAt + CrossTiming.Hop + CrossTiming.Settle + CrossTiming.CommitGrace;
                        var s = Go(OwnerPhase.Exiting, now, Start());
                        s.Fx.Add(new OwnerHopOut(VisitId!, StartAt, Edge, Seam!, Peer!));
                        return s;
                    }
                    return mine ? None() : CancelTo(from, vm.VisitId, "stale");
                case CrossCommit:
                    if (mine && Phase == OwnerPhase.Exiting)
                    {
                        _lastAck = now;
                        _lastBeat = now;
                        var s = Go(OwnerPhase.Away, now);
                        s.Fx.Add(new OwnerAway(VisitId!, Peer!));
                        return s;
                    }
                    if (mine && (Phase == OwnerPhase.Away || Phase == OwnerPhase.Returning)) return None();
                    // Commit for a visit we already cancelled (our cancel and their commit crossed).
                    return CancelTo(from, vm.VisitId, "stale");
                case VisitHeartbeatAck:
                    if (mine && Phase == OwnerPhase.Away) _lastAck = now;
                    return None();
                case VisitReturnRequest:
                    return mine && Phase == OwnerPhase.Away ? Recall(now, "host") : None();
                case VisitComplete c:
                    if (mine && (Phase == OwnerPhase.Returning || Phase == OwnerPhase.Away)) return Finish(now, c.Memory);
                    return None();
                case CrossCancel x:
                    if (!mine) return None();
                    if (Phase == OwnerPhase.Returning) return Finish(now, null);
                    if (Phase != OwnerPhase.Home) return Abort(now, x.Reason, false);
                    return None();
                default:
                    return None();
            }
        }

        public Step<OwnerFx> Tick(double now)
        {
            switch (Phase)
            {
                case OwnerPhase.Inviting:
                case OwnerPhase.Preparing:
                    if (now > _deadline) return Abort(now, "timeout");
                    return Retry(now, Phase == OwnerPhase.Inviting ? Invite() : Prepare());
                case OwnerPhase.Exiting:
                    if (now > _deadline) return Abort(now, "no-commit");
                    return Retry(now, Start());
                case OwnerPhase.Away:
                {
                    if (now - _lastAck > CrossTiming.Lease) return Abort(now, "lease");
                    if (now - _lastBeat < CrossTiming.Beat) return None();
                    _lastBeat = now;
                    var s = None();
                    s.Out.Add(new Out(Peer!, new VisitHeartbeat(VisitId!)));
                    return s;
                }
                case OwnerPhase.Returning:
                    if (now > _deadline) return Finish(now, null);
                    return Retry(now, ReturnMsg());
                default:
                    return None();
            }
        }

        // ── helpers
        private Step<OwnerFx> Go(OwnerPhase phase, double now, Msg? send = null)
        {
            Phase = phase;
            _lastSent = now;
            var s = new Step<OwnerFx>();
            if (send != null) s.Out.Add(new Out(Peer!, send));
            s.Fx.Add(new OwnerPhaseFx(phase));
            return s;
        }

        private Step<OwnerFx> Retry(double now, Msg msg)
        {
            if (now - _lastSent < CrossTiming.Retry) return None();
            _lastSent = now;
            var s = None();
            s.Out.Add(new Out(Peer!, msg));
            return s;
        }

        private Step<OwnerFx> Abort(double now, string reason, bool notify = true)
        {
            string visitId = VisitId!;
            bool wasOut = Phase == OwnerPhase.Exiting || Phase == OwnerPhase.Away;
            var outs = new List<Out>();
            if (notify && Peer != null) outs.Add(new Out(Peer, new CrossCancel(visitId, reason)));
            var s = Go(OwnerPhase.Home, now);
            s.Out = outs;
            s.Fx.Add(new OwnerComeBack(visitId, reason, wasOut));
            VisitId = null;
            return s;
        }

        private Step<OwnerFx> Finish(double now, VisitMemory? memory)
        {
            string visitId = VisitId!;
            var s = Go(OwnerPhase.Home, now);
            s.Fx.Add(new OwnerHome(visitId, memory));
            VisitId = null;
            return s;
        }

        private Msg Invite() => new VisitInvite(VisitId!, _visitor());
        private Msg Prepare() => new CrossPrepare(VisitId!, _visitor());
        // startAt travels in the receiver's clock so it can schedule without knowing ours.
        private Msg Start() => new CrossStart(VisitId!, StartAt + _offset(Peer!), Edge, Seam!);
        private Msg ReturnMsg() => new VisitReturn(VisitId!);

        private static Step<OwnerFx> CancelTo(string to, string visitId, string reason)
        {
            var s = None();
            s.Out.Add(new Out(to, new CrossCancel(visitId, reason)));
            return s;
        }
    }

    // ───────────────────────────── Host ─────────────────────────────

    public enum GuestPhase { Asking, Accepted, Ready, Arriving, Hosting, Leaving }

    public sealed class Guest
    {
        public string VisitId { get; internal set; } = "";
        public string Owner { get; internal set; } = "";
        public VisitorSnapshot Visitor { get; internal set; } = null!;
        public GuestPhase Phase { get; internal set; }
        public double Deadline { get; internal set; }
        public double LastBeat { get; internal set; }
        public double ArriveAt { get; internal set; }
        public Edge Edge { get; internal set; } = Edge.Left;
        public Seam? Seam { get; internal set; }
        public Reaction Reaction { get; internal set; }
    }

    public abstract record HostFx;
    public sealed record HostAsk(string VisitId, VisitorSnapshot Visitor) : HostFx;
    public sealed record HostHopIn(string VisitId, VisitorSnapshot Visitor, double At, Edge Edge, Seam Seam, Reaction Reaction) : HostFx;
    public sealed record HostHosting(string VisitId, VisitorSnapshot Visitor) : HostFx;
    public sealed record HostHopOut(string VisitId, double At, Edge Edge) : HostFx;
    /// <summary>Guest disappears without ceremony (cancel or lease expiry): fade, never persist.</summary>
    public sealed record HostDrop(string VisitId, string Reason) : HostFx;
    public sealed record HostUnasked(string VisitId) : HostFx;

    public enum HostMode { Ask, Auto, Off }

    /// <summary>
    /// Mode: 'ask' shows a prompt; 'auto' accepts; 'off' declines everything. Open: false while my
    /// own KIN is away (a house with nobody home doesn't take visitors).
    /// </summary>
    public sealed record HostPolicy(Func<HostMode> Mode, int Capacity, Func<bool> Open, Func<VisitorSnapshot, Reaction> ReactionFor, Func<Guest, VisitMemory> MemoryFor);

    public sealed class Host
    {
        private readonly HostPolicy _policy;
        // Insertion-ordered, like the TS Map (tick walks guests in arrival order).
        private readonly List<Guest> _guests = new List<Guest>();
        /// <summary>Finished visits, so a retried visit.return still gets its memory back exactly once.</summary>
        private readonly Dictionary<string, (double at, VisitMemory? memory, string owner)> _done = new Dictionary<string, (double, VisitMemory?, string)>();

        public Host(HostPolicy policy) => _policy = policy;

        public IReadOnlyList<Guest> Guests => _guests;

        public Guest? Find(string visitId)
        {
            foreach (var g in _guests) if (g.VisitId == visitId) return g;
            return null;
        }

        private static Step<HostFx> None() => new Step<HostFx>();

        private static Step<HostFx> Send(string to, Msg m)
        {
            var s = None();
            s.Out.Add(new Out(to, m));
            return s;
        }

        /// <summary>User answered the visit prompt.</summary>
        public Step<HostFx> Answer(string visitId, bool yes, double now)
        {
            var g = Find(visitId);
            if (g == null || g.Phase != GuestPhase.Asking) return None();
            if (!yes)
            {
                _guests.Remove(g);
                return Send(g.Owner, new VisitDecline(visitId, "host-declined"));
            }
            g.Phase = GuestPhase.Accepted;
            g.Deadline = now + CrossTiming.PrepareTimeout + CrossTiming.Retry * 2;
            return Send(g.Owner, new VisitAccept(visitId));
        }

        /// <summary>Host-side "send home" (the visitor's owner still decides; we only ask).</summary>
        public Step<HostFx> SendHome(string visitId)
        {
            var g = Find(visitId);
            if (g == null || g.Phase != GuestPhase.Hosting) return None();
            return Send(g.Owner, new VisitReturnRequest(visitId));
        }

        public Step<HostFx> Handle(string from, Msg msg, double now)
        {
            if (msg is not VisitMsg vm) return None();
            var g = Find(vm.VisitId);
            if (g != null && g.Owner != from) return None(); // only the owner speaks for its KIN
            Step<HostFx> Reply(Msg m) => Send(from, m);

            switch (msg)
            {
                case VisitInvite inv:
                {
                    if (g != null) return g.Phase == GuestPhase.Asking ? None() : Reply(new VisitAccept(g.VisitId));
                    if (_done.ContainsKey(inv.VisitId)) return Reply(new VisitDecline(inv.VisitId, "stale"));
                    var mode = _policy.Mode();
                    bool full = _guests.Count((x) => x.Phase != GuestPhase.Asking) >= _policy.Capacity;
                    bool already = _guests.Any((x) => x.Visitor.KinId == inv.Visitor.KinId);
                    if (mode == HostMode.Off || !_policy.Open() || full || already)
                        return Reply(new VisitDecline(inv.VisitId, mode == HostMode.Off ? "closed" : full ? "full" : "busy"));
                    var guest = new Guest
                    {
                        VisitId = inv.VisitId, Owner = from, Visitor = inv.Visitor, Phase = GuestPhase.Asking,
                        Deadline = now + CrossTiming.InviteTimeout - 1_000, LastBeat = now, ArriveAt = 0, Edge = Edge.Left, Seam = null,
                        Reaction = _policy.ReactionFor(inv.Visitor),
                    };
                    _guests.Add(guest);
                    if (mode == HostMode.Auto) return Answer(inv.VisitId, true, now);
                    var s = None();
                    s.Fx.Add(new HostAsk(inv.VisitId, inv.Visitor));
                    return s;
                }
                case CrossPrepare prep:
                    if (g == null) return Reply(new CrossCancel(prep.VisitId, "unknown"));
                    if (g.Phase == GuestPhase.Accepted)
                    {
                        g.Phase = GuestPhase.Ready;
                        g.Visitor = prep.Visitor;
                        g.Deadline = now + CrossTiming.PrepareTimeout + CrossTiming.Lead + CrossTiming.CommitGrace;
                    }
                    return g.Phase == GuestPhase.Ready ? Reply(new CrossReady(g.VisitId)) : None();
                case CrossStart start:
                {
                    if (g == null) return Reply(new CrossCancel(start.VisitId, "unknown"));
                    if (g.Phase == GuestPhase.Hosting) return Reply(new CrossCommit(g.VisitId));
                    if (g.Phase != GuestPhase.Ready) return None();
                    // Convert to local clock; if we heard late, join the hop mid-air rather than stall the party.
                    g.ArriveAt = Math.Max(start.StartAt, now - CrossTiming.Hop * 0.5);
                    g.Edge = CrossEdges.Opposite(start.Edge);
                    g.Seam = start.Seam;
                    g.Phase = GuestPhase.Arriving;
                    g.LastBeat = now;
                    var s = None();
                    s.Fx.Add(new HostHopIn(g.VisitId, g.Visitor, g.ArriveAt, g.Edge, start.Seam, g.Reaction));
                    return s;
                }
                case VisitHeartbeat hb:
                    if (g == null || g.Phase == GuestPhase.Leaving) return Reply(new CrossCancel(hb.VisitId, g != null ? "leaving" : "unknown"));
                    g.LastBeat = now;
                    return Reply(new VisitHeartbeatAck(g.VisitId));
                case VisitReturn ret:
                {
                    if (_done.TryGetValue(ret.VisitId, out var fin)) return Reply(new VisitComplete(ret.VisitId, fin.memory));
                    if (g == null) return Reply(new VisitComplete(ret.VisitId, null));
                    if (g.Phase == GuestPhase.Leaving) return None();
                    if (g.Phase != GuestPhase.Hosting && g.Phase != GuestPhase.Arriving) return Drop(g, now, "returned");
                    g.Phase = GuestPhase.Leaving;
                    g.Deadline = now + CrossTiming.Hop;
                    var s = None();
                    s.Fx.Add(new HostHopOut(g.VisitId, now, g.Edge));
                    return s;
                }
                case CrossCancel x:
                    return g != null ? Drop(g, now, x.Reason, false) : None();
                default:
                    return None();
            }
        }

        public Step<HostFx> Tick(double now)
        {
            var step = None();
            foreach (var g in _guests.ToArray())
            {
                switch (g.Phase)
                {
                    case GuestPhase.Asking:
                        if (now > g.Deadline)
                        {
                            _guests.Remove(g);
                            step.Out.Add(new Out(g.Owner, new VisitDecline(g.VisitId, "no-answer")));
                            step.Fx.Add(new HostUnasked(g.VisitId));
                        }
                        break;
                    case GuestPhase.Accepted:
                    case GuestPhase.Ready:
                        if (now > g.Deadline) Merge(step, Drop(g, now, "timeout"));
                        break;
                    case GuestPhase.Arriving:
                        if (now >= g.ArriveAt + CrossTiming.Hop + CrossTiming.Settle)
                        {
                            g.Phase = GuestPhase.Hosting;
                            g.LastBeat = now;
                            step.Out.Add(new Out(g.Owner, new CrossCommit(g.VisitId)));
                            step.Fx.Add(new HostHosting(g.VisitId, g.Visitor));
                        }
                        break;
                    case GuestPhase.Hosting:
                        if (now - g.LastBeat > CrossTiming.Lease) Merge(step, Drop(g, now, "lease"));
                        break;
                    case GuestPhase.Leaving:
                        if (now >= g.Deadline)
                        {
                            var memory = _policy.MemoryFor(g);
                            _guests.Remove(g);
                            _done[g.VisitId] = (now, memory, g.Owner);
                            step.Out.Add(new Out(g.Owner, new VisitComplete(g.VisitId, memory)));
                        }
                        break;
                }
            }
            List<string>? stale = null;
            foreach (var kv in _done) if (now - kv.Value.at > CrossTiming.Tombstone) (stale ??= new List<string>()).Add(kv.Key);
            if (stale != null) foreach (var id in stale) _done.Remove(id);
            return step;
        }

        private static void Merge(Step<HostFx> into, Step<HostFx> s)
        {
            into.Out.AddRange(s.Out);
            into.Fx.AddRange(s.Fx);
        }

        private Step<HostFx> Drop(Guest g, double now, string reason, bool notify = true)
        {
            _guests.Remove(g);
            _done[g.VisitId] = (now, null, g.Owner);
            var s = None();
            if (notify) s.Out.Add(new Out(g.Owner, new CrossCancel(g.VisitId, reason)));
            s.Fx.Add(new HostDrop(g.VisitId, reason));
            return s;
        }
    }
}
