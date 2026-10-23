// The AI director's contract (port of src/ai/schema.ts), shared with the Worker: the client
// validates too. The model never drives the creature directly. It reads a small card and answers
// with one JSON object: a short inner thought, a mood, and ONE action picked from the creature's
// existing safe vocabulary. That is the blueprint's "unscripted selection atop scripted, safe
// actions", with no free-form tool calls and no consciousness claims.
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
    public sealed record CardTraits(double Curiosity, double Bravery, double Playfulness, double Warmth, double Energy);
    public sealed record CardDrives(double Energy, double Social, double Curious, double Comfort);
    public sealed record CardWeather(string Word, double TempC, double WindKmh);
    public sealed record CardMoment(string Kind, string Other, string Reaction);
    public sealed record CardFriend(string Name, double Meets);
    /// <summary>Who it is becoming (Personas.Card), as it travels: closed archetype list, short prose.</summary>
    public sealed record PersonaWire(string Title, IReadOnlyList<(Archetype a, double share)> Blend, string Style, IReadOnlyList<string> Why);

    /// <summary>TimeOfDay: dawn | morning | afternoon | evening | night. Recent moments are by alias only.</summary>
    public sealed record Card(
        string Name, string Temperament, CardTraits Traits, CardDrives Drives, CardWeather Weather, string TimeOfDay, string Doing,
        IReadOnlyList<CardMoment> Recent, IReadOnlyList<CardFriend> Friends, PersonaWire? Persona);

    public sealed record Thought(string Text, string Mood, string Act);
    public sealed record Answer(string Text, string Mood, string Act);
    public sealed record Analysis(string Becoming, string Reading, IReadOnlyList<string> Favorites, string Motto);
    public sealed record TopicCard(string Name, string Flavor, Deltas Weights, string Line);

    /// <summary>A validated value, or the reasons it was refused.</summary>
    public sealed class Checked<T> where T : class
    {
        public T? Value { get; }
        public IReadOnlyList<string> Errors { get; }
        public bool Ok => Value != null;
        public Checked(T? value, IReadOnlyList<string> errors)
        {
            Value = value;
            Errors = errors;
        }
    }

    public static class AiSchema
    {
        public static readonly IReadOnlyList<string> DirectorActs = new[] { "wander", "sit", "groom", "sleep", "play", "bask", "shelter", "idle" };
        public static readonly IReadOnlyList<string> Moods = new[] { "happy", "content", "curious", "sleepy", "shy", "cozy", "proud", "sassy", "excited" };
        private static readonly string[] TimesOfDay = { "dawn", "morning", "afternoon", "evening", "night" };

        // JS regexes without the u flag are ASCII-minded (\b, \d, \w): ECMAScript mode matches that.
        private const RegexOptions Js = RegexOptions.ECMAScript | RegexOptions.IgnoreCase;
        private static readonly Regex NameRe = new Regex(@"^[\p{L}\p{N} '’-]{1,16}\z");
        private static readonly Regex NotWord = new Regex(@"[^\p{L}\p{N} '’-]");
        private static readonly Regex NotProse = new Regex(@"[^\p{L}\p{N} .,;:%'’()×→!?-]");
        private static readonly Regex NotQuestion = new Regex(@"[^\p{L}\p{N} .,;:'’?!-]");
        private static readonly Regex Spaces = new Regex(@"\s+");
        private static readonly Regex Banned = new Regex(@"\b(i am (alive|conscious|real|sentient)|kill|die|hate|blood|address|phone number|password)\b", Js);
        /// <summary>Best-effort IP guard: KIN is original; no real franchises, brands or celebrities in its mouth.</summary>
        public static readonly Regex IpWords = new Regex(@"(pok[eé]mon|pikachu|minecraft|fortnite|roblox|mario|zelda|nintendo|playstation|xbox|disney|pixar|marvel|avengers|spider-?man|batman|superman|barbie|star wars|harry potter|taylor swift|beyonc[eé]|\bbts\b|nike|adidas|mcdonald|coca-?cola|\blego\b|youtube|tiktok|instagram|netflix)", Js);
        private static readonly Regex Urlish = new Regex(@"(https?:|www\.|\.com\b|@\w)", Js);
        private static readonly Regex Pii = new Regex(@"(https?:|www\.|@|\d{3}[\s.-]?\d{3}[\s.-]?\d{4}|\bpassword\b|\baddress\b|\bwhere do you live\b)", Js);
        private static readonly Regex TopicBanned = new Regex(@"(https?:|www\.|@|\d{3}[\s.-]?\d{3}[\s.-]?\d{4}|password|address|kill|blood|gun|drug|beer|wine|sex)", Js);
        private static readonly Regex JsonObj = new Regex(@"\{[\s\S]*\}");
        private static readonly Regex Fence = new Regex(@"```(?:json)?");

        private static string Cut(string s, int max) => s.Length > max ? s.Substring(0, max) : s;

        private static double N01(JsonElement? x) =>
            x is JsonElement e && e.ValueKind == JsonValueKind.Number && e.TryGetDouble(out var d) && !double.IsNaN(d) && !double.IsInfinity(d) ? Math.Max(0, Math.Min(1, d)) : 0.5;

        private static string Word(JsonElement? x, int max = 16) =>
            x is JsonElement e && e.ValueKind == JsonValueKind.String ? Cut(NotWord.Replace(e.GetString()!, ""), max) : "";

        private static string Prose(JsonElement? x, int max) =>
            x is JsonElement e && e.ValueKind == JsonValueKind.String ? Cut(Spaces.Replace(NotProse.Replace(e.GetString()!, ""), " ").Trim(), max) : "";

        /// <summary>JavaScript Number(x): numbers as-is, numeric strings parsed, null → 0, missing/other → NaN.</summary>
        private static double JsNumber(JsonElement? x)
        {
            if (x is not JsonElement e) return double.NaN;
            switch (e.ValueKind)
            {
                case JsonValueKind.Number: return e.GetDouble();
                case JsonValueKind.Null: return 0;
                case JsonValueKind.True: return 1;
                case JsonValueKind.False: return 0;
                case JsonValueKind.String:
                    var s = e.GetString()!.Trim();
                    if (s.Length == 0) return 0;
                    return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : double.NaN;
                default: return double.NaN;
            }
        }

        /// <summary>JS `x || fallback` for numbers: 0 and NaN fall back.</summary>
        private static double Or(double x, double fallback) => x == 0 || double.IsNaN(x) ? fallback : x;

        private static JsonElement? Prop(JsonElement? o, string name) =>
            o is JsonElement e && e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? v : (JsonElement?)null;

        /// <summary>Sanitise a card from an untrusted source. Only short names and numbers survive.</summary>
        public static Card? CleanCard(JsonElement c)
        {
            if (c.ValueKind != JsonValueKind.Object || Prop(c, "name") is not JsonElement name || name.ValueKind != JsonValueKind.String || !NameRe.IsMatch(name.GetString()!)) return null;
            var traits = Prop(c, "traits");
            var drives = Prop(c, "drives");
            var weather = Prop(c, "weather");
            string tod = Prop(c, "timeOfDay") is JsonElement t && t.ValueKind == JsonValueKind.String && TimesOfDay.Contains(t.GetString()) ? t.GetString()! : "afternoon";
            var recent = Prop(c, "recent") is JsonElement r && r.ValueKind == JsonValueKind.Array
                ? r.EnumerateArray().Take(4).Select((m) => new CardMoment(Word(Prop(m, "kind")), Word(Prop(m, "other")), Word(Prop(m, "reaction")))).ToList()
                : new List<CardMoment>();
            var friends = Prop(c, "friends") is JsonElement f && f.ValueKind == JsonValueKind.Array
                ? f.EnumerateArray().Take(3).Select((x) => new CardFriend(Word(Prop(x, "name")), Math.Max(0, Math.Min(999, Or(JsNumber(Prop(x, "meets")), 0))))).ToList()
                : new List<CardFriend>();
            return new Card(
                name.GetString()!,
                Word(Prop(c, "temperament")),
                new CardTraits(N01(Prop(traits, "curiosity")), N01(Prop(traits, "bravery")), N01(Prop(traits, "playfulness")), N01(Prop(traits, "warmth")), N01(Prop(traits, "energy"))),
                new CardDrives(N01(Prop(drives, "energy")), N01(Prop(drives, "social")), N01(Prop(drives, "curious")), N01(Prop(drives, "comfort"))),
                new CardWeather(Word(Prop(weather, "word"), 10), Math.Max(-50, Math.Min(60, Or(JsNumber(Prop(weather, "tempC")), 20))), Math.Max(0, Math.Min(200, Or(JsNumber(Prop(weather, "windKmh")), 0)))),
                tod,
                Word(Prop(c, "doing")),
                recent,
                friends,
                CleanPersona(Prop(c, "persona")));
        }

        /// <summary>The persona as sent by a client: archetypes from the closed list, short plain prose only.</summary>
        public static PersonaWire? CleanPersona(JsonElement? raw)
        {
            if (raw is not JsonElement p || p.ValueKind != JsonValueKind.Object) return null;
            var blend = new List<(Archetype, double)>();
            if (Prop(p, "blend") is JsonElement b && b.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in b.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Array || item.GetArrayLength() < 1) continue;
                    var first = item[0];
                    if (first.ValueKind != JsonValueKind.String || Personas.FromWire(first.GetString()) is not Archetype a) continue;
                    double s = item.GetArrayLength() > 1 ? JsNumber(item[1]) : double.NaN;
                    blend.Add((a, Math.Max(0, Math.Min(1, Or(s, 0)))));
                    if (blend.Count == 3) break;
                }
            }
            var why = Prop(p, "why") is JsonElement w && w.ValueKind == JsonValueKind.Array
                ? w.EnumerateArray().Take(3).Select((x) => Prose(x, 80)).Where((x) => x.Length > 0).ToList()
                : new List<string>();
            string title = Prose(Prop(p, "title"), 32);
            return new PersonaWire(title.Length > 0 ? title : "Little One", blend, Prose(Prop(p, "style"), 320), why);
        }

        /// <summary>One gate for every line a model writes before a player sees it. Null if it's fine.</summary>
        public static string? UnsafeText(string t)
        {
            if (Banned.IsMatch(t)) return "breaks the house rules";
            if (IpWords.IsMatch(t)) return "names a real brand or franchise";
            if (Urlish.IsMatch(t)) return "contains a link";
            return null;
        }

        private static JsonElement? PickJson(string text)
        {
            var m = JsonObj.Match(Fence.Replace(text, ""));
            if (!m.Success) return null;
            try
            {
                using var doc = JsonDocument.Parse(m.Value);
                return doc.RootElement.Clone();
            }
            catch (JsonException)
            {
                return null;
            }
        }

        private static string Tidy(JsonElement? x) => x is JsonElement e && e.ValueKind == JsonValueKind.String ? Spaces.Replace(e.GetString()!, " ").Trim() : "";

        private static void CheckMoodAct(JsonElement j, List<string> errors)
        {
            if (!(Prop(j, "mood") is JsonElement mo && mo.ValueKind == JsonValueKind.String && Moods.Contains(mo.GetString()))) errors.Add("mood must be one of " + string.Join(", ", Moods));
            if (!(Prop(j, "act") is JsonElement ac && ac.ValueKind == JsonValueKind.String && DirectorActs.Contains(ac.GetString()))) errors.Add("act must be one of " + string.Join(", ", DirectorActs));
        }

        /// <summary>Pull the JSON object out of a model's answer (tolerating code fences or a lead-in) and check it.</summary>
        public static Checked<Thought> ParseThought(string text)
        {
            var m = JsonObj.Match(Fence.Replace(text, ""));
            if (!m.Success) return new Checked<Thought>(null, new[] { "no JSON object" });
            JsonElement j;
            try
            {
                using var doc = JsonDocument.Parse(m.Value);
                j = doc.RootElement.Clone();
            }
            catch (JsonException)
            {
                return new Checked<Thought>(null, new[] { "not valid JSON" });
            }
            var errors = new List<string>();
            string thought = Tidy(Prop(j, "thought"));
            if (thought.Length == 0 || thought.Length > 140) errors.Add("thought must be 1–140 characters");
            var bad = UnsafeText(thought);
            if (bad != null) errors.Add("thought " + bad);
            CheckMoodAct(j, errors);
            return errors.Count > 0
                ? new Checked<Thought>(null, errors)
                : new Checked<Thought>(new Thought(thought, Prop(j, "mood")!.Value.GetString()!, Prop(j, "act")!.Value.GetString()!), errors);
        }

        public static Checked<Answer> ParseAnswer(string text)
        {
            if (PickJson(text) is not JsonElement j) return new Checked<Answer>(null, new[] { "no JSON object" });
            var errors = new List<string>();
            string answer = Tidy(Prop(j, "answer"));
            if (answer.Length == 0 || answer.Length > 160) errors.Add("answer must be 1–160 characters");
            var bad = answer.Length > 0 ? UnsafeText(answer) : null;
            if (bad != null) errors.Add("answer " + bad);
            CheckMoodAct(j, errors);
            return errors.Count > 0
                ? new Checked<Answer>(null, errors)
                : new Checked<Answer>(new Answer(answer, Prop(j, "mood")!.Value.GetString()!, Prop(j, "act")!.Value.GetString()!), errors);
        }

        public static Checked<Analysis> ParseAnalysis(string text)
        {
            if (PickJson(text) is not JsonElement j) return new Checked<Analysis>(null, new[] { "no JSON object" });
            var errors = new List<string>();
            string becoming = Tidy(Prop(j, "becoming"));
            string reading = Tidy(Prop(j, "reading"));
            string motto = Tidy(Prop(j, "motto"));
            var favorites = Prop(j, "favorites") is JsonElement f && f.ValueKind == JsonValueKind.Array
                ? f.EnumerateArray().Select((x) => Tidy(x)).Where((x) => x.Length > 0 && x.Length <= 32).Take(3).ToList()
                : new List<string>();
            if (becoming.Length == 0 || becoming.Length > 48) errors.Add("becoming must be 1–48 characters");
            if (reading.Length == 0 || reading.Length > 440) errors.Add("reading must be 1–440 characters");
            if (motto.Length == 0 || motto.Length > 90) errors.Add("motto must be 1–90 characters");
            foreach (var t in new[] { becoming, reading, motto }.Concat(favorites))
            {
                var bad = t.Length > 0 ? UnsafeText(t) : null;
                if (bad != null)
                {
                    errors.Add("text " + bad);
                    break;
                }
            }
            return errors.Count > 0 ? new Checked<Analysis>(null, errors) : new Checked<Analysis>(new Analysis(becoming, reading, favorites, motto), errors);
        }

        /// <summary>A player's question: plain words, at most 120 characters, no links or personal details.</summary>
        public static string? CleanQuestion(string? raw)
        {
            if (raw == null || Pii.IsMatch(raw)) return null;
            string q = Cut(Spaces.Replace(NotQuestion.Replace(raw, " "), " ").Trim(), 120);
            return q.Length >= 2 ? q : null;
        }

        /// <summary>A player's topic: a few plain words, or null if it isn't suitable.</summary>
        public static string? CleanTopic(string? raw)
        {
            if (raw == null || TopicBanned.IsMatch(raw)) return null;
            string t = Cut(Spaces.Replace(NotWord.Replace(raw, " "), " ").Trim(), 40);
            return t.Length >= 2 ? t : null;
        }

        /// <summary>Validate a topic snack card; weights are re-scaled so one snack is worth about 0.03 of personality.</summary>
        public static TopicCard? ValidTopicCard(JsonElement c)
        {
            if (c.ValueKind != JsonValueKind.Object) return null;
            if (!(Prop(c, "name") is JsonElement n && n.ValueKind == JsonValueKind.String) || !(Prop(c, "flavor") is JsonElement fl && fl.ValueKind == JsonValueKind.String)) return null;
            if (!(Prop(c, "weights") is JsonElement w && w.ValueKind == JsonValueKind.Object)) return null;
            string name = Tidy(n), flavor = Tidy(fl), line = Tidy(Prop(c, "line"));
            if (name.Length == 0 || name.Length > 28 || flavor.Length == 0 || flavor.Length > 90 || line.Length > 90) return null;
            if (TopicBanned.IsMatch(name + flavor + line) || UnsafeText(name + " " + flavor + " " + line) != null) return null;
            var kept = new List<(Archetype a, double v)>();
            double sum = 0;
            foreach (var a in Personas.Archetypes)
            {
                double v = JsNumber(Prop(w, Personas.Wire(a)));
                if (!double.IsNaN(v) && !double.IsInfinity(v) && v > 0)
                {
                    double x = Math.Min(1, v);
                    kept.Add((a, x));
                    sum += x;
                }
            }
            if (sum == 0) return null;
            var weights = new Deltas();
            foreach (var (a, v) in kept) weights.Set(a, Rng.JsRound(v / sum * 0.03 * 1000) / 1000);
            string lower = name.ToLowerInvariant();
            return new TopicCard(lower, flavor, weights, line.Length > 0 ? line : "Mm, " + lower + "!");
        }

        public static Checked<TopicCard> ParseSnack(string text)
        {
            var j = PickJson(text);
            var v = j is JsonElement e ? ValidTopicCard(e) : null;
            return v != null ? new Checked<TopicCard>(v, Array.Empty<string>()) : new Checked<TopicCard>(null, new[] { j != null ? "snack card did not pass the rules" : "no JSON object" });
        }

        /// <summary>Offline / refused fallback: a deterministic local thought, so the feature never dead-ends.</summary>
        public static Thought LocalThought(Card c, RandomStream r)
        {
            bool cold = c.Weather.TempC < 6;
            bool wet = c.Weather.Word == "rainy" || c.Weather.Word == "snowy";
            bool night = c.TimeOfDay == "night";
            string? friend = c.Friends.Count > 0 ? c.Friends[0].Name : null;
            var pool = new[]
            {
                night ? new Thought("The plant is glowing. I think the stars are doing the same.", "sleepy", "sleep")
                      : new Thought("That ball has been looking at me. I will look back. Then pounce.", "happy", "play"),
                wet ? new Thought("Pitter-patter on the mushroom. Very cozy under here.", "cozy", "shelter")
                    : new Thought("Warm spot found. Not moving. Possibly ever.", "content", "bask"),
                cold ? new Thought("My ears are cold. My ears are always the first to know.", "shy", "shelter")
                     : new Thought("What is past the edge of the garden today, I wonder.", "curious", "wander"),
                !string.IsNullOrEmpty(friend) ? new Thought("I keep thinking about " + friend + ". We should hop over again.", "happy", "wander")
                       : new Thought("Grooming my ears so they are perfect for whoever visits.", "content", "groom"),
            };
            return pool[(int)Math.Floor(r() * pool.Length)];
        }

        /// <summary>Offline / refused fallback for "ask it something", in the voice of its strongest archetype.</summary>
        public static Answer LocalAnswer(Card c, RandomStream r)
        {
            if (c.Persona != null && c.Persona.Blend.Count > 0)
            {
                return c.Persona.Blend[0].a switch
                {
                    Archetype.Scholar => new Answer("Ooh, a good question! I will have to read about that under the mushroom.", "curious", "sit"),
                    Archetype.Gamer => new Answer("Hmm, that is a boss-level question. Let me grind some thinking points.", "excited", "play"),
                    Archetype.Athlete => new Answer("Great question! Let me think about it on a quick lap.", "excited", "wander"),
                    Archetype.Popstar => new Answer("A question for *me*? I am honoured. Let me think about it in my best pose.", "proud", "bask"),
                    Archetype.Brat => new Answer("Hmph. Maybe I know. Maybe I don't. Ask me again after a snack.", "sassy", "sit"),
                    Archetype.Royal => new Answer("A most worthy question. We shall ponder it with great dignity.", "proud", "groom"),
                    Archetype.Explorer => new Answer("I don't know yet. Let's go find out!", "curious", "wander"),
                    _ => new Answer("I don't know, but it makes me want to draw something.", "content", "idle"),
                };
            }
            var pool = new[]
            {
                new Answer("Hmm! I'm only little, but I think about that a lot.", "curious", "sit"),
                new Answer("I don't know! Can we find out together?", "happy", "wander"),
            };
            return pool[(int)Math.Floor(r() * pool.Length)];
        }

        private static readonly (Archetype a, Regex re)[] TopicLexicon =
        {
            (Archetype.Scholar, new Regex("(space|planet|star|science|history|book|math|ocean|dinosaur|fact|robot)", Js)),
            (Archetype.Athlete, new Regex("(ball|sport|run|race|swim|soccer|football|basketball|tennis|team)", Js)),
            (Archetype.Gamer, new Regex("(game|level|quest|pixel|arcade|puzzle|boss|score)", Js)),
            (Archetype.Popstar, new Regex("(music|song|dance|stage|fashion|style|party|sing)", Js)),
            (Archetype.Royal, new Regex("(king|queen|crown|castle|tea|palace|jewel)", Js)),
            (Archetype.Explorer, new Regex("(mountain|forest|travel|camp|map|island|cave|treasure|adventure)", Js)),
            (Archetype.Artist, new Regex("(draw|paint|color|colour|art|craft|poem|story)", Js)),
            (Archetype.Brat, new Regex("(sour|spicy|drama)", Js)),
        };

        /// <summary>Offline fallback: a topic snack from a small keyword map.</summary>
        public static TopicCard LocalTopicCard(string topic)
        {
            var hit = Archetype.Explorer;
            foreach (var (a, re) in TopicLexicon)
            {
                if (re.IsMatch(topic))
                {
                    hit = a;
                    break;
                }
            }
            string t = topic.ToLowerInvariant();
            return new TopicCard(t.Split(' ')[0] + " cookie", "Baked with a pinch of " + t + ".", Deltas.Of((hit, 0.03)), "It tastes like " + t + "!");
        }

        /// <summary>The card as the client sends it to /kin/api/think, /ask and /analyze (the server re-sanitises).</summary>
        public static string ToJson(Card c)
        {
            var o = new JsonObject
            {
                ["name"] = c.Name,
                ["temperament"] = c.Temperament,
                ["traits"] = new JsonObject { ["curiosity"] = c.Traits.Curiosity, ["bravery"] = c.Traits.Bravery, ["playfulness"] = c.Traits.Playfulness, ["warmth"] = c.Traits.Warmth, ["energy"] = c.Traits.Energy },
                ["drives"] = new JsonObject { ["energy"] = c.Drives.Energy, ["social"] = c.Drives.Social, ["curious"] = c.Drives.Curious, ["comfort"] = c.Drives.Comfort },
                ["weather"] = new JsonObject { ["word"] = c.Weather.Word, ["tempC"] = c.Weather.TempC, ["windKmh"] = c.Weather.WindKmh },
                ["timeOfDay"] = c.TimeOfDay,
                ["doing"] = c.Doing,
                ["recent"] = new JsonArray(c.Recent.Select((m) => (JsonNode)new JsonObject { ["kind"] = m.Kind, ["other"] = m.Other, ["reaction"] = m.Reaction }).ToArray()),
                ["friends"] = new JsonArray(c.Friends.Select((f) => (JsonNode)new JsonObject { ["name"] = f.Name, ["meets"] = f.Meets }).ToArray()),
            };
            if (c.Persona != null)
            {
                o["persona"] = new JsonObject
                {
                    ["title"] = c.Persona.Title,
                    ["blend"] = new JsonArray(c.Persona.Blend.Select((b) => (JsonNode)new JsonArray(Personas.Wire(b.a), b.share)).ToArray()),
                    ["style"] = c.Persona.Style,
                    ["why"] = new JsonArray(c.Persona.Why.Select((w) => (JsonNode?)w).ToArray()),
                };
            }
            return o.ToJsonString();
        }
    }
}
