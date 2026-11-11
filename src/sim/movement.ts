/**
 * Moving units, one tick at a time.
 *
 * Every tick runs in three passes over all units, each reading only what the
 * pass before it wrote, so the result never depends on the order units are
 * visited in:
 *
 *   1. Intent: each unit decides where it would like to step.
 *   2. Separation: units that would overlap are eased apart. A standing unit
 *      gives way to a comrade on the move, then drifts back to its post.
 *   3. Commit: positions are kept out of trees, rock and water, and each unit
 *      checks whether it has arrived or is getting nowhere.
 */

import { fromRatio, idiv, length, mulDiv, ONE, type Fixed } from './fixed';
import { DIR_X, DIR_Y } from './map';
import { chooseRoute, finishOrder, requestPath } from './routing';
import { FIELD_GOAL } from './search';
import { MoveState, type World } from './world';

/** How many tiles ahead along a flow field a unit looks for a straight run. */
const LOOKAHEAD = 10;
/** A standing unit tolerates being this far off its post before walking back. */
const HOLD_TOLERANCE: Fixed = ONE >> 5;
/** Close enough to count as having arrived. */
const ARRIVAL_RANGE: Fixed = ONE >> 4;
/** A blocked unit this near its destination settles where it stands. */
const SETTLE_RANGE: Fixed = 2 * ONE;
/** How many times a blocked unit asks for a fresh route before giving up. */
const MAX_RETRIES = 2;
/** The neighbour grid's cells are two tiles across. */
const CELL_SHIFT = 17;

/** Flags noted during separation, per unit. */
const PUSHED_BY_STANDING = 1;
const PUSHED_BY_MOVING = 2;

/** Eight unit vectors, for separating two units standing on the same spot. */
const DIAGONAL: Fixed = fromRatio(46341, 65536);
const NUDGE_X = [ONE, DIAGONAL, 0, -DIAGONAL, -ONE, -DIAGONAL, 0, DIAGONAL];
const NUDGE_Y = [0, DIAGONAL, ONE, DIAGONAL, 0, -DIAGONAL, -ONE, -DIAGONAL];

export function movementSystem(world: World): void {
  const count = world.highWater;
  if (count === 0) return;
  buildNeighbourGrid(world);
  const steerEvery = Math.max(1, idiv(world.config.tickRate, 8));
  const stuckLimit = Math.max(4, idiv(world.config.tickRate * 3, 2));

  const { alive, moveState, posX, posY } = world;
  const nextX = world.scratchX;
  const nextY = world.scratchY;

  // Pass 1: intent. Buildings take no part in any of this.
  const { mobile } = world;
  for (let slot = 0; slot < count; slot++) {
    if (alive[slot] === 0 || mobile[slot] === 0) continue;
    nextX[slot] = posX[slot]!;
    nextY[slot] = posY[slot]!;
    const state = moveState[slot]!;
    if (state === MoveState.Awaiting) continue;
    if (state === MoveState.Idle) {
      stepToward(world, slot, world.goalX[slot]!, world.goalY[slot]!, HOLD_TOLERANCE, false);
      continue;
    }
    steer(world, slot, (world.tick + slot) % steerEvery === 0);
    // Steering can hand the unit back to the route queue.
    if (moveState[slot] === MoveState.Awaiting) continue;
    stepToward(world, slot, world.steerX[slot]!, world.steerY[slot]!, 0, true);
  }

  separate(world);

  // Pass 3: commit.
  const pushX = world.scratchPushX;
  const pushY = world.scratchPushY;
  const flags = world.scratchFlags;
  for (let slot = 0; slot < count; slot++) {
    if (alive[slot] === 0 || mobile[slot] === 0) continue;
    const fromX = posX[slot]!;
    const fromY = posY[slot]!;
    settleOnGround(world, slot, nextX[slot]! + pushX[slot]!, nextY[slot]! + pushY[slot]!);
    const state = moveState[slot]!;
    if (state === MoveState.Idle) {
      // Two standing units that crowd each other both shuffle over for good.
      if ((flags[slot]! & PUSHED_BY_STANDING) !== 0) {
        world.goalX[slot] = posX[slot]!;
        world.goalY[slot] = posY[slot]!;
      }
      continue;
    }
    if (state === MoveState.Awaiting) continue;

    const toGoal = length(world.goalX[slot]! - posX[slot]!, world.goalY[slot]! - posY[slot]!);
    const path = world.paths[slot];
    const onLastLeg =
      state === MoveState.Direct ||
      (state === MoveState.Path && path !== undefined && world.pathIndex[slot]! * 2 >= path.length - 2);
    if (onLastLeg && toGoal <= Math.max(ARRIVAL_RANGE, world.speed[slot]!)) {
      finishOrder(world, slot);
      continue;
    }

    // Is it getting anywhere? On the final approach that means getting
    // nearer; before that, any real movement counts, since a route may lead
    // away from the destination for a while.
    const quarterStride = world.speed[slot]! >> 2;
    let progressing: boolean;
    if (onLastLeg) {
      progressing = toGoal < world.closest[slot]! - quarterStride;
      if (progressing) world.closest[slot] = toGoal;
    } else {
      const dx = posX[slot]! - fromX;
      const dy = posY[slot]! - fromY;
      progressing = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy) >= quarterStride;
    }
    if (progressing) {
      if (world.stuck[slot]! > 0) world.stuck[slot] = world.stuck[slot]! - 1;
      continue;
    }
    // Held up behind others who are also on the move is a queue, not a dead
    // end, so patience runs out eight times more slowly.
    if ((flags[slot]! & PUSHED_BY_MOVING) !== 0 && (world.tick & 7) !== 0) continue;
    world.stuck[slot] = world.stuck[slot]! + 1;
    if (world.stuck[slot]! <= stuckLimit) continue;
    world.stuck[slot] = 0;
    if (toGoal > SETTLE_RANGE && world.retries[slot]! < MAX_RETRIES) {
      world.retries[slot] = world.retries[slot]! + 1;
      requestPath(world, slot);
    } else {
      // Its place is taken or cannot be reached. Here will do.
      world.goalX[slot] = posX[slot]!;
      world.goalY[slot] = posY[slot]!;
      finishOrder(world, slot);
    }
  }
}

