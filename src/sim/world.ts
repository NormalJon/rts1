/**
 * The complete state of a match.
 *
 * Entities live in parallel arrays ("columns"), one array per property, indexed
 * by slot. This keeps the per-tick loops fast, and because every column is
 * registered in one list, the checksum and the save format cover new
 * properties automatically.
 */

import { CommandQueue } from './commands';
import { HALF, ONE, type Fixed } from './fixed';
import type { GameMap } from './map';
import { buildMap, type MapSpec } from './mapgen';
import { Rng } from './rng';
import { SearchScratch, type Search } from './search';
import { buildPointsNeeded, ENTITY_TYPES, Kind, RESOURCE_COUNT, siteHp, TRAIN_QUEUE_LENGTH } from './entityTypes';
import { perSecondToPerTick } from './units';

export interface SimConfig {
  /** Simulation steps per second. Fixed for the whole match. */
  readonly tickRate: number;
  readonly seed: number;
  readonly playerCount: number;
  /**
   * Which side each player is on. Players with the same number are allies and
   * do not fight each other. Players past the end of the list are each on
   * their own side, so an empty list is a free-for-all.
   */
  readonly teams: readonly number[];
  /** Map size in tiles. */
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly map: MapSpec;
  /**
   * What each player begins with. 'standard' is a town centre on their start
   * with a handful of villagers; 'empty' is nothing, for tests and debug pages.
   */
  readonly start: 'empty' | 'standard';
  readonly maxEntities: number;
  /**
   * How many tiles pathfinding may examine per tick. Searches that need more
   * carry on next tick, which keeps a burst of orders from stalling the game.
   */
  readonly pathBudget: number;
}

export const DEFAULT_TICK_RATE = 30;

export function defaultConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    tickRate: DEFAULT_TICK_RATE,
    seed: 1,
    playerCount: 2,
    teams: [],
    mapWidth: 64,
    mapHeight: 64,
    map: { kind: 'flat' },
    start: 'empty',
    maxEntities: 8192,
    pathBudget: 10000,
    ...overrides,
  };
}

/**
 * A handle to an entity: its slot plus the slot's generation. When an entity
 * dies its slot is reused with a new generation, so a stale handle (say, in a
 * command issued before the unit died) no longer matches anything.
 */
export type EntityId = number;
export const NO_ENTITY: EntityId = -1;

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GENERATION_MASK = (1 << 11) - 1;
export const ENTITY_LIMIT = 1 << INDEX_BITS;

export function entityIndex(id: EntityId): number {
  return id & INDEX_MASK;
}

export function entityGeneration(id: EntityId): number {
  return id >>> INDEX_BITS;
}

/** What a unit is doing about getting somewhere. */
export const MoveState = {
  /** Standing at its post. It drifts back if pushed off it. */
  Idle: 0,
  /** Has an order and is waiting for its route to be worked out. */
  Awaiting: 1,
  /** Following its own list of waypoints. */
  Path: 2,
  /** Following its group's flow field. */
  Field: 3,
  /** Walking straight at its destination, which is in plain sight. */
  Direct: 4,
} as const;

/** Where a gatherer is in its round trip. */
export const Job = {
  None: 0,
  /** Walking to its place beside the resource. */
  ToResource: 1,
  Harvesting: 2,
  /** Carrying a load to a drop-off building. */
  ToDropOff: 3,
  /** Walking to a building site. */
  ToSite: 4,
  /** At the site, building. */
  Constructing: 5,
} as const;

/**
 * What a unit has been told to do, which decides how it treats enemies.
 * A unit with no orders guards the spot where it stands.
 */
export const OrderKind = {
  /** Guarding its post: fights what comes near, then goes back. */
  None: 0,
  /** Going where it was sent and ignoring everything on the way. */
  Move: 1,
  /** Going where it was sent, fighting whatever it meets, then carrying on. */
  AttackMove: 2,
  /** Walking to and fro between two points, fighting whatever it meets. */
  Patrol: 3,
  /** After one particular enemy. */
  AttackTarget: 4,
  /** Standing its ground: strikes at what comes within reach but never gives chase. */
  Hold: 5,
} as const;

