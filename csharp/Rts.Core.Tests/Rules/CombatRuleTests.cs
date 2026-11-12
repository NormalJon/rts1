// Translated from test/combat.test.ts. Keep the two in step.
//
// Where the TypeScript passes a saved game through JSON before loading it,
// the save is loaded as it is: the C# library has no JSON in it.

using Rts.Sim;

namespace Rts.Tests.Rules
{
    public abstract class CombatScenario : Scenario
    {
        protected const int S = Kind.Spearman;
        protected const int A = Kind.Archer;
        protected const int H = Kind.Horseman;
        protected const int V = Kind.Villager;

        // These tests are about fighting, not about seeing, so the map is revealed:
        // everyone can see everything. VisionRuleTests covers the fog.
        protected static World Open(int size = 40, Action<SimConfig> overrides = null)
        {
            return FlatWorld(size, config =>
            {
                config.mapState = MapState.Revealed;
                overrides?.Invoke(config);
            });
        }

        protected static World OpenFrom(string[] rows)
        {
            return WorldFrom(rows, config => config.mapState = MapState.Revealed);
        }

        protected static int Place(World world, int player, int kind, double x, double y)
        {
            return world.SpawnUnit(player, kind, F(x), F(y));
        }

        protected static int Hp(World world, int id) => world.IsAlive(id) ? world.hp[SlotOf(id)] : 0;

        protected static bool AtRest(World world, int id)
        {
            return world.moveState[SlotOf(id)] == MoveState.Idle && world.engaged[SlotOf(id)] == 0;
        }

        /// <summary>A number of seconds as ticks, to the nearest tick.</summary>
        protected static int Seconds(World world, double s) => (int)Math.Floor(s * world.config.tickRate + 0.5);

        /// <summary>A line of units running north to south.</summary>
        protected static int[] Line(World world, int player, int kind, int count, double x, double y)
        {
            var ids = new int[count];
            for (int i = 0; i < count; i++) ids[i] = Place(world, player, kind, x, y + (i - (count - 1) / 2.0) * 0.7);
            return ids;
        }
    }

    public class TheArithmeticOfABlow : CombatScenario
    {
        readonly World world;
        readonly int spear;
        readonly int archer;
        readonly int horse;
        readonly int villager;
        readonly int house;

        public TheArithmeticOfABlow()
        {
            world = Open();
            spear = One(S, 0);
            archer = One(A, 0);
            horse = One(H, 0);
            villager = One(V, 1);
            house = SlotOf(world.SpawnBuilding(1, Kind.House, 30, 30));
        }

        int One(int kind, int player) => SlotOf(Place(world, player, kind, 5 + kind, 5 + player * 3));

        [Fact]
        public void IsTheWeaponPlusItsBonusAgainstThatKindOfTargetLessArmour()
        {
            Assert.Equal(8, Combat.DamageOf(world, spear, villager, 0));
            Assert.Equal(8 + 16, Combat.DamageOf(world, spear, horse, 0));
            Assert.Equal(5 + 5, Combat.DamageOf(world, archer, spear, 0));
            Assert.Equal(5 - 2, Combat.DamageOf(world, archer, horse, 0)); // the rider's padding against arrows
            Assert.Equal(9 + 9, Combat.DamageOf(world, horse, archer, 0));
            Assert.Equal(9, Combat.DamageOf(world, horse, spear, 0));
            Assert.Equal(9 + 9 + 10, Combat.DamageOf(world, horse, archer, 10));
        }

        [Fact]
        public void NeverDoesLessThan1HoweverThickTheWalls()
        {
            Assert.Equal(1, Combat.DamageOf(world, archer, house, 0));
            Assert.Equal(1, Combat.DamageOf(world, villager, house, 0));
            Assert.Equal(4, Combat.DamageOf(world, spear, house, 0));
        }

        [Fact]
        public void GivesAQuarterMoreToArrowsShotFromHighGroundAndNothingToBlades()
        {
            World hill = Open();
            int up = SlotOf(Place(hill, 0, A, 10.5, 10.5));
            int down = SlotOf(Place(hill, 1, V, 14.5, 10.5));
            int spearUp = SlotOf(Place(hill, 0, S, 10.5, 10.5));
            Assert.Equal(5, Combat.DamageOf(hill, up, down, 0));
            // Raise the four corners of the archer's tile by a whole tile's height.
            foreach ((int cx, int cy) in new[] { (10, 10), (11, 10), (10, 11), (11, 11) }) hill.map.elevation[cy * 41 + cx] = Fixed.ONE;
            Assert.Equal(6, Combat.DamageOf(hill, up, down, 0));
            Assert.Equal(3, Combat.DamageOf(hill, down, up, 0));
            Assert.Equal(8, Combat.DamageOf(hill, spearUp, down, 0));
        }
    }