/** Sorts units into grid cells so each can find its neighbours quickly. */
function buildNeighbourGrid(world: World): void {
  const { alive, mobile, posX, posY, cellStart, cellItems } = world;
  const columns = (world.map.width + 1) >> 1;
  cellStart.fill(0);
  let units = 0;
  for (let slot = 0; slot < world.highWater; slot++) {
    if (alive[slot] === 0 || mobile[slot] === 0) continue;
    units++;
    cellStart[(posY[slot]! >> CELL_SHIFT) * columns + (posX[slot]! >> CELL_SHIFT) + 1]!++;
  }
  for (let cell = 1; cell < cellStart.length; cell++) cellStart[cell] = cellStart[cell]! + cellStart[cell - 1]!;
  // Filling from the highest slot down leaves each cell in ascending slot order.
  for (let slot = world.highWater - 1; slot >= 0; slot--) {
    if (alive[slot] === 0 || mobile[slot] === 0) continue;
    const cell = (posY[slot]! >> CELL_SHIFT) * columns + (posX[slot]! >> CELL_SHIFT);
    cellItems[cellStart[cell + 1]! - 1] = slot;
    cellStart[cell + 1] = cellStart[cell + 1]! - 1;
  }
  // The fill shifted every boundary down by one cell; shift them back.
  for (let cell = 0; cell < cellStart.length - 1; cell++) cellStart[cell] = cellStart[cell + 1]!;
  cellStart[cellStart.length - 1] = units;
}