export const STARTING_VILLAGERS = 6;
const STARTING_STOCK = [200, 200, 0, 100]; // food, wood, stone, gold

/** Orders a unit can have waiting behind its current one. */
export const ORDER_QUEUE_LENGTH = 8;

export const GroupStatus = { New: 0, Pending: 1, Ready: 2 } as const;

/**
 * A move order shared by several units. They head for the same place, so they
 * share one flow field and line up facing the same way when they arrive.
 */
export interface MoveGroup {
  readonly id: number;
  /** Where the group is headed. Moves only if a building goes up on the spot. */
  goalTile: number;
  /** The way the formation faces on arrival, as a unit vector. */
  readonly faceX: Fixed;
  readonly faceY: Fixed;
  /** Units for which this is the current or a queued order. */
  refs: number;
  status: number;
  field: Uint8Array | null;
  fieldChecksum: number;
}

export type RouteRequest =
  | { readonly kind: 'path'; readonly slot: number; readonly seq: number }
  | { readonly kind: 'field'; readonly group: number };

/** A route search that is part-way through, with what is needed to redo it. */
export interface ActiveSearch {
  readonly request: RouteRequest;
  /** The map's passVersion when the search began. If the map has changed since, the search starts over. */
  readonly mapVersion: number;
  readonly start: number;
  readonly goal: number;
  readonly targets: readonly number[];
  readonly search: Search;
}

/** Numbers per arrow in World.shots: from x, from y, source, target, damage, tick loosed, tick it lands. */
export const SHOT_FIELDS = 7;

export type Column = Int32Array | Uint16Array | Uint8Array;

export interface ColumnInfo {
  readonly name: string;
  readonly data: Column;
  /** Values per entity. */
  readonly stride: number;
}

export class World {
  readonly config: SimConfig;
  readonly map: GameMap;
  /** Ticks simulated so far, which is also the number of the next tick to run. */
  tick = 0;
  readonly rng: Rng;
  readonly commands = new CommandQueue();

  /** One past the highest slot ever used. */
  highWater = 0;
  /** Slots of dead entities, reused last-freed-first. */
  readonly freeSlots: number[] = [];

  private readonly columnList: ColumnInfo[] = [];

  readonly alive: Uint8Array;
  readonly generation: Uint16Array;
  readonly owner: Uint8Array;
  readonly entityType: Uint8Array;
  /** 1 for units, 0 for buildings, which never move. */
  readonly mobile: Uint8Array;
  readonly posX: Int32Array;
  readonly posY: Int32Array;
  /** Facing, as a unit vector. */
  readonly dirX: Int32Array;
  readonly dirY: Int32Array;
  /** Distance covered per tick. */
  readonly speed: Int32Array;
  readonly radius: Int32Array;

  readonly moveState: Uint8Array;
  /** Where the unit is trying to be: its destination, or its post when idle. */
  readonly goalX: Int32Array;
  readonly goalY: Int32Array;
  /** The point it is walking toward right now. */
  readonly steerX: Int32Array;
  readonly steerY: Int32Array;
  /** The next waypoint, when following a path. */
  readonly pathIndex: Int32Array;
  /** The shared order it is carrying out, or 0. */
  readonly group: Int32Array;
  /** Goes up with every new order, so a route worked out for an old one is recognised and dropped. */
  readonly orderSeq: Int32Array;
  /** Ticks in a row without getting anywhere, and re-routes tried since. */
  readonly stuck: Int32Array;
  readonly retries: Uint8Array;
  /** The nearest it has been to its destination on the final approach. */
  readonly closest: Int32Array;

