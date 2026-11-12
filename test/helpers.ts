import { canPlace } from '../src/sim/buildings';
import { buildPointsNeeded, ENTITY_TYPES, Kind, RESOURCE_COUNT, resourceOfTerrain, TRAIN_QUEUE_LENGTH } from '../src/sim/entityTypes';
import { fromInt, length } from '../src/sim/fixed';
import { Terrain } from '../src/sim/map';
import { hashWorld } from '../src/sim/hash';
import { Rng } from '../src/sim/rng';
import { ORDER_QUEUE_LENGTH, SHOT_FIELDS, type SimConfig, type World } from '../src/sim/world';
import { LocalSession } from '../src/session/localSession';

export interface PlayedMatch {
  readonly session: LocalSession;
  /** The world checksum after each tick; hashes[t] is the state after tick t ran. */
  readonly hashes: number[];
}

/**
 * Plays a match in which every player issues random commands, the way a
 * fuzzer would: spawning, moving random groups (sometimes as queued
 * waypoints), stopping them, gathering, building, training and attacking,
 * with a random input delay each time. The
 * "decisions" come from their own seeded generator, so a given
 * (config, scriptSeed) always produces the same match.
 */
export function playRandomMatch(
  config: SimConfig,
  scriptSeed: number,
  ticks: number,
  afterTick?: (world: World) => void,
): PlayedMatch {
  const session = new LocalSession(config);
  const script = new Rng(scriptSeed);
  const { world } = session;
  const randomX = (): number => fromInt(script.nextInt(config.mapWidth));
  const randomY = (): number => fromInt(script.nextInt(config.mapHeight));
  const unitTypes = ENTITY_TYPES.map((type, index) => (type.building ? -1 : index)).filter((index) => index >= 0);
  const randomUnitType = (): number => unitTypes[script.nextInt(unitTypes.length)]!;
  const soldierTypes = unitTypes.filter((index) => ENTITY_TYPES[index]!.aggressive);
  /** Usually a resource tile not far from the player's start; now and then any tile at all. */
  const randomTile = (player: number): number => {
    if (script.chance(1, 6)) return script.nextInt(world.map.tileCount);
    const start = world.map.starts[player];
    const tx = (start ? start.x >> 16 : script.nextInt(config.mapWidth)) + script.nextInt(21) - 10;
    const ty = (start ? start.y >> 16 : script.nextInt(config.mapHeight)) + script.nextInt(21) - 10;
    const found = world.map.nearestTile(tx, ty, 20, (tile) => resourceOfTerrain(world.map.terrain[tile]!) !== -1);
    return found === -1 ? script.nextInt(world.map.tileCount) : found;
  };
  const randomGroup = (player: number, forWork = false): number[] => {
    // Buildings are included on purpose: orders to them must be ignored. A
    // third of the units are never marched about, so that some villagers get
    // to finish a round trip.
    const mine = world.livingEntities(player).filter((id) => forWork || (id & 0xfffff) % 3 !== 0);
    // Sometimes everyone, sometimes one unit, usually about half.
    const pick = script.nextInt(6);
    if (pick === 0) return mine;
    if (pick === 1) return mine.length > 0 ? [mine[script.nextInt(mine.length)]!] : [];
    return mine.filter(() => script.chance(1, 2));
  };

  for (let player = 0; player < config.playerCount; player++) {
    const start = world.map.starts[player];
    session.issue(player, {
      kind: 'spawn',
      x: start?.x ?? randomX(),
      y: start?.y ?? randomY(),
      // With the standard kit there are six villagers already and room for ten units in all.
      count: config.start === 'standard' ? 3 : 20,
      unitType: randomUnitType(),
    });
    // As a player would: everyone who can work starts on something near home.
    session.inputDelayTicks = 2;
    session.issue(player, { kind: 'gather', units: world.livingEntities(player), tile: randomTile(player) });
    session.inputDelayTicks = 0;
  }

  const hashes: number[] = [];
  while (world.tick < ticks) {
    // Early on each player founds a house on the first free plot near home
    // and sets one of the villagers who are never marched about to building it, so
    // that every match has some building in it whatever the dice say later.
    if (config.start === 'standard' && world.tick === 60) {
      session.inputDelayTicks = 0;
      for (let player = 0; player < config.playerCount; player++) {
        const start = world.map.starts[player];
        if (start === undefined) continue;
        const plot = world.map.nearestTile(start.x >> 16, start.y >> 16, 12, (tile) =>
          canPlace(world, Kind.House, tile % config.mapWidth, Math.floor(tile / config.mapWidth)),
        );
        if (plot === -1) continue;
        session.issue(player, {
          kind: 'build',
          units: world.livingUnits(player).filter((id) => (id & 0xfffff) % 3 === 0).slice(0, 1),
          buildingType: Kind.House,
          tileX: plot % config.mapWidth,
          tileY: Math.floor(plot / config.mapWidth),
        });
      }
    }
    // Twice in the match a war band from each side appears a few tiles apart
    // near one player's town, so that there is a fight to the finish whatever
    // else the random orders do. A third of them are never ordered away.
    const fightAt = config.start === 'standard' ? [240, 1000].indexOf(world.tick) : -1;
    const home = fightAt === -1 ? undefined : world.map.starts[fightAt % config.playerCount];
    if (home !== undefined) {
      session.inputDelayTicks = 0;
      const towardMiddle = home.x < fromInt(config.mapWidth >> 1) ? 1 : -1;
      for (let player = 0; player < config.playerCount; player++) {
        session.issue(player, {
          kind: 'spawn',
          x: home.x + fromInt(towardMiddle * (8 + player * 5)),
          y: home.y,
          count: 9,
          unitType: soldierTypes[script.nextInt(soldierTypes.length)]!,
        });
      }
    }
    for (let player = 0; player < config.playerCount; player++) {
      session.inputDelayTicks = script.nextInt(7);
      if (script.chance(1, 14)) {
        session.issue(player, {
          kind: 'move',
          units: randomGroup(player),
          x: randomX(),
          y: randomY(),
          queue: script.chance(1, 3),
        });
      }
      if (script.chance(1, 120)) {
        session.issue(player, { kind: script.chance(1, 3) ? 'hold' : 'stop', units: randomGroup(player) });
      }
      // Fighting: marches that stop to fight, patrols, and going after one enemy (or, wrongly, a friend).
      if (script.chance(1, 40)) {
        const others = world.livingEntities().filter((id) => world.owner[id & 0xfffff] !== player);
        const foe = others.length > 0 ? others[script.nextInt(others.length)]! : -1;
        const pick = script.nextInt(8);
        if (pick < 4 && foe !== -1) {
          // Usually toward where the enemy is, so that the two sides meet.
          session.issue(player, {
            kind: 'attackMove',
            units: randomGroup(player),
            x: world.posX[foe & 0xfffff]!,
            y: world.posY[foe & 0xfffff]!,
            queue: script.chance(1, 4),
          });
        } else if (pick < 5) {
          session.issue(player, { kind: 'attackMove', units: randomGroup(player), x: randomX(), y: randomY() });
        } else if (pick < 6) {
          session.issue(player, { kind: 'patrol', units: randomGroup(player), x: randomX(), y: randomY() });
        } else {
          const everything = world.livingEntities();
          const target = script.chance(1, 5) && everything.length > 0 ? everything[script.nextInt(everything.length)]! : foe;
          session.issue(player, { kind: 'attack', units: randomGroup(player), target });
        }
      }
      if (script.chance(1, config.start === 'standard' ? 700 : 200)) {
        session.issue(player, {
          kind: 'spawn',
          x: randomX(),
          y: randomY(),
          count: 1 + script.nextInt(6),
          unitType: randomUnitType(),
        });
      }
      if (script.chance(1, 320)) {
        session.issue(player, { kind: 'gather', units: randomGroup(player, true), tile: randomTile(player) });
      }
      const buildings = world.livingEntities(player).filter((id) => world.mobile[id & 0xfffff] === 0);
      const randomBuilding = (): number =>
        buildings.length > 0 ? buildings[script.nextInt(buildings.length)]! : script.nextInt(50);
      if (script.chance(1, 400)) {
        session.issue(player, { kind: 'deliver', units: randomGroup(player, true), target: randomBuilding() });
      }
      // Building and training, as often badly as well: on trees, without the wood, in a full queue.
      const start = world.map.starts[player];
      if (start !== undefined && script.chance(1, 200)) {
        session.issue(player, {
          kind: 'build',
          units: randomGroup(player, true),
          buildingType: script.nextInt(ENTITY_TYPES.length),
          tileX: (start.x >> 16) + script.nextInt(25) - 12,
          tileY: (start.y >> 16) + script.nextInt(25) - 12,
        });
      }
      if (script.chance(1, 180)) {
        session.issue(player, { kind: 'construct', units: randomGroup(player, true), target: randomBuilding() });
      }
      if (script.chance(1, 60)) {
        // Mostly something trainable; sometimes nonsense.
        const unitType = script.chance(3, 4) ? randomUnitType() : script.nextInt(ENTITY_TYPES.length + 2);
        session.issue(player, { kind: 'train', building: randomBuilding(), unitType });
      }
      if (script.chance(1, 500)) {
        session.issue(player, { kind: 'cancelTrain', building: randomBuilding(), index: script.nextInt(3) });
      }
      if (script.chance(1, 300)) {
        session.issue(player, { kind: 'rally', buildings: [randomBuilding()], x: randomX(), y: randomY() });
      }
      // The town centre (the first building) is spared, or the economy under test would stop.
      if (buildings.length > 1 && script.chance(1, 900)) {
        session.issue(player, { kind: 'demolish', targets: [buildings[1 + script.nextInt(buildings.length - 1)]!] });
      }
    }
    session.step();
    hashes.push(hashWorld(world));
    afterTick?.(world);
  }
  return { session, hashes };
}