/** Updates where a moving unit is heading. */
function steer(world: World, slot: number, refresh: boolean): void {
  const { map } = world;
  const px = world.posX[slot]!;
  const py = world.posY[slot]!;
  const goalX = world.goalX[slot]!;
  const goalY = world.goalY[slot]!;
  const state = world.moveState[slot]!;

  if (state === MoveState.Direct) {
    world.steerX[slot] = goalX;
    world.steerY[slot] = goalY;
    // Jostling can shove it behind an obstacle. If so, find a proper route.
    if (refresh && !map.clearPath(px, py, goalX, goalY, world.radius[slot]!)) chooseRoute(world, slot);
    return;
  }

  if (state === MoveState.Path) {
    const path = world.paths[slot]!;
    let index = world.pathIndex[slot]!;
    const lastIndex = (path.length >> 1) - 1;
    const stride = world.speed[slot]!;
    while (index < lastIndex) {
      const wx = path[index * 2]!;
      const wy = path[index * 2 + 1]!;
      if (length(wx - px, wy - py) > stride) break;
      index++;
    }
    world.pathIndex[slot] = index;
    world.steerX[slot] = path[index * 2]!;
    world.steerY[slot] = path[index * 2 + 1]!;
    return;
  }

  // Following the group's flow field.
  const stride = world.speed[slot]!;
  const reached = length(world.steerX[slot]! - px, world.steerY[slot]! - py) <= stride;
  if (!refresh && !reached) return;
  const group = world.groups.get(world.group[slot]!);
  if (group === undefined || group.field === null) {
    requestPath(world, slot);
    return;
  }
  const radius = world.radius[slot]!;
  let tile = map.tileAt(px, py);
  if (tile === group.goalTile || map.clearPath(px, py, goalX, goalY, radius)) {
    world.moveState[slot] = MoveState.Direct;
    world.steerX[slot] = goalX;
    world.steerY[slot] = goalY;
    return;
  }
  const field = group.field;
  if (field[tile]! > FIELD_GOAL) {
    // Pushed somewhere the field does not cover. Go it alone.
    requestPath(world, slot);
    return;
  }
  // Aim at the furthest tile along the flow that can be walked to in a
  // straight line, so the unit crosses open ground at any angle instead of
  // zigzagging from tile to tile.
  let aim = -1;
  for (let k = 0; k < LOOKAHEAD; k++) {
    const dir = field[tile]!;
    if (dir >= FIELD_GOAL) break;
    tile += DIR_Y[dir]! * map.width + DIR_X[dir]!;
    if (k > 0 && !map.clearPath(px, py, map.centreX(tile), map.centreY(tile), radius)) break;
    aim = tile;
  }
  if (aim === -1) return;
  world.steerX[slot] = map.centreX(aim);
  world.steerY[slot] = map.centreY(aim);
}

/**
 * Sets the unit's intended position one stride toward a point, or onto it if
 * that is nearer. Does nothing within `tolerance` of the point.
 */
function stepToward(world: World, slot: number, x: Fixed, y: Fixed, tolerance: Fixed, turn: boolean): void {
  const px = world.posX[slot]!;
  const py = world.posY[slot]!;
  const dx = x - px;
  const dy = y - py;
  const distance = length(dx, dy);
  if (distance <= tolerance || distance === 0) return;
  const stride = world.speed[slot]!;
  if (distance <= stride) {
    world.scratchX[slot] = x;
    world.scratchY[slot] = y;
  } else {
    world.scratchX[slot] = px + mulDiv(dx, stride, distance);
    world.scratchY[slot] = py + mulDiv(dy, stride, distance);
  }
  if (turn) {
    world.dirX[slot] = mulDiv(dx, ONE, distance);
    world.dirY[slot] = mulDiv(dy, ONE, distance);
  }
}

/**
 * Pass 2. For each unit, works out how far it must shift so that it does not
 * overlap its neighbours' intended positions.
 */
