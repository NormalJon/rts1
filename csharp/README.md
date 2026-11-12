# The simulation in C#

`Rts.Core` is the game's simulation and skirmish AI as a C# class library, ported
from the TypeScript in `src/sim`, `src/ai` and `src/session`. It has no engine
code in it and depends on nothing but .NET itself, so the same library serves
Unity or Godot. The engine draws the picture and takes input; this decides
what happens in a match.

It is .NET Standard 2.1 and C# 9, which Unity 6 and Godot 4 (.NET) both accept.

Unity uses these source files as they are: `Rts.Core/package.json` and
`Rts.Core/Rts.Core.asmdef` make the folder a Unity package, and
`unity/Packages/manifest.json` points at it. So a rule is changed in one
place, the tests here check it, and Unity compiles the same file. Two things
follow. The `.asmdef` sets `noEngineReferences`, so Unity itself refuses
engine code in this folder. And the .NET SDK must leave nothing in it, since
Unity would import that too: `Directory.Build.props` sends all build output to
`csharp/.build/` (Unity skips folders whose names begin with a dot). The
`.meta` files Unity writes beside each source file are kept in the
repository.

## Commands

```bash
dotnet test csharp/Rts.slnx              # build, then run every check below
dotnet test csharp/Rts.slnx -c Release   # the same, several times as fast: about half a minute
```

Needs the .NET SDK (version 10 was used). The tests read the files in
`recordings/` at the top of the repository.

There are two kinds of test. The first kind holds the C# to the TypeScript by
whole matches and recorded figures, and says only that something differs and
on which tick. The second kind (`Rts.Core.Tests/Rules/`) is the TypeScript's
own unit tests translated one for one: each sets up a small situation and
checks one rule, so when something is wrong it names the rule.

## How it is known to be the same game

The TypeScript game is the reference. `npm run record` plays ten matches in it
and writes each one down in `recordings/`: the settings, every command, and the
world checksum after every tick. The tests here hold the C# to those files.

| Test | What it proves |
|---|---|
| `ReplayTests` | Each of the ten matches, played back from its commands, has the same checksum after every tick: about 157,000 ticks in all. The reference match ends on `8faaf6a6`. If a tick differs, the test names the first one. |
| `AiTests` | A replay does not consult the AI, so here the C# AI plays the three recorded AI matches itself from the first tick. It must give the orders the TypeScript AI gave, on the same ticks. If one differs, the test names it. |
| `SnapshotTests` | A match saved part-way and loaded into a new world carries on with the same checksum on every later tick, including a save taken in the middle of a route search. |
| `ArithmeticTests` | The fixed-point functions and the random number generator, over 4,000 rounds of inputs worked out by the TypeScript. |
| `MapTests` | Ten maps agree tile for tile, and 90 route searches on them find the same routes after the same amount of work. Two of the maps are ones on which the generator has to cut a way through between the two starts. |
| `TableTests` | Every technology is written down as in the TypeScript, description included; each one alone, and all of them together, make the same of every unit and building; and everything takes the same number of ticks at every tick rate from 1 to 120. No one match researches everything or runs at every rate. |
| `WorldTests` | The world's own bookkeeping, as in the TypeScript tests of the same name: slots are reused safely, a save restores free slots and generations, a dead unit gives up its place in a group, a full world says so, and settings the TypeScript refuses are refused here. |
| `InvariantTests` | Every recorded match is played back and, after every tick, held to what must always be true (`Helpers.BrokenInvariant`, ported from `test/helpers.ts`): no resource is made or lost, the map's record of what connects to what is right, buildings and tilled ground match the map, every shared order counts its units correctly, no arrow is overdue, nobody stands in an obstacle, and each side is counted as seeing exactly what it can see. One more test spoils a world four ways to show the checks notice. |
| `Rules/` | The TypeScript unit tests, translated: 235 of them. See below. |

The ten matches: the reference match and the same with pathfinding starved;
random orders from the first age on a larger map; on a hand-drawn map with
three players, nothing hidden, at 60 ticks a second; on open grass with four
players in two teams at 20 ticks a second; with no towns on a field that fills
up; a short scripted one that does things the others never happen to (new
villagers rallied onto berries, a tree felled that joins two pieces of ground,
a mill pulled down while a villager is carrying a load to it); and three AI
matches, one of them two hard AIs for 36 minutes through all four ages.

