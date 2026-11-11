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
import { ENTITY_TYPES, Kind, RESOURCE_COUNT } from './entityTypes';
import { perSecondToPerTick } from './units';

export interface SimConfig {
  /** Simulation steps per second. Fixed for the whole match. */
  readonly tickRate: number;
  readonly seed: number;
  readonly playerCount: number;
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
    mapWidth: 64,
    mapHeight: 64,
    map: { kind: 'flat' },
    start: 'empty',
    maxEntities: 8192,
    pathBudget: 30000,
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
  readonly goalTile: number;
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

  /** Each player's stockpile: playerCount x 4, as food, wood, stone, gold. */
  readonly stock: Int32Array;

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
    this.stock = new Int32Array(config.playerCount * RESOURCE_COUNT);

    this.searchScratch = new SearchScratch(this.map.tileCount);
    this.scratchX = new Int32Array(n);
    this.scratchY = new Int32Array(n);
    this.scratchPushX = new Int32Array(n);
    this.scratchPushY = new Int32Array(n);
    this.scratchFlags = new Uint8Array(n);
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
    return this.idAt(slot);
  }

  /**
   * Puts up a building centred on a tile and returns its handle, or NO_ENTITY
   * if the world is full. The ground it covers stops being passable.
   */
  spawnBuilding(owner: number, entityType: number, tileX: number, tileY: number): EntityId {
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
    const half = type.footprint >> 1;
    this.map.setBuilding(tileX - half, tileY - half, type.footprint, true);
    return this.idAt(slot);
  }

  destroy(id: EntityId): void {
    if (!this.isAlive(id)) return;
    const slot = entityIndex(id);
    this.clearOrders(slot);
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

  /** Forgets a unit's current and queued orders. It stays where it is. */
  clearOrders(slot: number): void {
    this.releaseGroup(this.group[slot]!);
    this.group[slot] = 0;
    const base = slot * ORDER_QUEUE_LENGTH;
    for (let k = 0; k < this.queueLength[slot]!; k++) this.releaseGroup(this.queueGroup[base + k]!);
    this.queueLength[slot] = 0;
    this.paths[slot] = undefined;
    this.pathIndex[slot] = 0;
    this.stuck[slot] = 0;
    this.retries[slot] = 0;
    // Any route still being worked out for the old order is now out of date.
    this.orderSeq[slot] = (this.orderSeq[slot]! + 1) | 0;
    this.moveState[slot] = MoveState.Idle;
    this.goalX[slot] = this.posX[slot]!;
    this.goalY[slot] = this.posY[slot]!;
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
