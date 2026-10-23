// Interop: a Unity client and a web client must be able to cross with each other through the
// Cloudflare relay. Golden envelopes in the fixture were produced by the real TS state machines
// during a full crossing; the C# side must parse every one and re-emit the same JSON value.
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Kin.Core;
using Xunit;

namespace Kin.Core.Tests
{
    public class ProtocolTests
    {
        private static readonly JsonElement Ref = JsonDocument.Parse(File.ReadAllText(Path.Combine(System.AppContext.BaseDirectory, "Fixtures", "ts-reference.json"))).RootElement;

        [Fact]
        public void ParsesEveryEnvelopeTheWebClientSendsAndReEmitsTheSameJson()
        {
            var wire = Ref.GetProperty("wire").EnumerateArray().Select((x) => x.GetString()!).ToList();
            Assert.True(wire.Count >= 13);
            foreach (var w in wire)
            {
                var e = Protocol.Parse(w);
                Assert.True(e != null, "rejected: " + w);
                string back = Protocol.Serialize(e!);
                Assert.True(JsonNode.DeepEquals(JsonNode.Parse(w), JsonNode.Parse(back)), w + "\n  vs\n" + back);
            }
        }

        [Fact]
        public void WritesTheDiscriminatorFirstAndKeyOrderMatchesTheWebClient()
        {
            var wire = Ref.GetProperty("wire").EnumerateArray().Select((x) => x.GetString()!).ToList();
            foreach (var w in wire) Assert.Equal(w, Protocol.Serialize(Protocol.Parse(w)!));
        }

        [Fact]
        public void TypedMessagesComeBackTyped()
        {
            var start = Ref.GetProperty("wire").EnumerateArray().Select((x) => x.GetString()!).First((w) => w.Contains("\"cross.start\""));
            var e = Protocol.Parse(start)!;
            var m = Assert.IsType<CrossStart>(e.Msg);
            Assert.Equal(Edge.Right, m.Edge);
            Assert.Equal(330.5, m.Seam.From.X);
            Assert.Equal(1730000000462.5, m.StartAt); // fractional epoch ms survive (clock offsets are not integers)
        }

        [Fact]
        public void AcceptsTheDiscriminatorInAnyPosition()
        {
            const string json = "{\"msg\":{\"visitId\":\"v\",\"reason\":\"stale\",\"t\":\"cross.cancel\"},\"at\":5,\"to\":\"b\",\"from\":\"a\",\"id\":\"m\",\"v\":1}";
            var e = Protocol.Parse(json)!;
            Assert.Equal("stale", Assert.IsType<CrossCancel>(e.Msg).Reason);
        }

        [Fact]
        public void NullMemoryIsWrittenExplicitly()
        {
            var e = new Envelope(1, "m_1", "b", "a", 10, new VisitComplete("gone", null));
            Assert.Equal("{\"v\":1,\"id\":\"m_1\",\"from\":\"b\",\"to\":\"a\",\"at\":10,\"msg\":{\"t\":\"visit.complete\",\"visitId\":\"gone\",\"memory\":null}}", Protocol.Serialize(e));
        }

        [Theory]
        [InlineData("not json")]
        [InlineData("{\"v\":2,\"id\":\"m\",\"from\":\"a\",\"to\":\"b\",\"at\":1,\"msg\":{\"t\":\"presence.bye\"}}")]
        [InlineData("{\"v\":1,\"id\":\"m\",\"from\":\"a\",\"to\":\"b\",\"at\":1,\"msg\":{\"t\":\"wat\"}}")]
        [InlineData("{\"v\":1,\"id\":\"m\",\"from\":\"a\",\"to\":\"b\",\"at\":1,\"msg\":{\"t\":\"visit.accept\"}}")]
        [InlineData("{\"v\":1,\"id\":\"m\",\"from\":\"a\",\"to\":\"b\",\"at\":1,\"msg\":{\"t\":\"visit.accept\",\"visitId\":7}}")]
        [InlineData("{\"v\":1,\"id\":\"m\",\"from\":\"a\",\"to\":\"b\",\"at\":1,\"msg\":{\"t\":\"cross.start\",\"visitId\":\"v\",\"startAt\":1,\"edge\":\"right\",\"seam\":{\"rect\":null}}}")]
        [InlineData("{\"v\":1,\"id\":\"m\",\"from\":\"a\",\"to\":\"b\",\"at\":1,\"msg\":{\"t\":\"visit.invite\",\"visitId\":\"v\",\"visitor\":{\"kinId\":\"k\",\"seed\":1,\"name\":\"\",\"hue\":1,\"traits\":{}}}}")]
        [InlineData("{\"v\":1,\"id\":\"m\",\"from\":\"a\",\"to\":\"b\",\"at\":1,\"msg\":{\"t\":\"presence.hello\",\"info\":{\"peer\":\"p\",\"name\":\"a name that is far too long to pass\"}}}")]
        [InlineData("{\"v\":1,\"id\":\"\",\"from\":\"a\",\"to\":\"b\",\"at\":1,\"msg\":{\"t\":\"presence.bye\"}}")]
        public void RejectsMalformedEnvelopes(string json) => Assert.Null(Protocol.Parse(json));

        [Fact]
        public void RejectsOversizedEnvelopes()
        {
            string big = "{\"v\":1,\"id\":\"m\",\"from\":\"a\",\"to\":\"b\",\"at\":1,\"msg\":{\"t\":\"presence.bye\",\"pad\":\"" + new string('x', 9000) + "\"}}";
            Assert.Null(Protocol.Parse(big));
        }
    }
}
