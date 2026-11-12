import { describe, expect, it } from 'vitest';
import { damageOf } from '../src/sim/combat';
import type { Command } from '../src/sim/commands';
import { Age, ENTITY_TYPES, Kind, Resource, ticksPerUnit } from '../src/sim/entityTypes';
import { ONE } from '../src/sim/fixed';
import { hashWorld } from '../src/sim/hash';
import { Terrain } from '../src/sim/map';
import { countPopulation } from '../src/sim/production';
import { step } from '../src/sim/sim';
import { restoreSnapshot, takeSnapshot, type WorldSnapshot } from '../src/sim/snapshot';
import { finishResearch, isQueued, QUEUED_TECH, TechId, TECHS, TERRAINS, whyNot } from '../src/sim/tech';
import { fromFloat } from '../src/sim/units';
import { defaultConfig, entityIndex, World, type SimConfig } from '../src/sim/world';
import { brokenInvariant } from './helpers';

function town(overrides: Partial<SimConfig> = {}): { world: World; hall: number } {
  const world = new World(defaultConfig({ mapWidth: 60, mapHeight: 60, mapState: 'revealed', ...overrides }));
  const hall = world.spawnBuilding(0, Kind.TownCentre, 12, 12);
  world.spawnBuilding(1, Kind.TownCentre, 48, 48);
  world.stock.set([5000, 5000, 5000, 5000], 0);
  world.stock.set([5000, 5000, 5000, 5000], 4);
  return { world, hall };
}

let seq = 0;
function send(world: World, player: number, command: Command): void {
  world.commands.schedule({ tick: world.tick, player, seq: seq++, command }, world.tick);
}

function run(world: World, ticks: number, done?: () => boolean): number {
  for (let i = 0; i < ticks; i++) {
    step(world);
    const broken = brokenInvariant(world);
    if (broken !== null) throw new Error(`tick ${world.tick}: ${broken}`);
    if (done?.()) return i + 1;
  }
  return ticks;
}

const slotOf = entityIndex;
const has = (world: World, player: number, tech: number): boolean => world.researched[player * TECHS.length + tech] === 1;
const stock = (world: World, player: number): number[] => Array.from(world.stock.subarray(player * 4, player * 4 + 4));
/** Gives a player a technology on the spot, as if one of their buildings had just finished researching it. */
const grant = (world: World, building: number, tech: number): void => finishResearch(world, slotOf(building), tech);

describe('the technologies themselves', () => {
  it('are each researched somewhere a player can have, after things that come before them', () => {
    TECHS.forEach((tech, id) => {
      const where = ENTITY_TYPES[tech.at]!;
      expect(where.building, tech.name).toBe(true);
      expect(where.age, `${tech.name} is researched at a building of a later age`).toBeLessThanOrEqual(tech.age);
      for (const first of tech.requires) {
        expect(first, tech.name).toBeLessThan(id);
        expect(TECHS[first]!.age, tech.name).toBeLessThanOrEqual(tech.age);
      }
      expect(tech.cost.every((amount) => amount >= 0), tech.name).toBe(true);
      expect(tech.cost.some((amount) => amount > 0), tech.name).toBe(true);
      expect(tech.seconds, tech.name).toBeGreaterThan(0);
      expect(tech.about.length, tech.name).toBeGreaterThan(40);
      expect(tech.effects.length, tech.name).toBeGreaterThan(0);
    });
    expect(Object.keys(TechId).length).toBe(TECHS.length);
    expect(TECHS.length).toBeLessThan(256 - QUEUED_TECH);
  });

  it('offer exactly two reforms in each age but the last', () => {
    for (const age of [Age.EarlyMedieval, Age.HighMedieval, Age.LateMedieval]) {
      const offered = TECHS.filter((tech) => tech.reform && tech.age === age);
      expect(offered.length, `age ${age}`).toBe(2);
      for (const tech of offered) expect(tech.at).toBe(Kind.TownCentre);
    }
    expect(TECHS.filter((tech) => tech.reform && tech.age === Age.EarlyModern)).toEqual([]);
  });

  it('each change something: no effect falls on nothing', () => {
    const { world, hall } = town();
    for (let id = 0; id < TECHS.length; id++) {
      const before = JSON.stringify([world.types[0], Array.from(world.gatherBonus.subarray(0, TERRAINS))]);
      grant(world, hall, id);
      const after = JSON.stringify([world.types[0], Array.from(world.gatherBonus.subarray(0, TERRAINS))]);
      expect(after, TECHS[id]!.name).not.toBe(before);
    }
    // And none of it touched the other player.
    expect(JSON.stringify(world.types[1])).toBe(JSON.stringify(ENTITY_TYPES));
    expect(brokenInvariant(world)).toBeNull();
  });

  it('come out the same whatever order they are researched in', () => {
    const forward = town();
    const backward = town();
    for (let id = 0; id < TECHS.length; id++) grant(forward.world, forward.hall, id);
    for (let id = TECHS.length - 1; id >= 0; id--) grant(backward.world, backward.hall, id);
    expect(JSON.stringify(backward.world.types[0])).toBe(JSON.stringify(forward.world.types[0]));
    expect(Array.from(backward.world.gatherBonus)).toEqual(Array.from(forward.world.gatherBonus));
  });
});

