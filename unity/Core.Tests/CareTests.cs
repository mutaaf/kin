// Port of tests/care.test.ts.
using System;
using System.Collections.Generic;
using System.Linq;
using Kin.Core;
using Xunit;

namespace Kin.Core.Tests
{
    public class CareTests
    {
        private const double H = 3_600_000;
        private static readonly CareEnv DayEnv = new CareEnv(40, 20, 0, false);
        private static readonly CareEnv NightEnv = new CareEnv(-20, 12, 0, false);

        [Fact]
        public void AMonthOfNeglectLeavesAHungrySleepyKinNeverBelowTheFloor()
        {
            var c = Care.New(0);
            for (int t = 1; t <= 30 * 24; t++) c = Care.Tick(c, t * H, t % 24 < 12 ? DayEnv : NightEnv, false).care;
            foreach (var n in Care.Needs) Assert.True(c[n] >= Care.NeedFloor);
            Assert.NotEmpty(Care.Wants(c));
            Assert.True(c.Plant.Size > 0.2); // the plant droops at worst, it never dies
        }

        [Fact]
        public void CapsCatchUpAt48Hours()
        {
            var a = Care.Tick(Care.New(0), 48 * H, DayEnv, false).care;
            var b = Care.Tick(Care.New(0), 400 * H, DayEnv, false).care;
            Assert.Equal(a.Needs, b.Needs);
        }

        [Fact]
        public void SleepRestoresRestAndRainCleansAndWaters()
        {
            var c0 = Care.Revive("{\"v\":1,\"needs\":{\"rest\":0.2,\"clean\":0.3},\"lastAt\":0}", 0);
            Assert.True(Care.Tick(c0, 3 * H, NightEnv, true).care[Need.Rest] > 0.8);
            var wet = Care.Tick(c0, 1 * H, DayEnv with { PrecipMm = 3 }, false).care;
            Assert.True(wet[Need.Clean] > 0.6);
            Assert.Equal(1, wet.Plant.Water);
        }

        [Fact]
        public void BerriesRipenUpToThreeAndOverripeOnesFall()
        {
            var c = Care.New(0);
            int fallen = 0;
            for (int t = 1; t <= 72; t++)
            {
                var r = Care.Tick(c, t * H, DayEnv, false);
                c = r.care;
                fallen += r.fallen;
            }
            Assert.True(c.Plant.Berries.Count <= 3);
            Assert.True(fallen > 0);
        }

        [Fact]
        public void APlantedWateredSeedBloomsInAboutTwoDays()
        {
            var c = Care.Collect(Care.New(0), 0, "seed-mint").Care;
            c = Care.PlantSeed(c, 0, 0, "seed-mint")!.Care;
            Assert.Equal(0, c.Collection["seed-mint"]);
            for (int t = 1; t <= 60; t++) c = Care.WaterPlot(Care.Tick(c, t * H, DayEnv, false).care, t * H, 0).Care;
            Assert.Equal(1, c.Plots[0].Growth);
        }

        [Fact]
        public void RefusesToPlantWhatYouDoNotHave()
        {
            Assert.Null(Care.PlantSeed(Care.New(0), 0, 0, "seed-moon"));
            Assert.Null(Care.PlantSeed(Care.Collect(Care.New(0), 0, "pebble-round").Care, 0, 0, "pebble-round"));
        }

        [Fact]
        public void BondLevelsAreInfiniteAndNamed()
        {
            var b0 = Care.BondLevel(0);
            Assert.Equal(1, b0.Level);
            Assert.Equal("New friends", b0.Name);
            var big = Care.BondLevel(5_000_000);
            Assert.True(big.Level > 40);
            Assert.StartsWith("Kindred", big.Name);
        }

        [Fact]
        public void XpHasDiminishingReturnsWithinAnHourNeverZero()
        {
            var c = Care.New(0);
            var xps = new List<double>();
            for (int i = 0; i < 12; i++)
            {
                var o = Care.Feed(c, 1000 + i);
                xps.Add(o.Xp);
                c = o.Care;
            }
            Assert.Equal(xps[0], xps[4]);
            Assert.True(xps[11] < xps[0]);
            Assert.True(xps[11] > 0);
            Assert.Equal(xps[0], Care.Feed(c, 2 * H).Xp); // next hour, full again
        }

