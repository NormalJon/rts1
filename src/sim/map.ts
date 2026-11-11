/**
 * The terrain a match is played on: a square grid of tiles with a height at
 * every tile corner.
 *
 * Positions are in tiles, so the tile containing a fixed-point position is its
 * whole part. A tile is either passable or not; everything about movement
 * (pathfinding, line of sight, collision with terrain) reads that one fact.
 *
 * The map changes during a match: trees are felled, deposits are worked out,
 * buildings go up. Every change goes through the methods here, which keep
 * passability, the connected regions and the state fingerprint in step.
 */

import { HALF, idiv, length, mulDiv, ONE, type Fixed } from './fixed';

export const Terrain = {
  Grass: 0,
  /** Trees block movement and are the wood supply. One tree to a tile. */
  Forest: 1,
  /** A ford: water shallow enough to wade. */
  Shallows: 2,
  Water: 3,
  /** Bare outcrop. Blocks movement and yields nothing. */
  Rock: 4,
  /** Berry bushes: the first food. */
  Berries: 5,
  /** Quarryable stone. */
  Stone: 6,
  /** Gold ore. */
  Gold: 7,
} as const;

const PASSABLE_BY_TERRAIN = [1, 0, 1, 0, 0, 0, 0, 0];
/** How much a tile of each terrain holds before anyone has gathered from it. */
const STARTING_AMOUNT = [0, 100, 0, 0, 0, 250, 500, 700];

export interface StartPosition {
  readonly x: Fixed;
  readonly y: Fixed;
}