  readonly queueLength: Uint8Array;
  readonly queueGroup: Int32Array;
  readonly queueX: Int32Array;
  readonly queueY: Int32Array;

  /** Gathering: the stage of the round trip, and the resource tile being worked. */
  readonly job: Uint8Array;
  readonly jobTile: Int32Array;
  /** The terrain being gathered, kept so another tile of it can be found when this one runs out. */
  readonly jobTerrain: Uint8Array;
  /** Where it stands to work: a neighbouring tile and which half of it, as tile * 2 + side. */
  readonly jobSpot: Int32Array;
  /** Ticks of work done toward the next unit gathered. */
  readonly jobTimer: Int32Array;
  readonly jobTries: Uint8Array;
  /** The drop-off building it is heading for. */
  readonly jobTarget: Int32Array;
  /** What it is carrying and how much. */
  readonly carryKind: Uint8Array;
  readonly carry: Int32Array;

  /** Hit points left. */
  readonly hp: Int32Array;
  /** How it is to treat enemies (see OrderKind), and the same for each order waiting in its queue. */
  readonly orderKind: Uint8Array;
  readonly queueKind: Uint8Array;
  /** The enemy it is after, or NO_ENTITY, and whether it has broken off what it was doing to fight. */
  readonly target: Int32Array;
  readonly engaged: Uint8Array;
  /**
   * Where a unit goes back to when the fighting is over: its post, or the
   * place it was marching to, with the shared order it was marching under.
   */
  readonly homeX: Int32Array;
  readonly homeY: Int32Array;
  readonly homeGroup: Int32Array;
  /** Patrols: the far end of the beat. */
  readonly otherX: Int32Array;
  readonly otherY: Int32Array;
  /** Ticks until the blow now being struck lands, and until another can be started. */
  readonly windup: Uint16Array;
  readonly cooldown: Uint16Array;
  /** 1 while it is planted in front of an enemy, trading blows. Comrades go round it. */
  readonly rooted: Uint8Array;
  /** Times it has come to a halt short of its target. */
  readonly chaseTries: Uint8Array;
  /** Riders: ticks of unbroken running, which is what makes a charge. */
  readonly momentum: Uint16Array;

  /** Buildings: 1 once construction is finished, and the work done toward that. */
  readonly built: Uint8Array;
  readonly buildPoints: Int32Array;
  /** Buildings: the unit types waiting to be trained (each stored as type + 1), and how many. */
  readonly trainQueue: Uint8Array;
  readonly trainLength: Uint8Array;
  /** Ticks spent on the unit at the head of the queue, and whether room in the population has been set aside for it. */
  readonly trainTicks: Int32Array;
  readonly trainStarted: Uint8Array;
  /** Where newly trained units go: a point, or a resource tile to start work on. -1 for none. */
  readonly rallyX: Int32Array;
  readonly rallyY: Int32Array;
  readonly rallyTile: Int32Array;

  /** Each player's stockpile: playerCount x 4, as food, wood, stone, gold. */
  readonly stock: Int32Array;
  /** What each player has spent on units and buildings, less refunds, laid out like the stockpile. */
  readonly spent: Int32Array;
  /** Resources that were on the backs of villagers when they were killed, by kind. */
  readonly lost: Int32Array;
  /** Which side each player is on. */
  readonly team: Uint8Array;

  /**
   * Arrows in the air. Each is a row of SHOT_FIELDS numbers: where it was
   * loosed from, who loosed it, whom it will hit, how hard, and the ticks it
   * left and lands on. An arrow always finds its target if the target lives.
   */
  shots: Int32Array;
  shotCount = 0;

  /** Waypoints (x, y pairs) for units following their own path. */
  readonly paths: (Int32Array | undefined)[] = [];
  readonly groups = new Map<number, MoveGroup>();
  nextGroupId = 1;
  /** Route searches waiting their turn, oldest first. */
  readonly routeQueue: RouteRequest[] = [];
  activeSearch: ActiveSearch | null = null;