describe('ages', () => {
  it('begin with the Early Medieval, where only its own soldiers and buildings can be had', () => {
    const { world } = town();
    expect(Array.from(world.age)).toEqual([0, 0]);
    const barracks = world.spawnBuilding(0, Kind.Barracks, 20, 12);
    const builder = world.spawnUnit(0, Kind.Villager, fromFloat(16.5), fromFloat(16.5));
    send(world, 0, { kind: 'train', building: barracks, unitType: Kind.ManAtArms });
    send(world, 0, { kind: 'build', units: [builder], buildingType: Kind.Blacksmith, tileX: 20, tileY: 20 });
    run(world, 5);
    expect(world.trainLength[slotOf(barracks)]).toBe(0);
    expect(world.livingEntities(0).length).toBe(3);
    expect(stock(world, 0)).toEqual([5000, 5000, 5000, 5000]);
    // The spearman, the archer and the horseman are there from the start.
    send(world, 0, { kind: 'train', building: barracks, unitType: Kind.Spearman });
    run(world, 5);
    expect(world.trainLength[slotOf(barracks)]).toBe(1);
  });

  it('are left by choosing one of two reforms, which needs two kinds of building standing', () => {
    const { world, hall } = town();
    expect(whyNot(world, 0, TechId.OpenFields)).toMatch(/needs 2 of/);
    send(world, 0, { kind: 'research', building: hall, tech: TechId.OpenFields });
    run(world, 5);
    expect(world.trainLength[slotOf(hall)]).toBe(0);
    world.spawnBuilding(0, Kind.Mill, 20, 12);
    world.spawnBuilding(0, Kind.Mill, 24, 12); // two of one kind is still one kind
    expect(whyNot(world, 0, TechId.OpenFields)).toMatch(/needs 2 of/);
    world.spawnBuilding(0, Kind.LumberCamp, 20, 16);
    expect(whyNot(world, 0, TechId.OpenFields)).toBeNull();
    expect(whyNot(world, 0, TechId.TownCharters)).toBe('not yet');

    send(world, 0, { kind: 'research', building: hall, tech: TechId.OpenFields });
    run(world, 2);
    expect(stock(world, 0)).toEqual([4600, 5000, 5000, 4850]);
    expect(isQueued(world, 0, TechId.OpenFields)).toBe(true);
    // Having started down one road, the other cannot be started too.
    send(world, 0, { kind: 'research', building: hall, tech: TechId.KnightService });
    run(world, 2);
    expect(world.trainLength[slotOf(hall)]).toBe(1);
    expect(whyNot(world, 0, TechId.KnightService)).toBe('another reform is under way');

    const ticks = run(world, 3000, () => world.age[0] === Age.HighMedieval);
    // Sixty seconds of work, four ticks of which were done above.
    expect(ticks).toBe(60 * 30 - 4);
    expect(has(world, 0, TechId.OpenFields)).toBe(true);
    expect(world.trainLength[slotOf(hall)]).toBe(0);
    expect(world.age[1]).toBe(Age.EarlyMedieval);
    // The road not taken is closed.
    expect(whyNot(world, 0, TechId.KnightService)).toBe('that age is past');
    send(world, 0, { kind: 'research', building: hall, tech: TechId.KnightService });
    run(world, 5);
    expect(world.trainLength[slotOf(hall)]).toBe(0);
    expect(has(world, 0, TechId.KnightService)).toBe(false);
    // Its mark is on the player: farms a fifth faster.
    expect(world.gatherBonus[Terrain.Field]).toBe(20);
    expect(world.gatherBonus[TERRAINS + Terrain.Field]).toBe(0);
  });

  it('open up new soldiers and buildings as they are reached', () => {
    const { world } = town({ startAge: Age.HighMedieval });
    const barracks = world.spawnBuilding(0, Kind.Barracks, 20, 12);
    const range = world.spawnBuilding(0, Kind.ArcheryRange, 28, 12);
    world.spawnBuilding(0, Kind.House, 20, 20);
    const builder = world.spawnUnit(0, Kind.Villager, fromFloat(16.5), fromFloat(16.5));
    send(world, 0, { kind: 'train', building: barracks, unitType: Kind.ManAtArms });
    send(world, 0, { kind: 'train', building: range, unitType: Kind.Crossbowman }); // an age too soon
    send(world, 0, { kind: 'build', units: [builder], buildingType: Kind.Blacksmith, tileX: 30, tileY: 22 });
    run(world, 5);
    expect(world.trainLength[slotOf(barracks)]).toBe(1);
    expect(world.trainLength[slotOf(range)]).toBe(0);
    expect(world.livingEntities(0).some((id) => world.entityType[slotOf(id)] === Kind.Blacksmith)).toBe(true);
    run(world, 30 * 30, () => world.livingUnits(0).length === 2);
    expect(world.livingUnits(0).map((id) => world.entityType[slotOf(id)]).sort()).toEqual([Kind.Villager, Kind.ManAtArms]);
  });

  it('can be set for the whole match, for games that start later', () => {
    const { world } = town({ startAge: Age.LateMedieval });
    expect(Array.from(world.age)).toEqual([2, 2]);
    expect(whyNot(world, 0, TechId.OpenFields)).toBe('that age is past');
    expect(() => new World(defaultConfig({ startAge: 4 }))).toThrow();
  });
});

