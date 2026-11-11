import { describe, expect, it } from 'vitest';
import { hashHex, hashWorld } from '../src/sim/hash';
import { runReplay, type Replay } from '../src/sim/replay';
import { step } from '../src/sim/sim';
import { restoreSnapshot, takeSnapshot, type WorldSnapshot } from '../src/sim/snapshot';
import { defaultConfig, World } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { playRandomMatch } from './helpers';

const TICKS = 900; // 30 seconds of play at 30 ticks per second
const config = defaultConfig({ seed: 20261111, playerCount: 4 });

describe('determinism', () => {
  it('produces the same checksum on every tick when the same match is played twice', () => {
    const first = playRandomMatch(config, 77, TICKS);
    const second = playRandomMatch(config, 77, TICKS);
    expect(second.hashes).toEqual(first.hashes);
  });

  it('actually changes state over time (the checksum is not constant)', () => {
    const { hashes, session } = playRandomMatch(config, 77, TICKS);
    expect(new Set(hashes).size).toBe(TICKS);
    expect(session.replay().commands.length).toBeGreaterThan(200);
    expect(session.world.livingEntities().length).toBeGreaterThan(80);
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

  it('continues identically from a saved game taken mid-match', () => {
    const { session, hashes } = playRandomMatch(config, 77, TICKS);
    const replay = session.replay();
    for (const saveAt of [1, 250, 613]) {
      const original = runReplay(replay, undefined, saveAt);
      // Through JSON, as a save file or a rejoining player would receive it.
      const saved = JSON.parse(JSON.stringify(takeSnapshot(original))) as WorldSnapshot;
      const restored = restoreSnapshot(saved);
      expect(hashWorld(restored)).toBe(hashes[saveAt - 1]);
      // Commands issued after the save still have to be delivered.
      for (const entry of replay.commands) {
        const alreadyKnown = saved.pending.some(
          (p) => p.tick === entry.tick && p.player === entry.player && p.seq === entry.seq,
        );
        if (entry.tick >= restored.tick && !alreadyKnown) {
          restored.commands.schedule(entry, restored.tick);
        }
      }
      while (restored.tick < TICKS) {
        step(restored);
        expect(hashWorld(restored)).toBe(hashes[restored.tick - 1]);
      }
    }
  });

  it('diverges when anything about the inputs differs', () => {
    const base = playRandomMatch(config, 77, TICKS);
    const final = base.hashes[TICKS - 1];

    const otherSeed = playRandomMatch({ ...config, seed: config.seed + 1 }, 77, TICKS);
    expect(otherSeed.hashes[TICKS - 1]).not.toBe(final);

    const replay = base.session.replay();
    const lastMove = replay.commands.findLast(
      (c) => c.command.kind === 'move' && c.command.units.length > 0,
    )!;
    const dropped = replay.commands.filter((c) => c !== lastMove);
    expect(hashWorld(runReplay({ ...replay, commands: dropped }))).not.toBe(final);

    const nudged = replay.commands.map((c) =>
      c === lastMove && c.command.kind === 'move'
        ? { ...c, command: { ...c.command, x: c.command.x + 1 } }
        : c,
    );
    // One 65536th of a tile is enough to be noticed.
    expect(hashWorld(runReplay({ ...replay, commands: nudged }))).not.toBe(final);
  });

  it('matches the recorded checksum for the reference match', () => {
    // This pins the simulation's exact behaviour. It fails whenever a change
    // alters the outcome of a match, deliberately or not. If the change was
    // deliberate, update the value; old replays will no longer play back.
    const { hashes } = playRandomMatch(config, 77, TICKS);
    expect(hashHex(hashes[TICKS - 1]!)).toBe('2f14c7ff');
  });
});

describe('world bookkeeping', () => {
  it('reuses slots safely and invalidates stale handles', () => {
    const world = new World(defaultConfig());
    const a = world.spawn(0, 0, 0, 1);
    const b = world.spawn(0, 0, 0, 1);
    world.destroy(a);
    expect(world.isAlive(a)).toBe(false);
    expect(world.isAlive(b)).toBe(true);
    const c = world.spawn(1, 5, 5, 1);
    expect(c).not.toBe(a);
    expect(world.isAlive(c)).toBe(true);
    expect(world.isAlive(a)).toBe(false);
    expect(world.livingEntities()).toEqual([c, b]);
    expect(world.livingEntities(1)).toEqual([c]);
  });

  it('saves and restores free slots and generations', () => {
    const world = new World(defaultConfig());
    const ids = Array.from({ length: 10 }, (_, i) => world.spawn(i % 2, i * 1000, i * 2000, 100));
    world.destroy(ids[3]!);
    world.destroy(ids[7]!);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(takeSnapshot(world))));
    expect(hashWorld(restored)).toBe(hashWorld(world));
    // Both worlds must hand out the same handle next.
    expect(restored.spawn(0, 1, 1, 1)).toBe(world.spawn(0, 1, 1, 1));
    expect(restored.isAlive(ids[3]!)).toBe(false);
    expect(hashWorld(restored)).toBe(hashWorld(world));
  });

  it('reports a full world instead of overflowing', () => {
    const world = new World(defaultConfig({ maxEntities: 2 }));
    expect(world.spawn(0, 0, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(world.spawn(0, 0, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(world.spawn(0, 0, 0, 0)).toBe(-1);
  });
});