  /** Working memory. Rebuilt whenever needed; never part of the saved state. */
  readonly searchScratch: SearchScratch;
  readonly scratchX: Int32Array;
  readonly scratchY: Int32Array;
  readonly scratchPushX: Int32Array;
  readonly scratchPushY: Int32Array;
  readonly scratchFlags: Uint8Array;
  /** How many villagers have worked on each building site so far this tick. */
  readonly scratchBuilders: Uint16Array;
  /** Damage dealt to each entity so far this tick, taken off all at once so that two who strike together both land. */
  readonly scratchDamage: Int32Array;
  /** The slots of this tick's buildings. */
  readonly scratchBuildings: Int32Array;
  scratchBuildingCount = 0;
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;

  /**
   * @param restoring  True when a saved game is about to be loaded into this
   *   world, so the starting kit must not be placed a second time.
   */
  constructor(config: SimConfig, restoring = false) {
    if (!Number.isInteger(config.tickRate) || config.tickRate < 1 || config.tickRate > 120) {
      throw new RangeError(`tickRate must be a whole number from 1 to 120, got ${config.tickRate}`);
    }
    if (config.maxEntities < 1 || config.maxEntities > ENTITY_LIMIT) {
      throw new RangeError(`maxEntities must be from 1 to ${ENTITY_LIMIT}`);
    }
    if (config.playerCount < 1 || config.playerCount > 8) {
      throw new RangeError('playerCount must be from 1 to 8');
    }
    if (config.mapWidth < 1 || config.mapHeight < 1 || config.mapWidth > 1024 || config.mapHeight > 1024) {
      throw new RangeError('map size must be from 1 to 1024 tiles each way');
    }
    if (!Number.isInteger(config.pathBudget) || config.pathBudget < 1) {
      throw new RangeError('pathBudget must be a positive whole number');
    }
    this.config = config;
    this.rng = new Rng(config.seed);
    this.map = buildMap(config.mapWidth, config.mapHeight, config.seed, config.map);

    const n = config.maxEntities;
    this.alive = this.column('alive', new Uint8Array(n));
    this.generation = this.column('generation', new Uint16Array(n));
    this.owner = this.column('owner', new Uint8Array(n));
    this.entityType = this.column('entityType', new Uint8Array(n));
    this.mobile = this.column('mobile', new Uint8Array(n));
    this.posX = this.column('posX', new Int32Array(n));
    this.posY = this.column('posY', new Int32Array(n));
    this.dirX = this.column('dirX', new Int32Array(n));
    this.dirY = this.column('dirY', new Int32Array(n));
    this.speed = this.column('speed', new Int32Array(n));
    this.radius = this.column('radius', new Int32Array(n));
    this.moveState = this.column('moveState', new Uint8Array(n));
    this.goalX = this.column('goalX', new Int32Array(n));
    this.goalY = this.column('goalY', new Int32Array(n));
    this.steerX = this.column('steerX', new Int32Array(n));
    this.steerY = this.column('steerY', new Int32Array(n));
    this.pathIndex = this.column('pathIndex', new Int32Array(n));
    this.group = this.column('group', new Int32Array(n));
    this.orderSeq = this.column('orderSeq', new Int32Array(n));
    this.stuck = this.column('stuck', new Int32Array(n));
    this.retries = this.column('retries', new Uint8Array(n));
    this.closest = this.column('closest', new Int32Array(n));
    this.queueLength = this.column('queueLength', new Uint8Array(n));
    const q = ORDER_QUEUE_LENGTH;
    this.queueGroup = this.column('queueGroup', new Int32Array(n * q), q);
    this.queueX = this.column('queueX', new Int32Array(n * q), q);
    this.queueY = this.column('queueY', new Int32Array(n * q), q);
    this.job = this.column('job', new Uint8Array(n));
    this.jobTile = this.column('jobTile', new Int32Array(n));
    this.jobTerrain = this.column('jobTerrain', new Uint8Array(n));
    this.jobSpot = this.column('jobSpot', new Int32Array(n));
    this.jobTimer = this.column('jobTimer', new Int32Array(n));
    this.jobTries = this.column('jobTries', new Uint8Array(n));
    this.jobTarget = this.column('jobTarget', new Int32Array(n));
    this.carryKind = this.column('carryKind', new Uint8Array(n));
    this.carry = this.column('carry', new Int32Array(n));
    this.hp = this.column('hp', new Int32Array(n));
    this.orderKind = this.column('orderKind', new Uint8Array(n));
    this.queueKind = this.column('queueKind', new Uint8Array(n * q), q);
    this.target = this.column('target', new Int32Array(n));
    this.engaged = this.column('engaged', new Uint8Array(n));
    this.homeX = this.column('homeX', new Int32Array(n));
    this.homeY = this.column('homeY', new Int32Array(n));
    this.homeGroup = this.column('homeGroup', new Int32Array(n));
    this.otherX = this.column('otherX', new Int32Array(n));
    this.otherY = this.column('otherY', new Int32Array(n));
    this.windup = this.column('windup', new Uint16Array(n));
    this.cooldown = this.column('cooldown', new Uint16Array(n));
    this.rooted = this.column('rooted', new Uint8Array(n));
    this.chaseTries = this.column('chaseTries', new Uint8Array(n));
    this.momentum = this.column('momentum', new Uint16Array(n));
    this.built = this.column('built', new Uint8Array(n));
    this.buildPoints = this.column('buildPoints', new Int32Array(n));
    this.trainQueue = this.column('trainQueue', new Uint8Array(n * TRAIN_QUEUE_LENGTH), TRAIN_QUEUE_LENGTH);
    this.trainLength = this.column('trainLength', new Uint8Array(n));
    this.trainTicks = this.column('trainTicks', new Int32Array(n));
    this.trainStarted = this.column('trainStarted', new Uint8Array(n));
    this.rallyX = this.column('rallyX', new Int32Array(n));
    this.rallyY = this.column('rallyY', new Int32Array(n));
    this.rallyTile = this.column('rallyTile', new Int32Array(n));
    this.stock = new Int32Array(config.playerCount * RESOURCE_COUNT);
    this.spent = new Int32Array(config.playerCount * RESOURCE_COUNT);
    this.lost = new Int32Array(RESOURCE_COUNT);
    this.team = new Uint8Array(config.playerCount);
    for (let player = 0; player < config.playerCount; player++) {
      const side = config.teams[player];
      // Sides named in the list are numbered from 0; everyone else gets a side to themselves above those.
      this.team[player] = side === undefined ? 128 + player : side & 127;
    }
    this.shots = new Int32Array(64 * SHOT_FIELDS);

    this.searchScratch = new SearchScratch(this.map.tileCount);
    this.scratchX = new Int32Array(n);
    this.scratchY = new Int32Array(n);
    this.scratchPushX = new Int32Array(n);
    this.scratchPushY = new Int32Array(n);
    this.scratchFlags = new Uint8Array(n);
    this.scratchBuilders = new Uint16Array(n);
    this.scratchDamage = new Int32Array(n);
    this.scratchBuildings = new Int32Array(n);
    // The neighbour grid uses cells two tiles across.
    const cells = ((this.map.width + 1) >> 1) * ((this.map.height + 1) >> 1);
    this.cellStart = new Int32Array(cells + 1);
    this.cellItems = new Int32Array(n);

    if (config.start === 'standard' && !restoring) this.placeStartingKit();
  }

