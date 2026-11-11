import { describe, expect, it } from 'vitest';
import { CommandQueue, type Command, type ScheduledCommand } from '../src/sim/commands';
import { fromInt, length, ONE, toFloat } from '../src/sim/fixed';
import { hashWorld } from '../src/sim/hash';
import { step } from '../src/sim/sim';
import { UnitKind } from '../src/sim/unitTypes';
import { defaultConfig, entityIndex, MoveState, World } from '../src/sim/world';

const stop = (tick: number, player: number, seq: number): ScheduledCommand => ({
  tick,
  player,
  seq,
  command: { kind: 'stop', units: [] },
});

describe('command queue', () => {
  it('orders commands within a tick by player, then by sequence', () => {
    const queue = new CommandQueue();
    queue.schedule(stop(5, 1, 1), 0);
    queue.schedule(stop(5, 0, 2), 0);
    queue.schedule(stop(5, 1, 0), 0);
    queue.schedule(stop(5, 0, 0), 0);
    queue.schedule(stop(6, 0, 3), 0);
    expect(queue.size).toBe(5);
    expect(queue.takeDue(5).map((c) => [c.player, c.seq])).toEqual([
      [0, 0],
      [0, 2],
      [1, 0],
      [1, 1],
    ]);
    expect(queue.size).toBe(1);
    expect(queue.takeDue(5)).toEqual([]);
  });

  it('rejects a command for a tick that has already run', () => {
    const queue = new CommandQueue();
    expect(() => queue.schedule(stop(9, 0, 0), 10)).toThrow(/too late/);
    expect(() => queue.schedule(stop(10, 0, 0), 10)).not.toThrow();
  });

  it('rejects the same command delivered twice', () => {
    const queue = new CommandQueue();
    queue.schedule(stop(3, 0, 0), 0);
    expect(() => queue.schedule(stop(3, 0, 0), 0)).toThrow(/duplicate/);
  });

  it('lists waiting commands in the order they will run', () => {
    const queue = new CommandQueue();
    queue.schedule(stop(8, 1, 0), 0);
    queue.schedule(stop(2, 1, 1), 0);
    queue.schedule(stop(2, 0, 0), 0);
    expect(queue.pending().map((c) => [c.tick, c.player])).toEqual([
      [2, 0],
      [2, 1],
      [8, 1],
    ]);
  });
});

