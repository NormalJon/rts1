/**
 * Working out how units get where they are told to go.
 *
 * A unit that can see its destination walks straight there. Otherwise a lone
 * unit gets its own path, and a group shares one flow field. Searches wait in
 * a queue and are given a fixed amount of work each tick; a unit whose route
 * is not ready yet simply waits, usually for a tick or less.
 */

import { FIXED_MAX, idiv } from './fixed';
import { AStarSearch, FieldSearch } from './search';
import {
  GroupStatus,
  MoveState,
  ORDER_QUEUE_LENGTH,
  type ActiveSearch,
  type RouteRequest,
  type World,
} from './world';

/** Starts a unit on an order. Its claim on the group must already be counted. */
export function beginOrder(world: World, slot: number, groupId: number, goalX: number, goalY: number): void {
  world.orderSeq[slot] = (world.orderSeq[slot]! + 1) | 0;
  world.group[slot] = groupId;
  world.goalX[slot] = goalX;
  world.goalY[slot] = goalY;
  // The ground may have been built on since the order was given.
  keepGoalOnOpenGround(world, slot);
  world.paths[slot] = undefined;
  world.pathIndex[slot] = 0;
  world.stuck[slot] = 0;
  world.retries[slot] = 0;
  world.closest[slot] = FIXED_MAX;
  chooseRoute(world, slot);
}

/** Picks how a unit with a destination should travel, from where it is now. */
export function chooseRoute(world: World, slot: number): void {
  const px = world.posX[slot]!;
  const py = world.posY[slot]!;
  const goalX = world.goalX[slot]!;
  const goalY = world.goalY[slot]!;
  if (world.map.clearPath(px, py, goalX, goalY, world.radius[slot]!)) {
    world.moveState[slot] = MoveState.Direct;
    world.steerX[slot] = goalX;
    world.steerY[slot] = goalY;
    return;
  }
  const group = world.groups.get(world.group[slot]!);
  if (group === undefined) {
    requestPath(world, slot);
    return;
  }
  if (group.status === GroupStatus.Ready) {
    world.moveState[slot] = MoveState.Field;
    // Steering toward where it already stands makes it pick a real heading at once.
    world.steerX[slot] = px;
    world.steerY[slot] = py;
    return;
  }
  if (group.status === GroupStatus.New) {
    group.status = GroupStatus.Pending;
    world.routeQueue.push({ kind: 'field', group: group.id });
  }
  world.moveState[slot] = MoveState.Awaiting;
}

/** If a unit's destination is somewhere it cannot stand, moves the destination to the nearest place it can. */
function keepGoalOnOpenGround(world: World, slot: number): boolean {
  const { map } = world;
  const goalTile = map.tileAt(world.goalX[slot]!, world.goalY[slot]!);
  if (map.passable[goalTile] === 1) return false;
  const region = map.region[map.tileAt(world.posX[slot]!, world.posY[slot]!)]!;
  let near = map.nearestPassable(goalTile % map.width, idiv(goalTile, map.width), region, 24);
  if (near === -1) near = map.nearestPassable(goalTile % map.width, idiv(goalTile, map.width));
  if (near === -1) return false;
  world.goalX[slot] = map.centreX(near);
  world.goalY[slot] = map.centreY(near);
  return true;
}

/**
 * Called when a building has just gone up. Any route may now lead through
 * it, so shared flow fields are thrown away, and each unit on the move checks
 * that its way is still open and asks for a new route if not.
 */