describe('research', () => {
  it('waits its turn in the building\'s queue, is paid for when queued and refunded when cancelled', () => {
    const { world, hall } = town({ startAge: Age.HighMedieval });
    world.spawnBuilding(0, Kind.House, 20, 12);
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    send(world, 0, { kind: 'research', building: hall, tech: TechId.Wheelbarrow });
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    run(world, 2);
    const queue = Array.from(world.trainQueue.subarray(slotOf(hall) * 8, slotOf(hall) * 8 + 3));
    expect(queue).toEqual([Kind.Villager + 1, QUEUED_TECH + TechId.Wheelbarrow, Kind.Villager + 1]);
    expect(stock(world, 0)).toEqual([5000 - 50 - 150 - 50, 5000 - 100, 5000, 5000]);
    // It cannot be queued twice, here or anywhere.
    send(world, 0, { kind: 'research', building: hall, tech: TechId.Wheelbarrow });
    run(world, 2);
    expect(world.trainLength[slotOf(hall)]).toBe(3);
    send(world, 0, { kind: 'cancelTrain', building: hall, index: 1 });
    run(world, 2);
    expect(world.trainLength[slotOf(hall)]).toBe(2);
    expect(stock(world, 0)).toEqual([4900, 5000, 5000, 5000]);
    expect(isQueued(world, 0, TechId.Wheelbarrow)).toBe(false);
  });

  it('needs the right building, finished and the player\'s own, the right age and what comes before', () => {
    const { world, hall } = town();
    const mill = world.spawnBuilding(0, Kind.Mill, 20, 12);
    const site = world.spawnBuilding(0, Kind.LumberCamp, 20, 16, false);
    const theirs = world.spawnBuilding(1, Kind.Mill, 40, 48);
    const refused: Command[] = [
      { kind: 'research', building: hall, tech: TechId.HeavyPlough }, // wrong building
      { kind: 'research', building: site, tech: TechId.FellingAxes }, // not finished
      { kind: 'research', building: theirs, tech: TechId.HeavyPlough }, // not the player's
      { kind: 'research', building: mill, tech: TechId.HorseCollar }, // an age too soon, and nothing before it
      { kind: 'research', building: mill, tech: 999 },
      { kind: 'research', building: mill, tech: -1 },
      { kind: 'research', building: 123456, tech: TechId.HeavyPlough },
    ];
    for (const command of refused) send(world, 0, command);
    run(world, 3);
    expect(stock(world, 0)).toEqual([5000, 5000, 5000, 5000]);
    expect(whyNot(world, 0, TechId.HorseCollar)).toBe('needs the High Medieval age');
    world.age[0] = Age.HighMedieval;
    expect(whyNot(world, 0, TechId.HorseCollar)).toBe('needs Heavy plough');
  });

  it('cannot be had without the means to pay for it', () => {
    for (const [wood, queued] of [[124, 0], [125, 1]] as const) {
      const { world } = town();
      const mill = world.spawnBuilding(0, Kind.Mill, 20, 12);
      world.stock.set([0, wood, 0, 0], 0);
      send(world, 0, { kind: 'research', building: mill, tech: TechId.HeavyPlough });
      run(world, 3);
      expect(world.trainLength[slotOf(mill)]).toBe(queued);
    }
  });

  it('takes its stated time and needs no room in the population', () => {
    const { world } = town();
    const mill = world.spawnBuilding(0, Kind.Mill, 20, 12);
    // A full town: nothing can be trained, but research goes ahead.
    for (let i = 0; i < 10; i++) world.spawnUnit(0, Kind.Villager, fromFloat(14.5 + i), fromFloat(18.5));
    expect(countPopulation(world).used[0]).toBe(countPopulation(world).room[0]);
    send(world, 0, { kind: 'research', building: mill, tech: TechId.HeavyPlough });
    const ticks = run(world, 2000, () => has(world, 0, TechId.HeavyPlough));
    expect(ticks).toBe(30 * 30);
    expect(countPopulation(world).used[0]).toBe(10);
  });

  it('is lost with the building, and can then be begun again elsewhere', () => {
    const { world } = town();
    const mill = world.spawnBuilding(0, Kind.Mill, 20, 12);
    const second = world.spawnBuilding(0, Kind.Mill, 26, 12);
    send(world, 0, { kind: 'research', building: mill, tech: TechId.HeavyPlough });
    run(world, 100);
    world.destroy(mill);
    expect(isQueued(world, 0, TechId.HeavyPlough)).toBe(false);
    expect(stock(world, 0)[Resource.Wood]).toBe(5000 - 125); // destroyed, not cancelled: no refund
    send(world, 0, { kind: 'research', building: second, tech: TechId.HeavyPlough });
    run(world, 2000, () => has(world, 0, TechId.HeavyPlough));
    expect(has(world, 0, TechId.HeavyPlough)).toBe(true);
    // Pulling a building down oneself does give research back.
    send(world, 0, { kind: 'research', building: second, tech: TechId.FellingAxes }); // wrong building: ignored
    world.age[0] = Age.HighMedieval;
    send(world, 0, { kind: 'research', building: second, tech: TechId.HorseCollar });
    run(world, 3);
    const before = stock(world, 0);
    send(world, 0, { kind: 'demolish', targets: [second] });
    run(world, 3);
    expect(stock(world, 0)[Resource.Wood]).toBe(before[Resource.Wood]! + 200);
    expect(stock(world, 0)[Resource.Gold]).toBe(before[Resource.Gold]! + 50);
  });

  it('comes back from a saved game half done and finishes on the same tick', () => {
    const { world, hall } = town({ startAge: Age.HighMedieval });
    const smith = world.spawnBuilding(0, Kind.Blacksmith, 20, 12);
    grant(world, hall, TechId.HeavyPlough);
    send(world, 0, { kind: 'research', building: smith, tech: TechId.SteeledEdges });
    send(world, 0, { kind: 'research', building: smith, tech: TechId.MailHauberks });
    run(world, 500);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(takeSnapshot(world))) as WorldSnapshot);
    expect(hashWorld(restored)).toBe(hashWorld(world));
    expect(JSON.stringify(restored.types)).toBe(JSON.stringify(world.types));
    expect(Array.from(restored.gatherBonus)).toEqual(Array.from(world.gatherBonus));
    let finishedAt = -1;
    let restoredAt = -1;
    for (let i = 0; i < 2500; i++) {
      step(world);
      step(restored);
      if (finishedAt === -1 && has(world, 0, TechId.MailHauberks)) finishedAt = world.tick;
      if (restoredAt === -1 && has(restored, 0, TechId.MailHauberks)) restoredAt = restored.tick;
    }
    expect(finishedAt).toBeGreaterThan(0);
    expect(restoredAt).toBe(finishedAt);
    expect(hashWorld(restored)).toBe(hashWorld(world));
  });
});

