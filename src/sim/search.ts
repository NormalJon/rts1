/**
 * The two searches behind unit movement.
 *
 * AStarSearch finds the cheapest route for one unit. FieldSearch works
 * outward from a destination and records, for every tile it reaches, which
 * way to step to get there: one search then guides a whole group, wherever
 * each member happens to stand.
 *
 * Both can be run a slice at a time. Work is counted in tiles examined, never
 * in elapsed time, so a search split across several ticks produces exactly the
 * result it would have produced in one go, on every machine.
 */

import { idiv } from './fixed';
import { DIR_X, DIR_Y, STEP_DIAGONAL, STEP_ORTHOGONAL, type GameMap } from './map';

/** Marks in a flow field for the destination tile and for tiles not reached. */
export const FIELD_GOAL = 8;
export const FIELD_UNKNOWN = 255;

/** Once every unit's tile is reached, a field search carries on this much further. */
const FIELD_MARGIN = 10 * STEP_ORTHOGONAL;

/** Keys pack a cost and a tiebreak into one number; both stay far below 2^53. */
const KEY_SHIFT = 4194304;

class MinHeap {
  private keys: Float64Array;
  private items: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.items = new Int32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(key: number, item: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
      const items = new Int32Array(this.size * 2);
      items.set(this.items);
      this.items = items;
    }
    let i = this.size++;
    const { keys, items } = this;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent]! <= key) break;
      keys[i] = keys[parent]!;
      items[i] = items[parent]!;
      i = parent;
    }
    keys[i] = key;
    items[i] = item;
  }

  /** Removes and returns the item with the smallest key. */
  pop(): number {
    const { keys, items } = this;
    const top = items[0]!;
    const last = --this.size;
    if (last > 0) {
      const key = keys[last]!;
      const item = items[last]!;
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= last) break;
        if (child + 1 < last && keys[child + 1]! < keys[child]!) child++;
        if (keys[child]! >= key) break;
        keys[i] = keys[child]!;
        items[i] = items[child]!;
        i = child;
      }
      keys[i] = key;
      items[i] = item;
    }
    return top;
  }
}

/**
 * Working memory for searches, sized to one map. A world runs one search at a
 * time, so a single set of buffers is reused.
 */
export class SearchScratch {
  readonly cost: Int32Array;
  readonly parent: Int32Array;
  /** 0 untouched, 1 waiting in the heap, 2 finished. */
  readonly mark: Uint8Array;
  readonly isTarget: Uint8Array;
  readonly heap: MinHeap;

  constructor(tileCount: number) {
    this.cost = new Int32Array(tileCount);
    this.parent = new Int32Array(tileCount);
    this.mark = new Uint8Array(tileCount);
    this.isTarget = new Uint8Array(tileCount);
    this.heap = new MinHeap(Math.max(64, tileCount));
  }
}

export interface Search {
  /** Tiles examined so far. */
  readonly expansions: number;
  readonly done: boolean;
  /** Examines up to budget more tiles and returns how many it examined. */
  run(budget: number): number;
}

export class AStarSearch implements Search {
  expansions = 0;
  done = false;
  found = false;
  private readonly goalX: number;
  private readonly goalY: number;

  constructor(
    private readonly map: GameMap,
    private readonly scratch: SearchScratch,
    readonly start: number,
    readonly goal: number,
  ) {
    this.goalX = goal % map.width;
    this.goalY = idiv(goal, map.width);
    scratch.mark.fill(0);
    scratch.heap.clear();
    scratch.cost[start] = 0;
    scratch.parent[start] = -1;
    scratch.mark[start] = 1;
    scratch.heap.push(this.estimate(start % map.width, idiv(start, map.width)), start);
  }

  /** Cost of the straight run to the goal if nothing were in the way. */
  private estimate(tx: number, ty: number): number {
    const dx = tx < this.goalX ? this.goalX - tx : tx - this.goalX;
    const dy = ty < this.goalY ? this.goalY - ty : ty - this.goalY;
    const long = dx > dy ? dx : dy;
    const short = dx > dy ? dy : dx;
    return STEP_ORTHOGONAL * long + (STEP_DIAGONAL - STEP_ORTHOGONAL) * short;
  }