export function routesAfterObstacle(world: World): void {
  const { map } = world;
  for (const group of world.groups.values()) {
    if (map.passable[group.goalTile] === 0) {
      const near = map.nearestPassable(group.goalTile % map.width, idiv(group.goalTile, map.width));
      if (near !== -1) group.goalTile = near;
    }
    if (group.status === GroupStatus.Ready) {
      group.field = null;
      group.fieldChecksum = 0;
      group.status = GroupStatus.New;
    }
  }
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0 || world.mobile[slot] === 0) continue;
    const moved = keepGoalOnOpenGround(world, slot);
    const state = world.moveState[slot]!;
    if (state === MoveState.Idle || state === MoveState.Awaiting) continue;
    if (state === MoveState.Field || moved) {
      chooseRoute(world, slot);
      continue;
    }
    // Walk the rest of the way in the mind's eye: here to the next waypoint, and on to the last.
    let x = world.posX[slot]!;
    let y = world.posY[slot]!;
    let open = true;
    const path = world.paths[slot];
    if (state === MoveState.Path && path !== undefined) {
      for (let i = world.pathIndex[slot]! * 2; i < path.length && open; i += 2) {
        open = map.lineOfSight(x, y, path[i]!, path[i + 1]!);
        x = path[i]!;
        y = path[i + 1]!;
      }
    } else {
      open = map.lineOfSight(x, y, world.goalX[slot]!, world.goalY[slot]!);
    }
    if (!open) chooseRoute(world, slot);
  }
}

/** Queues a search for a path of the unit's own. */
export function requestPath(world: World, slot: number): void {
  world.paths[slot] = undefined;
  world.pathIndex[slot] = 0;
  world.moveState[slot] = MoveState.Awaiting;
  world.routeQueue.push({ kind: 'path', slot, seq: world.orderSeq[slot]! });
}

/**
 * Ends a unit's current order where it stands and starts the next queued one,
 * if any.
 */
export function finishOrder(world: World, slot: number): void {
  const group = world.groups.get(world.group[slot]!);
  if (group !== undefined) {
    // The formation ends up facing the way it was sent.
    world.dirX[slot] = group.faceX;
    world.dirY[slot] = group.faceY;
  }
  world.releaseGroup(world.group[slot]!);
  world.group[slot] = 0;
  world.paths[slot] = undefined;
  world.pathIndex[slot] = 0;
  world.stuck[slot] = 0;
  world.retries[slot] = 0;
  world.moveState[slot] = MoveState.Idle;

  const waiting = world.queueLength[slot]!;
  if (waiting === 0) return;
  const base = slot * ORDER_QUEUE_LENGTH;
  const groupId = world.queueGroup[base]!;
  const goalX = world.queueX[base]!;
  const goalY = world.queueY[base]!;
  for (let k = 1; k < waiting; k++) {
    world.queueGroup[base + k - 1] = world.queueGroup[base + k]!;
    world.queueX[base + k - 1] = world.queueX[base + k]!;
    world.queueY[base + k - 1] = world.queueY[base + k]!;
  }
  world.queueGroup[base + waiting - 1] = 0;
  world.queueX[base + waiting - 1] = 0;
  world.queueY[base + waiting - 1] = 0;
  world.queueLength[slot] = waiting - 1;
  // The queued entry's claim on its group becomes the current order's claim.
  beginOrder(world, slot, groupId, goalX, goalY);
}

/** Spends this tick's pathfinding budget on the searches at the head of the queue. */
export function routingSystem(world: World): void {
  let budget = world.config.pathBudget;
  while (budget > 0) {
    if (world.activeSearch === null) {
      const request = world.routeQueue.shift();
      if (request === undefined) return;
      world.activeSearch = startSearch(world, request);
      if (world.activeSearch === null) continue;
    }
    let active: ActiveSearch | null = world.activeSearch;
    if (active.mapVersion !== world.map.passVersion) {
      // A tree has fallen or a building gone up since this search began, so
      // what it has worked out may be wrong. Begin it again on the new map.
      active = world.activeSearch = startSearch(world, active.request);
      if (active === null) continue;
    }
    budget -= active.search.run(budget);
    if (!active.search.done) return;
    world.activeSearch = null;
    finishSearch(world, active);
  }
}

function pathRequestStillWanted(world: World, slot: number, seq: number): boolean {
  return (
    world.alive[slot] === 1 &&
    world.orderSeq[slot] === seq &&
    world.moveState[slot] === MoveState.Awaiting
  );
}