describe('what research does', () => {
  it('speeds the work it is about: felling axes make woodcutters 15 per cent faster', () => {
    const { world, hall } = town();
    expect(ticksPerUnit(Terrain.Forest, 30)).toBe(45);
    expect(ticksPerUnit(Terrain.Forest, 30, 15)).toBe(39);
    expect(ticksPerUnit(Terrain.Forest, 30, 35)).toBe(33);
    grant(world, hall, TechId.FellingAxes);
    expect(world.gatherBonus[Terrain.Forest]).toBe(15);
    expect(world.gatherBonus[Terrain.Field]).toBe(0);
    // Bonuses on the same work add up.
    grant(world, hall, TechId.Sawmills);
    expect(world.gatherBonus[Terrain.Forest]).toBe(35);
  });

  it('changes the soldiers a player already has as well as those to come, and nobody else\'s', () => {
    const { world, hall } = town();
    const sound = world.spawnUnit(0, Kind.Spearman, fromFloat(20.5), fromFloat(20.5));
    const hurt = world.spawnUnit(0, Kind.Spearman, fromFloat(22.5), fromFloat(20.5));
    const enemy = world.spawnUnit(1, Kind.Spearman, fromFloat(40.5), fromFloat(40.5));
    world.hp[slotOf(hurt)] = 50;
    grant(world, hall, TechId.PaidRetinues);
    expect(world.types[0]![Kind.Spearman]!.hp).toBe(88);
    expect(world.hp[slotOf(sound)]).toBe(88);
    expect(world.hp[slotOf(hurt)]).toBe(58); // the wound stays; only the extra is added
    expect(world.hp[slotOf(enemy)]).toBe(80);
    const fresh = world.spawnUnit(0, Kind.Spearman, fromFloat(24.5), fromFloat(20.5));
    expect(world.hp[slotOf(fresh)]).toBe(88);
    expect(world.types[1]![Kind.Spearman]!.hp).toBe(80);
    expect(ENTITY_TYPES[Kind.Spearman]!.hp).toBe(80);
  });

  it('sharpens blades and thickens armour at the blacksmith', () => {
    const { world, hall } = town();
    const mine = slotOf(world.spawnUnit(0, Kind.Spearman, fromFloat(20.5), fromFloat(20.5)));
    const theirs = slotOf(world.spawnUnit(1, Kind.Spearman, fromFloat(21.5), fromFloat(20.5)));
    const theirArcher = slotOf(world.spawnUnit(1, Kind.Archer, fromFloat(25.5), fromFloat(20.5)));
    const theirRider = slotOf(world.spawnUnit(1, Kind.Horseman, fromFloat(23.5), fromFloat(20.5)));
    expect(damageOf(world, mine, theirs, 0)).toBe(8);
    grant(world, hall, TechId.SteeledEdges);
    expect(damageOf(world, mine, theirs, 0)).toBe(9);
    expect(damageOf(world, theirs, mine, 0)).toBe(8);
    grant(world, hall, TechId.BlastFurnace);
    expect(damageOf(world, mine, theirs, 0)).toBe(11);
    grant(world, hall, TechId.MailHauberks);
    expect(damageOf(world, theirs, mine, 0)).toBe(7);
    expect(damageOf(world, theirArcher, mine, 0)).toBe(10); // mail does nothing against arrows
    grant(world, hall, TechId.CoatOfPlates);
    expect(damageOf(world, theirs, mine, 0)).toBe(6);
    expect(damageOf(world, theirArcher, mine, 0)).toBe(9);
    // Longer spears do more to horses and nothing more to anyone else.
    grant(world, hall, TechId.LongSpears);
    expect(damageOf(world, mine, theirRider, 0)).toBe(11 + 16 + 4);
    expect(damageOf(world, mine, theirs, 0)).toBe(11);
  });

  it('gives a unit its later name and reach: archers become longbowmen', () => {
    const { world, hall } = town();
    expect(world.types[0]![Kind.Archer]!.name).toBe('archer');
    grant(world, hall, TechId.Longbows);
    const longbow = world.types[0]![Kind.Archer]!;
    expect(longbow.name).toBe('longbowman');
    expect(longbow.range).toBe(6 * ONE);
    expect(longbow.damage).toBe(6);
    expect(world.types[1]![Kind.Archer]!.name).toBe('archer');
    // In the field: a longbowman outranges an archer by a tile.
    const bow = world.spawnUnit(0, Kind.Archer, fromFloat(20.5), fromFloat(30.5));
    const foe = world.spawnUnit(1, Kind.Archer, fromFloat(26.9), fromFloat(30.5));
    send(world, 0, { kind: 'hold', units: [bow] });
    send(world, 1, { kind: 'hold', units: [foe] });
    run(world, 200);
    expect(world.hp[slotOf(foe)]).toBeLessThan(60);
    expect(world.hp[slotOf(bow)]).toBe(60);
  });

  it('makes villagers carry more and walk faster with the wheelbarrow', () => {
    const { world, hall } = town();
    const villager = slotOf(world.spawnUnit(0, Kind.Villager, fromFloat(20.5), fromFloat(20.5)));
    const before = world.speed[villager]!;
    grant(world, hall, TechId.Wheelbarrow);
    expect(world.types[0]![Kind.Villager]!.carries).toBe(15);
    expect(world.speed[villager]).toBeGreaterThan(before);
    expect(world.speed[villager]! / before).toBeCloseTo(1.1, 2);
  });

  it('changes what soldiers cost and how long they take', () => {
    const { world, hall } = town({ startAge: Age.HighMedieval });
    world.spawnBuilding(0, Kind.House, 20, 20);
    grant(world, hall, TechId.StandingCompanies);
    expect(world.types[0]![Kind.Spearman]!.cost).toEqual([51, 17, 0, 0]);
    expect(world.types[0]![Kind.Knight]!.cost).toEqual([119, 0, 0, 85]);
    expect(world.types[0]![Kind.Villager]!.cost).toEqual([50, 0, 0, 0]);
    grant(world, hall, TechId.KnightService);
    expect(world.types[0]![Kind.Spearman]!.seconds).toBe(12);
    expect(world.types[0]![Kind.Villager]!.seconds).toBe(20);
    const barracks = world.spawnBuilding(0, Kind.Barracks, 20, 12);
    send(world, 0, { kind: 'train', building: barracks, unitType: Kind.Spearman });
    run(world, 2);
    expect(stock(world, 0)).toEqual([5000 - 51, 5000 - 17, 5000, 5000]);
    const ticks = run(world, 1000, () => world.livingUnits(0).length === 1);
    // Twelve seconds, not fifteen; two ticks were done above.
    expect(ticks).toBe(12 * 30 - 2);
  });

  it('lets towers and town centres see and shoot further through arrow loops', () => {
    const { world, hall } = town();
    const tower = world.spawnBuilding(0, Kind.Watchtower, 20, 20);
    run(world, 2);
    expect(world.sightRadius[slotOf(tower)]).toBe(13);
    grant(world, hall, TechId.ArrowLoops);
    run(world, 2);
    expect(world.sightRadius[slotOf(tower)]).toBe(15);
    expect(world.sightRadius[slotOf(hall)]).toBe(13);
    expect(world.types[0]![Kind.Watchtower]!.range).toBe(8 * ONE);
  });
});

