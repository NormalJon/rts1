# The simulation in C#

`Rts.Core` is the game's simulation and skirmish AI as a C# class library, ported
from the TypeScript in `src/sim`, `src/ai` and `src/session`. It has no engine
code in it and depends on nothing but .NET itself, so the same library serves
Unity or Godot. The engine draws the picture and takes input; this decides
what happens in a match.

It is .NET Standard 2.1 and C# 9, which Unity 6 and Godot 4 (.NET) both accept.

## Commands

```bash
dotnet test csharp/Rts.slnx              # build, then run every check below
dotnet test csharp/Rts.slnx -c Release   # the same, about three times as fast
```

Needs the .NET SDK (version 10 was used). The tests read the files in
`recordings/` at the top of the repository.

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
  in the recorded matches. Keep it that way: run
  `dotnet test csharp/Rts.slnx --no-incremental -p:CheckForOverflowUnderflow=true`
  after changing arithmetic.
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

While the port is being finished the TypeScript stays frozen. After that, a
change to how matches play out is made in both, in step:

1. Change the TypeScript and its tests. The reference checksum in
   `test/determinism.test.ts` will move if behaviour did.
2. `npm run record` to write the recordings again.
3. Make the same change here until `dotnet test csharp/Rts.slnx` passes.

## Not checked

- Inside Unity or Godot. The library has only been built and run with the .NET
  SDK on Windows (x64). Unity compiles C# with its own toolchain (Mono in the
  editor, IL2CPP for release builds); nothing here should trouble it, but that
  is a belief until the replay tests have been run there.
- On a Mac, or any ARM processor.
- Speed in a large late-game battle. For scale: the 36-minute match between two
  hard AIs (64,800 ticks, about 240 units and buildings at the end) replays in
  about four seconds in a Release build, checksum on every tick included.
- Commands with nonsense in them beyond what the random-order matches send. In
  TypeScript a command can arrive with a fraction or a missing list where a
  whole number or a list should be; in C# its fields are typed, so whatever
  reads commands from a file or the network must reject those before they
  reach the simulation.
- Rule by rule. The 253 TypeScript unit tests were not translated. The C# is
  held to the TypeScript by whole matches and by the recorded figures, so a
  rule that none of them reaches is checked only by reading the two files
  against each other. A coverage tool
  (`dotnet test csharp/Rts.slnx --collect:"XPlat Code Coverage"`, which takes
  about a quarter of an hour) showed the tests running 97.3 per cent of the
  library's lines before the scenario match, the two extra maps and the table
  figures were added to reach more of them. What is still never run:
  - in `Combat.cs`, a unit that finds itself inside the outline of the
    building it is attacking stepping out sideways (`FindPlaceBeside`);
  - in `Movement.cs`, a unit on a flow field whose group or field has gone
    asking for a path of its own (`Steer`);
  - in `Ai/Skirmish.cs`, choosing a horseman as the scout, standing down when
    there is nothing left to find, and working out where home is for a side
    that has never had a town centre;
  - in `Search.cs`, the heap growing past its first size;
  - two branches nothing can reach as the rules stand: a change of terrain
    that alters whether a tile can be walked on (`SetTerrain`), and a
    technology giving a unit a bonus where it had none;
  - a few small helpers that nothing in the library calls (`Fixed.ToFloat`,
    `Units.FromFloat`, `SkirmishAi.Status`).