/**
 * Things that must hold after every tick, whatever orders were given. Returns
 * a description of the first one broken, or null.
 */
const startingTotals = new WeakMap<World, number[]>();

/**
 * Everything of each resource there is: in the ground, on villagers' backs,
 * in the stores, spent, and lost with the dead; less what farms have grown,
 * which is the one thing that comes from nowhere.
 */
export function resourceTotals(world: World): number[] {
  const totals = new Array<number>(RESOURCE_COUNT).fill(0);
  const { map } = world;
  for (let tile = 0; tile < map.tileCount; tile++) {
    // A farm's crop is not a store in the ground: it is counted as it is grown.
    if (map.terrain[tile] === Terrain.Field) continue;
    const resource = resourceOfTerrain(map.terrain[tile]!);
    if (resource !== -1) totals[resource]! += map.amount[tile]!;
    else if (map.amount[tile] !== 0) totals[0] = NaN; // an amount where there is no resource
  }
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 1) totals[world.carryKind[slot]!]! += world.carry[slot]!;
  }
  for (let i = 0; i < world.stock.length; i++) totals[i % RESOURCE_COUNT]! += world.stock[i]! + world.spent[i]!;
  for (let r = 0; r < RESOURCE_COUNT; r++) totals[r]! += world.lost[r]! - world.grown[r]!;
  return totals;
}