    public class AFight : CombatScenario
    {
        [Fact]
        public void BetweenTwoEqualSpearmenKillsBothAtTheSameMomentTenBlowsEach()
        {
            World world = Open();
            int a = Place(world, 0, S, 18, 20);
            int b = Place(world, 1, S, 22, 20);
            var hpSeen = new HashSet<int>();
            int ticks = Run(world, 1200, () =>
            {
                hpSeen.Add(Hp(world, a));
                return !world.IsAlive(a) || !world.IsAlive(b);
            });
            Assert.False(world.IsAlive(a));
            Assert.False(world.IsAlive(b));
            Assert.Equal(new[] { 80, 72, 64, 56, 48, 40, 32, 24, 16, 8, 0 }, hpSeen.OrderByDescending(h => h).ToArray());
            // Ten blows 1.75 seconds apart, the first landing half a second after they meet.
            Assert.True(ticks > Seconds(world, 9 * 1.75));
            Assert.True(ticks < Seconds(world, 9 * 1.75 + 4));
            Assert.Empty(world.LivingEntities());
        }

        [Fact]
        public void TakesABlowHalfASecondToLandAndTheNext175SecondsToFollow()
        {
            World world = Open();
            int a = Place(world, 0, S, 20, 20);
            int victim = Place(world, 1, V, 20.8, 20);
            var landed = new List<int>();
            int last = Hp(world, victim);
            Run(world, 200, () =>
            {
                if (Hp(world, victim) < last) landed.Add(world.tick);
                last = Hp(world, victim);
                return landed.Count == 3;
            });
            Assert.True(world.IsAlive(a));
            Assert.Equal(Seconds(world, 1.75), landed[1] - landed[0]);
            Assert.Equal(Seconds(world, 1.75), landed[2] - landed[1]);
        }

        /// <summary>Two sides march at each other. Returns how many of each are left when one side is gone.</summary>
        (int a, int b) Battle(int kindA, int countA, int kindB, int countB)
        {
            World world = Open(48);
            int[] a = Line(world, 0, kindA, countA, 18, 24);
            int[] b = Line(world, 1, kindB, countB, 30, 24);
            Send(world, 0, Command.AttackMove(a, F(30), F(24)));
            Send(world, 1, Command.AttackMove(b, F(18), F(24)));
            Run(world, 3600, () => world.LivingUnits(0).Count == 0 || world.LivingUnits(1).Count == 0);
            return (world.LivingUnits(0).Count, world.LivingUnits(1).Count);
        }

        [Fact]
        public void GoesToTheSpearmenAgainstTheSameCostInHorsemen()
        {
            // 480 resources a side.
            (int a, int b) left = Battle(S, 6, H, 4);
            Assert.Equal(0, left.b);
            Assert.True(left.a >= 4);
        }

        [Fact]
        public void GoesToTheHorsemenAgainstMoreThanTheirCostInArchers()
        {
            // 600 against 640.
            (int a, int b) left = Battle(H, 5, A, 8);
            Assert.Equal(0, left.b);
            Assert.True(left.a >= 4);
        }

        [Fact]
        public void GoesToTheArchersAgainstTheSameCostInSpearmen()
        {
            // 640 a side.
            (int a, int b) left = Battle(A, 8, S, 8);
            Assert.Equal(0, left.b);
            Assert.True(left.a >= 3);
        }

        [Fact]
        public void IsEvenBetweenEqualNumbersOfTheSameTroops()
        {
            (int a, int b) left = Battle(S, 20, S, 20);
            Assert.Equal(0, Math.Min(left.a, left.b));
            Assert.True(Math.Max(left.a, left.b) < 12);
        }
    }

    public class ASoldierLeftToItself : CombatScenario
    {
        [Fact]
        public void GoesForAnEnemyThatComesNearAndThenWalksBackToItsPost()
        {
            World world = Open();
            int guard = Place(world, 0, S, 10, 20);
            int intruder = Place(world, 1, V, 14, 20);
            Run(world, 900, () => !world.IsAlive(intruder));
            Assert.False(world.IsAlive(intruder));
            Assert.True(DistanceTo(world, guard, 10, 20) > 2);
            Run(world, 300, () => AtRest(world, guard));
            Assert.True(DistanceTo(world, guard, 10, 20) < 0.1);
            Assert.Equal(OrderKind.None, world.orderKind[SlotOf(guard)]);
            Assert.Equal(80, Hp(world, guard)); // villagers do not fight back unless told to
        }

        [Fact]
        public void DoesNotNoticeAnEnemyFurtherOffThanEightTiles()
        {
            World world = Open();
            int guard = Place(world, 0, S, 10, 20);
            Place(world, 1, V, 19, 20);
            Run(world, 200);
            Assert.Equal(0, DistanceTo(world, guard, 10, 20));
            Assert.Equal(World.NO_ENTITY, world.target[SlotOf(guard)]);
        }

