# Medieval RTS (working title)

A historical real-time strategy game covering roughly 800–1600 CE. This
repository holds the first two steps of the core build: the deterministic
simulation loop, then maps, pathfinding, unit movement and a 3D view to
play it in.

## Commands

```bash
npm install
npm test               # maths, maps, pathfinding, movement, determinism, source rules
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

## Rules for code in `src/sim`

`test/determinism-lint.test.ts` enforces these by reading the source:

- No `/`, no decimal literals, no `Math.*` beyond `imul`, `min`, `max`, `abs`.
  Use `mul`, `div`, `idiv`, `mulDiv`, `sqrt` and `length` from `fixed.ts`.
- No clocks, timers, `Math.random`, browser objects, locale functions or async.
  Randomness comes from `world.rng`.
- No imports from outside `src/sim`.
- Add new entity properties with `this.column(...)` in the `World` constructor so the checksum and
  snapshots pick them up automatically.

If a change alters how a match plays out, the reference checksum in
`test/determinism.test.ts` (and `scripts/browser-check.mjs`) fails. Update it
only when the change in behaviour is intended.
