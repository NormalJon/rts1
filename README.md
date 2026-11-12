# Medieval RTS (working title)

A historical real-time strategy game covering roughly 800–1600 CE. This
repository holds the eight steps of the core build: the deterministic
simulation loop; maps, pathfinding and unit movement with a 3D view to play
it in; resources and gathering; buildings, training and population; combat
and the counter triangle; fog of war; a skirmish AI to play against; then
ages and technology. Step nine carried the simulation and the AI
over to C# for a game engine to draw (`csharp/`, with its own README).

## Commands

```bash
npm install
npm test               # maths, maps, pathfinding, movement, economy, buildings, combat, vision, technology, the AI, determinism, source rules
npm run typecheck
npm run dev            # pages at http://localhost:5173
npm run build          # writes dist/playtest.html and dist/tick-rate-lab.html
npm run check:browser  # reference match must give the same checksum in a browser
npm run record         # play the reference matches and write them to recordings/
npm run check:recordings  # play them again and compare with what is on disk
dotnet test csharp/Rts.slnx  # the C# port must replay every recording exactly and pass its own rule-by-rule tests (needs the .NET SDK)
scripts\unity-batch.ps1 -Tests EditMode   # the same recordings replayed inside Unity (Windows, Unity 6.3, editor closed)
scripts\unity-batch.ps1 -Tests PlayMode   # the match scene played and checked; leaves pictures in unity/Logs/Snapshots
```

## Layout

| Path | What it is |
|---|---|
| `src/sim/` | The simulation. Pure, deterministic, no browser or clock access. |
| `src/session/` | Running a match: turning real time into ticks, stamping and recording commands, asking controllers for theirs. |
| `src/ai/` | The skirmish AI: a computer player that issues commands like anyone else. |
| `src/client/game/` | The 3D playtest: view, camera, selection and orders, minimap. |
| `src/client/` | The Tick Rate Lab debug page. |
| `test/` | Vitest suites. `helpers.ts` plays randomised matches for the determinism tests; `recordings.ts` says which matches are recorded for the C# port. |
| `scripts/` | Page build, the cross-browser checksum check, the match recorder, and `unity-batch.ps1`, which runs the Unity editor without its window. |
| `recordings/` | Ten matches played by this TypeScript game and written down in full: settings, every command, and the checksum after every tick. The C# port is held to them. |
| `csharp/` | The simulation and the AI again in C#, as a library with no engine code, the tests that replay the recordings, and the tests in `test/` translated rule by rule. See `csharp/README.md`. |
| `unity/` | The game in Unity 6: a project that compiles `csharp/Rts.Core` as it stands and draws what it does. So far it shows a match between two AIs; open it from Unity Hub and press Play. |
| `art-pipeline/` | Generates the models the playtest uses, with its own `package.json`. Unity takes its copies from here. |
| `docs/art-sources.md` | Survey of openly licensed art sources, with licence checks. |

## How the core works

- **Ticks.** The simulation advances in fixed steps, 30 per second by default.
  The rate is a per-match setting; all stats are authored in seconds and tiles
  and converted when loaded (`src/sim/units.ts`).
- **Fixed-point maths.** Every simulated number is a Q16.16 integer
  (`src/sim/fixed.ts`), so results are bit-identical on every machine.
- **Commands.** Nothing outside the simulation changes it directly. Players, AI,
  replays and the network all submit commands stamped with the tick they run
  on (`src/sim/commands.ts`). Within a tick they run in player order, then in
  each player's own sequence, never in arrival order.
- **Checksums, replays, snapshots.** `hashWorld` fingerprints the whole state.
  A replay is the settings plus the command log; a snapshot is the whole world
  as plain JSON. Both reproduce a match exactly, and the tests prove it.
- **Maps.** A tile grid with a height at every corner (`src/sim/map.ts`). One
  tile is two metres. Generated maps (`src/sim/mapgen.ts`) are symmetric under
  a half turn, with a river crossed at three fords.
- **Pathfinding.** A lone unit gets an A* path; a group shares one flow field
  (`src/sim/search.ts`, `src/sim/routing.ts`). Searches are budgeted in tiles
  examined per tick, never in time, and resume on the next tick.
- **Movement.** Three passes per tick: intent, separation, commit
  (`src/sim/movement.ts`). Each pass reads only what the previous one wrote, so
  the result does not depend on the order units are visited in.