/** Whether the map's record of which tiles connect matches a flood fill done from scratch. */
export function regionsAreRight(world: World): boolean {
  const { map } = world;
  const seen = new Int32Array(map.tileCount);
  const used = new Set<number>();
  for (let seed = 0; seed < map.tileCount; seed++) {
    if (map.passable[seed] === 0) {
      if (map.region[seed] !== 0) return false;
      continue;
    }
    if (seen[seed] === 1) continue;
    const region = map.region[seed]!;
    if (region === 0 || used.has(region)) return false;
    used.add(region);
    const stack = [seed];
    seen[seed] = 1;
    while (stack.length > 0) {
      const tile = stack.pop()!;
      if (map.region[tile] !== region) return false;
      const tx = tile % map.width;
      const ty = Math.floor(tile / map.width);
      for (let dir = 0; dir < 8; dir++) {
        if (!map.canStep(tx, ty, dir)) continue;
        const dx = [1, 1, 0, -1, -1, -1, 0, 1][dir]!;
        const dy = [0, 1, 1, 1, 0, -1, -1, -1][dir]!;
        const other = (ty + dy) * map.width + tx + dx;
        if (seen[other] === 0) {
          seen[other] = 1;
          stack.push(other);
        }
      }
    }
  }
  return true;
}

export function brokenInvariant(world: World): string | null {
  const { map } = world;
  // Nothing is created or lost: gathering only moves resources about.
  const totals = resourceTotals(world);
  const before = startingTotals.get(world);
  if (before === undefined) startingTotals.set(world, totals);
  else if (totals.some((total, i) => total !== before[i])) {
    return `resources are not conserved: started with ${before.join('/')}, now ${totals.join('/')}`;
  }
  if (world.tick % 20 === 0 && !regionsAreRight(world)) return 'the map\'s connected regions are out of date';
  // Every built-on tile belongs to a building and every building's tiles are built on.
  let built = 0;
  let fields = 0;
  const claims = new Map<number, number>();
  const claim = (group: number): void => {
    if (group !== 0) claims.set(group, (claims.get(group) ?? 0) + 1);
  };
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0) continue;
    const x = world.posX[slot]!;
    const y = world.posY[slot]!;
    const type = ENTITY_TYPES[world.entityType[slot]!]!;
    if (world.carry[slot]! > type.carries) return `unit ${slot} carries more than it can`;
    if (world.hp[slot]! <= 0) return `entity ${slot} is alive with ${world.hp[slot]} hit points`;
    if (world.hp[slot]! > type.hp) return `entity ${slot} has more hit points than its kind allows`;
    if (world.orderKind[slot]! > 5) return `entity ${slot} has an order of no known kind`;
    if (world.engaged[slot] === 0 && world.homeGroup[slot] !== 0) return `unit ${slot} is holding a march open without being in a fight`;
    if (world.windup[slot]! > 0 && world.moveState[slot] !== 0) return `unit ${slot} is striking a blow on the move`;
    if (world.mobile[slot] === 0) {
      if (world.moveState[slot] !== 0 || world.group[slot] !== 0) return `building ${slot} has been given orders`;
      const needed = buildPointsNeeded(world.entityType[slot]!, world.config.tickRate);
      if ((world.built[slot] === 1) !== (world.buildPoints[slot]! >= needed)) return `building ${slot} is finished but not built, or the reverse`;
      if (world.trainLength[slot]! > TRAIN_QUEUE_LENGTH) return `building ${slot} has too long a queue`;
      if (world.trainLength[slot] === 0 && (world.trainTicks[slot] !== 0 || world.trainStarted[slot] !== 0)) {
        return `building ${slot} is training with nothing queued`;
      }
      if (type.farm && world.built[slot] === 1) {
        // A finished farm is tilled ground, not walls: nine tiles of field, the crop in the middle one.
        const cx = x >> 16;
        const cy = y >> 16;
        for (let ty = cy - 1; ty <= cy + 1; ty++) {
          for (let tx = cx - 1; tx <= cx + 1; tx++) {
            const tile = ty * map.width + tx;
            if (map.terrain[tile] !== Terrain.Field) return `farm ${slot} is not tilled at tile ${tile}`;
            if (map.amount[tile] !== (tx === cx && ty === cy ? 1 : 0)) return `farm ${slot} has its crop in the wrong place`;
            if (map.blocked[tile] === 1) return `farm ${slot} blocks the way`;
          }
        }
        fields += 9;
      } else {
        built += type.footprint * type.footprint;
      }
      continue;
    }
    if (x < 0 || y < 0 || x > map.maxX || y > map.maxY) return `unit ${slot} is off the map`;
    if (map.passable[map.tileAt(x, y)] === 0) return `unit ${slot} is standing in an obstacle`;
    claim(world.group[slot]!);
    claim(world.homeGroup[slot]!);
    for (let k = 0; k < world.queueLength[slot]!; k++) claim(world.queueGroup[slot * ORDER_QUEUE_LENGTH + k]!);
  }
  let blocked = 0;
  let tilled = 0;
  for (let tile = 0; tile < map.tileCount; tile++) {
    blocked += map.blocked[tile]!;
    if (map.terrain[tile] === Terrain.Field) tilled++;
  }
  if (blocked !== built) return `${blocked} tiles are marked as built on, but buildings cover ${built}`;
  if (tilled !== fields) return `${tilled} tiles are tilled, but farms cover ${fields}`;
  for (const group of world.groups.values()) {
    if (group.refs !== (claims.get(group.id) ?? 0)) {
      return `group ${group.id} counts ${group.refs} units but ${claims.get(group.id) ?? 0} refer to it`;
    }
  }
  for (const id of claims.keys()) {
    if (!world.groups.has(id)) return `units refer to group ${id}, which no longer exists`;
  }
  for (let i = 0; i < world.shotCount; i++) {
    if (world.shots[i * SHOT_FIELDS + 6]! < world.tick) return `arrow ${i} should have landed already`;
  }
  if (world.tick % 10 === 0) return brokenVision(world);
  return null;
}