  /** A town centre on each player's start, villagers round it, and something in the stores. */
  private placeStartingKit(): void {
    const { map } = this;
    const reach = (ENTITY_TYPES[Kind.TownCentre]!.footprint >> 1) + 1;
    for (let player = 0; player < this.config.playerCount; player++) {
      const start = map.starts[player];
      if (start === undefined) break;
      const tx = start.x >> 16;
      const ty = start.y >> 16;
      this.spawnBuilding(player, Kind.TownCentre, tx, ty);
      this.stock.set(STARTING_STOCK, player * RESOURCE_COUNT);
      // Villagers line up along the side of the hall that faces the middle of the map.
      const towardCentreX = tx * 2 < map.width ? 1 : -1;
      const towardCentreY = ty * 2 < map.height ? 1 : -1;
      for (let i = 0; i < STARTING_VILLAGERS; i++) {
        const along = i - (STARTING_VILLAGERS >> 1);
        const vx = tx + towardCentreX * reach;
        const vy = ty + towardCentreY * along;
        if (map.isPassable(vx, vy)) this.spawnUnit(player, Kind.Villager, vx * ONE + HALF, vy * ONE + HALF);
      }
    }
  }

  private column<T extends Column>(name: string, data: T, stride = 1): T {
    this.columnList.push({ name, data, stride });
    return data;
  }