  run(budget: number): number {
    const { map } = this;
    const { cost, parent, mark, heap } = this.scratch;
    const width = map.width;
    let used = 0;
    while (!this.done && used < budget) {
      if (heap.size === 0) {
        this.done = true;
        break;
      }
      const tile = heap.pop();
      // A tile can sit in the heap more than once; only its first exit counts.
      if (mark[tile] === 2) continue;
      mark[tile] = 2;
      used++;
      if (tile === this.goal) {
        this.found = true;
        this.done = true;
        break;
      }
      const tx = tile % width;
      const ty = idiv(tile, width);
      const base = cost[tile]!;
      for (let dir = 0; dir < 8; dir++) {
        if (!map.canStep(tx, ty, dir)) continue;
        const nx = tx + DIR_X[dir]!;
        const ny = ty + DIR_Y[dir]!;
        const next = ny * width + nx;
        if (mark[next] === 2) continue;
        const through = base + ((dir & 1) === 0 ? STEP_ORTHOGONAL : STEP_DIAGONAL);
        if (mark[next] === 1 && through >= cost[next]!) continue;
        cost[next] = through;
        parent[next] = tile;
        mark[next] = 1;
        const remaining = this.estimate(nx, ny);
        heap.push((through + remaining) * KEY_SHIFT + remaining, next);
      }
    }
    this.expansions += used;
    return used;
  }

  /** The tiles from start to goal, inclusive. Only valid once found. */
  path(): number[] {
    const tiles: number[] = [];
    for (let tile = this.goal; tile !== -1; tile = this.scratch.parent[tile]!) tiles.push(tile);
    return tiles.reverse();
  }
}

export class FieldSearch implements Search {
  expansions = 0;
  done = false;
  /**
   * For each tile, the direction (0 to 7) of the next step toward the goal,
   * FIELD_GOAL on the goal itself, FIELD_UNKNOWN where the search did not
   * reach.
   */
  readonly directions: Uint8Array;
  private remainingTargets = 0;
  private furthestTarget = 0;
  private readonly coverAll: boolean;

  /**
   * @param targets  Tiles that must be covered, normally where the group's
   *   units stand. The search stops a little past the furthest one. With no
   *   targets it covers everything that can reach the goal.
   */
  constructor(
    private readonly map: GameMap,
    private readonly scratch: SearchScratch,
    readonly goal: number,
    targets: readonly number[],
  ) {
    this.directions = new Uint8Array(map.tileCount).fill(FIELD_UNKNOWN);
    scratch.mark.fill(0);
    scratch.isTarget.fill(0);
    scratch.heap.clear();
    for (const tile of targets) {
      if (scratch.isTarget[tile] === 0) {
        scratch.isTarget[tile] = 1;
        this.remainingTargets++;
      }
    }
    this.coverAll = this.remainingTargets === 0;
    scratch.cost[goal] = 0;
    scratch.mark[goal] = 1;
    this.directions[goal] = FIELD_GOAL;
    scratch.heap.push(goal, goal);
  }

  run(budget: number): number {
    const { map, directions } = this;
    const { cost, mark, isTarget, heap } = this.scratch;
    const width = map.width;
    let used = 0;
    while (!this.done && used < budget) {
      if (heap.size === 0) {
        this.done = true;
        break;
      }
      const tile = heap.pop();
      if (mark[tile] === 2) continue;
      const base = cost[tile]!;
      if (!this.coverAll && this.remainingTargets === 0 && base > this.furthestTarget + FIELD_MARGIN) {
        this.done = true;
        break;
      }
      mark[tile] = 2;
      used++;
      if (isTarget[tile] === 1) {
        this.remainingTargets--;
        if (base > this.furthestTarget) this.furthestTarget = base;
      }
      const tx = tile % width;
      const ty = idiv(tile, width);
      for (let dir = 0; dir < 8; dir++) {
        // Steps are reversible, so a unit on the neighbour can step here.
        if (!map.canStep(tx, ty, dir)) continue;
        const next = (ty + DIR_Y[dir]!) * width + tx + DIR_X[dir]!;
        if (mark[next] === 2) continue;
        const through = base + ((dir & 1) === 0 ? STEP_ORTHOGONAL : STEP_DIAGONAL);
        if (mark[next] === 1 && through >= cost[next]!) continue;
        cost[next] = through;
        mark[next] = 1;
        directions[next] = (dir + 4) & 7;
        heap.push(through * KEY_SHIFT + next, next);
      }
    }
    this.expansions += used;
    return used;
  }
}