        [Fact]
        public void GivesUpTheChaseTwelveTilesFromItsPostAndComesHome()
        {
            World world = Open(60);
            int guard = Place(world, 0, S, 10, 30);
            // A rider trots past and away, too fast to catch.
            int rider = Place(world, 1, H, 13, 26);
            Send(world, 1, Command.Move(Ids(rider), F(50), F(30)));
            double furthest = 0;
            bool chased = false;
            Run(world, 900, () =>
            {
                furthest = Math.Max(furthest, DistanceTo(world, guard, 10, 30));
                chased = chased || world.engaged[SlotOf(guard)] == 1;
                return chased && AtRest(world, guard);
            });
            Assert.True(chased);
            Assert.True(furthest > 1);
            Assert.True(furthest < 13);
            Assert.True(DistanceTo(world, guard, 10, 30) < 0.1);
            Assert.True(world.IsAlive(rider));
        }

        [Fact]
        public void ClosesWithAnArcherThatComesUpAndShootsAtIt()
        {
            World world = Open();
            int guard = Place(world, 0, S, 10, 20);
            int archer = Place(world, 1, A, 24, 20);
            Send(world, 1, Command.Attack(Ids(archer), guard));
            Run(world, 1500, () => !world.IsAlive(archer) || !world.IsAlive(guard));
            // It closes with the archer and gets some blows in before it falls.
            Assert.False(world.IsAlive(guard));
            Assert.True(Hp(world, archer) < 60);
        }

        [Fact]
        public void ComesToTheAidOfABuildingOfItsSideAttackedBeyondItsNoticeThenGoesHome()
        {
            World world = Open(48);
            int guard = Place(world, 0, S, 11.5, 20.5);
            world.SpawnBuilding(0, Kind.House, 20, 20);
            // The raider comes at the house from the far side, ten tiles from the guard.
            int raider = Place(world, 1, S, 30, 20.5);
            Send(world, 1, Command.Attack(Ids(raider), world.LivingEntities(0)[1]));
            double wentOut = 0;
            Run(world, 2400, () =>
            {
                wentOut = Math.Max(wentOut, DistanceTo(world, guard, 11.5, 20.5));
                return !world.IsAlive(raider);
            });
            Assert.False(world.IsAlive(raider));
            Assert.True(wentOut > 5);
            Run(world, 600, () => AtRest(world, guard));
            Assert.True(DistanceTo(world, guard, 11.5, 20.5) < 0.1);
        }

        [Fact]
        public void DoesNotHearACryForHelpFromFurtherOffThanEightTiles()
        {
            World world = Open(48);
            int guard = Place(world, 0, S, 8.5, 20.5);
            int house = world.SpawnBuilding(0, Kind.House, 20, 20);
            int raider = Place(world, 1, S, 30, 20.5);
            Send(world, 1, Command.Attack(Ids(raider), house));
            Run(world, 600, () => Hp(world, house) < 380);
            Assert.True(Hp(world, house) < 380);
            Assert.Equal(0, DistanceTo(world, guard, 8.5, 20.5));
        }

        [Fact]
        public void IsNotASoldierIfItIsAVillagerItIgnoresEnemiesAndDoesNotHitBack()
        {
            World world = Open();
            int villager = Place(world, 0, V, 10, 20);
            int enemy = Place(world, 1, V, 11, 20);
            Send(world, 1, Command.Attack(Ids(enemy), villager));
            Run(world, 400, () => Hp(world, villager) < 30);
            Assert.True(Hp(world, villager) < 30);
            Assert.Equal(50, Hp(world, enemy));
            Assert.Equal(World.NO_ENTITY, world.target[SlotOf(villager)]);
        }
    }

    public class OrdersAndEnemies : CombatScenario
    {
        [Fact]
        public void APlainMoveIgnoresTheEnemyAltogether()
        {
            World world = Open();
            int rider = Place(world, 0, H, 5, 20);
            int enemy = Place(world, 1, V, 15, 20.5);
            Send(world, 0, Command.Move(Ids(rider), F(30), F(20)));
            bool distracted = false;
            Run(world, 600, () =>
            {
                distracted = distracted || world.target[SlotOf(rider)] != World.NO_ENTITY;
                return world.moveState[SlotOf(rider)] == MoveState.Idle;
            });
            Assert.False(distracted);
            Assert.True(DistanceTo(world, rider, 30, 20) < 0.1);
            Assert.Equal(50, Hp(world, enemy));
        }

        [Fact]
        public void AnAttackMoveFightsWhatItMeetsAndThenCarriesOnToWhereItWasSent()
        {
            World world = Open(48);
            int[] band = Line(world, 0, S, 4, 6, 24);
            int first = Place(world, 1, V, 18, 24);
            int second = Place(world, 1, V, 19, 26);
            Send(world, 0, Command.AttackMove(band, F(36), F(24)));
            Run(world, 2400, () => band.All(id => AtRest(world, id) && world.orderKind[SlotOf(id)] == OrderKind.None));
            Assert.False(world.IsAlive(first));
            Assert.False(world.IsAlive(second));
            foreach (int id in band) Assert.True(DistanceTo(world, id, 36, 24) < 1.5);
            // The shared marching order has been let go of.
            Assert.Equal(0, world.groups.Count);
        }

