# Medieval RTS (working title)

A historical real-time strategy game covering roughly 800–1600 CE. This
repository holds the first five steps of the core build: the deterministic
simulation loop; maps, pathfinding and unit movement with a 3D view to play
it in; resources and gathering; buildings, training and population; then
combat and the counter triangle.

## Commands

```bash
npm install
npm test               # maths, maps, pathfinding, movement, economy, buildings, combat, determinism, source rules
npm run typecheck
npm run dev            # pages at http://localhost:5173
npm run build          # writes dist/playtest.html and dist/tick-rate-lab.html
npm run check:browser  # reference match must give the same checksum in a browser
```

## Layout

| Path | What it is |
|---|---|
| `src/sim/` | The simulation. Pure, deterministic, no browser or clock access. |
| `src/session/` | Running a match: turning real time into ticks, stamping and recording commands. |
| `src/client/game/` | The 3D playtest: view, camera, selection and orders, minimap. |
| `src/client/` | The Tick Rate Lab debug page. |
| `test/` | Vitest suites. `helpers.ts` plays randomised matches for the determinism tests. |
| `scripts/` | Page build and the cross-browser checksum check. |
| `art-pipeline/` | Generates the models the playtest uses, with its own `package.json`. |
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

Walls, gates and siege engines; garrisoning; fog of war (every unit can be
seen and targeted); an AI (the playtest's red side follows a short script in
`src/client/game/main.ts`); ages and technology. Mending a building is free.
Formations march as a block but do not keep ranks on the way.

If a change alters how a match plays out, the reference checksum in
`test/determinism.test.ts` (and `scripts/browser-check.mjs`) fails. Update it
only when the change in behaviour is intended.
