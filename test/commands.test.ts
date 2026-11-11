import { describe, expect, it } from 'vitest';
import { CommandQueue, type Command, type ScheduledCommand } from '../src/sim/commands';
import { fromInt, ONE, toFloat } from '../src/sim/fixed';
import { hashWorld } from '../src/sim/hash';
import { step } from '../src/sim/sim';
import { perSecondToPerTick } from '../src/sim/units';
import { defaultConfig, entityIndex, World } from '../src/sim/world';

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
    const speed = perSecondToPerTick(fromInt(3), world.config.tickRate);
    const mine = world.spawn(0, fromInt(10), fromInt(10), speed);
    const theirs = world.spawn(1, fromInt(20), fromInt(20), speed);
    return { world, mine, theirs };
  };
  const send = (world: World, player: number, command: Command, seq = 0): void =>
    world.commands.schedule({ tick: world.tick, player, seq, command }, world.tick);

  it('runs a command on exactly the tick it is stamped with', () => {
    const { world, mine } = setup();
    world.commands.schedule(
      { tick: 3, player: 0, seq: 0, command: { kind: 'move', units: [mine], x: fromInt(30), y: fromInt(10) } },
      world.tick,
    );
    const slot = entityIndex(mine);
    for (let i = 0; i < 3; i++) step(world);
    expect(world.posX[slot]).toBe(fromInt(10)); // ticks 0, 1, 2: nothing yet
    step(world);
    expect(world.posX[slot]).toBeGreaterThan(fromInt(10)); // tick 3: moving
  });

  it('moves a unit to its destination and stops it there', () => {
    const { world, mine } = setup();
    send(world, 0, { kind: 'move', units: [mine], x: fromInt(13), y: fromInt(14) });
    const slot = entityIndex(mine);
    // 5 tiles at 3 tiles per second is 50 ticks; allow a couple for rounding.
    for (let i = 0; i < 49; i++) step(world);
    expect(world.moving[slot]).toBe(1);
    for (let i = 0; i < 3; i++) step(world);
    expect(world.moving[slot]).toBe(0);
    expect(world.posX[slot]).toBe(fromInt(13));
    expect(world.posY[slot]).toBe(fromInt(14));
  });

  it("ignores orders for another player's units", () => {
    const { world, theirs } = setup();
    send(world, 0, { kind: 'move', units: [theirs], x: 0, y: 0 });
    step(world);
    expect(world.moving[entityIndex(theirs)]).toBe(0);
  });

  it('ignores handles to units that no longer exist', () => {
    const { world, mine } = setup();
    world.destroy(mine);
    const replacement = world.spawn(0, fromInt(10), fromInt(10), ONE);
    send(world, 0, { kind: 'move', units: [mine], x: 0, y: 0 });
    step(world);
    expect(world.moving[entityIndex(replacement)]).toBe(0);
  });

  it('stops units where they stand', () => {
    const { world, mine } = setup();
    send(world, 0, { kind: 'move', units: [mine], x: fromInt(40), y: fromInt(10) });
    for (let i = 0; i < 10; i++) step(world);
    send(world, 0, { kind: 'stop', units: [mine] }, 1);
    step(world);
    const slot = entityIndex(mine);
    const x = world.posX[slot];
    for (let i = 0; i < 10; i++) step(world);
    expect(world.posX[slot]).toBe(x);
    expect(world.moving[slot]).toBe(0);
  });

  it('keeps destinations and spawn points on the map', () => {
    const { world, mine } = setup();
    send(world, 0, { kind: 'move', units: [mine], x: fromInt(-500), y: fromInt(9000) });
    send(world, 0, { kind: 'spawn', x: fromInt(-50), y: fromInt(-50), count: 30, speed: ONE }, 1);
    step(world);
    const maxX = fromInt(world.config.mapWidth);
    const maxY = fromInt(world.config.mapHeight);
    for (const id of world.livingEntities()) {
      const slot = entityIndex(id);
      for (const x of [world.posX[slot]!, world.targetX[slot]!]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(maxX);
      }
      for (const y of [world.posY[slot]!, world.targetY[slot]!]) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(maxY);
      }
    }
  });

  it('spreads a group over a formation instead of one point', () => {
    const world = new World(defaultConfig());
    send(world, 0, { kind: 'spawn', x: fromInt(30), y: fromInt(30), count: 9, speed: fromInt(4) });
    step(world);
    send(world, 0, { kind: 'move', units: world.livingEntities(0), x: fromInt(10), y: fromInt(10) }, 1);
    step(world);
    const targets = new Set(
      world.livingEntities(0).map((id) => {
        const slot = entityIndex(id);
        return `${world.targetX[slot]},${world.targetY[slot]}`;
      }),
    );
    expect(targets.size).toBe(9);
    // A 3 by 3 block centred on the destination.
    const xs = world.livingEntities(0).map((id) => toFloat(world.targetX[entityIndex(id)]!));
    expect(Math.min(...xs)).toBe(9.25);
    expect(Math.max(...xs)).toBe(10.75);
  });

  it('survives malformed commands without changing anything', () => {
    const { world } = setup();
    const untouched = new World(defaultConfig());
    const speed = perSecondToPerTick(fromInt(3), 30);
    untouched.spawn(0, fromInt(10), fromInt(10), speed);
    untouched.spawn(1, fromInt(20), fromInt(20), speed);

    const garbage = [
      { kind: 'move', units: 'all', x: 1, y: 1 },
      { kind: 'move', units: [1.5, -3, NaN, 'x', null, 2 ** 40], x: NaN, y: undefined },
      { kind: 'stop' },
      { kind: 'spawn', x: 'here', y: {}, count: NaN, speed: -5 },
      { kind: 'teleport', units: [0] },
      {},
    ] as unknown as Command[];
    garbage.forEach((command, seq) => send(world, 0, command, seq));
    send(world, 9, { kind: 'stop', units: [] }, 0); // no such player
    send(world, -1, { kind: 'stop', units: [] }, 0);
    expect(() => step(world)).not.toThrow();
    step(untouched);
    expect(hashWorld(world)).toBe(hashWorld(untouched));
  });
});

describe('tick rate independence', () => {
  it('covers the same ground in the same time at any tick rate', () => {
    for (const tickRate of [8, 20, 30, 60]) {
      const world = new World(defaultConfig({ tickRate }));
      const id = world.spawn(0, fromInt(10), fromInt(10), perSecondToPerTick(fromInt(5), tickRate));
      world.commands.schedule(
        { tick: 0, player: 0, seq: 0, command: { kind: 'move', units: [id], x: fromInt(50), y: fromInt(10) } },
        0,
      );
      for (let i = 0; i < tickRate * 2; i++) step(world); // two seconds
      const travelled = toFloat(world.posX[entityIndex(id)]!) - 10;
      expect(Math.abs(travelled - 10), `at ${tickRate} ticks per second`).toBeLessThan(0.01);
    }
  });
});