        [Fact]
        public void TricksImproveWithPractice()
        {
            var c = Care.New(0);
            int early = 0, late = 0;
            for (int i = 0; i < 200; i++)
            {
                var o = Care.DoTrick(c, i * H, Trick.Sit, (i * 0.6180339) % 1);
                if (i < 20 && o.Success == true) early++;
                if (i >= 180 && o.Success == true) late++;
                c = o.Care;
            }
            Assert.True(c.Skill(Trick.Sit) > 0.9);
            Assert.True(late > early);
            Assert.Equal(200, c.Attempts[(int)Trick.Sit]);
        }

        [Fact]
        public void TricksUnlockWithTheBondAndGardenPlotsOpenUp()
        {
            var c = Care.New(0);
            Assert.True(Care.CanTeach(c, Trick.Sit));
            Assert.False(Care.CanTeach(c, Trick.Dance));
            var rich = Care.Revive("{\"v\":1,\"bondXp\":100000}", 0);
            Assert.True(Care.CanTeach(rich, Trick.Dance));
            Assert.True(Care.PlotCount(rich) > 3);
            Assert.Equal(Care.PlotCount(rich), Care.EnsurePlots(rich).Plots.Count);
        }

        [Fact]
        public void RevivesAnOldOrPartialSaveWithoutThrowing()
        {
            var r = Care.Revive("{\"v\":1,\"needs\":{\"fun\":0.2}}", 0);
            Assert.Equal(0.2, r[Need.Fun]);
            Assert.True(r[Need.Fullness] > 0);
            Assert.Equal(0.75, Care.Revive("\"garbage\"", 0)[Need.Fullness]);
            Assert.Equal(0.75, Care.Revive("not json", 0)[Need.Fullness]);
            var c = Care.Feed(Care.Collect(Care.New(0), 5, "shell-fan").Care, 6).Care;
            Assert.Equal(Care.ToJson(c), Care.ToJson(Care.Revive(Care.ToJson(c), 0)));
        }

        [Fact]
        public void SurprisesAndDigsAreStablePerDateAndKinAndDifferAcrossDays()
        {
            var d1 = new DateTime(2026, 10, 22);
            var d2 = new DateTime(2026, 10, 23);
            Assert.Equal(Care.SurprisesFor(d1, 7), Care.SurprisesFor(d1, 7));
            var all = Enumerable.Range(0, 20).Select((i) => string.Join(",", Care.SurprisesFor(new DateTime(2026, 1, 1 + i), 7))).ToHashSet();
            Assert.True(all.Count > 5);
            Assert.Equal(Care.Dig(d1, 7, 0, Season.Autumn), Care.Dig(d1, 7, 0, Season.Autumn));
            Assert.Null(Care.Dig(d2, 7, 9, Season.Autumn)); // a few finds a day keeps them special
        }

        [Fact]
        public void SeasonalItemsOnlyTurnUpInTheirSeason()
        {
            for (int i = 0; i < 300; i++)
            {
                var it = Care.Dig(new DateTime(2026, 7, 1 + (i % 28)), (uint)i, i % 4, Season.Summer);
                if (it?.Season != null) Assert.Equal(Season.Summer, it.Season);
            }
        }

        [Fact]
        public void SeasonsFlipInTheSouthernHemisphere()
        {
            Assert.Equal(Season.Winter, Care.SeasonOf(new DateTime(2026, 1, 10), 32));
            Assert.Equal(Season.Summer, Care.SeasonOf(new DateTime(2026, 1, 10), -33));
        }

        [Fact]
        public void TheCatalogueIsHonest()
        {
            Assert.Equal(Care.Catalog.Count, Care.Catalog.Select((c) => c.Id).Distinct().Count());
            Assert.Equal(new[] { 1, 2, 3, 4 }, Care.Catalog.Select((c) => c.Rarity).Distinct().OrderBy((x) => x));
        }
    }
}