        [Fact]
        public void AnAttackMovePullsDownBuildingsInItsWayWhichAGuardLeavesAlone()
        {
            World world = Open(48);
            int house = world.SpawnBuilding(1, Kind.House, 24, 24);
            int guard = Place(world, 0, S, 24.5, 20.5);
            Run(world, 120);
            Assert.Equal(World.NO_ENTITY, world.target[SlotOf(guard)]);
            int[] band = Line(world, 0, S, 6, 10, 24);
            Send(world, 0, Command.AttackMove(band, F(38), F(24)));
            Run(world, 3600, () => !world.IsAlive(house) && band.All(id => AtRest(world, id)));
            Assert.False(world.IsAlive(house));
            foreach (int id in band) Assert.True(DistanceTo(world, id, 38, 24) < 1.5);
            Assert.True(world.map.IsPassable(24, 24));
        }

        [Fact]
        public void APatrolWalksItsBeatToAndFroDealingWithIntrudersOnTheWay()
        {
            World world = Open(48);
            int sentry = Place(world, 0, S, 10, 24);
            Send(world, 0, Command.Patrol(Ids(sentry), F(20), F(24)));
            var visits = new List<string>();
            void Note()
            {
                string end = DistanceTo(world, sentry, 10, 24) < 0.3 ? "near" : DistanceTo(world, sentry, 20, 24) < 0.3 ? "far" : "";
                if (end != "" && (visits.Count == 0 || visits[visits.Count - 1] != end)) visits.Add(end);
            }
            Note();
            Run(world, 300, () =>
            {
                Note();
                return visits.Count == 2;
            });
            int intruder = Place(world, 1, V, 15, 27);
            Run(world, 1800, () =>
            {
                Note();
                return visits.Count >= 5 && !world.IsAlive(intruder);
            });
            Assert.Equal(new[] { "near", "far", "near", "far", "near" }, visits.Take(5).ToArray());
            Assert.False(world.IsAlive(intruder));
            Assert.Equal(OrderKind.Patrol, world.orderKind[SlotOf(sentry)]);
            // Any other order ends the patrol.
            Send(world, 0, Command.Stop(Ids(sentry)));
            Run(world, 5);
            Assert.Equal(OrderKind.None, world.orderKind[SlotOf(sentry)]);
        }

        [Fact]
        public void AUnitToldToHoldStrikesAtWhatComesWithinReachAndNeverGivesChase()
        {
            World world = Open();
            int holder = Place(world, 0, S, 10, 20);
            int enemy = Place(world, 1, V, 12.5, 20);
            Send(world, 0, Command.Hold(Ids(holder)));
            Run(world, 150);
            Assert.Equal(0, DistanceTo(world, holder, 10, 20));
            Assert.Equal(50, Hp(world, enemy));
            Send(world, 1, Command.Attack(Ids(enemy), holder));
            Run(world, 900, () => !world.IsAlive(enemy));
            Assert.False(world.IsAlive(enemy));
            Assert.True(DistanceTo(world, holder, 10, 20) < 0.05);
            Assert.Equal(OrderKind.Hold, world.orderKind[SlotOf(holder)]);
        }

        [Fact]
        public void AnAttackOrderFollowsItsQuarryKillsItAndGoesOnToTheNextOrderInTheQueue()
        {
            World world = Open(48);
            int hunter = Place(world, 0, S, 10, 24);
            int quarry = Place(world, 1, V, 20, 24);
            Send(world, 1, Command.Move(Ids(quarry), F(40), F(30)));
            Send(world, 0, Command.Attack(Ids(hunter), quarry));
            Run(world, 2);
            Send(world, 0, Command.Move(Ids(hunter), F(8), F(8), queue: true));
            Run(world, 30);
            Assert.Equal(OrderKind.AttackTarget, world.orderKind[SlotOf(hunter)]);
            Assert.Equal(1, world.queueLength[SlotOf(hunter)]);
            Run(world, 3000, () => !world.IsAlive(quarry) && AtRest(world, hunter));
            Assert.False(world.IsAlive(quarry));
            Assert.True(DistanceTo(world, hunter, 8, 8) < 0.1);
        }

        [Fact]
        public void VillagersFightWhenOrderedToAndStandDownWhenTheJobIsDone()
        {
            World world = Open();
            int[] mob = Line(world, 0, V, 3, 10, 20);
            int victim = Place(world, 1, V, 14, 20);
            int bystander = Place(world, 1, V, 15, 21);
            Send(world, 0, Command.Attack(mob, victim));
            Run(world, 1200, () => !world.IsAlive(victim) && mob.All(id => AtRest(world, id)));
            Assert.False(world.IsAlive(victim));
            Run(world, 200);
            Assert.Equal(50, Hp(world, bystander));
            foreach (int id in mob) Assert.Equal(World.NO_ENTITY, world.target[SlotOf(id)]);
        }