/** The smallest gap between any two living units, less their radii. Negative means overlap. */
export function smallestGap(world: World): number {
  let smallest = Infinity;
  for (let a = 0; a < world.highWater; a++) {
    if (world.alive[a] === 0 || world.mobile[a] === 0) continue;
    for (let b = a + 1; b < world.highWater; b++) {
      if (world.alive[b] === 0 || world.mobile[b] === 0) continue;
      const gap =
        length(world.posX[a]! - world.posX[b]!, world.posY[a]! - world.posY[b]!) -
        world.radius[a]! -
        world.radius[b]!;
      if (gap < smallest) smallest = gap;
    }
  }
  return smallest;
}

/**
 * Checks what each side is counted as seeing against a count made from
 * scratch: every living thing looking out from the tile it stands on.
 */
export function brokenVision(world: World): string | null {
  const { map } = world;
  const expected = world.seen.map(() => new Uint16Array(map.tileCount));
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0) continue;
    const type = ENTITY_TYPES[world.entityType[slot]!]!;
    const radius = type.building && world.built[slot] === 0 ? Math.min(type.sight, 3) : type.sight;
    const cx = Math.min(map.width - 1, Math.max(0, world.posX[slot]! >> 16));
    const cy = Math.min(map.height - 1, Math.max(0, world.posY[slot]! >> 16));
    const counts = expected[world.view[world.owner[slot]!]!]!;
    for (let y = Math.max(0, cy - radius); y <= Math.min(map.height - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(map.width - 1, cx + radius); x++) {
        if (Math.hypot(x - cx, y - cy) <= radius + 0.5) counts[y * map.width + x]!++;
      }
    }
  }
  for (let view = 0; view < expected.length; view++) {
    const counts = expected[view]!;
    const seen = world.seen[view]!;
    const explored = world.explored[view]!;
    for (let tile = 0; tile < map.tileCount; tile++) {
      if (seen[tile] !== counts[tile]) {
        return `side ${view} is counted as having ${seen[tile]} lookers on tile ${tile}, but ${counts[tile]} can see it`;
      }
      if (seen[tile]! > 0 && explored[tile] === 0) return `side ${view} sees tile ${tile} without having explored it`;
    }
  }
  return null;
}