Both of the main tests have been seen to fail when they should. With one
combat distance changed by a tile, six of the matches reported the first tick
that differed; with one AI distance changed by a tile, all three AI matches
named the first order that differed.

## The rule-by-rule tests

`Rts.Core.Tests/Rules/` has one C# file for each TypeScript test file, with
the tests in the same order. A `describe` block there is a class here, and a
test keeps its name in plain words: `it('walks round a wall to reach the
other side')` under `describe('a single unit')` is
`ASingleUnit.WalksRoundAWallToReachTheOtherSide`.

| TypeScript | C# | Tests |
|---|---|---|
| `test/fixed.test.ts` | `Rules/FixedRuleTests.cs` | 11 |
| `test/rng.test.ts` | `Rules/RngRuleTests.cs` | 6 |
| `test/map.test.ts` | `Rules/MapRuleTests.cs` | 21 |
| `test/pathfinding.test.ts` | `Rules/PathfindingRuleTests.cs` | 8 |
| `test/movement.test.ts` | `Rules/MovementRuleTests.cs` | 22 |
| `test/commands.test.ts` | `Rules/CommandsRuleTests.cs` | 14 |
| `test/economy.test.ts` | `Rules/EconomyRuleTests.cs` | 24 |
| `test/buildings.test.ts` | `Rules/BuildingsRuleTests.cs` | 31 |
| `test/combat.test.ts` | `Rules/CombatRuleTests.cs` | 46 |
| `test/vision.test.ts` | `Rules/VisionRuleTests.cs` | 19 |
| `test/tech.test.ts` | `Rules/TechRuleTests.cs` | 24 |
| `test/ai.test.ts` | `Rules/AiRuleTests.cs` | 5 |
| `test/determinism.test.ts` | `Rules/DeterminismRuleTests.cs`, and the tests named at the top of that file | 4 here, 10 elsewhere |
| `test/helpers.ts` | `Helpers.cs` | (the checks the others use) |

`Rules/Scenario.cs` holds what the TypeScript files each repeat at the top: a
small world drawn by hand, a way to give an order, and `Run`, which plays
ticks and checks after every one that nothing that must always hold is broken.

Every one of them passed the first time it was run: translating the tests
turned up no rule on which the C# and the TypeScript differ. They have been
seen to fail when they should. In a copy of the library, a spearman's blow
changed from 8 to 9 failed ten tests, each naming a rule about blows or
battles; soldiers noticing enemies at nine tiles instead of eight failed
"does not notice an enemy further off than eight tiles"; and mending made a
sixth faster failed "are mended by villagers, slowly".

New rules (walls, siege, garrisons, civilizations, victory) are written in C#
first from now on. Give each its tests here, in the same style, and add what
must always be true of it to `Helpers.BrokenInvariant`.

### What was not translated, and why

Whole files:

- `test/determinism-lint.test.ts` (4 tests) reads the TypeScript source to
  enforce the rules for simulation code. Nothing reads the C# source that
  way; its rules are kept by reading, and by the run with overflow checking.
- `test/stepper.test.ts` (4 tests): `stepper.ts` is not ported (see Layout).
- `test/recordings.test.ts` (4 tests) is about the TypeScript recorder and
  its files. Its C# counterpart is `ReplayTests`.
- `playRandomMatch` in `test/helpers.ts`, which plays a match of random
  orders. The matches it played are in `recordings/` and stand in for it, so
  the C# has no way to make up a *new* random match. Two tests of
  `determinism.test.ts` change shape because of that: "actually exercises the
  simulation" tallies three recorded matches (the reference match and two
  random ones on other settings) where the TypeScript plays the reference
  settings three times, and "diverges when anything about the inputs
  differs" gives the same orders on another seed's map where the TypeScript
  has the random player play again.

Parts of tests, because a C# command has typed fields and cannot hold them:

- Commands with text, a fraction or "not a number" where a whole number
  belongs, a command with no kind, and a bare word in place of a command
  ("survives malformed commands" in `commands.test.ts`: of ten pieces of
  nonsense, the ones kept are a missing list, handles that are negative or
  far out of range, a unit type and a kind of command that do not exist, no
  command at all, and players who do not exist).
- A gather order with a fraction for its tile or no tile at all, and a
  delivery whose target is a word (`economy.test.ts`).
- A building plot at tile 2.5 or at "not a number", a place 2.5 in a
  training queue, a handle of a million million, and the word "all" in place
  of a list of buildings (`buildings.test.ts`; a missing list is sent
  instead of the word, and the largest whole number instead of the handle).
