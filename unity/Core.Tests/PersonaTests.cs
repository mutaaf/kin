// Port of tests/persona.test.ts.
using System;
using System.Linq;
using System.Text.Json;
using Kin.Core;
using Xunit;

namespace Kin.Core.Tests
{
    public class PersonaTests
    {
        private const double Day = 86_400_000;
        private static readonly double T0 = new DateTimeOffset(2026, 10, 23, 12, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();
        private static Persona Fresh() => Personas.New(Genomes.MakeTraits(7), T0);

        private static Persona FeedFor(Persona p, Archetype a, int days, int perDay = 6)
        {
            for (int d = 0; d < days; d++)
                for (int i = 0; i < perDay; i++)
                    p = Personas.Apply(p, new Experience.Fed(Personas.Wire(a), Deltas.Of((a, 0.03)), Personas.Wire(a) + " snack"), T0 + d * Day + i * 60_000);
            return p;
        }

        [Fact]
        public void StartsAsALittleOneLeaningSlightlyOnItsOwnTraits()
        {
            var p = Fresh();
            Assert.Equal("Little One", Personas.Title(p));
            foreach (var a in Personas.Archetypes) Assert.True(p.Levels[a] < 0.1);
        }

        [Fact]
        public void GrowsGradually()
        {
            var p = Personas.Apply(Fresh(), new Experience.Fed("trivia-tart", Deltas.Of((Archetype.Scholar, 0.03))), T0);
            Assert.True(p.Levels[Archetype.Scholar] < 0.12);
            p = FeedFor(p, Archetype.Scholar, 7);
            Assert.True(p.Levels[Archetype.Scholar] > 0.45);
            Assert.Equal(Archetype.Scholar, Personas.Dominant(p));
            Assert.Contains("Scholar", Personas.Title(p));
        }

        [Fact]
        public void CapsGrowthPerDay() => Assert.True(FeedFor(Fresh(), Archetype.Royal, 1, 50).Levels[Archetype.Royal] < 0.25);

        [Fact]
        public void ASportyBratIsANormalOutcome()
        {
            var p = FeedFor(FeedFor(Fresh(), Archetype.Brat, 6), Archetype.Athlete, 4, 4);
            var b = Personas.Blend(p);
            Assert.Equal(Archetype.Brat, b[0].a);
            Assert.Equal(Archetype.Athlete, b[1].a);
            Assert.Equal("Sporty Brat", Personas.Title(p));
            Assert.Matches("Brat.*Athlete|Athlete.*Brat", Personas.DialogueStyle(p));
        }

        [Fact]
        public void StaysBoundedAndRelaxesTowardItsOwnNature()
        {
            var p = FeedFor(Fresh(), Archetype.Gamer, 20, 12);
            foreach (var a in Personas.Archetypes) Assert.True(p.Levels[a] <= 1);
            double high = p.Levels[Archetype.Gamer];
            p = Personas.Settle(p, T0 + 120 * Day);
            Assert.True(p.Levels[Archetype.Gamer] < high * 0.7);
            Assert.True(p.Levels[Archetype.Gamer] >= p.Base[Archetype.Gamer] - 1e-9);
        }

        [Fact]
        public void ASteeredArchetypeGrowsFasterAndDoesNotFade()
        {
            var p = Personas.Apply(Fresh(), new Experience.SteerTo(Archetype.Artist), T0);
            p = FeedFor(p, Archetype.Artist, 5);
            double lv = p.Levels[Archetype.Artist];
            p = Personas.Settle(p, T0 + 60 * Day);
            Assert.Equal(lv, p.Levels[Archetype.Artist]);
        }

        [Fact]
        public void ANightOwlLeansGamer()
        {
            var p = Fresh();
            for (int i = 1; i <= 60; i++) p = Personas.Settle(p, T0 + i * 10 * 60_000, hour: 23, active: true);
            Assert.True(p.Levels[Archetype.Gamer] > Fresh().Levels[Archetype.Gamer]);
            Assert.Contains("stays up late", string.Join(" ", Personas.Why(p)));
        }

        [Fact]
        public void ExplainsItselfAndClassifiesTalk()
        {
            var p = FeedFor(Fresh(), Archetype.Popstar, 3);
            p = Personas.Apply(p, new Experience.Talk("can you sing me a song about the stage?"), T0 + 3 * Day);
            Assert.Matches("ate popstar snack.*Pop Star", Personas.Why(p)[0]);
            Assert.Contains(Archetype.Scholar, Personas.Classify("What planet is the biggest?"));
            Assert.Contains(Archetype.Gamer, Personas.Classify("let us play a game"));
        }

        [Fact]
        public void ExposesExpressionHooks()
        {
            var ex = Personas.Express(FeedFor(Fresh(), Archetype.Royal, 12));
            Assert.Equal(Archetype.Royal, ex.Dominant);
            Assert.Contains("crown-tiny", ex.Accessories.Select((a) => a.Id));
            Assert.Equal("royal", ex.Speech);
            Assert.True(ex.Voice.Tempo < 1);
        }

        [Fact]
        public void IsDeterministicAndSurvivesStorageRoundTripsAndJunk()
        {
            var a = FeedFor(Fresh(), Archetype.Explorer, 4);
            var b = FeedFor(Fresh(), Archetype.Explorer, 4);
            Assert.Equal(Personas.ToJson(a), Personas.ToJson(b));
            Assert.Equal(Personas.ToJson(a), Personas.ToJson(Personas.Revive(Personas.ToJson(a), Genomes.MakeTraits(7), T0 + 5 * Day)));
            var junk = Personas.Revive("{\"v\":1,\"levels\":{\"scholar\":9,\"nope\":3},\"steer\":\"evil\"}", Genomes.MakeTraits(7), T0);
            Assert.Equal(1, junk.Levels[Archetype.Scholar]);
            Assert.Null(junk.Steer);
            Assert.Equal("Little One", Personas.Title(Personas.Revive("garbage", Genomes.MakeTraits(7), T0)));
        }

        [Fact]
        public void NeverMovesOnNonFiniteOrUnknownDeltas()
        {
            var p = Fresh();
            var deltas = new Deltas { new System.Collections.Generic.KeyValuePair<string, double>("scholar", double.NaN), new System.Collections.Generic.KeyValuePair<string, double>("wizard", 0.5) };
            var q = Personas.Grow(p, deltas, "x", T0);
            foreach (var a in Personas.Archetypes) Assert.Equal(p.Levels[a], q.Levels[a]);
        }

        [Fact]
        public void TravelsToTheAiAsACleanCardFreeOfIp()
        {
            var card = Personas.Card(FeedFor(Fresh(), Archetype.Popstar, 6));
            var c = new Card("Lumi", "playful", new CardTraits(0.5, 0.5, 0.5, 0.5, 0.5), new CardDrives(0.5, 0.5, 0.5, 0.5), new CardWeather("sunny", 20, 5), "afternoon", "sit",
                Array.Empty<CardMoment>(), Array.Empty<CardFriend>(), new PersonaWire(card.Title, card.Blend, card.Style, card.Why));
            // Add an unknown archetype the way a hostile client might, and clean it like the server does.
            var json = AiSchema.ToJson(c).Replace("\"blend\":[", "\"blend\":[[\"wizard\",1],");
            var clean = AiSchema.CleanCard(JsonDocument.Parse(json).RootElement)!;
            Assert.Contains("Pop Star", clean.Persona!.Title);
            Assert.All(clean.Persona.Blend, (b) => Assert.Contains(b.a, Personas.Archetypes));
            Assert.False(AiSchema.IpWords.IsMatch(json));
        }
    }
}