function separate(world: World): void {
  const { alive, moveState, owner, radius, dirX, dirY, cellStart, cellItems } = world;
  const nextX = world.scratchX;
  const nextY = world.scratchY;
  const pushX = world.scratchPushX;
  const pushY = world.scratchPushY;
  const flags = world.scratchFlags;
  const columns = (world.map.width + 1) >> 1;
  const rows = (world.map.height + 1) >> 1;

  for (let slot = 0; slot < world.highWater; slot++) {
    if (alive[slot] === 0 || world.mobile[slot] === 0) continue;
    const x = nextX[slot]!;
    const y = nextY[slot]!;
    const r = radius[slot]!;
    const moving = moveState[slot]! >= MoveState.Path;
    let shiftX = 0;
    let shiftY = 0;
    let flag = 0;
    const cellX = world.posX[slot]! >> CELL_SHIFT;
    const cellY = world.posY[slot]! >> CELL_SHIFT;
    for (let cy = cellY - 1; cy <= cellY + 1; cy++) {
      if (cy < 0 || cy >= rows) continue;
      for (let cx = cellX - 1; cx <= cellX + 1; cx++) {
        if (cx < 0 || cx >= columns) continue;
        const cell = cy * columns + cx;
        for (let at = cellStart[cell]!; at < cellStart[cell + 1]!; at++) {
          const other = cellItems[at]!;
          if (other === slot) continue;
          const dx = x - nextX[other]!;
          const dy = y - nextY[other]!;
          const apart = r + radius[other]!;
          if (dx >= apart || dx <= -apart || dy >= apart || dy <= -apart) continue;
          const distance = length(dx, dy);
          if (distance >= apart) continue;
          const overlap = apart - distance;

          // How much of the overlap this unit gives up: none, half or all.
          const otherMoving = moveState[other]! >= MoveState.Path;
          const comrades = owner[slot] === owner[other];
          let halves: number;
          if (otherMoving) flag |= PUSHED_BY_MOVING;
          if (moving === otherMoving) {
            halves = 1;
            if (!moving) flag |= PUSHED_BY_STANDING;
          } else if (moving) {
            halves = comrades ? 0 : 2;
          } else {
            halves = comrades ? 2 : 0;
          }

          if (halves === 2 && comrades) {
            // A standing unit steps aside for a comrade coming through: to
            // whichever side of the walker's line it is already on, never
            // ahead of them, or it would be swept along like a leaf.
            const side = dirX[other]! * dy - dirY[other]! * dx >= 0 ? 1 : -1;
            shiftX += side * mulDiv(-dirY[other]!, overlap, ONE);
            shiftY += side * mulDiv(dirX[other]!, overlap, ONE);
          } else if (halves > 0) {
            if (distance === 0) {
              // Exactly on top of each other: part along a direction both agree on.
              const low = slot < other ? slot : other;
              const high = slot < other ? other : slot;
              const way = (low * 7 + high * 13) & 7;
              const sign = slot < other ? 1 : -1;
              shiftX += sign * mulDiv(NUDGE_X[way]!, overlap * halves, 2 * ONE);
              shiftY += sign * mulDiv(NUDGE_Y[way]!, overlap * halves, 2 * ONE);
            } else {
              shiftX += mulDiv(dx, overlap * halves, 2 * distance);
              shiftY += mulDiv(dy, overlap * halves, 2 * distance);
            }
          }

          // Keep to the right when meeting someone head on, or someone who
          // will not budge, so two columns pass instead of locking shields.
          if (moving) {
            const headOn = otherMoving && dirX[slot]! * dirX[other]! + dirY[slot]! * dirY[other]! < 0;
            if (headOn || (!otherMoving && !comrades)) {
              shiftX += mulDiv(-dirY[slot]!, overlap, 2 * ONE);
              shiftY += mulDiv(dirX[slot]!, overlap, 2 * ONE);
            }
          }
        }
      }
    }
    // Never shove a unit further than its own radius in one tick.
    if (shiftX > r) shiftX = r;
    else if (shiftX < -r) shiftX = -r;
    if (shiftY > r) shiftY = r;
    else if (shiftY < -r) shiftY = -r;
    pushX[slot] = shiftX;
    pushY[slot] = shiftY;
    flags[slot] = flag;
  }
}

/**
 * Pass 3, per unit. Moves it to (x, y) but keeps its whole body on open
 * ground: out of impassable tiles and inside the map.
 */
function settleOnGround(world: World, slot: number, x: Fixed, y: Fixed): void {
  const { map } = world;
  const r = world.radius[slot]!;
  if (x < r) x = r;
  else if (x > map.maxX - r) x = map.maxX - r;
  if (y < r) y = r;
  else if (y > map.maxY - r) y = map.maxY - r;

  for (let round = 0; round < 2; round++) {
    const tx = x >> 16;
    const ty = y >> 16;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if ((ox === 0 && oy === 0) || map.isPassable(tx + ox, ty + oy)) continue;
        // The nearest point of the blocked tile.
        const left = (tx + ox) << 16;
        const top = (ty + oy) << 16;
        const nearX = x < left ? left : x > left + ONE ? left + ONE : x;
        const nearY = y < top ? top : y > top + ONE ? top + ONE : y;
        const dx = x - nearX;
        const dy = y - nearY;
        if (dx >= r || dx <= -r || dy >= r || dy <= -r) continue;
        const distance = length(dx, dy);
        if (distance >= r || distance === 0) continue;
        x += mulDiv(dx, r - distance, distance);
        y += mulDiv(dy, r - distance, distance);
      }
    }
  }
  // If it has somehow ended up inside an obstacle, it does not move this tick.
  if (!map.isPassable(x >> 16, y >> 16)) return;
  world.posX[slot] = x;
  world.posY[slot] = y;
}