        [Fact]
        public void NobodyCanBeOrderedToAttackTheirOwnSideOrAnAlly()
        {
            World world = Open(40, config =>
            {
                config.playerCount = 3;
                config.teams = new[] { 0, 1, 0 };
            });
            int mine = Place(world, 0, S, 10, 20);
            int friend = Place(world, 0, S, 11, 20);
            int ally = Place(world, 2, S, 10, 21);
            int allyHouse = world.SpawnBuilding(2, Kind.House, 14, 20);
            foreach (int target in new[] { friend, ally, allyHouse, mine, 123456, -1 })
            {
                Send(world, 0, Command.Attack(Ids(mine), target));
            }
            Run(world, 300);
            foreach (int id in new[] { mine, friend, ally }) Assert.Equal(80, Hp(world, id));
            Assert.Equal(400, Hp(world, allyHouse));
            Assert.Equal(World.NO_ENTITY, world.target[SlotOf(mine)]);
            // The third player is an enemy of both.
            int foe = Place(world, 1, V, 12, 22);
            Run(world, 900, () => !world.IsAlive(foe));
            Assert.False(world.IsAlive(foe));
        }

        [Fact]
        public void ANewOrderCancelsABlowThatHasNotLandedYet()
        {
            World world = Open();
            int spear = Place(world, 0, S, 20, 20);
            int victim = Place(world, 1, V, 20.8, 20);
            Run(world, 60, () => world.windup[SlotOf(spear)] > 0);
            Assert.True(world.windup[SlotOf(spear)] > 0);
            Send(world, 0, Command.Move(Ids(spear), F(30), F(20)));
            Run(world, 20);
            Assert.Equal(50, Hp(world, victim));
            Assert.Equal(0, world.windup[SlotOf(spear)]);
        }
    }

    public class Arrows : CombatScenario
    {
        static string[] RiverRows()
        {
            return Enumerable.Repeat("..........~~..........", 20).ToArray();
        }

        [Fact]
        public void LeaveTheBowHalfASecondAfterTheArcherSetsToAndLandAfterTheirFlight()
        {
            World world = Open();
            int archer = Place(world, 0, A, 10, 20);
            int target = Place(world, 1, V, 14, 20);
            Send(world, 0, Command.Hold(Ids(archer)));
            int loosed = -1;
            int lands = -1;
            int ticks = Run(world, 200, () =>
            {
                if (loosed == -1 && world.shotCount > 0)
                {
                    loosed = world.tick;
                    lands = world.shots[6];
                    Assert.Equal(archer, world.shots[2]);
                    Assert.Equal(target, world.shots[3]);
                    Assert.Equal(5, world.shots[4]);
                }
                return Hp(world, target) < 50;
            });
            Assert.True(ticks < 200);
            // Fourteen tiles a second over four tiles: nine ticks in the air.
            Assert.Equal(9, lands - (loosed - 1));
            Assert.Equal(lands, world.tick - 1);
            Assert.Equal(45, Hp(world, target));
        }

        [Fact]
        public void ShootOnceEverySecondAndAHalf()
        {
            World world = Open();
            int archer = Place(world, 0, A, 10, 20);
            Place(world, 1, Kind.Horseman, 13, 20);
            Send(world, 0, Command.Hold(Ids(archer)));
            Send(world, 1, Command.Hold(world.LivingUnits(1).ToArray()));
            var loosed = new List<int>();
            int before = 0;
            Run(world, 400, () =>
            {
                if (world.shotCount > before) loosed.Add(world.tick);
                before = world.shotCount;
                return loosed.Count == 4;
            });
            Assert.Equal(4, loosed.Count);
            for (int i = 1; i < loosed.Count; i++) Assert.Equal(Seconds(world, 1.5), loosed[i] - loosed[i - 1]);
        }

        [Fact]
        public void DoNothingIfTheTargetIsDeadByTheTimeTheyArrive()
        {
            World world = Open();
            int archer = Place(world, 0, A, 10, 20);
            int target = Place(world, 1, V, 14, 20);
            Run(world, 200, () => world.shotCount > 0);
            Assert.Equal(1, world.shotCount);
            world.Destroy(target);
            // Someone else moves into the dead unit's slot. The arrow is not for them.
            int newcomer = Place(world, 1, V, 14, 20);
            Assert.Equal(SlotOf(target), SlotOf(newcomer));
            Send(world, 0, Command.Stop(Ids(archer)));
            Send(world, 0, Command.Move(Ids(archer), F(2), F(2)));
            Run(world, 30);
            Assert.Equal(0, world.shotCount);
            Assert.Equal(50, Hp(world, newcomer));
        }

