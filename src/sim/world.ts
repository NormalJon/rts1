/**
 * The complete state of a match.
 *
 * Entities live in parallel arrays ("columns"), one array per property, indexed
 * by slot. This keeps the per-tick loops fast, and because every column is
 * registered in one list, the checksum and the save format cover new
 * properties automatically.
 */

import { CommandQueue } from './commands';
import { Rng } from './rng';
import type { Fixed } from './fixed';

export interface SimConfig {
  /** Simulation steps per second. Fixed for the whole match. */
  readonly tickRate: number;
  readonly seed: number;
  readonly playerCount: number;
  /** Map size in tiles. */
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly maxEntities: number;
}

export const DEFAULT_TICK_RATE = 30;

export function defaultConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    tickRate: DEFAULT_TICK_RATE,
    seed: 1,
    playerCount: 2,
    mapWidth: 64,
    mapHeight: 64,
    maxEntities: 8192,
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

export type Column = Int32Array | Uint16Array | Uint8Array;

export class World {
  readonly config: SimConfig;
  /** Ticks simulated so far, which is also the number of the next tick to run. */
  tick = 0;
  readonly rng: Rng;
  readonly commands = new CommandQueue();

  /** One past the highest slot ever used. */
  highWater = 0;
  /** Slots of dead entities, reused last-freed-first. */
  readonly freeSlots: number[] = [];

  private readonly columnList: { readonly name: string; readonly data: Column }[] = [];

  readonly alive: Uint8Array;
  readonly generation: Uint16Array;
  readonly owner: Uint8Array;
  readonly posX: Int32Array;
  readonly posY: Int32Array;
  readonly targetX: Int32Array;
  readonly targetY: Int32Array;
  /** Distance covered per tick. */
  readonly speed: Int32Array;
  readonly moving: Uint8Array;

  constructor(config: SimConfig) {
    if (!Number.isInteger(config.tickRate) || config.tickRate < 1 || config.tickRate > 120) {
      throw new RangeError(`tickRate must be a whole number from 1 to 120, got ${config.tickRate}`);
    }
    if (config.maxEntities < 1 || config.maxEntities > ENTITY_LIMIT) {
      throw new RangeError(`maxEntities must be from 1 to ${ENTITY_LIMIT}`);
    }
    if (config.playerCount < 1 || config.playerCount > 8) {
      throw new RangeError('playerCount must be from 1 to 8');
    }
    this.config = config;
    this.rng = new Rng(config.seed);

    const n = config.maxEntities;
    this.alive = this.column('alive', new Uint8Array(n));
    this.generation = this.column('generation', new Uint16Array(n));
    this.owner = this.column('owner', new Uint8Array(n));
    this.posX = this.column('posX', new Int32Array(n));
    this.posY = this.column('posY', new Int32Array(n));
    this.targetX = this.column('targetX', new Int32Array(n));
    this.targetY = this.column('targetY', new Int32Array(n));
    this.speed = this.column('speed', new Int32Array(n));
    this.moving = this.column('moving', new Uint8Array(n));
  }

  private column<T extends Column>(name: string, data: T): T {
    this.columnList.push({ name, data });
    return data;
  }

  /** Every entity property, in a fixed order. */
  get columns(): readonly { readonly name: string; readonly data: Column }[] {
    return this.columnList;
  }

  /** Creates an entity and returns its handle, or NO_ENTITY if the world is full. */
  spawn(owner: number, x: Fixed, y: Fixed, speedPerTick: Fixed): EntityId {
    let slot = this.freeSlots.pop();
    if (slot === undefined) {
      if (this.highWater >= this.config.maxEntities) return NO_ENTITY;
      slot = this.highWater++;
    }
    const generation = this.generation[slot]!;
    // Clear whatever the slot's previous occupant left behind.
    for (const { data } of this.columnList) data[slot] = 0;
    this.generation[slot] = generation;
    this.alive[slot] = 1;
    this.owner[slot] = owner;
    this.posX[slot] = x;
    this.posY[slot] = y;
    this.targetX[slot] = x;
    this.targetY[slot] = y;
    this.speed[slot] = speedPerTick;
    return this.idAt(slot);
  }

  destroy(id: EntityId): void {
    if (!this.isAlive(id)) return;
    const slot = entityIndex(id);
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
}