function startSearch(world: World, request: RouteRequest): ActiveSearch | null {
  const { map } = world;
  if (request.kind === 'path') {
    const { slot, seq } = request;
    if (!pathRequestStillWanted(world, slot, seq)) return null;
    const start = map.tileAt(world.posX[slot]!, world.posY[slot]!);
    const goal = map.tileAt(world.goalX[slot]!, world.goalY[slot]!);
    return restoreSearch(world, request, start, goal, []);
  }
  const group = world.groups.get(request.group);
  if (group === undefined) return null;
  const targets: number[] = [];
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 1 && world.group[slot] === group.id) {
      targets.push(map.tileAt(world.posX[slot]!, world.posY[slot]!));
    }
  }
  return restoreSearch(world, request, group.goalTile, -1, targets);
}

/**
 * Builds a search from its recorded inputs. Also used when loading a saved
 * game, where the search is then re-run to the point it had reached.
 */
export function restoreSearch(
  world: World,
  request: RouteRequest,
  start: number,
  goal: number,
  targets: readonly number[],
): ActiveSearch {
  const search =
    request.kind === 'path'
      ? new AStarSearch(world.map, world.searchScratch, start, goal)
      : new FieldSearch(world.map, world.searchScratch, start, targets);
  return { request, mapVersion: world.map.passVersion, start, goal, targets, search };
}

function finishSearch(world: World, active: ActiveSearch): void {
  const { request, search } = active;
  if (request.kind === 'path') {
    const { slot, seq } = request;
    if (!pathRequestStillWanted(world, slot, seq)) return;
    const astar = search as AStarSearch;
    if (!astar.found) {
      // Nowhere to go. Stay put and carry on with whatever is queued next.
      world.goalX[slot] = world.posX[slot]!;
      world.goalY[slot] = world.posY[slot]!;
      finishOrder(world, slot);
      return;
    }
    const waypoints = smoothPath(world, slot, astar.path());
    world.paths[slot] = waypoints;
    world.pathIndex[slot] = 0;
    world.steerX[slot] = waypoints[0]!;
    world.steerY[slot] = waypoints[1]!;
    world.moveState[slot] = MoveState.Path;
    return;
  }
  const group = world.groups.get(request.group);
  if (group === undefined) return;
  const field = (search as FieldSearch).directions;
  group.field = field;
  group.fieldChecksum = checksumBytes(field);
  group.status = GroupStatus.Ready;
  for (let slot = 0; slot < world.highWater; slot++) {
    if (
      world.alive[slot] === 1 &&
      world.group[slot] === group.id &&
      world.moveState[slot] === MoveState.Awaiting
    ) {
      world.moveState[slot] = MoveState.Field;
      world.steerX[slot] = world.posX[slot]!;
      world.steerY[slot] = world.posY[slot]!;
    }
  }
}

export function checksumBytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return h >>> 0;
}

/**
 * Turns a tile-by-tile path into a few waypoints the unit can walk between in
 * straight lines, cutting every corner that can safely be cut.
 */
function smoothPath(world: World, slot: number, tiles: readonly number[]): Int32Array {
  const { map } = world;
  const radius = world.radius[slot]!;
  const goalX = world.goalX[slot]!;
  const goalY = world.goalY[slot]!;
  const points: number[] = [];
  let fromX = world.posX[slot]!;
  let fromY = world.posY[slot]!;
  const last = tiles.length - 1;
  let reached = 0;
  while (reached < last && !map.clearPath(fromX, fromY, goalX, goalY, radius)) {
    // The furthest tile ahead that can be walked to in a straight line. The
    // next tile is always taken, since stepping to a neighbour is always possible.
    let next = reached + 1;
    for (let j = reached + 1; j <= last; j++) {
      const tile = tiles[j]!;
      if (!map.clearPath(fromX, fromY, map.centreX(tile), map.centreY(tile), radius)) break;
      next = j;
    }
    fromX = map.centreX(tiles[next]!);
    fromY = map.centreY(tiles[next]!);
    points.push(fromX, fromY);
    reached = next;
  }
  points.push(goalX, goalY);
  return Int32Array.from(points);
}