        [Fact]
        public void CrossARiverThatASpearmanCannot()
        {
            World world = OpenFrom(RiverRows());
            int archer = Place(world, 0, A, 8.5, 10.5);
            int spear = Place(world, 1, S, 13.5, 10.5);
            Run(world, 1500, () => !world.IsAlive(spear));
            Assert.False(world.IsAlive(spear));
            Assert.Equal(60, Hp(world, archer));
        }

        [Fact]
        public void ASpearmanDoesNotGoAfterASoldierAcrossTheRiverWhomHeCannotReach()
        {
            World world = OpenFrom(RiverRows());
            int spear = Place(world, 0, S, 8.5, 10.5);
            int other = Place(world, 1, S, 13.5, 10.5);
            Run(world, 300);
            foreach (int id in new[] { spear, other })
            {
                Assert.Equal(World.NO_ENTITY, world.target[SlotOf(id)]);
                Assert.Equal(MoveState.Idle, world.moveState[SlotOf(id)]);
            }
            Assert.Equal(0, DistanceTo(world, spear, 8.5, 10.5));
        }
    }

    public class ACharge : CombatScenario
    {
        [Fact]
        public void AddsTenToARidersFirstBlowAfterARunAndOnlyTheFirst()
        {
            World world = Open(48);
            int rider = Place(world, 0, H, 8, 24);
            int archer = Place(world, 1, A, 20, 24);
            Send(world, 1, Command.Hold(Ids(archer)));
            Send(world, 0, Command.Attack(Ids(rider), archer));
            var seen = new List<int> { 60 };
            Run(world, 900, () =>
            {
                int now = Hp(world, archer);
                if (now != seen[seen.Count - 1]) seen.Add(now);
                return now == 0;
            });
            // 9 + 9 against archers + 10 for the charge, then 18 a blow.
            Assert.Equal(new[] { 60, 32, 14, 0 }, seen.ToArray());
        }

        [Fact]
        public void IsNotReadyWithoutRoomToRun()
        {
            World world = Open();
            int rider = Place(world, 0, H, 20, 20);
            int archer = Place(world, 1, A, 21, 20);
            Send(world, 1, Command.Hold(Ids(archer)));
            Send(world, 0, Command.Attack(Ids(rider), archer));
            Run(world, 300, () => Hp(world, archer) < 60);
            Assert.Equal(42, Hp(world, archer));
        }

        [Fact]
        public void FadesIfTheRiderStandsAboutBeforeStriking()
        {
            World world = Open(48);
            int rider = Place(world, 0, H, 8, 24);
            Send(world, 0, Command.Move(Ids(rider), F(20), F(24)));
            Run(world, 600, () => AtRest(world, rider));
            Assert.True(world.momentum[SlotOf(rider)] > 30);
            Run(world, 60);
            Assert.Equal(0, world.momentum[SlotOf(rider)]);
        }

        [Fact]
        public void OntoASpearmanWhoIsStandingReadyComesToNothingAndCostsTheRiderAWound()
        {
            World world = Open(48);
            int rider = Place(world, 0, H, 8, 24);
            int spear = Place(world, 1, S, 20, 24);
            Send(world, 1, Command.Hold(Ids(spear)));
            Send(world, 0, Command.Attack(Ids(rider), spear));
            Run(world, 900, () => Hp(world, spear) < 80);
            Assert.Equal(80 - 9, Hp(world, spear));
            Assert.Equal(120 - 24, Hp(world, rider));
        }

        [Fact]
        public void CatchesASpearmanOnTheMoveUnbraced()
        {
            World world = Open(100);
            int rider = Place(world, 0, H, 8, 24);
            int spear = Place(world, 1, S, 20, 24);
            Send(world, 1, Command.Move(Ids(spear), F(95), F(24)));
            Send(world, 0, Command.Attack(Ids(rider), spear));
            Run(world, 900, () => Hp(world, spear) < 80);
            Assert.NotEqual(MoveState.Idle, world.moveState[SlotOf(spear)]);
            Assert.Equal(80 - 9 - 10, Hp(world, spear));
            Assert.Equal(120, Hp(world, rider));
        }

        [Fact]
        public void OrAnyBlowOnceBegunIsNotDodgedByRunningAway()
        {
            World world = Open(100);
            int hunter = Place(world, 0, S, 10, 24);
            int quarry = Place(world, 1, V, 12, 24);
            Send(world, 1, Command.Move(Ids(quarry), F(95), F(24)));
            Send(world, 0, Command.Attack(Ids(hunter), quarry));
            // The spearman is the faster by a little, so it catches up, strikes, falls behind, and catches up again.
            Run(world, 2400, () => !world.IsAlive(quarry));
            Assert.False(world.IsAlive(quarry));
        }
    }

