/**
 * Saving and restoring the whole world.
 *
 * A snapshot is plain data, so JSON.stringify turns it straight into a save
 * file, and the same thing lets a player who dropped out of a multiplayer
 * match rejoin: load the snapshot, then run the commands issued since.
 *
 * The lie of the land is not saved; it is rebuilt from the match settings,
 * which always produce the same map. What has changed on it since (felled
 * trees, worked-out deposits) is saved.
 */

import type { ScheduledCommand } from './commands';
import { ENTITY_TYPES } from './entityTypes';
import { idiv } from './fixed';
import type { RngState } from './rng';
import { checksumBytes, restoreSearch } from './routing';
import { exploredRuns, restoreVision } from './vision';
import { SHOT_FIELDS, World, type RouteRequest, type SimConfig } from './world';

interface SavedGroup {
  readonly id: number;
  readonly goalTile: number;
  readonly faceX: number;
  readonly faceY: number;
  readonly refs: number;
  readonly status: number;
  /** The flow field, one direction per tile, once it has been worked out. */
  readonly field: readonly number[] | null;
}

/**
 * A route search caught part-way through. Searches are repeatable, so it is
 * saved as its inputs plus how far it had got, and re-run to that point on
 * loading.
 */
interface SavedSearch {
  readonly request: RouteRequest;
  readonly start: number;
  readonly goal: number;
  readonly targets: readonly number[];
  readonly expansions: number;
}

export interface WorldSnapshot {
  readonly version: 6;
  readonly config: SimConfig;
  readonly tick: number;
  readonly rng: RngState;
  readonly highWater: number;
  readonly freeSlots: readonly number[];
  /** What is on each tile now, and how much of its resource is left. */
  readonly terrain: readonly number[];
  readonly amount: readonly number[];
  /** Each player's stockpile, and what they have spent. */
  readonly stock: readonly number[];
  readonly spent: readonly number[];
  /** Resources that died with the villagers carrying them. */
  readonly lost: readonly number[];
  /** Arrows in the air, SHOT_FIELDS numbers each. */
  readonly shots: readonly number[];
  /**
   * What each side has explored, as runs: so many tiles unexplored, so many
   * explored, and so on in turn. What each side can see at the moment is not
   * saved; it follows from where everyone stands.
   */
  readonly explored: readonly (readonly number[])[];
  /** Each entity property by name, holding slots 0 to highWater - 1. */
  readonly columns: Readonly<Record<string, readonly number[]>>;
  /** Waypoint lists by slot, for units following their own path. */
  readonly paths: readonly (readonly number[] | null)[];
  readonly nextGroupId: number;
  readonly groups: readonly SavedGroup[];
  readonly routeQueue: readonly RouteRequest[];
  readonly activeSearch: SavedSearch | null;
  /** Commands issued but not yet run. */
  readonly pending: readonly ScheduledCommand[];
}

export function takeSnapshot(world: World): WorldSnapshot {
  const columns: Record<string, number[]> = {};
  for (const { name, data, stride } of world.columns) {
    columns[name] = Array.from(data.subarray(0, world.highWater * stride));
  }
  const paths: (number[] | null)[] = [];
  for (let slot = 0; slot < world.highWater; slot++) {
    const path = world.alive[slot] === 1 ? world.paths[slot] : undefined;
    paths.push(path === undefined ? null : Array.from(path));
  }
  const active = world.activeSearch;
  return {
    version: 6,
    config: { ...world.config },
    tick: world.tick,
    rng: world.rng.getState(),
    highWater: world.highWater,
    freeSlots: [...world.freeSlots],
    terrain: Array.from(world.map.terrain),
    amount: Array.from(world.map.amount),
    stock: Array.from(world.stock),
    spent: Array.from(world.spent),
    lost: Array.from(world.lost),
    shots: Array.from(world.shots.subarray(0, world.shotCount * SHOT_FIELDS)),
    explored: world.explored.map((_, view) => exploredRuns(world, view)),
    columns,
    paths,
    nextGroupId: world.nextGroupId,
    groups: [...world.groups.values()].map((group) => ({
      id: group.id,
      goalTile: group.goalTile,
      faceX: group.faceX,
      faceY: group.faceY,
      refs: group.refs,
      status: group.status,
      field: group.field === null ? null : Array.from(group.field),
    })),
    routeQueue: world.routeQueue.map((request) => ({ ...request })),
    activeSearch:
      active === null
        ? null
        : {
            request: { ...active.request },
            start: active.start,
            goal: active.goal,
            targets: [...active.targets],
            expansions: active.search.expansions,
          },
    pending: world.commands.pending(),
  };
}

export function restoreSnapshot(snapshot: WorldSnapshot): World {
  if (snapshot.version !== 6) {
    throw new Error(`unsupported snapshot version ${String(snapshot.version)}`);
  }
  const world = new World(snapshot.config, true);
  if (snapshot.highWater > world.config.maxEntities) {
    throw new Error('snapshot holds more entities than its config allows');
  }
  world.tick = snapshot.tick;
  world.rng.setState(snapshot.rng);
  world.highWater = snapshot.highWater;
  world.freeSlots.push(...snapshot.freeSlots);
  for (const { name, data, stride } of world.columns) {
    const saved = snapshot.columns[name];
    if (saved === undefined) throw new Error(`snapshot is missing column "${name}"`);
    if (saved.length !== snapshot.highWater * stride) {
      throw new Error(`snapshot column "${name}" has the wrong length`);
    }
    data.set(saved);
  }
  for (let slot = 0; slot < snapshot.highWater; slot++) {
    const path = snapshot.paths[slot];
    world.paths[slot] = path === null || path === undefined ? undefined : Int32Array.from(path);
  }
  // The ground as it now is, then the buildings standing on it.
  world.map.restoreState(snapshot.terrain, snapshot.amount);
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0 || world.mobile[slot] === 1) continue;
    const footprint = ENTITY_TYPES[world.entityType[slot]!]!.footprint;
    const half = footprint >> 1;
    world.map.setBuilding((world.posX[slot]! >> 16) - half, (world.posY[slot]! >> 16) - half, footprint, true);
  }
  restoreVision(world, snapshot.explored);
  world.stock.set(snapshot.stock);
  world.spent.set(snapshot.spent);
  world.lost.set(snapshot.lost);
  if (snapshot.shots.length > world.shots.length) world.shots = new Int32Array(snapshot.shots.length);
  world.shots.set(snapshot.shots);
  world.shotCount = idiv(snapshot.shots.length, SHOT_FIELDS);
  world.nextGroupId = snapshot.nextGroupId;
  for (const saved of [...snapshot.groups].sort((a, b) => a.id - b.id)) {
    const field = saved.field === null ? null : Uint8Array.from(saved.field);
    world.groups.set(saved.id, {
      id: saved.id,
      goalTile: saved.goalTile,
      faceX: saved.faceX,
      faceY: saved.faceY,
      refs: saved.refs,
      status: saved.status,
      field,
      fieldChecksum: field === null ? 0 : checksumBytes(field),
    });
  }
  world.routeQueue.push(...snapshot.routeQueue);
  const active = snapshot.activeSearch;
  if (active !== null) {
    world.activeSearch = restoreSearch(world, active.request, active.start, active.goal, active.targets);
    world.activeSearch.search.run(active.expansions);
  }
  for (const entry of snapshot.pending) world.commands.schedule(entry, world.tick);
  return world;
}