  /** Every entity property, in a fixed order. */
  get columns(): readonly ColumnInfo[] {
    return this.columnList;
  }

  /** Takes a free slot and wipes it, or returns -1 if the world is full. */
  private claimSlot(): number {
    let slot = this.freeSlots.pop();
    if (slot === undefined) {
      if (this.highWater >= this.config.maxEntities) return -1;
      slot = this.highWater++;
    }
    const generation = this.generation[slot]!;
    // Clear whatever the slot's previous occupant left behind.
    for (const { data, stride } of this.columnList) data.fill(0, slot * stride, (slot + 1) * stride);
    this.paths[slot] = undefined;
    this.generation[slot] = generation;
    this.alive[slot] = 1;
    this.jobTile[slot] = -1;
    this.jobTarget[slot] = NO_ENTITY;
    this.target[slot] = NO_ENTITY;
    this.rallyX[slot] = -1;
    this.rallyY[slot] = -1;
    this.rallyTile[slot] = -1;
    return slot;
  }

  /**
   * Creates a unit and returns its handle, or NO_ENTITY if the world is full.
   * The position must be on passable ground.
   */
  spawnUnit(owner: number, entityType: number, x: Fixed, y: Fixed): EntityId {
    const type = ENTITY_TYPES[entityType];
    if (type === undefined || type.building) throw new RangeError(`not a unit type: ${entityType}`);
    const slot = this.claimSlot();
    if (slot === -1) return NO_ENTITY;
    this.owner[slot] = owner;
    this.entityType[slot] = entityType;
    this.mobile[slot] = 1;
    this.posX[slot] = x;
    this.posY[slot] = y;
    this.goalX[slot] = x;
    this.goalY[slot] = y;
    this.steerX[slot] = x;
    this.steerY[slot] = y;
    this.dirX[slot] = 0;
    this.dirY[slot] = ONE;
    this.speed[slot] = perSecondToPerTick(type.speed, this.config.tickRate);
    this.radius[slot] = type.radius;
    this.hp[slot] = type.hp;
    this.homeX[slot] = x;
    this.homeY[slot] = y;
    return this.idAt(slot);
  }

  /**
   * Puts up a building centred on a tile and returns its handle, or NO_ENTITY
   * if the world is full. The ground it covers stops being passable at once,
   * whether the building is finished or only a site waiting to be built.
   */
  spawnBuilding(owner: number, entityType: number, tileX: number, tileY: number, finished = true): EntityId {
    const type = ENTITY_TYPES[entityType];
    if (type === undefined || !type.building) throw new RangeError(`not a building type: ${entityType}`);
    const slot = this.claimSlot();
    if (slot === -1) return NO_ENTITY;
    this.owner[slot] = owner;
    this.entityType[slot] = entityType;
    this.posX[slot] = tileX * ONE + HALF;
    this.posY[slot] = tileY * ONE + HALF;
    this.goalX[slot] = this.posX[slot]!;
    this.goalY[slot] = this.posY[slot]!;
    this.dirY[slot] = ONE;
    if (finished) {
      this.built[slot] = 1;
      this.buildPoints[slot] = buildPointsNeeded(entityType, this.config.tickRate);
      this.hp[slot] = type.hp;
    } else {
      this.hp[slot] = siteHp(entityType);
    }
    const half = type.footprint >> 1;
    this.map.setBuilding(tileX - half, tileY - half, type.footprint, true);
    return this.idAt(slot);
  }