- A random-number bound of 1.5 (`rng.test.ts`).

One thing in several files: the TypeScript writes a saved game out as JSON
and reads it back before loading it. The C# library has no JSON in it, so
here the save is loaded as it is. Whatever writes saved games to disk for the
engine will need its own test that a save survives the round trip.

## Layout

One C# file for each TypeScript file, with the same name, in the same order
inside. To compare the two, open them side by side.

| TypeScript | C# |
|---|---|
| `src/sim/fixed.ts`, `units.ts`, `rng.ts`, `hash.ts` | `Sim/Fixed.cs`, `Units.cs`, `Rng.cs`, `Hash.cs` |
| `src/sim/map.ts`, `mapgen.ts`, `search.ts` | `Sim/Map.cs`, `MapGen.cs`, `Search.cs` |
| `src/sim/entityTypes.ts`, `tech.ts`, `world.ts`, `commands.ts` | `Sim/EntityTypes.cs`, `Tech.cs`, `World.cs`, `Commands.cs` |
| `src/sim/orders.ts`, `routing.ts`, `movement.ts`, `economy.ts`, `combat.ts`, `production.ts`, `buildings.ts`, `vision.ts` | the same names in `Sim/` |
| `src/sim/sim.ts`, `replay.ts`, `snapshot.ts` | `Sim/Sim.cs`, `Replay.cs`, `Snapshot.cs` |
| `src/ai/skirmish.ts` | `Ai/Skirmish.cs` |
| `src/session/localSession.ts` | `Session/LocalSession.cs` |

Names follow the TypeScript so that a search finds both: variables and fields
keep their names (`world.posX`, `goalTile`), constants keep theirs
(`ORDER_QUEUE_LENGTH`), and functions take a capital (`applyCommand` becomes
`Orders.ApplyCommand`). A file's loose functions live in a static class named
after the file. The TypeScript's lists of named numbers (`Kind.Villager`,
`Terrain.Forest`) are static classes of constants, not C# enums, because the
numbers are stored in byte arrays and compared all over.

Not ported: `src/session/stepper.ts`, which turns frame time into ticks. It is
forty lines, belongs to the display side, and is best written against the
engine's own clock.

## Rules for code in `Sim/`

The TypeScript's rules (see the main README) hold here too, and a few are
particular to C#.

- **Whole numbers only.** `int` for a simulation value, `long` wherever a sum
  or product could pass 32 bits. A TypeScript number holds every whole number
  up to 2^53, so `a * b` there may be exact where `int * int` here would wrap.
  Places that matter: squared distances in fixed-point, the cross products in
  `LineOfSight` and in `Separate`, the heap keys in `Search.cs`, and the sum of
  positions in `ApplyMove`.
- **Wrapping is always marked.** Where 32-bit wraparound is meant (hashing, the
  random numbers, `| 0` in the TypeScript, narrowing into a byte or ushort
  column), the code says `unchecked`. The tests pass with overflow checking
  switched on for the whole library, which shows that nothing else overflows
  in the recorded matches or in the rule-by-rule tests. Keep it that way:
  after changing arithmetic, run
  `dotnet build csharp/Rts.slnx --no-incremental -p:CheckForOverflowUnderflow=true`
  and then `dotnet test csharp/Rts.slnx --no-build` (about three minutes),
  and build again in the ordinary way afterwards. (`dotnet test` itself does
  not take `--no-incremental` in SDK 10.)
- **No order from a `Dictionary` or `HashSet`.** They are used only to look
  things up. Anything read in order is a list: the move groups (`GroupMap` in
  `World.cs`), the route queue, the AI's remembered buildings.
- **Stable sorting.** `Sorting.StableSort` in `Commands.cs`, never
  `Array.Sort` or `List.Sort` on anything that can tie. (The map generator
  sorts plain numbers with `Array.Sort`, where a tie cannot show.)
- **No state outside the world.** `combat.ts` keeps where a chasing unit should
  head in two module-level variables; here they are `world.aimX` and `aimY`,
  so two worlds can run at once, on different threads if need be.
- **No floating point, clock, threads or `GetHashCode`** in anything that
  decides what happens. `Fixed.Isqrt` starts from `Math.Sqrt` as the TypeScript
  does and then settles the answer with whole-number loops, so the result does
  not depend on it. `Units.FromFloat` and `SecondsToTicks` take decimals and
  are for data files and the display side; the simulation does not call them.