    public class BuildingsInAFight : CombatScenario
    {
        [Fact]
        public void StartAsASiteWithATenthOfTheirStrengthAndGainTheRestAsTheyGoUp()
        {
            World world = Open();
            new[] { 0, 500, 0, 0 }.CopyTo(world.stock, 0);
            int builder = Place(world, 0, V, 10, 10);
            Send(world, 0, Command.Build(Ids(builder), Kind.House, 14, 10));
            Run(world, 1);
            int house = world.LivingEntities(0).First(id => world.mobile[SlotOf(id)] == 0);
            Assert.Equal(EntityTypes.SiteHp(Kind.House), Hp(world, house));
            Assert.Equal(40, EntityTypes.SiteHp(Kind.House));
            int last = 40;
            Run(world, 1200, () =>
            {
                Assert.True(Hp(world, house) >= last);
                last = Hp(world, house);
                return world.built[SlotOf(house)] == 1;
            });
            Assert.Equal(1, world.built[SlotOf(house)]);
            Assert.Equal(400, Hp(world, house));
        }

        [Fact]
        public void CanBeDestroyedWhichFreesTheGroundAndTakesAwayTheRoomTheyGave()
        {
            World world = Open();
            int house = world.SpawnBuilding(1, Kind.House, 20, 20);
            Assert.Equal(10, Production.CountPopulation(world).room[1]);
            int[] band = Line(world, 0, S, 6, 14, 20);
            Send(world, 0, Command.Attack(band, house));
            int ticks = Run(world, 3600, () => !world.IsAlive(house));
            Assert.False(world.IsAlive(house));
            // 400 hit points at 4 a blow from six spearmen: about 17 rounds of 1.75 seconds.
            Assert.True(ticks > Seconds(world, 25));
            Assert.True(ticks < Seconds(world, 60));
            Assert.Equal(0, Production.CountPopulation(world).room[1]);
            for (int ty = 19; ty <= 21; ty++)
            {
                for (int tx = 19; tx <= 21; tx++) Assert.True(world.map.IsPassable(tx, ty));
            }
            Run(world, 200, () => band.All(id => AtRest(world, id)));
            foreach (int id in band) Assert.Equal(OrderKind.None, world.orderKind[SlotOf(id)]);
        }

        [Fact]
        public void TakeAUnitQueuedForTrainingDownWithThemUnrefunded()
        {
            World world = Open();
            new[] { 500, 100, 0, 0 }.CopyTo(world.stock, 4);
            int barracks = world.SpawnBuilding(1, Kind.Barracks, 20, 20);
            world.SpawnBuilding(1, Kind.House, 30, 30);
            Send(world, 1, Command.Train(barracks, S));
            Run(world, 5);
            Assert.Equal(440, world.stock[4]);
            world.hp[SlotOf(barracks)] = 4;
            int spear = Place(world, 0, S, 16.5, 20);
            Send(world, 0, Command.Attack(Ids(spear), barracks));
            Run(world, 300, () => !world.IsAlive(barracks));
            Assert.False(world.IsAlive(barracks));
            Assert.Equal(440, world.stock[4]);
            Assert.Equal(0, Production.CountPopulation(world).used[1]);
        }

        [Fact]
        public void AreMendedByVillagersSlowlyBackToFullStrengthAndNoFurther()
        {
            World world = Open();
            int house = world.SpawnBuilding(0, Kind.House, 20, 20);
            int idler = Place(world, 0, V, 15, 20);
            // Nothing to do at a sound building: the villager just walks over.
            Send(world, 0, Command.Construct(Ids(idler), house));
            Run(world, 300);
            Assert.Equal(0, world.job[SlotOf(idler)]);
            world.hp[SlotOf(house)] = 100;
            int mender = Place(world, 0, V, 15, 22);
            Send(world, 0, Command.Construct(Ids(mender), house));
            int ticks = Run(world, 3600, () => Hp(world, house) == 400);
            Assert.Equal(400, Hp(world, house));
            // Three quarters of the house, at a full house every two minutes.
            Assert.True(ticks > Seconds(world, 90));
            Assert.True(ticks < Seconds(world, 100));
            Run(world, 100);
            Assert.Equal(400, Hp(world, house));
            Assert.Equal(0, world.job[SlotOf(mender)]);
        }

        [Fact]
        public void WithArrowsShootTheNearestEnemyInRangeButNotBeforeTheyAreFinished()
        {
            World world = Open(48);
            new[] { 0, 500, 500, 0 }.CopyTo(world.stock, 0);
            int builder = Place(world, 0, V, 20, 20);
            Send(world, 0, Command.Build(Ids(builder), Kind.Watchtower, 24, 24));
            Run(world, 1);
            int tower = world.LivingEntities(0).First(id => world.mobile[SlotOf(id)] == 0);
            int near = Place(world, 1, V, 29, 24);
            int far = Place(world, 1, V, 24, 33.5);
            Run(world, 200);
            Assert.Equal(50, Hp(world, near));
            Run(world, 3000, () => world.built[SlotOf(tower)] == 1);
            Assert.Equal(1, world.built[SlotOf(tower)]);
            int ticks = Run(world, 900, () => !world.IsAlive(near));
            Assert.False(world.IsAlive(near));
            // Seven blows of 8 at one every two seconds.
            Assert.True(ticks > Seconds(world, 11));
            Assert.True(ticks < Seconds(world, 15));
            // Eight tiles from the wall is out of range.
            Assert.Equal(50, Hp(world, far));
        }