  destroy(id: EntityId): void {
    if (!this.isAlive(id)) return;
    const slot = entityIndex(id);
    this.clearOrders(slot);
    // Whatever a villager was carrying goes with it.
    if (this.carry[slot]! > 0) {
      this.lost[this.carryKind[slot]!] = this.lost[this.carryKind[slot]!]! + this.carry[slot]!;
      this.carry[slot] = 0;
    }
    const type = ENTITY_TYPES[this.entityType[slot]!]!;
    if (type.building) {
      const half = type.footprint >> 1;
      this.map.setBuilding(
        (this.posX[slot]! >> 16) - half,
        (this.posY[slot]! >> 16) - half,
        type.footprint,
        false,
      );
    }
    this.alive[slot] = 0;
    this.generation[slot] = (this.generation[slot]! + 1) & GENERATION_MASK;
    this.freeSlots.push(slot);
  }

  isAlive(id: EntityId): boolean {
    // Handles are non-negative 32-bit integers. Anything else (a fraction, a
    // huge number whose low bits happen to match a real handle) is not one.
    if ((id | 0) !== id || id < 0) return false;
    const slot = entityIndex(id);
    return (
      slot < this.highWater &&
      this.alive[slot] === 1 &&
      this.generation[slot] === entityGeneration(id)
    );
  }

  /** The handle of whatever currently occupies a slot. */
  idAt(slot: number): EntityId {
    return (this.generation[slot]! << INDEX_BITS) | slot;
  }

  /** Handles of all living entities, optionally one player's, in slot order. */
  livingEntities(owner?: number): EntityId[] {
    const out: EntityId[] = [];
    for (let slot = 0; slot < this.highWater; slot++) {
      if (this.alive[slot] === 0) continue;
      if (owner !== undefined && this.owner[slot] !== owner) continue;
      out.push(this.idAt(slot));
    }
    return out;
  }

  /** Handles of living units (not buildings), optionally one player's, in slot order. */
  livingUnits(owner?: number): EntityId[] {
    const out: EntityId[] = [];
    for (let slot = 0; slot < this.highWater; slot++) {
      if (this.alive[slot] === 0 || this.mobile[slot] === 0) continue;
      if (owner !== undefined && this.owner[slot] !== owner) continue;
      out.push(this.idAt(slot));
    }
    return out;
  }

  // ---- Orders --------------------------------------------------------------

  createGroup(goalTile: number, faceX: Fixed, faceY: Fixed): MoveGroup {
    const group: MoveGroup = {
      id: this.nextGroupId++,
      goalTile,
      faceX,
      faceY,
      refs: 0,
      status: GroupStatus.New,
      field: null,
      fieldChecksum: 0,
    };
    this.groups.set(group.id, group);
    return group;
  }

  retainGroup(id: number): void {
    if (id === 0) return;
    this.groups.get(id)!.refs++;
  }

  /** Drops one unit's claim on a group; the group goes when no unit needs it. */
  releaseGroup(id: number): void {
    if (id === 0) return;
    const group = this.groups.get(id);
    if (group === undefined) return;
    if (--group.refs <= 0) this.groups.delete(id);
  }

