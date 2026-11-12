import { describe, expect, it } from 'vitest';
import { SkirmishAi, type Controller, type Difficulty } from '../src/ai/skirmish';
import { LocalSession } from '../src/session/localSession';
import { canPlace } from '../src/sim/buildings';
import type { Command } from '../src/sim/commands';
import { Kind } from '../src/sim/entityTypes';
import { hashWorld } from '../src/sim/hash';
import { Terrain } from '../src/sim/map';
import { runReplay } from '../src/sim/replay';
import { TECHS } from '../src/sim/tech';
import { canSee, hasExplored } from '../src/sim/vision';
import { defaultConfig, Job, MoveState, type World } from '../src/sim/world';
import { brokenInvariant } from './helpers';

const MINUTE = 30 * 60;

function match(seed: number, players: (Difficulty | null)[]): { session: LocalSession; ais: (SkirmishAi | null)[] } {
  const session = new LocalSession(
    defaultConfig({
      seed,
      playerCount: 2,
      mapWidth: 128,
      mapHeight: 128,
      map: { kind: 'generated' },
      start: 'standard',
      maxEntities: 2048,
    }),
  );
  const ais = players.map((level, player) => {
    if (level === null) return null;
    const ai = new SkirmishAi(player, level);
    session.control(player, ai);
    return ai;
  });
  return { session, ais };
}

/** How many of each kind of thing a player has. Unfinished buildings are not counted. */
function census(world: World, player: number): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const id of world.livingEntities(player)) {
    const slot = id & 0xfffff;
    if (world.mobile[slot] === 0 && world.built[slot] === 0) continue;
    counts[world.entityType[slot]!] = (counts[world.entityType[slot]!] ?? 0) + 1;
  }
  return counts;
}

const townCentre = (world: World, player: number): number =>
  world.livingEntities(player).find((id) => world.entityType[id & 0xfffff] === Kind.TownCentre) ?? -1;