describe('applying commands', () => {
  const setup = (): { world: World; mine: number; theirs: number } => {
    const world = new World(defaultConfig());
    const mine = world.spawn(0, UnitKind.Spearman, fromInt(10), fromInt(10));
    const theirs = world.spawn(1, UnitKind.Spearman, fromInt(20), fromInt(20));
    return { world, mine, theirs };
  };
  let nextSeq = 0;
  const send = (world: World, player: number, command: Command): void =>
    world.commands.schedule({ tick: world.tick, player, seq: nextSeq++, command }, world.tick);
  const run = (world: World, ticks: number): void => {
    for (let i = 0; i < ticks; i++) step(world);
  };

  it('runs a command on exactly the tick it is stamped with', () => {
    const { world, mine } = setup();
    world.commands.schedule(
      { tick: 3, player: 0, seq: 0, command: { kind: 'move', units: [mine], x: fromInt(30), y: fromInt(10) } },
      world.tick,
    );
    const slot = entityIndex(mine);
    run(world, 3);
    expect(world.posX[slot]).toBe(fromInt(10)); // ticks 0, 1, 2: nothing yet
    step(world);
    expect(world.posX[slot]).toBeGreaterThan(fromInt(10)); // tick 3: moving
  });

  it('moves a unit to its destination and stops it there', () => {
    const { world, mine } = setup();
    send(world, 0, { kind: 'move', units: [mine], x: fromInt(13), y: fromInt(14) });
    const slot = entityIndex(mine);
    // 5 tiles at 1.6 tiles per second is just under 94 ticks.
    run(world, 90);
    expect(world.moveState[slot]).not.toBe(MoveState.Idle);
    run(world, 6);
    expect(world.moveState[slot]).toBe(MoveState.Idle);
    expect(world.posX[slot]).toBe(fromInt(13));
    expect(world.posY[slot]).toBe(fromInt(14));
  });

  it('turns a unit to face the way it walks', () => {
    const { world, mine } = setup();
    send(world, 0, { kind: 'move', units: [mine], x: fromInt(10), y: fromInt(4) });
    run(world, 5);
    const slot = entityIndex(mine);
    expect(world.dirX[slot]).toBe(0);
    expect(world.dirY[slot]).toBe(-ONE);
  });

  it("ignores orders for another player's units", () => {
    const { world, theirs } = setup();
    send(world, 0, { kind: 'move', units: [theirs], x: 0, y: 0 });
    run(world, 2);
    expect(world.moveState[entityIndex(theirs)]).toBe(MoveState.Idle);
    expect(world.posX[entityIndex(theirs)]).toBe(fromInt(20));
  });

  it('ignores handles to units that no longer exist', () => {
    const { world, mine } = setup();
    world.destroy(mine);
    const replacement = world.spawn(0, UnitKind.Spearman, fromInt(10), fromInt(10));
    send(world, 0, { kind: 'move', units: [mine], x: 0, y: 0 });
    run(world, 2);
    expect(world.moveState[entityIndex(replacement)]).toBe(MoveState.Idle);
  });

  it('stops units where they stand and forgets their waypoints', () => {
    const { world, mine } = setup();
    send(world, 0, { kind: 'move', units: [mine], x: fromInt(40), y: fromInt(10) });
    send(world, 0, { kind: 'move', units: [mine], x: fromInt(40), y: fromInt(40), queue: true });
    run(world, 10);
    const slot = entityIndex(mine);
    expect(world.queueLength[slot]).toBe(1);
    send(world, 0, { kind: 'stop', units: [mine] });
    step(world);
    const x = world.posX[slot];
    run(world, 10);
    expect(world.posX[slot]).toBe(x);
    expect(world.moveState[slot]).toBe(MoveState.Idle);
    expect(world.queueLength[slot]).toBe(0);
  });

  it('keeps destinations and spawn points on the map', () => {
    const { world, mine } = setup();
    send(world, 0, { kind: 'move', units: [mine], x: fromInt(-500), y: fromInt(9000) });
    send(world, 0, { kind: 'spawn', x: fromInt(-50), y: fromInt(-50), count: 30, unitType: 0 });
    step(world);
    for (const id of world.livingEntities()) {
      const slot = entityIndex(id);
      for (const x of [world.posX[slot]!, world.goalX[slot]!]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(world.map.maxX);
      }
      for (const y of [world.posY[slot]!, world.goalY[slot]!]) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(world.map.maxY);
      }
    }
  });

  it('gives each unit of a group its own place in a block facing the way they travel', () => {
    const world = new World(defaultConfig());
    send(world, 0, { kind: 'spawn', x: fromInt(30), y: fromInt(30), count: 9, unitType: 0 });
    step(world);
    const units = world.livingEntities(0);
    send(world, 0, { kind: 'move', units, x: fromInt(30), y: fromInt(10) });
    step(world);
    const goals = units.map((id) => {
      const slot = entityIndex(id);
      return [world.goalX[slot]!, world.goalY[slot]!] as const;
    });
    // Nine units make a front rank of five and a second rank of four. The
    // block faces north, so the ranks are the two clusters of y values.
    const ys = goals.map(([, y]) => toFloat(y)).sort((a, b) => a - b);
    expect(ys[4]! - ys[0]!).toBeLessThan(0.2);
    expect(ys[8]! - ys[5]!).toBeLessThan(0.2);
    expect(ys[5]! - ys[4]!).toBeGreaterThan(0.4);
    // No two places are closer than the formation spacing.
    for (let a = 0; a < goals.length; a++) {
      for (let b = a + 1; b < goals.length; b++) {
        const apart = toFloat(length(goals[a]![0] - goals[b]![0], goals[a]![1] - goals[b]![1]));
        expect(apart).toBeGreaterThan(0.59);
      }
    }
    expect(world.groups.size).toBe(1);
  });

  it('survives malformed commands without changing anything', () => {
    const { world } = setup();
    const untouched = new World(defaultConfig());
    untouched.spawn(0, UnitKind.Spearman, fromInt(10), fromInt(10));
    untouched.spawn(1, UnitKind.Spearman, fromInt(20), fromInt(20));

    const garbage = [
      { kind: 'move', units: 'all', x: 1, y: 1 },
      { kind: 'move', units: [1.5, -3, NaN, 'x', null, 2 ** 40], x: NaN, y: undefined },
      { kind: 'move', units: [], x: 5, y: 5, queue: 'yes' },
      { kind: 'stop' },
      { kind: 'spawn', x: 'here', y: {}, count: NaN, unitType: -5 },
      { kind: 'spawn', x: 0, y: 0, count: 5, unitType: 99 },
      { kind: 'teleport', units: [0] },
      {},
      null,
      'move',
    ] as unknown as Command[];
    for (const command of garbage) send(world, 0, command);
    send(world, 9, { kind: 'stop', units: [] }); // no such player
    send(world, -1, { kind: 'stop', units: [] });
    expect(() => step(world)).not.toThrow();
    step(untouched);
    expect(hashWorld(world)).toBe(hashWorld(untouched));
  });
});

describe('tick rate independence', () => {
  it('covers the same ground in the same time at any tick rate', () => {
    for (const tickRate of [8, 20, 30, 60]) {
      const world = new World(defaultConfig({ tickRate }));
      const id = world.spawn(0, UnitKind.Spearman, fromInt(10), fromInt(10));
      world.commands.schedule(
        { tick: 0, player: 0, seq: 0, command: { kind: 'move', units: [id], x: fromInt(50), y: fromInt(10) } },
        0,
      );
      for (let i = 0; i < tickRate * 5; i++) step(world); // five seconds
      const travelled = toFloat(world.posX[entityIndex(id)]!) - 10;
      // A spearman covers 1.6 tiles a second.
      expect(Math.abs(travelled - 8), `at ${tickRate} ticks per second`).toBeLessThan(0.01);
    }
  });
});