  /**
   * Forgets a unit's current and queued orders, and any fight it is in. It
   * stays where it is, guarding the spot.
   */
  clearOrders(slot: number): void {
    this.releaseGroup(this.group[slot]!);
    this.group[slot] = 0;
    this.releaseGroup(this.homeGroup[slot]!);
    this.homeGroup[slot] = 0;
    const base = slot * ORDER_QUEUE_LENGTH;
    for (let k = 0; k < this.queueLength[slot]!; k++) this.releaseGroup(this.queueGroup[base + k]!);
    this.queueLength[slot] = 0;
    this.orderKind[slot] = OrderKind.None;
    this.target[slot] = NO_ENTITY;
    this.engaged[slot] = 0;
    this.windup[slot] = 0;
    this.rooted[slot] = 0;
    this.chaseTries[slot] = 0;
    this.standStill(slot);
    this.homeX[slot] = this.posX[slot]!;
    this.homeY[slot] = this.posY[slot]!;
  }

  /** Stops a unit in its tracks without touching its orders: it stands where it is until told otherwise. */
  standStill(slot: number): void {
    this.paths[slot] = undefined;
    this.pathIndex[slot] = 0;
    this.stuck[slot] = 0;
    this.retries[slot] = 0;
    // Any route still being worked out for it is now out of date.
    this.orderSeq[slot] = (this.orderSeq[slot]! + 1) | 0;
    this.moveState[slot] = MoveState.Idle;
    this.goalX[slot] = this.posX[slot]!;
    this.goalY[slot] = this.posY[slot]!;
  }

  /** Whether two players are enemies. */
  hostile(a: number, b: number): boolean {
    return this.team[a] !== this.team[b];
  }

  // ---- Arrows ----------------------------------------------------------------

  /** Looses an arrow that will hit `target` for `damage` when tick `lands` comes. */
  addShot(fromX: Fixed, fromY: Fixed, source: EntityId, target: EntityId, damage: number, lands: number): void {
    const at = this.shotCount * SHOT_FIELDS;
    if (at + SHOT_FIELDS > this.shots.length) {
      const bigger = new Int32Array(this.shots.length * 2);
      bigger.set(this.shots);
      this.shots = bigger;
    }
    this.shots[at] = fromX;
    this.shots[at + 1] = fromY;
    this.shots[at + 2] = source;
    this.shots[at + 3] = target;
    this.shots[at + 4] = damage;
    this.shots[at + 5] = this.tick;
    this.shots[at + 6] = lands;
    this.shotCount++;
  }

  // ---- Stores ----------------------------------------------------------------

  canAfford(player: number, cost: readonly number[]): boolean {
    for (let r = 0; r < RESOURCE_COUNT; r++) {
      if (this.stock[player * RESOURCE_COUNT + r]! < cost[r]!) return false;
    }
    return true;
  }

  /** Takes a cost out of a player's stores. Check canAfford first. */
  pay(player: number, cost: readonly number[]): void {
    for (let r = 0; r < RESOURCE_COUNT; r++) {
      const at = player * RESOURCE_COUNT + r;
      this.stock[at] = this.stock[at]! - cost[r]!;
      this.spent[at] = this.spent[at]! + cost[r]!;
    }
  }

  /** Gives a cost back, as when a building site or a queued unit is cancelled. */
  refund(player: number, cost: readonly number[]): void {
    for (let r = 0; r < RESOURCE_COUNT; r++) {
      const at = player * RESOURCE_COUNT + r;
      this.stock[at] = this.stock[at]! + cost[r]!;
      this.spent[at] = this.spent[at]! - cost[r]!;
    }
  }

  /** Takes a gatherer off its round trip. It keeps whatever it is carrying. */
  clearJob(slot: number): void {
    this.job[slot] = Job.None;
    this.jobTile[slot] = -1;
    this.jobSpot[slot] = 0;
    this.jobTimer[slot] = 0;
    this.jobTries[slot] = 0;
    this.jobTarget[slot] = NO_ENTITY;
  }
}
