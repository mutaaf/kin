// One versioned envelope for every transport (port of src/protocol/messages.ts). The JSON shapes
// are identical to the web client's, so a Unity client, a browser and the Cloudflare relay all
// speak the same protocol. Keep payloads minimal: a visitor travels as its seed, name and traits,
// never as owner data.
#nullable enable
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Kin.Core
{
    /// <summary>Window rectangle in screen pixels; Sw/Sh is the screen size; Fine = mouse/trackpad device.</summary>
    public sealed record ScreenRect(double X, double Y, double W, double H, double Sw, double Sh, bool Fine);

    /// <summary>Open is false while this KIN is away (it can't receive visitors) or visits are off.</summary>
    public sealed record PeerInfo(string Peer, string KinId, string Name, double Hue, string Temperament, bool Open, ScreenRect? Rect);

    public sealed record VisitorSnapshot(string KinId, uint Seed, string Name, Traits Traits, double Hue);

    public sealed record VisitMemory(string HostId, string HostName, double HostHue, Reaction HostReaction, Reaction VisitorReaction, string Weather);

    public sealed record Point2(double X, double Y);

    /// <summary>
    /// Where the hop starts. Both screens rebuild the same arc from this plus each other's rect, so
    /// the creature crosses the seam at the same height and depth on both. Rect: source window
    /// (screen px). From: hop start in source-window CSS px.
    /// </summary>
    public sealed record Seam(ScreenRect? Rect, Point2 From);

    /// <summary>A protocol message. <see cref="T"/> is the wire discriminator ("visit.invite", …).</summary>
    public abstract record Msg
    {
        [JsonIgnore] public abstract string T { get; }
    }

    /// <summary>A message that belongs to one visit.</summary>
    public abstract record VisitMsg(string VisitId) : Msg;

    public sealed record PresenceHello(PeerInfo Info, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Reply = null) : Msg { public override string T => "presence.hello"; }
    public sealed record PresenceBye() : Msg { public override string T => "presence.bye"; }
    public sealed record ClockPing(double T0) : Msg { public override string T => "clock.ping"; }
    public sealed record ClockPong(double T0, double T1) : Msg { public override string T => "clock.pong"; }
    public sealed record VisitInvite(string VisitId, VisitorSnapshot Visitor) : VisitMsg(VisitId) { public override string T => "visit.invite"; }
    public sealed record VisitAccept(string VisitId) : VisitMsg(VisitId) { public override string T => "visit.accept"; }
    public sealed record VisitDecline(string VisitId, string Reason) : VisitMsg(VisitId) { public override string T => "visit.decline"; }
    public sealed record CrossPrepare(string VisitId, VisitorSnapshot Visitor) : VisitMsg(VisitId) { public override string T => "cross.prepare"; }
    public sealed record CrossReady(string VisitId) : VisitMsg(VisitId) { public override string T => "cross.ready"; }
    public sealed record CrossStart(string VisitId, double StartAt, Edge Edge, Seam Seam) : VisitMsg(VisitId) { public override string T => "cross.start"; }
    public sealed record CrossCommit(string VisitId) : VisitMsg(VisitId) { public override string T => "cross.commit"; }
    public sealed record CrossCancel(string VisitId, string Reason) : VisitMsg(VisitId) { public override string T => "cross.cancel"; }
    public sealed record VisitHeartbeat(string VisitId) : VisitMsg(VisitId) { public override string T => "visit.heartbeat"; }
    public sealed record VisitHeartbeatAck(string VisitId) : VisitMsg(VisitId) { public override string T => "visit.heartbeat.ack"; }
    public sealed record VisitReturnRequest(string VisitId) : VisitMsg(VisitId) { public override string T => "visit.return.request"; }
    public sealed record VisitReturn(string VisitId) : VisitMsg(VisitId) { public override string T => "visit.return"; }
    public sealed record VisitComplete(string VisitId, VisitMemory? Memory) : VisitMsg(VisitId) { public override string T => "visit.complete"; }

    public sealed record Envelope(int V, string Id, string From, string To, double At, Msg Msg);

    public static class Protocol
    {
        public const int Version = 1;
        public const int MaxEnvelopeBytes = 8 * 1024;

        internal static readonly Dictionary<string, Type> Types = new Dictionary<string, Type>
        {
            ["presence.hello"] = typeof(PresenceHello),
            ["presence.bye"] = typeof(PresenceBye),
            ["clock.ping"] = typeof(ClockPing),
            ["clock.pong"] = typeof(ClockPong),
            ["visit.invite"] = typeof(VisitInvite),
            ["visit.accept"] = typeof(VisitAccept),
            ["visit.decline"] = typeof(VisitDecline),
            ["cross.prepare"] = typeof(CrossPrepare),
            ["cross.ready"] = typeof(CrossReady),
            ["cross.start"] = typeof(CrossStart),
            ["cross.commit"] = typeof(CrossCommit),
            ["cross.cancel"] = typeof(CrossCancel),
            ["visit.heartbeat"] = typeof(VisitHeartbeat),
            ["visit.heartbeat.ack"] = typeof(VisitHeartbeatAck),
            ["visit.return.request"] = typeof(VisitReturnRequest),
            ["visit.return"] = typeof(VisitReturn),
            ["visit.complete"] = typeof(VisitComplete),
        };

        /// <summary>camelCase properties, lowercase enum strings, explicit nulls: the web client's JSON exactly.</summary>
        public static readonly JsonSerializerOptions Json = CreateOptions();

        private static JsonSerializerOptions CreateOptions()
        {
            var o = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                PropertyNameCaseInsensitive = true,
                DefaultIgnoreCondition = JsonIgnoreCondition.Never,
                NumberHandling = JsonNumberHandling.Strict,
            };
            o.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: false));
            o.Converters.Add(new MsgConverter());
            return o;
        }

        public static string Serialize(Envelope e) => JsonSerializer.Serialize(e, Json);

        private static bool IsStr(JsonElement o, string name, int max = 64)
        {
            if (!o.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return false;
            int n = v.GetString()!.Length;
            return n > 0 && n <= max;
        }

        private static bool IsNum(JsonElement o, string name) =>
            o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) && !double.IsNaN(d) && !double.IsInfinity(d);

        private static bool ValidVisitor(JsonElement m)
        {
            if (!m.TryGetProperty("visitor", out var x) || x.ValueKind != JsonValueKind.Object) return false;
            return IsStr(x, "kinId") && IsNum(x, "seed") && IsStr(x, "name", 24) && IsNum(x, "hue")
                && x.TryGetProperty("traits", out var t) && t.ValueKind == JsonValueKind.Object;
        }

        /// <summary>Schema check at every ingress. Unknown, oversized or malformed envelopes are dropped (null).</summary>
        public static Envelope? Parse(string raw)
        {
            if (raw.Length > MaxEnvelopeBytes) return null;
            try
            {
                using var doc = JsonDocument.Parse(raw);
                return Parse(doc.RootElement);
            }
            catch (JsonException)
            {
                return null;
            }
        }

        public static Envelope? Parse(JsonElement e)
        {
            if (e.ValueKind != JsonValueKind.Object) return null;
            if (!e.TryGetProperty("v", out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetInt32(out var vi) || vi != Version) return null;
            if (!IsStr(e, "id") || !IsStr(e, "from") || !IsStr(e, "to") || !IsNum(e, "at")) return null;
            if (!e.TryGetProperty("msg", out var m) || m.ValueKind != JsonValueKind.Object) return null;
            if (!m.TryGetProperty("t", out var tt) || tt.ValueKind != JsonValueKind.String || !Types.ContainsKey(tt.GetString()!)) return null;
            string t = tt.GetString()!;
            if (m.TryGetProperty("visitId", out _) && !IsStr(m, "visitId")) return null;
            if (typeof(VisitMsg).IsAssignableFrom(Types[t]) && !IsStr(m, "visitId")) return null;
            if (t == "cross.start")
            {
                if (!IsNum(m, "startAt") || !m.TryGetProperty("seam", out var seam) || seam.ValueKind != JsonValueKind.Object) return null;
                if (!seam.TryGetProperty("from", out var from) || from.ValueKind != JsonValueKind.Object || !IsNum(from, "x") || !IsNum(from, "y")) return null;
            }
            if ((t == "visit.invite" || t == "cross.prepare") && !ValidVisitor(m)) return null;
            if (t == "presence.hello")
            {
                if (!m.TryGetProperty("info", out var info) || info.ValueKind != JsonValueKind.Object || !IsStr(info, "peer") || !IsStr(info, "name", 24)) return null;
            }
            try
            {
                return e.Deserialize<Envelope>(Json);
            }
            catch (Exception ex) when (ex is JsonException || ex is NotSupportedException || ex is InvalidOperationException || ex is ArgumentException)
            {
                return null; // passed the shape check but had a wrong type deeper in: drop it
            }
        }
    }

    /// <summary>
    /// Reads/writes <see cref="Msg"/> with "t" as the discriminator, written first and read from any
    /// position (JS objects don't promise key order across every client and relay).
    /// </summary>
    public sealed class MsgConverter : JsonConverter<Msg>
    {
        public override Msg? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            using var doc = JsonDocument.ParseValue(ref reader);
            var root = doc.RootElement;
            if (!root.TryGetProperty("t", out var t) || t.ValueKind != JsonValueKind.String || !Protocol.Types.TryGetValue(t.GetString()!, out var type))
                throw new JsonException("unknown message type");
            return (Msg?)root.Deserialize(type, options);
        }

        public override void Write(Utf8JsonWriter writer, Msg value, JsonSerializerOptions options)
        {
            var body = JsonSerializer.SerializeToNode(value, value.GetType(), options) as JsonObject ?? new JsonObject();
            writer.WriteStartObject();
            writer.WriteString("t", value.T);
            // Same key order as the web client's object literals: t, visitId, then the payload.
            if (value is VisitMsg vm) writer.WriteString("visitId", vm.VisitId);
            foreach (var kv in body)
            {
                if (kv.Key == "t" || (value is VisitMsg && kv.Key == "visitId")) continue;
                writer.WritePropertyName(kv.Key);
                if (kv.Value is null) writer.WriteNullValue();
                else kv.Value.WriteTo(writer, options);
            }
            writer.WriteEndObject();
        }
    }
}
