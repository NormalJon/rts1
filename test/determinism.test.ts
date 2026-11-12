import { describe, expect, it } from 'vitest';
import { fromInt } from '../src/sim/fixed';
import { hashHex, hashWorld } from '../src/sim/hash';
import { runReplay, type Replay } from '../src/sim/replay';
import { step } from '../src/sim/sim';
import { restoreSnapshot, takeSnapshot, type WorldSnapshot } from '../src/sim/snapshot';
import { Kind } from '../src/sim/entityTypes';
import { defaultConfig, Job, World } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { brokenInvariant, playRandomMatch } from './helpers';

const TICKS = 2100; // 70 seconds of play at 30 ticks per second
const config = defaultConfig({ seed: 20261111, playerCount: 2, map: { kind: 'generated' }, start: 'standard' });
// The same match with pathfinding starved, so searches run across many ticks.
const starved = { ...config, pathBudget: 150 };

describe('determinism', () => {
  it('produces the same checksum on every tick when the same match is played twice', () => {
    const first = playRandomMatch(config, 77, TICKS);
    const second = playRandomMatch(config, 77, TICKS);
    expect(second.hashes).toEqual(first.hashes);
  });

  it('actually exercises the simulation', () => {
    // Tally what went on during the match, tick by tick.
    let harvesting = 0;
    let constructing = 0;
    let mostBuildings = 0;
    let mostQueued = 0;
    let striking = 0;
    let arrows = 0;
    let fighting = 0;
    const { hashes, session } = playRandomMatch(config, 77, TICKS, (world) => {
      let buildings = 0;
      arrows += world.shotCount;
      for (let slot = 0; slot < world.highWater; slot++) {
        if (world.alive[slot] === 0) continue;
        if (world.job[slot] === Job.Harvesting) harvesting++;
        if (world.job[slot] === Job.Constructing) constructing++;
        if (world.windup[slot]! > 0) striking++;
        if (world.engaged[slot] === 1) fighting++;
        if (world.mobile[slot] === 0) {
          buildings++;
          mostQueued = Math.max(mostQueued, world.trainLength[slot]!);
        }
      }
      mostBuildings = Math.max(mostBuildings, buildings);
    });
    const replay = session.replay();
    expect(new Set(hashes).size).toBeGreaterThan(TICKS - 30);
    expect(replay.commands.length).toBeGreaterThan(100);
    expect(replay.commands.some((c) => c.command.kind === 'move' && c.command.queue === true)).toBe(true);
    const kinds = [
      'gather', 'deliver', 'build', 'construct', 'train', 'cancelTrain', 'rally', 'demolish',
      'attack', 'attackMove', 'patrol', 'hold', 'stop',
    ] as const;
    for (const kind of kinds) {
      expect(replay.commands.some((c) => c.command.kind === kind), kind).toBe(true);
    }
    expect(session.world.livingEntities().length).toBeGreaterThan(20);
    // Villagers gathered and built, sites were founded, units were queued and paid for.
    expect(harvesting).toBeGreaterThan(300);
    expect(constructing).toBeGreaterThan(300);
    expect(mostBuildings).toBeGreaterThan(2);
    expect(mostQueued).toBeGreaterThan(0);
    const { spent } = session.world;
    expect(spent[0]! + spent[4]!).toBeGreaterThan(0); // food, on units
    // Soldiers fought, arrows flew, and some of both sides did not come back.
    expect(fighting).toBeGreaterThan(3000);
    expect(striking).toBeGreaterThan(1000);
    expect(arrows).toBeGreaterThan(200);
    const { generation, highWater } = session.world;
    let deaths = 0;
    for (let slot = 0; slot < highWater; slot++) deaths += generation[slot]!;
    expect(deaths).toBeGreaterThan(5);
  });

  it('never leaves a unit in an obstacle or a group miscounted', () => {
    for (const settings of [config, starved]) {
      let broken: string | null = null;
      playRandomMatch(settings, 77, TICKS, (world) => {
        broken ??= brokenInvariant(world);
      });
      expect(broken).toBeNull();
    }
  });

  it('rebuilds the match exactly from its replay', () => {
    const { session, hashes } = playRandomMatch(config, 77, TICKS);
    const replayed: number[] = [];
    runReplay(session.replay(), (world) => replayed.push(hashWorld(world)));
    expect(replayed).toEqual(hashes);
  });

  it('rebuilds the match from a replay that has been through JSON', () => {
    const { session, hashes } = playRandomMatch(config, 77, TICKS);
    const fromDisk = JSON.parse(JSON.stringify(session.replay())) as Replay;
    const world = runReplay(fromDisk);
    expect(hashWorld(world)).toBe(hashes[TICKS - 1]);
  });

  it('does not care what order commands arrive in', () => {
    const { session, hashes } = playRandomMatch(config, 77, TICKS);
    const replay = session.replay();
    const shuffled = [...replay.commands];
    const shuffler = new Rng(5);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = shuffler.nextInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const world = runReplay({ ...replay, commands: shuffled });
    expect(hashWorld(world)).toBe(hashes[TICKS - 1]);
  });

  /** Saves at a tick, loads the save through JSON, and checks every later tick matches. */
  const continuesFrom = (replay: Replay, hashes: readonly number[], saveAt: number): void => {
    const original = runReplay(replay, undefined, saveAt);
    const saved = JSON.parse(JSON.stringify(takeSnapshot(original))) as WorldSnapshot;
    const restored = restoreSnapshot(saved);
    expect(hashWorld(restored), `straight after loading at tick ${saveAt}`).toBe(hashes[saveAt - 1]);
    // Commands issued after the save still have to be delivered.
    for (const entry of replay.commands) {
      const alreadyKnown = saved.pending.some(
        (p) => p.tick === entry.tick && p.player === entry.player && p.seq === entry.seq,
      );
      if (entry.tick >= restored.tick && !alreadyKnown) restored.commands.schedule(entry, restored.tick);
    }
    while (restored.tick < replay.ticks) {
      step(restored);
      if (hashWorld(restored) !== hashes[restored.tick - 1]) {
        throw new Error(`saved at tick ${saveAt}, diverged at tick ${restored.tick}`);
      }
    }
  };

  it('continues identically from a saved game taken mid-match', () => {
    const { session, hashes } = playRandomMatch(config, 77, TICKS);
    for (const saveAt of [1, 250, 613, 1180, 1790]) continuesFrom(session.replay(), hashes, saveAt);
  });

  it('continues identically from a save taken in the middle of a route search', () => {
    const { session, hashes } = playRandomMatch(starved, 77, TICKS);
    const replay = session.replay();
    // Find ticks at which a search was part-way through and others were queued behind it.
    const midSearch: number[] = [];
    runReplay(replay, (world) => {
      const active = world.activeSearch;
      if (active !== null && active.search.expansions > 0 && midSearch.length < 4) {
        if (midSearch.length === 0 || world.tick > midSearch[midSearch.length - 1]! + 60) {
          midSearch.push(world.tick);
        }
      }
    });
    expect(midSearch.length).toBeGreaterThanOrEqual(3);
    for (const saveAt of midSearch) continuesFrom(replay, hashes, saveAt);
  });

  it('diverges when anything about the inputs differs', () => {
    const base = playRandomMatch(config, 77, TICKS);
    const final = base.hashes[TICKS - 1];

    const otherSeed = playRandomMatch({ ...config, seed: config.seed + 1 }, 77, TICKS);
    expect(otherSeed.hashes[TICKS - 1]).not.toBe(final);

    const replay = base.session.replay();
    const lastMove = replay.commands.findLast(
      (c) => c.command.kind === 'move' && c.command.units.length > 0 && c.tick < TICKS - 120,
    )!;
    const dropped = replay.commands.filter((c) => c !== lastMove);
    expect(hashWorld(runReplay({ ...replay, commands: dropped }))).not.toBe(final);
  });

  it('matches the recorded checksum for the reference match', () => {
    // This pins the simulation's exact behaviour. It fails whenever a change
    // alters the outcome of a match, deliberately or not. If the change was
    // deliberate, update the value here and in scripts/browser-check.mjs; old
    // replays will no longer play back.
    const { hashes } = playRandomMatch(config, 77, TICKS);
    expect(hashHex(hashes[TICKS - 1]!)).toBe('ab77540a');
  });
});