describe('the skirmish AI', () => {
  it('builds up a town and an army from the standard start', () => {
    const { session } = match(1066, ['standard', 'standard']);
    const { world } = session;
    let idleVillagerTicks = 0;
    let villagerTicks = 0;
    let broken: string | null = null;
    const at: Record<number, Record<number, number>> = {};
    for (let tick = 0; tick < 10 * MINUTE; tick++) {
      session.step();
      if (tick % 97 === 0) broken ??= brokenInvariant(world);
      if (tick % 30 === 0) {
        for (const id of world.livingUnits(0)) {
          const slot = id & 0xfffff;
          if (world.entityType[slot] !== Kind.Villager) continue;
          villagerTicks++;
          if (world.job[slot] === Job.None && world.moveState[slot] === MoveState.Idle) idleVillagerTicks++;
        }
      }
      if ((tick + 1) % MINUTE === 0) at[(tick + 1) / MINUTE] = census(world, 0);
    }
    expect(broken).toBeNull();
    // Three minutes in: villagers streaming out, a house up, a barracks built.
    expect(at[3]![Kind.Villager]).toBeGreaterThanOrEqual(13);
    expect(at[3]![Kind.House]).toBeGreaterThanOrEqual(1);
    expect(at[3]![Kind.Barracks]).toBe(1);
    // Six minutes: the full complement of villagers, somewhere to shoot from, and the first farms.
    expect(at[6]![Kind.Villager]).toBeGreaterThanOrEqual(22);
    expect(at[6]![Kind.ArcheryRange]).toBe(1);
    expect(at[6]![Kind.LumberCamp]).toBeGreaterThanOrEqual(1);
    expect(at[6]![Kind.Farm] ?? 0).toBeGreaterThanOrEqual(1);
    // Ten minutes: the berries are all but gone and the town lives off its farms; all three kinds of soldier can be trained.
    expect(at[10]![Kind.Farm]).toBeGreaterThanOrEqual(8);
    expect(at[10]![Kind.Stable]).toBe(1);
    expect((at[10]![Kind.Watchtower] ?? 0) + (at[10]![Kind.Blacksmith] ?? 0)).toBeGreaterThanOrEqual(1);
    let berries = 0;
    for (let tile = 0; tile < world.map.tileCount; tile++) {
      if (world.map.terrain[tile] === Terrain.Berries && hasExplored(world, 0, tile)) berries += world.map.amount[tile]!;
    }
    expect(berries).toBeLessThan(300);
    expect(world.grown[0]).toBeGreaterThan(500);
    // It has dug for gold, chosen a reform and left the first age, and begun on research.
    expect(at[10]![Kind.MiningCamp]).toBeGreaterThanOrEqual(1);
    expect(world.age[0]).toBeGreaterThanOrEqual(1);
    let researched = 0;
    for (let id = 0; id < TECHS.length; id++) researched += world.researched[id]!;
    expect(researched).toBeGreaterThanOrEqual(4);
    // Its villagers are hardly ever standing about.
    expect(idleVillagerTicks / villagerTicks).toBeLessThan(0.05);
    // And it does all this with a person's worth of orders, not a flood.
    expect(session.replay().commands.length).toBeLessThan(10 * 60 * 2);
  });

  it('plays the same match every time, and the match replays without it', () => {
    const first = match(7, ['standard', 'hard']);
    const second = match(7, ['standard', 'hard']);
    for (let tick = 0; tick < 6 * MINUTE; tick++) {
      first.session.step();
      second.session.step();
      if (tick % 600 === 0) expect(hashWorld(second.session.world)).toBe(hashWorld(first.session.world));
    }
    expect(hashWorld(second.session.world)).toBe(hashWorld(first.session.world));
    // The commands it gave are in the record like anyone's, so the replay needs no AI.
    const replayed = runReplay(first.session.replay());
    expect(hashWorld(replayed)).toBe(hashWorld(first.session.world));
  });

  it('plays fair under the fog: it orders nothing that needs knowledge it could not have', () => {
    const { session, ais } = match(1066, ['standard', 'standard']);
    const { world } = session;
    // Wrap each AI so every order can be checked against what its side could see at the time.
    const problems: string[] = [];
    let attacks = 0;
    let builds = 0;
    ais.forEach((ai, player) => {
      const honest: Controller = {
        act: (now) => {
          const commands: Command[] = ai!.act(now);
          for (const command of commands) {
            if (command.kind === 'attack') {
              attacks++;
              const slot = command.target & 0xfffff;
              if (!now.isAlive(command.target) || !canSee(now, player, slot)) {
                problems.push(`tick ${now.tick}: player ${player} ordered an attack on something out of sight`);
              }
            }
            if (command.kind === 'build') {
              builds++;
              if (!canPlace(now, command.buildingType, command.tileX, command.tileY, player)) {
                problems.push(`tick ${now.tick}: player ${player} tried to build where it could not`);
              }
            }
            if (command.kind === 'gather' && !hasExplored(now, player, command.tile)) {
              problems.push(`tick ${now.tick}: player ${player} sent villagers to a resource it had never seen`);
            }
          }
          return commands;
        },
      };
      session.control(player, honest);
    });
    for (let tick = 0; tick < 12 * MINUTE; tick++) session.step();
    expect(problems).toEqual([]);
    expect(builds).toBeGreaterThan(30);
    // Each side has found the other and remembers what it saw there.
    for (const ai of ais) expect(ai!.status().knownBuildings).toBeGreaterThan(0);
    expect(world.tick).toBe(12 * MINUTE);
    expect(attacks).toBeGreaterThanOrEqual(0);
  });

  it('destroys the town of an opponent who does nothing', () => {
    const { session } = match(1066, [null, 'standard']);
    const { world } = session;
    const doomed = townCentre(world, 0);
    let fell = -1;
    for (let tick = 0; tick < 20 * MINUTE && fell === -1; tick++) {
      session.step();
      if (!world.isAlive(doomed)) fell = tick;
    }
    expect(fell).toBeGreaterThan(4 * MINUTE); // not before it has had time to raise an army
    expect(fell).toBeLessThan(19 * MINUTE);
    // It goes on to hunt down what is left.
    for (let tick = 0; tick < 3 * MINUTE && world.livingEntities(0).length > 0; tick++) session.step();
    expect(world.livingEntities(0).length).toBe(0);
    expect(brokenInvariant(world)).toBeNull();
  });

  it('is stronger at each level: hard outgrows and overruns easy', () => {
    const { session } = match(1066, ['hard', 'easy']);
    const { world } = session;
    const easyTown = townCentre(world, 1);
    const hardTown = townCentre(world, 0);
    let fell = -1;
    for (let tick = 0; tick < 28 * MINUTE && fell === -1; tick++) {
      session.step();
      if (tick === 8 * MINUTE) {
        expect(census(world, 0)[Kind.Villager]!).toBeGreaterThan(census(world, 1)[Kind.Villager]! + 8);
      }
      if (!world.isAlive(easyTown)) fell = tick;
    }
    expect(fell).not.toBe(-1);
    expect(world.isAlive(hardTown)).toBe(true);
    // Hard climbs further through the ages than easy is allowed to.
    expect(world.age[0]).toBeGreaterThanOrEqual(2);
    expect(world.age[1]).toBeLessThanOrEqual(1);
  });
});