- **The AI is the one exception**, as it is in TypeScript: it is a player, not
  part of the simulation, and does three sums in decimals (how its memory of
  enemy soldiers fades, how it weighs one kind of soldier against another, and
  what share of villagers gather food). They are marked in `Ai/Skirmish.cs`.
  They use only multiplying, dividing and adding 64-bit floats, which give the
  same answers in both languages on this computer. Only the machine running an
  AI works them out; everyone else receives its commands.

## When the game changes

The port is finished. The TypeScript stays as the reference the C# was checked
against, and for as long as it is kept, a change to how matches play out is
made in both, in step:

1. Change the TypeScript and its tests. The reference checksum in
   `test/determinism.test.ts` will move if behaviour did.
2. `npm run record` to write the recordings again.
3. Make the same change here, and to the translated tests in `Rules/`, until
   `dotnet test csharp/Rts.slnx` passes.

New features (walls, siege, garrisoning and the rest) are to be written once,
in C#. From then on the TypeScript can no longer supply the reference, and the
C# will need to record matches of its own to be held to. That has not been set
up yet. Until it is, what holds a new rule is its own tests in `Rules/` and
what is added for it to `Helpers.BrokenInvariant`.

## Not checked

- Inside a built Unity game, or Godot. In the Unity editor it is checked:
  `unity/Assets/Game/Tests/Editor/RecordedMatchTests.cs` plays all ten
  recorded matches there, and has the AI play the three AI matches itself,
  with the same checksum on every tick (run with
  `scripts\unity-batch.ps1 -Tests EditMode`). With a player giving orders it
  is checked there too: `unity/Assets/Game/Tests/Play/OrdersTests.cs` plays a
  match through the game's own controls and then replays the commands it
  recorded, with no picture, to the same checksum. The editor runs C# on
  Mono. A built game is compiled another way (IL2CPP), and nothing has been
  run that way yet.
- On a Mac, or any ARM processor.
- Speed in a large late-game battle. For scale: the 36-minute match between two
  hard AIs (64,800 ticks, about 240 units and buildings at the end) replays in
  about four seconds in a Release build, checksum on every tick included.
- Commands with nonsense in them beyond what the random-order matches send. In
  TypeScript a command can arrive with a fraction or a missing list where a
  whole number or a list should be; in C# its fields are typed, so whatever
  reads commands from a file or the network must reject those before they
  reach the simulation.
- What the rule-by-rule tests leave out (listed above), and saved games
  written to text and read back.
- Lines no test runs. A rule that no recorded match and no translated test
  reaches is checked only by reading the two files against each other. A
  coverage tool
  (`dotnet test csharp/Rts.slnx -c Release --collect:"XPlat Code Coverage"`,
  which takes about nine minutes) shows all the tests together running 99.1
  per cent of the library's lines: 4,580 of 4,622. (It was 97.3 per cent
  before the scenario match, the two extra maps, the table figures and the
  rule-by-rule tests were added.) The 42 lines never run, as measured on 12
  November 2026 with the rule-by-rule tests in:
  - in `Combat.cs`, a soldier whose quarry stands on ground it cannot walk
    to heading for the nearest ground it can (the second half of
    `FindWayToward`), and a unit that finds itself inside the outline of the
    building it is attacking stepping out sideways (`FindPlaceBeside`);
  - in `Movement.cs`, a unit on a flow field whose group or field has gone
    asking for a path of its own (`Steer`);
  - in `Ai/Skirmish.cs`, choosing a horseman as the scout, standing down when
    there is nothing left to find, and working out where home is for a side
    that has never had a town centre;
  - in `Search.cs`, the heap growing past its first size;
  - branches nothing can reach as the rules stand: a change of terrain that
    alters whether a tile can be walked on (`SetTerrain`), a technology
    giving a unit a bonus where it had none, a group being put where one of
    the same number already is (`GroupMap.Set`), and the line after the end
    of the loop in `LineOfSight`;
  - what is done about things nothing sends: a figure, an AI level, a kind
    of soldier or a kind of map that does not exist; a map built with the
    wrong number of heights; a saved game of the wrong version or the wrong
    size; a map seed that cannot join the two starts;
  - `Column.Length`, which nothing calls.

  The small helpers that nothing in the library calls (`Fixed.ToFloat`,
  `Units.FromFloat`, `SkirmishAi.Status`) are run by the rule-by-rule tests
  now.