describe('world bookkeeping', () => {
  const at = (n: number): number => fromInt(n);

  it('reuses slots safely and invalidates stale handles', () => {
    const world = new World(defaultConfig());
    const a = world.spawnUnit(0, Kind.Spearman, at(3), at(3));
    const b = world.spawnUnit(0, Kind.Spearman, at(6), at(3));
    world.destroy(a);
    expect(world.isAlive(a)).toBe(false);
    expect(world.isAlive(b)).toBe(true);
    const c = world.spawnUnit(1, Kind.Villager, at(5), at(5));
    expect(c).not.toBe(a);
    expect(world.isAlive(c)).toBe(true);
    expect(world.isAlive(a)).toBe(false);
    expect(world.livingEntities()).toEqual([c, b]);
    expect(world.livingEntities(1)).toEqual([c]);
  });

  it('saves and restores free slots and generations', () => {
    const world = new World(defaultConfig());
    const ids = Array.from({ length: 10 }, (_, i) => world.spawnUnit(i % 2, i % 2, at(2 + i * 3), at(4)));
    world.destroy(ids[3]!);
    world.destroy(ids[7]!);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(takeSnapshot(world))));
    expect(hashWorld(restored)).toBe(hashWorld(world));
    // Both worlds must hand out the same handle next.
    expect(restored.spawnUnit(0, 0, at(9), at(9))).toBe(world.spawnUnit(0, 0, at(9), at(9)));
    expect(restored.isAlive(ids[3]!)).toBe(false);
    expect(hashWorld(restored)).toBe(hashWorld(world));
  });

  it('releases a dead unit\'s claim on its group', () => {
    const world = new World(defaultConfig());
    const a = world.spawnUnit(0, 0, at(10), at(10));
    const b = world.spawnUnit(0, 0, at(11), at(10));
    world.commands.schedule(
      { tick: 0, player: 0, seq: 0, command: { kind: 'move', units: [a, b], x: at(40), y: at(40) } },
      0,
    );
    step(world);
    expect(world.groups.size).toBe(1);
    world.destroy(a);
    expect(brokenInvariant(world)).toBeNull();
    world.destroy(b);
    expect(world.groups.size).toBe(0);
  });

  it('reports a full world instead of overflowing', () => {
    const world = new World(defaultConfig({ maxEntities: 2 }));
    expect(world.spawnUnit(0, 0, at(1), at(1))).toBeGreaterThanOrEqual(0);
    expect(world.spawnUnit(0, 0, at(2), at(1))).toBeGreaterThanOrEqual(0);
    expect(world.spawnUnit(0, 0, at(3), at(1))).toBe(-1);
  });
});