- **Economy.** Food, wood, stone and gold sit on the map as terrain with an
  amount per tile, and a worked-out tile becomes open grass. Villagers make a
  round trip between a resource and the nearest drop-off
  (`src/sim/economy.ts`). Nothing is created or lost on the way; the tests
  check that on every tick.
- **Farms.** Berries run out; farms do not. A farm is a building until it is
  finished and tilled ground after: it can be walked over, one villager at a
  time works it from the middle, and what they gather is counted as grown
  (`world.grown`) so the books still balance.
- **A map that changes.** Felled trees and buildings alter what can be walked
  on. `GameMap` keeps passability, connected regions and a running state
  checksum up to date change by change, and a route search in progress starts
  over when the map changes under it.
- **Buildings.** Villagers found a building on open grass
  (`src/sim/buildings.ts`); it is paid for at once and blocks its ground from
  then on. Building is work done at the site (`src/sim/economy.ts`). When one
  goes up, routes laid across that ground are re-planned
  (`routesAfterObstacle` in `src/sim/routing.ts`).
- **Training and population.** Buildings train units from a queue
  (`src/sim/production.ts`). A unit is paid for when queued and waits for room
  in the population, which finished town centres and houses provide.
- **Entity types.** `src/sim/entityTypes.ts` is the one table of units and
  buildings: cost, time, speed, size, carrying capacity, footprint, what a
  building trains, houses and takes in, and everything about fighting: hit
  points, armour, damage, range, timing and bonuses.
- **Combat.** `src/sim/combat.ts`. A blow has a wind-up and a pause before
  the next; arrows always hit, after their time in the air. Damage is the
  weapon, plus a bonus against the kinds of target it is good against, less
  armour (one figure against blades, one against arrows), never under 1.
  Everything dealt in a tick comes off at the end of it, so two who strike
  together both land.

  | | hp | hit | every | armour | and |
  |---|---|---|---|---|---|
  | spearman | 80 | 8 | 1.75 s | 0 / 0 | +16 against horsemen; standing still, turns a charge back on the rider |
  | archer | 60 | 5 | 1.5 s | 0 / 0 | +5 against spearmen; shoots 5 tiles |
  | horseman | 120 | 9 | 1.75 s | 0 / 2 | +9 against archers; +10 on the first blow after a run; half as fast again |

  Arrows from ground half a tile higher do a quarter more. Buildings have
  armour 4 / 8, so blades wear them down slowly and arrows hardly at all.
  The town centre and the watchtower shoot back.
- **Orders and enemies.** What a soldier does about an enemy depends on its
  orders (`OrderKind` in `src/sim/world.ts`). With none it guards its post:
  it fights what comes within eight tiles, or whoever hits someone of its
  side within earshot, and then walks back. A plain move ignores the enemy.
  An attack-move fights whatever it meets and then carries on; a patrol does
  that to and fro. Hold strikes only what comes within reach. Players can be
  put on sides (`teams` in the match settings), and allies do not fight.
- **Fog of war.** `src/sim/vision.ts`. Every unit and building sees a disc of
  tiles (7 to 13 across the types), and allies see as one. For each side the
  world counts how many of its own can see each tile and records every tile
  ever seen, which gives the three states a player knows: unexplored,
  explored, visible. The counts follow units from tile to tile and always
  equal a count made from scratch; a saved game stores only what has been
  explored. The fog is in the simulation, not just on the screen, because it
  decides what a side may do: soldiers go only for enemies their side can
  see and lose a quarry that gets out of sight, an attack cannot be ordered
  on an unseen unit (a building on explored ground can be attacked from
  memory), and nothing can be founded on ground never seen. A match starts
  `concealed`, `explored` or `revealed` (`mapState` in the match settings).
  In the playtest, the view (`src/client/game/view.ts`) keeps what the player
  believes: terrain and enemy buildings stay drawn as last seen until someone
  looks again.

## Ages and technology

`src/sim/tech.ts`. A match passes through four ages: Early Medieval
(800–1000), High Medieval (1000–1250), Late Medieval (1250–1450) and Early
Modern (1450–1600). A player leaves one for the next by choosing one of two
**reforms** at the town centre, each a real change in how medieval societies
raised food, money or soldiers. It needs two kinds of building standing, costs
food and gold, takes a minute or more, and leaves its mark for the rest of the
match; the reform not chosen is closed.