        [Fact]
        public void AreFoughtBackAgainstAGuardShotAtByATowerGoesAndPullsItDown()
        {
            World world = Open(48);
            int tower = world.SpawnBuilding(1, Kind.Watchtower, 24, 24);
            int[] band = Line(world, 0, S, 8, 24, 30.5);
            Run(world, 5400, () => !world.IsAlive(tower));
            Assert.False(world.IsAlive(tower));
            Assert.Contains(band, id => world.IsAlive(id));
        }
    }

    public class TheDead : CombatScenario
    {
        [Fact]
        public void TakeWhatTheyWereCarryingWithThemAndTheBooksStillBalance()
        {
            World world = Open();
            int villager = Place(world, 1, V, 20, 20);
            world.carry[SlotOf(villager)] = 7;
            world.carryKind[SlotOf(villager)] = Resource.Wood;
            int spear = Place(world, 0, S, 19, 20);
            Run(world, 900, () => !world.IsAlive(villager));
            Assert.False(world.IsAlive(villager));
            Assert.Equal(new[] { 0, 7, 0, 0 }, world.lost);
            Assert.True(world.IsAlive(spear));
        }

        [Fact]
        public void LeaveTheirSlotsToNewcomersWhomOldOrdersDoNotTouch()
        {
            World world = Open();
            int spear = Place(world, 0, S, 10, 20);
            int victim = Place(world, 1, V, 11, 20);
            Run(world, 900, () => !world.IsAlive(victim));
            int newcomer = Place(world, 0, V, 30, 30);
            Assert.Equal(SlotOf(victim), SlotOf(newcomer));
            Send(world, 0, Command.Attack(Ids(spear), victim));
            Run(world, 200);
            Assert.Equal(50, Hp(world, newcomer));
            Assert.Equal(World.NO_ENTITY, world.target[SlotOf(spear)]);
        }
    }

    public class ABattle : CombatScenario
    {
        World DrawnUp()
        {
            World world = Open(48);
            int[] a = Line(world, 0, A, 8, 14, 24).Concat(Line(world, 0, S, 8, 16, 24)).Concat(Line(world, 0, H, 4, 15, 18)).ToArray();
            int[] b = Line(world, 1, A, 8, 34, 24).Concat(Line(world, 1, S, 8, 32, 24)).Concat(Line(world, 1, H, 4, 33, 30)).ToArray();
            world.SpawnBuilding(0, Kind.Watchtower, 8, 24);
            Send(world, 0, Command.AttackMove(a, F(33), F(24)));
            Send(world, 1, Command.AttackMove(b, F(15), F(24)));
            return world;
        }

        [Fact]
        public void PicksUpExactlyWhereItLeftOffAfterBeingSavedWithArrowsInTheAir()
        {
            World world = DrawnUp();
            Run(world, 400, () => world.shotCount >= 3);
            Assert.True(world.shotCount >= 3);
            WorldSnapshot saved = Snapshot.TakeSnapshot(world);
            Assert.Equal(world.shotCount * World.SHOT_FIELDS, saved.shots.Length);
            World restored = Snapshot.RestoreSnapshot(saved);
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
            for (int i = 0; i < 900; i++)
            {
                Simulation.Step(world);
                Simulation.Step(restored);
                if (Hash.HashWorld(restored) != Hash.HashWorld(world)) Assert.Fail($"diverged {i + 1} ticks after loading");
            }
            Assert.True(world.LivingUnits().Count < 40);
        }

        [Fact]
        public void EndsWithOneSideGoneAndTheSurvivorsStandingWhereTheyWereSent()
        {
            World world = DrawnUp();
            Run(world, 5400, () => world.LivingUnits(0).Count == 0 || world.LivingUnits(1).Count == 0);
            int winner = world.LivingUnits(0).Count > 0 ? 0 : 1;
            List<int> left = world.LivingUnits(winner);
            Assert.True(left.Count > 0);
            Run(world, 1500, () => left.All(id => AtRest(world, id)));
            Assert.True(left.All(id => AtRest(world, id)));
            Assert.Equal(0, world.groups.Count);
            Assert.Equal(0, world.shotCount);
            foreach (int id in left) Assert.False(EntityTypes.ENTITY_TYPES[world.entityType[SlotOf(id)]].building);
        }
    }
}