/** Neighbour offsets, indexed by direction 0 to 7: E, SE, S, SW, W, NW, N, NE. */
export const DIR_X = [1, 1, 0, -1, -1, -1, 0, 1];
export const DIR_Y = [0, 1, 1, 1, 0, -1, -1, -1];
/** Cost of an orthogonal and a diagonal step, in the ratio 1 : 1.4143. */
export const STEP_ORTHOGONAL = 70;
export const STEP_DIAGONAL = 99;

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly tileCount: number;
  /** What is on each tile. Changes as resources are used up. */
  readonly terrain: Uint8Array;
  /** How much of its resource each tile still holds. */
  readonly amount: Int32Array;
  /** 1 where a building stands. */
  readonly blocked: Uint8Array;
  /** Height at each tile corner, (width + 1) by (height + 1), in tiles. */
  readonly elevation: Int32Array;
  readonly passable: Uint8Array;
  /**
   * Which connected area each passable tile belongs to (1 and up; 0 for
   * impassable tiles). Two tiles can be walked between exactly when their
   * regions match.
   */
  readonly region: Int32Array;
  readonly starts: readonly StartPosition[];
  /** Fingerprint of everything about the map that never changes. */
  readonly checksum: number;
  /** Fingerprint of everything that does: terrain, amounts and buildings. Kept up to date change by change. */
  stateHash = 0;
  /** Goes up whenever a tile opens or closes, so anything planned on the old layout can tell. */
  passVersion = 0;
  private regionCount = 0;
  /** The largest valid coordinate on each axis. */
  readonly maxX: Fixed;
  readonly maxY: Fixed;

  constructor(
    width: number,
    height: number,
    terrain: Uint8Array,
    elevation: Int32Array,
    starts: readonly StartPosition[],
  ) {
    if (terrain.length !== width * height) throw new Error('terrain size does not match the map');
    if (elevation.length !== (width + 1) * (height + 1)) {
      throw new Error('elevation size does not match the map');
    }
    this.width = width;
    this.height = height;
    this.tileCount = width * height;
    this.terrain = terrain;
    this.elevation = elevation;
    this.starts = starts;
    this.maxX = width * ONE - 1;
    this.maxY = height * ONE - 1;
    this.amount = new Int32Array(this.tileCount);
    this.blocked = new Uint8Array(this.tileCount);
    this.passable = new Uint8Array(this.tileCount);
    this.region = new Int32Array(this.tileCount);
    for (let i = 0; i < this.tileCount; i++) this.amount[i] = STARTING_AMOUNT[terrain[i]!] ?? 0;
    this.rebuild();
    this.checksum = this.computeChecksum();
  }

  // ---- Changes ---------------------------------------------------------------

  /** Recomputes everything derived from terrain, amounts and buildings. */
  private rebuild(): void {
    let hash = 0;
    for (let i = 0; i < this.tileCount; i++) {
      this.passable[i] = this.blocked[i] === 0 ? (PASSABLE_BY_TERRAIN[this.terrain[i]!] ?? 0) : 0;
      hash = (hash + this.tileHash(i)) | 0;
    }
    this.stateHash = hash;
    this.passVersion++;
    this.labelRegions();
  }

  private tileHash(tile: number): number {
    let h =
      Math.imul(tile + 1, 0x9e3779b1) ^
      Math.imul(this.terrain[tile]! + 1, 0x85ebca6b) ^
      Math.imul(this.amount[tile]! + 1, 0xc2b2ae35) ^
      Math.imul(this.blocked[tile]! + 1, 0x27d4eb2f);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    return h ^ (h >>> 13);
  }

  /**
   * Takes one unit of resource from a tile. When the last is taken the tile
   * becomes open grass. Returns whether that happened.
   */
  harvest(tile: number): boolean {
    if (this.amount[tile]! <= 0) return false;
    this.stateHash = (this.stateHash - this.tileHash(tile)) | 0;
    this.amount[tile] = this.amount[tile]! - 1;
    const exhausted = this.amount[tile] === 0;
    if (exhausted) this.terrain[tile] = Terrain.Grass;
    this.stateHash = (this.stateHash + this.tileHash(tile)) | 0;
    if (exhausted) this.open(tile);
    return exhausted;
  }

  /** Marks a square of tiles as built on, or clears it again. */
  setBuilding(left: number, top: number, size: number, present: boolean): void {
    const want = present ? 1 : 0;
    for (let ty = top; ty < top + size; ty++) {
      for (let tx = left; tx < left + size; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        const tile = ty * this.width + tx;
        if (this.blocked[tile] === want) continue;
        this.stateHash = (this.stateHash - this.tileHash(tile)) | 0;
        this.blocked[tile] = want;
        this.passable[tile] = want === 0 ? (PASSABLE_BY_TERRAIN[this.terrain[tile]!] ?? 0) : 0;
        this.stateHash = (this.stateHash + this.tileHash(tile)) | 0;
      }
    }
    // A building can cut one area in two, or its removal join two up, so the regions are worked out afresh.
    this.passVersion++;
    this.labelRegions();
  }

  /** Replaces the changeable state wholesale, as when loading a saved game. */
  restoreState(terrain: ArrayLike<number>, amount: ArrayLike<number>): void {
    if (terrain.length !== this.tileCount || amount.length !== this.tileCount) {
      throw new Error('saved terrain does not match the map');
    }
    this.terrain.set(terrain);
    this.amount.set(amount);
    this.rebuild();
  }

  /** A tile has just become passable: fit it into the regions around it. */
  private open(tile: number): void {
    if (this.passable[tile] === 1 || this.blocked[tile] === 1) return;
    this.passable[tile] = 1;
    this.passVersion++;
    const tx = tile % this.width;
    const ty = idiv(tile, this.width);
    let joined = 0;
    for (let dir = 0; dir < 8; dir++) {
      if (!this.canStep(tx, ty, dir)) continue;
      const other = this.region[(ty + DIR_Y[dir]!) * this.width + tx + DIR_X[dir]!]!;
      if (joined === 0) joined = other;
      else if (other !== joined) {
        // It bridges two areas that were separate. Start again from scratch.
        this.labelRegions();
        return;
      }
    }
    this.region[tile] = joined !== 0 ? joined : ++this.regionCount;
  }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  /** The tile containing a position, clamped onto the map. */
  tileAt(x: Fixed, y: Fixed): number {
    let tx = x >> 16;
    let ty = y >> 16;
    if (tx < 0) tx = 0;
    else if (tx >= this.width) tx = this.width - 1;
    if (ty < 0) ty = 0;
    else if (ty >= this.height) ty = this.height - 1;
    return ty * this.width + tx;
  }

  /** How high the ground is at a tile: the average of its four corners. */
  heightOf(tile: number): Fixed {
    // Corners are stored in rows one longer than the rows of tiles.
    const corner = tile + idiv(tile, this.width);
    const below = corner + this.width + 1;
    const e = this.elevation;
    return (e[corner]! + e[corner + 1]! + e[below]! + e[below + 1]!) >> 2;
  }

  isPassable(tx: number, ty: number): boolean {
    return (
      tx >= 0 && ty >= 0 && tx < this.width && ty < this.height && this.passable[ty * this.width + tx] === 1
    );
  }

  /**
   * Whether a unit can step from a tile to its neighbour in a direction.
   * Diagonal steps need both adjoining tiles open, so nothing squeezes between
   * two obstacles that touch at a corner.
   */
  canStep(tx: number, ty: number, dir: number): boolean {
    const dx = DIR_X[dir]!;
    const dy = DIR_Y[dir]!;
    if (!this.isPassable(tx + dx, ty + dy)) return false;
    if (dx !== 0 && dy !== 0) {
      return this.isPassable(tx + dx, ty) && this.isPassable(tx, ty + dy);
    }
    return true;
  }

  /**
   * Whether the straight line between two positions crosses only passable
   * tiles. A line through the exact corner where four tiles meet also needs
   * both tiles beside the corner to be open.
   */
  lineOfSight(x0: Fixed, y0: Fixed, x1: Fixed, y1: Fixed): boolean {
    let tx = x0 >> 16;
    let ty = y0 >> 16;
    const endX = x1 >> 16;
    const endY = y1 >> 16;
    if (!this.isPassable(tx, ty) || !this.isPassable(endX, endY)) return false;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const absX = dx < 0 ? -dx : dx;
    const absY = dy < 0 ? -dy : dy;
    // Distance along each axis to the next tile boundary.
    let toX = dx > 0 ? ((tx + 1) << 16) - x0 : x0 - (tx << 16);
    let toY = dy > 0 ? ((ty + 1) << 16) - y0 : y0 - (ty << 16);
    for (let guard = this.width + this.height + 4; guard > 0; guard--) {
      if (tx === endX && ty === endY) return true;
      // The x boundary comes first when toX / absX < toY / absY; compared by
      // cross-multiplying, which stays exact.
      let moveX: boolean;
      if (tx === endX) moveX = false;
      else if (ty === endY) moveX = true;
      else {
        const a = toX * absY;
        const b = toY * absX;
        if (a === b) {
          if (!this.isPassable(tx + stepX, ty) || !this.isPassable(tx, ty + stepY)) return false;
          tx += stepX;
          ty += stepY;
          toX += ONE;
          toY += ONE;
          if (!this.isPassable(tx, ty)) return false;
          continue;
        }
        moveX = a < b;
      }
      if (moveX) {
        tx += stepX;
        toX += ONE;
      } else {
        ty += stepY;
        toY += ONE;
      }
      if (!this.isPassable(tx, ty)) return false;
    }
    return false;
  }

  /**
   * Whether a unit of the given radius can walk straight from one position to
   * another. Checks the line its centre follows and the lines its two sides
   * follow, so it is not sent scraping round a corner.
   */
  clearPath(x0: Fixed, y0: Fixed, x1: Fixed, y1: Fixed, radius: Fixed): boolean {
    if (!this.lineOfSight(x0, y0, x1, y1)) return false;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const distance = length(dx, dy);
    if (distance === 0) return true;
    // Slightly inside the unit's edge, so standing against a wall does not count as blocked.
    const reach = radius - (radius >> 3);
    const ox = mulDiv(-dy, reach, distance);
    const oy = mulDiv(dx, reach, distance);
    return (
      this.lineOfSight(x0 + ox, y0 + oy, x1 + ox, y1 + oy) &&
      this.lineOfSight(x0 - ox, y0 - oy, x1 - ox, y1 - oy)
    );
  }

  centreX(tile: number): Fixed {
    return (tile % this.width) * ONE + HALF;
  }

  centreY(tile: number): Fixed {
    return idiv(tile, this.width) * ONE + HALF;
  }

  /**
   * The tile closest to (tx, ty) that is passable and, if a region is given,
   * in that region. Returns -1 if none lies within maxRadius tiles.
   */
  nearestPassable(tx: number, ty: number, region = 0, maxRadius = 64): number {
    return this.nearestTile(
      tx,
      ty,
      maxRadius,
      (tile) => this.passable[tile] === 1 && (region === 0 || this.region[tile] === region),
    );
  }

  /**
   * The nearest tile of a terrain that still holds something and can be
   * worked: it has a neighbouring tile to stand on, in the given region.
   */
  nearestResource(tx: number, ty: number, terrain: number, region: number, maxRadius: number): number {
    return this.nearestTile(
      tx,
      ty,
      maxRadius,
      (tile) => this.terrain[tile] === terrain && this.amount[tile]! > 0 && this.canBeWorkedFrom(tile, region),
    );
  }

  /** Whether any of a tile's eight neighbours is open ground in the region. */
  canBeWorkedFrom(tile: number, region: number): boolean {
    const tx = tile % this.width;
    const ty = idiv(tile, this.width);
    for (let dir = 0; dir < 8; dir++) {
      const nx = tx + DIR_X[dir]!;
      const ny = ty + DIR_Y[dir]!;
      if (this.isPassable(nx, ny) && this.region[ny * this.width + nx] === region) return true;
    }
    return false;
  }

  /** The tile closest to (tx, ty) that passes a test, or -1 if none lies within maxRadius tiles. */
  nearestTile(tx: number, ty: number, maxRadius: number, wanted: (tile: number) => boolean): number {
    let best = -1;
    let bestDistSq = 0;
    let stopAt = maxRadius;
    let found = false;
    for (let r = 0; r <= stopAt; r++) {
      const x0 = tx - r;
      const x1 = tx + r;
      const y0 = ty - r;
      const y1 = ty + r;
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= this.height) continue;
        // Only the ring: full rows at top and bottom, the two ends otherwise.
        const stride = y === y0 || y === y1 || r === 0 ? 1 : 2 * r;
        for (let x = x0; x <= x1; x += stride) {
          if (x < 0 || x >= this.width) continue;
          const i = y * this.width + x;
          if (!wanted(i)) continue;
          const distSq = (x - tx) * (x - tx) + (y - ty) * (y - ty);
          if (best === -1 || distSq < bestDistSq) {
            best = i;
            bestDistSq = distSq;
          }
        }
      }
      // A ring at radius r can hold tiles up to r * 1.42 away, so a closer one
      // may still turn up a few rings further out.
      if (best !== -1 && !found) {
        found = true;
        stopAt = Math.min(maxRadius, r + (r >> 1) + 1);
      }
    }
    return best;
  }

  private labelRegions(): void {
    this.region.fill(0);
    const stack: number[] = [];
    let next = 0;
    for (let seed = 0; seed < this.tileCount; seed++) {
      if (this.passable[seed] === 0 || this.region[seed] !== 0) continue;
      next++;
      this.region[seed] = next;
      stack.push(seed);
      while (stack.length > 0) {
        const tile = stack.pop()!;
        const tx = tile % this.width;
        const ty = idiv(tile, this.width);
        for (let dir = 0; dir < 8; dir++) {
          if (!this.canStep(tx, ty, dir)) continue;
          const other = (ty + DIR_Y[dir]!) * this.width + tx + DIR_X[dir]!;
          if (this.region[other] !== 0) continue;
          this.region[other] = next;
          stack.push(other);
        }
      }
    }
    this.regionCount = next;
  }

  private computeChecksum(): number {
    let h = 0x1f3d5b79 ^ Math.imul(this.width, 0x9e3779b1) ^ Math.imul(this.height, 0x85ebca6b);
    const mix = (value: number): void => {
      h = Math.imul(h ^ value, 0x01000193);
      h = (h << 13) | (h >>> 19);
    };
    for (let i = 0; i < this.elevation.length; i++) mix(this.elevation[i]!);
    for (const start of this.starts) {
      mix(start.x);
      mix(start.y);
    }
    return h >>> 0;
  }
}