describe('the soldiers of later ages', () => {
  const pair = (a: number, b: number): [number, number] => {
    const world = new World(defaultConfig({ mapWidth: 40, mapHeight: 40, mapState: 'revealed' }));
    return [damageOf(world, slotOf(world.spawnUnit(0, a, fromFloat(10.5), fromFloat(10.5))), slotOf(world.spawnUnit(1, b, fromFloat(12.5), fromFloat(10.5))), 0), 0];
  };

  it('wear armour that the cheap troops struggle against', () => {
    expect(pair(Kind.Spearman, Kind.ManAtArms)[0]).toBe(5);
    expect(pair(Kind.Archer, Kind.ManAtArms)[0]).toBe(2);
    expect(pair(Kind.ManAtArms, Kind.Spearman)[0]).toBe(11);
    expect(pair(Kind.Archer, Kind.Knight)[0]).toBe(2);
    expect(pair(Kind.Horseman, Kind.Knight)[0]).toBe(6);
  });

  it('meet their match in the crossbow, the pike and the gun', () => {
    expect(pair(Kind.Crossbowman, Kind.ManAtArms)[0]).toBe(10 + 10 - 3);
    expect(pair(Kind.Crossbowman, Kind.Knight)[0]).toBe(17);
    expect(pair(Kind.Crossbowman, Kind.Spearman)[0]).toBe(10);
    expect(pair(Kind.Spearman, Kind.Knight)[0]).toBe(8 + 16 - 3);
    expect(pair(Kind.Handgunner, Kind.Knight)[0]).toBe(32 + 6 - 3);
    expect(pair(Kind.Handgunner, Kind.Spearman)[0]).toBe(32);
    expect(pair(Kind.Knight, Kind.Crossbowman)[0]).toBe(14 + 6);
  });

  /** Two sides march at each other. Returns how many of each are left when one side is gone. */
  function battle(kindA: number, countA: number, kindB: number, countB: number): { a: number; b: number } {
    const world = new World(defaultConfig({ mapWidth: 48, mapHeight: 48, mapState: 'revealed' }));
    const line = (player: number, kind: number, count: number, x: number): number[] =>
      Array.from({ length: count }, (_, i) => world.spawnUnit(player, kind, fromFloat(x), fromFloat(24 + (i - (count - 1) / 2) * 0.7)));
    const a = line(0, kindA, countA, 18);
    const b = line(1, kindB, countB, 30);
    send(world, 0, { kind: 'attackMove', units: a, x: fromFloat(30), y: fromFloat(24) });
    send(world, 1, { kind: 'attackMove', units: b, x: fromFloat(18), y: fromFloat(24) });
    run(world, 5400, () => world.livingUnits(0).length === 0 || world.livingUnits(1).length === 0);
    return { a: world.livingUnits(0).length, b: world.livingUnits(1).length };
  }

  it('win their fights as the figures say: armour beats the levy, and its counters beat armour', () => {
    // 560 resources of men-at-arms against 560 of spearmen.
    expect(battle(Kind.ManAtArms, 4, Kind.Spearman, 7).b).toBe(0);
    // 720 of knights against 720 of archers.
    expect(battle(Kind.Knight, 3, Kind.Archer, 9).b).toBe(0);
    // 720 of knights against 720 of spearmen: the spear still stops the horse.
    expect(battle(Kind.Knight, 3, Kind.Spearman, 9).a).toBe(0);
    // 840 of men-at-arms against 840 of crossbowmen.
    expect(battle(Kind.ManAtArms, 6, Kind.Crossbowman, 8).a).toBe(0);
    // 780 of handgunners against 840 of men-at-arms: armour is no answer to the gun.
    expect(battle(Kind.Handgunner, 6, Kind.ManAtArms, 6).b).toBe(0);
    // But 910 of handgunners are ridden down by 960 of knights before they can reload.
    expect(battle(Kind.Handgunner, 7, Kind.Knight, 4).a).toBe(0);
  });
});