| Leaving | One reform | The other |
|---|---|---|
| Early Medieval | Open fields: farms a fifth faster | Knight service: soldiers train a fifth faster |
| High Medieval | Town charters: gold and stone a quarter faster | Paid retinues: soldiers a tenth more hit points |
| Late Medieval | Standing companies: soldiers 15% cheaper | Gunfounding: handgunners hit harder and further |

Seventeen **technologies** are researched at the buildings they belong to
(ploughs at the mill, steel and armour at the blacksmith, pikes at the
barracks). Research sits in a building's queue like a unit in training, is
paid for when queued and refunded if cancelled. Each carries a line on what it
was and when.

Later ages add soldiers in armour, bought with gold, and what beats them:

| | Age | hp | hit | every | armour | and |
|---|---|---|---|---|---|---|
| man-at-arms | High Medieval | 130 | 11 | 1.75 s | 3 / 3 | no weakness to arrows |
| knight | High Medieval | 190 | 14 | 1.75 s | 3 / 3 | +14 on a charge; still fears spears |
| crossbowman | Late Medieval | 70 | 10 | 2.25 s | 0 / 0 | +10 against armour; shoots 5 tiles |
| handgunner | Early Modern | 70 | 32 | 3.5 s | 0 / 0 | +6 against armour; shoots 4 tiles |

How it works underneath: each player has their own copy of the unit and
building figures (`world.types[player]`, read through `world.typeOf(slot)`).
It is rebuilt from the starting figures in `entityTypes.ts` and the list of
what that player has researched, additions first and percentages of the
starting figure after, so the order of research makes no difference and
nothing but the list need be saved. When research finishes, units already in
the field gain what new ones would have. To add a technology, add an entry to
`TECHS` and a name to `TechId`; the tests check that every one can be reached
and changes something. A match can start in a later age (`startAge`).

## The skirmish AI

`src/ai/skirmish.ts`. The AI is a player, not part of the simulation.
`LocalSession.control(player, controller)` hands it a side; before each tick
the session asks it for commands and issues and records them like a person's,
so a replay plays back without it and multiplayer need not know it exists.

It plays fair: no extra resources, and no seeing through the fog. Of the enemy
it knows what its side can see now and the buildings it remembers seeing. The
tests wrap it and check every order against what it could have known. It is
given only where towns can start on the map.

Every second or so it looks at the world and, in order: trains villagers and
builds houses ahead of need; shares villagers between food, wood and a little
stone; plants farms before the berries give out and puts lumber camps by the
trees; builds a barracks, archery range, stable and tower, saving wood for
each; keeps them training, leaning toward what beats the enemy soldiers it
has seen; scouts; comes home to fight raiders; and attacks in waves that go
from one known building to the next, falling back when two in three are lost
and returning with more. It mines gold, chooses a reform when the town is big
enough to bear it, and researches what its buildings offer. `easy`, `standard`
and `hard` differ in how often it thinks, how big it grows, how soon and how
hard it attacks, whether it counters what it sees, and how far through the
ages it goes (easy stops at High Medieval, standard at Late Medieval). Nothing in it is random, so a match between two AIs
plays out the same way every time.

Its plans live outside the world, so they are not in a saved game: after
loading, it picks up from what it can see and has to scout again.

## Rules for code in `src/sim`

`test/determinism-lint.test.ts` enforces these by reading the source:

- No `/`, no decimal literals, no `Math.*` beyond `imul`, `min`, `max`, `abs`.
  Use `mul`, `div`, `idiv`, `mulDiv`, `sqrt` and `length` from `fixed.ts`.
- No clocks, timers, `Math.random`, browser objects, locale functions or async.
  Randomness comes from `world.rng`.
- No imports from outside `src/sim`.
- Add new entity properties with `this.column(...)` in the `World` constructor so the checksum and
  snapshots pick them up automatically.

## Not in yet

Walls, gates and siege engines; garrisoning; civilizations (everyone plays
the same people, with the same reforms on offer); victory conditions in the
simulation (the playtest calls the match when a town centre falls). Mending a
building is free. Soldiers do not change their look as they are upgraded: a
pikeman is drawn as the spearman he was. Formations march as a block but do not keep ranks
on the way. Nothing blocks sight: units see over trees and hills alike, and
high ground does not see further.

If a change alters how a match plays out, the reference checksum in
`test/determinism.test.ts` (and `scripts/browser-check.mjs`) fails. Update it
only when the change in behaviour is intended. The recordings then no longer
describe the game: run `npm run record`, and make the same change in
`csharp/` until `dotnet test csharp/Rts.slnx` passes again.
