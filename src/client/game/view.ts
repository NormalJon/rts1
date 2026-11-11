/**
 * Draws the match in 3D and answers questions about what is where on screen.
 *
 * This is display code. It reads the world and never changes it. The
 * simulation works in tiles; the scene works in metres, two to a tile, so
 * models made at real scale need no adjusting.
 */

import * as THREE from 'three';
import { ENTITY_TYPES, resourceOfTerrain } from '../../sim/entityTypes';
import { toFloat } from '../../sim/fixed';
import { Terrain } from '../../sim/map';
import { Job, type EntityId, type World } from '../../sim/world';
import { BAKE_FPS, type BakedClip, type Models, type StaticModel, type UnitModel } from './models';

/** Metres per tile. */
export const TILE = 2;
const WATER_LEVEL = -0.16;
const PITCH = 0.96; // radians above the horizon: a little under 55 degrees
const MIN_DISTANCE = 22;
const MAX_DISTANCE = 190;
const MARKER_SECONDS = 0.8;

/** Player colours, named for the heraldic tinctures: azure, gules, or, vert. */
export const TEAM_COLOURS = ['#2c5aa8', '#b3312c', '#d6a21e', '#2f7d46', '#7a4aa0', '#d07a2a', '#3aa6a0', '#8a8f98'];

/** The ground under each kind of terrain. */
const TERRAIN_COLOURS: Record<number, string> = {
  [Terrain.Grass]: '#7f9b58',
  [Terrain.Forest]: '#566f43',
  [Terrain.Shallows]: '#c4bb8f',
  [Terrain.Water]: '#3f5557',
  [Terrain.Rock]: '#8d8b85',
  [Terrain.Berries]: '#6f8c50',
  [Terrain.Stone]: '#8f8a78',
  [Terrain.Gold]: '#8d8263',
};

/** How tall the thing standing on each kind of resource tile is, in metres, for clicking on it. */
const PROP_HEIGHT: Record<number, number> = {
  [Terrain.Forest]: 6,
  [Terrain.Berries]: 1.2,
  [Terrain.Stone]: 1.5,
  [Terrain.Gold]: 1.5,
};
const BUILDING_HEIGHT = 6.5;

const MARKER_COLOURS = { move: '#bfe38a', queue: '#e9c46a', work: '#f0d9a0' } as const;

/** What a point on the screen is over. */
export type Pick =
  | { readonly kind: 'tile'; readonly tile: number }
  | { readonly kind: 'building'; readonly id: EntityId }
  | { readonly kind: 'ground'; readonly x: number; readonly y: number };

interface UnitBatch {
  readonly model: UnitModel;
  readonly type: number;
  readonly meshes: THREE.InstancedMesh[];
  capacity: number;
  count: number;
}

interface Marker {
  readonly mesh: THREE.Mesh;
  born: number;
}

interface Placement {
  readonly tile: number;
  readonly x: number;
  readonly y: number;
  readonly turn: number;
  readonly size: number;
  readonly tint: number;
}

function tileNoise(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 0xffffffff;
}

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 2, 2500);

  /** What the camera looks at, in tiles, and how far back it sits, in metres. */
  targetX: number;
  targetY: number;
  distance = 62;

  /** Called when a tile changes, so other displays (the minimap) can follow. */
  onTileChanged: ((tile: number) => void) | null = null;

  private readonly world: World;
  private readonly models: Models;
  private readonly heights: Float32Array;
  private readonly batches: UnitBatch[] = [];
  private readonly rings: THREE.InstancedMesh;
  private readonly shadows: THREE.InstancedMesh;
  private readonly markers: Marker[] = [];
  private readonly raycaster = new THREE.Raycaster();

  // The ground's colours, kept so single tiles can be repainted.
  private readonly tileColour: Float32Array;
  private readonly cornerColour: Float32Array;
  private groundColours!: THREE.BufferAttribute;
  /** The terrain as last drawn, to spot what has changed since. */
  private readonly seenTerrain: Uint8Array;
  /** The tree, bush or outcrop standing on each resource tile. */
  private readonly propOfTile = new Map<number, { readonly meshes: THREE.InstancedMesh[]; readonly index: number }>();
  private readonly buildings = new Map<number, { readonly id: EntityId; readonly group: THREE.Group }>();

  // Per-unit display state, by slot.
  private readonly prevX: Float32Array;
  private readonly prevY: Float32Array;
  private readonly yaw: Float32Array;
  private readonly animTime: Float32Array;
  private readonly clipOf: Uint8Array;
  private seconds = 0;

  constructor(canvas: HTMLCanvasElement, world: World, models: Models) {
    this.world = world;
    this.models = models;
    const { map } = world;
    this.targetX = map.width / 2;
    this.targetY = map.height / 2;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = new THREE.Color('#141a17');

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x59604f, 0.78));
    const sun = new THREE.DirectionalLight(0xfff1dc, 0.85);
    sun.position.set(-0.55, 1, 0.4);
    this.scene.add(sun);

    this.heights = new Float32Array(map.elevation.length);
    for (let i = 0; i < this.heights.length; i++) this.heights[i] = toFloat(map.elevation[i]!) * TILE;

    this.tileColour = new Float32Array(map.tileCount * 3);
    this.cornerColour = new Float32Array((map.width + 1) * (map.height + 1) * 3);
    this.seenTerrain = Uint8Array.from(map.terrain);
    this.buildTerrain();
    this.buildProps();

    const n = world.config.maxEntities;
    this.prevX = new Float32Array(n);
    this.prevY = new Float32Array(n);
    this.yaw = new Float32Array(n);
    this.animTime = new Float32Array(n);
    this.clipOf = new Uint8Array(n);

    const shadowGeometry = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(
      shadowGeometry,
      new THREE.MeshBasicMaterial({ color: 0x0b100d, transparent: true, opacity: 0.26, depthWrite: false }),
      n,
    );
    const ringGeometry = new THREE.RingGeometry(0.87, 1, 28).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: 0xf4f1e4, transparent: true, opacity: 0.95, depthWrite: false }),
      n,
    );
    for (const mesh of [this.shadows, this.rings]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      this.scene.add(mesh);
    }
    this.shadows.renderOrder = 1;
    this.rings.renderOrder = 2;

    models.units.forEach((model, type) => {
      if (model === undefined) return;
      const batch: UnitBatch = { model, type, meshes: [], capacity: 0, count: 0 };
      this.batches.push(batch);
      this.growBatch(batch, 256);
    });

    this.rememberPositions();
    for (let slot = 0; slot < world.highWater; slot++) {
      this.yaw[slot] = Math.atan2(toFloat(world.dirX[slot]!), toFloat(world.dirY[slot]!));
    }
  }

  // ---- Terrain ---------------------------------------------------------------

  /** Ground height in metres at a position in tiles. Matches the drawn triangles exactly. */
  heightAt(x: number, y: number): number {
    const { width, height } = this.world.map;
    const cx = Math.min(width - 1e-6, Math.max(0, x));
    const cy = Math.min(height - 1e-6, Math.max(0, y));
    const tx = Math.floor(cx);
    const ty = Math.floor(cy);
    const fx = cx - tx;
    const fy = cy - ty;
    const row = width + 1;
    const h00 = this.heights[ty * row + tx]!;
    const h10 = this.heights[ty * row + tx + 1]!;
    const h01 = this.heights[(ty + 1) * row + tx]!;
    const h11 = this.heights[(ty + 1) * row + tx + 1]!;
    // Each tile is two triangles split along the diagonal from its first corner.
    return fx > fy ? h00 + (h10 - h00) * fx + (h11 - h10) * fy : h00 + (h11 - h01) * fx + (h01 - h00) * fy;
  }

  /** Works out one tile's own colour from its terrain, with a little variation. */
  private paintTile(tx: number, ty: number): void {
    const { map } = this.world;
    const id = map.terrain[ty * map.width + tx]!;
    const colour = new THREE.Color(TERRAIN_COLOURS[id] ?? '#ff00ff').convertSRGBToLinear();
    const shade = 0.9 + tileNoise(tx, ty) * 0.2;
    this.tileColour.set([colour.r * shade, colour.g * shade, colour.b * shade], (ty * map.width + tx) * 3);
  }

  /**
   * Blends the colours of the tiles meeting at a corner, so terrain types fade
   * into each other instead of meeting along the grid. Rock keeps a hard edge
   * and takes no part.
   */
  private blendCorner(cx: number, cy: number): void {
    const { map } = this.world;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let oy = -1; oy <= 0; oy++) {
      for (let ox = -1; ox <= 0; ox++) {
        const tx = cx + ox;
        const ty = cy + oy;
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        if (map.terrain[ty * map.width + tx] === Terrain.Rock) continue;
        const at = (ty * map.width + tx) * 3;
        r += this.tileColour[at]!;
        g += this.tileColour[at + 1]!;
        b += this.tileColour[at + 2]!;
        n++;
      }
    }
    if (n > 0) this.cornerColour.set([r / n, g / n, b / n], (cy * (map.width + 1) + cx) * 3);
  }

  /** The corners of a tile's two triangles, in the order they are stored. */
  private static readonly TRIANGLE_CORNERS = [
    [0, 0],
    [0, 1],
    [1, 1],
    [0, 0],
    [1, 1],
    [1, 0],
  ] as const;

  /** Writes a tile's six vertex colours: its own flat colour for rock, blended corners otherwise. */
  private colourTile(tx: number, ty: number, colours: Float32Array): void {
    const { map } = this.world;
    const tile = ty * map.width + tx;
    const rock = map.terrain[tile] === Terrain.Rock;
    GameView.TRIANGLE_CORNERS.forEach(([ox, oy], k) => {
      const from = rock ? tile * 3 : ((ty + oy) * (map.width + 1) + tx + ox) * 3;
      const source = rock ? this.tileColour : this.cornerColour;
      colours.set([source[from]!, source[from + 1]!, source[from + 2]!], (tile * 6 + k) * 3);
    });
  }

  private buildTerrain(): void {
    const { map } = this.world;
    const { width, height } = map;
    for (let ty = 0; ty < height; ty++) for (let tx = 0; tx < width; tx++) this.paintTile(tx, ty);
    for (let cy = 0; cy <= height; cy++) for (let cx = 0; cx <= width; cx++) this.blendCorner(cx, cy);

    const positions = new Float32Array(map.tileCount * 18);
    const colours = new Float32Array(map.tileCount * 18);
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        GameView.TRIANGLE_CORNERS.forEach(([ox, oy], k) => {
          const at = ((ty * width + tx) * 6 + k) * 3;
          positions[at] = (tx + ox) * TILE;
          positions[at + 1] = this.heights[(ty + oy) * (width + 1) + tx + ox]!;
          positions[at + 2] = (ty + oy) * TILE;
        });
        this.colourTile(tx, ty, colours);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.groundColours = new THREE.BufferAttribute(colours, 3);
    geometry.setAttribute('color', this.groundColours);
    geometry.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true })));

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(width * TILE, height * TILE).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: new THREE.Color('#2a6788'), transparent: true, opacity: 0.8 }),
    );
    water.position.set((width * TILE) / 2, WATER_LEVEL, (height * TILE) / 2);
    this.scene.add(water);

    // A dark table under the map, so its edges do not hang in space.
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(width * TILE * 3, height * TILE * 3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#141a17') }),
    );
    table.position.set((width * TILE) / 2, -1.2, (height * TILE) / 2);
    this.scene.add(table);
  }

  /** Repaints the ground on and around a tile whose terrain has changed. */
  private repaintAround(tile: number): void {
    const { map } = this.world;
    const tx = tile % map.width;
    const ty = Math.floor(tile / map.width);
    this.paintTile(tx, ty);
    for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) this.blendCorner(tx + ox, ty + oy);
    const colours = this.groundColours.array as Float32Array;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = tx + ox;
        const ny = ty + oy;
        if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height) this.colourTile(nx, ny, colours);
      }
    }
    this.groundColours.needsUpdate = true;
  }

  // ---- Trees, bushes and deposits ---------------------------------------------

  /** Stands one copy of a model on each of the given tiles. */
  private addProps(model: StaticModel, placements: readonly Placement[]): void {
    if (placements.length === 0) return;
    const place = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const colour = new THREE.Color();
    const meshes = model.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
      placements.forEach((p, i) => {
        turn.setFromAxisAngle(up, p.turn);
        place.compose(
          new THREE.Vector3(p.x * TILE, this.heightAt(p.x, p.y) - 0.05, p.y * TILE),
          turn,
          new THREE.Vector3(p.size, p.size, p.size),
        );
        mesh.setMatrixAt(i, place.multiply(part.matrix));
        mesh.setColorAt(i, colour.setScalar(p.tint));
      });
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    });
    placements.forEach((p, index) => this.propOfTile.set(p.tile, { meshes, index }));
  }

  private buildProps(): void {
    const { map } = this.world;
    const lists: Record<string, Placement[]> = { oak: [], conifer: [], berries: [], stone: [], gold: [] };
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const tile = ty * map.width + tx;
        const a = tileNoise(tx * 3 + 1, ty * 3 + 2);
        const b = tileNoise(tx * 5 + 7, ty * 5 + 3);
        const c = tileNoise(tx * 7 + 5, ty * 7 + 11);
        switch (map.terrain[tile]) {
          case Terrain.Forest: {
            // One tree to a tile. Oaks spread wide, so they are few among the firs.
            const isOak = a < 0.14;
            (isOak ? lists.oak! : lists.conifer!).push({
              tile,
              x: tx + 0.3 + b * 0.4,
              y: ty + 0.3 + c * 0.4,
              turn: b * Math.PI * 2,
              size: (isOak ? 0.6 : 0.72) + c * 0.38,
              tint: 0.82 + a * 0.3,
            });
            break;
          }
          case Terrain.Berries:
            lists.berries!.push({ tile, x: tx + 0.5, y: ty + 0.5, turn: a * Math.PI * 2, size: 0.92 + b * 0.2, tint: 0.92 + c * 0.16 });
            break;
          case Terrain.Stone:
          case Terrain.Gold:
            (map.terrain[tile] === Terrain.Stone ? lists.stone! : lists.gold!).push({
              tile,
              x: tx + 0.5,
              y: ty + 0.5,
              turn: Math.floor(a * 4) * (Math.PI / 2),
              size: 0.9 + b * 0.18,
              tint: 0.94 + c * 0.12,
            });
            break;
        }
      }
    }
    this.addProps(this.models.oak, lists.oak!);
    this.addProps(this.models.conifer, lists.conifer!);
    this.addProps(this.models.berries, lists.berries!);
    this.addProps(this.models.stone, lists.stone!);
    this.addProps(this.models.gold, lists.gold!);
  }

  /** Brings the scene up to date with tiles that have changed: felled trees, worked-out deposits. */
  private syncTerrain(): void {
    const { terrain, tileCount } = this.world.map;
    const seen = this.seenTerrain;
    const nothing = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let tile = 0; tile < tileCount; tile++) {
      if (terrain[tile] === seen[tile]) continue;
      seen[tile] = terrain[tile]!;
      const prop = this.propOfTile.get(tile);
      if (prop !== undefined) {
        for (const mesh of prop.meshes) {
          mesh.setMatrixAt(prop.index, nothing);
          mesh.instanceMatrix.needsUpdate = true;
        }
        this.propOfTile.delete(tile);
      }
      this.repaintAround(tile);
      this.onTileChanged?.(tile);
    }
  }

  // ---- Buildings -------------------------------------------------------------

  private syncBuildings(): void {
    const { world } = this;
    for (const [slot, shown] of this.buildings) {
      if (world.isAlive(shown.id)) continue;
      this.scene.remove(shown.group);
      this.buildings.delete(slot);
    }
    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 0 || world.mobile[slot] === 1 || this.buildings.has(slot)) continue;
      const model = this.models.buildings[world.entityType[slot]!];
      if (model === undefined) continue;
      const team = this.teamLinear[world.owner[slot]! % this.teamLinear.length]!;
      const group = new THREE.Group();
      for (const part of model.parts) {
        let material = part.material;
        if (part.team) {
          material = part.material.clone();
          (material as THREE.MeshStandardMaterial).color.copy(team);
        }
        const mesh = new THREE.Mesh(part.geometry, material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(part.matrix);
        group.add(mesh);
      }
      const x = toFloat(world.posX[slot]!);
      const y = toFloat(world.posY[slot]!);
      group.position.set(x * TILE, this.heightAt(x, y), y * TILE);
      this.scene.add(group);
      this.buildings.set(slot, { id: world.idAt(slot), group });
    }
  }

  /** The building standing on a tile, if any. */
  private buildingOn(tile: number): EntityId | null {
    const { world } = this;
    const tx = tile % world.map.width;
    const ty = Math.floor(tile / world.map.width);
    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 0 || world.mobile[slot] === 1) continue;
      const half = ENTITY_TYPES[world.entityType[slot]!]!.footprint >> 1;
      const cx = world.posX[slot]! >> 16;
      const cy = world.posY[slot]! >> 16;
      if (Math.abs(tx - cx) <= half && Math.abs(ty - cy) <= half) return world.idAt(slot);
    }
    return null;
  }

  // ---- Units -----------------------------------------------------------------

  private growBatch(batch: UnitBatch, capacity: number): void {
    for (const mesh of batch.meshes) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    batch.meshes.length = 0;
    batch.capacity = capacity;
    for (const part of batch.model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (part.team) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 3;
      batch.meshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  /** Call just before each simulation tick, so drawing can blend from here to the new positions. */
  rememberPositions(): void {
    const { world } = this;
    for (let slot = 0; slot < world.highWater; slot++) {
      this.prevX[slot] = toFloat(world.posX[slot]!);
      this.prevY[slot] = toFloat(world.posY[slot]!);
    }
  }

  /** Where a unit is drawn this frame, in tiles: part-way from its last position to its current one. */
  unitPosition(slot: number, alpha: number): { x: number; y: number } {
    const x = toFloat(this.world.posX[slot]!);
    const y = toFloat(this.world.posY[slot]!);
    return { x: this.prevX[slot]! + (x - this.prevX[slot]!) * alpha, y: this.prevY[slot]! + (y - this.prevY[slot]!) * alpha };
  }

  private readonly teamLinear = TEAM_COLOURS.map((hex) => new THREE.Color(hex).convertSRGBToLinear());

  private drawUnits(alpha: number, dt: number, selected: ReadonlySet<number>): void {
    const { world } = this;
    const tickSeconds = 1 / world.config.tickRate;
    const batchOfType: (UnitBatch | undefined)[] = [];
    for (const batch of this.batches) {
      batchOfType[batch.type] = batch;
      batch.count = 0;
      let living = 0;
      for (let slot = 0; slot < world.highWater; slot++) {
        if (world.alive[slot] === 1 && world.entityType[slot] === batch.type) living++;
      }
      if (living > batch.capacity) this.growBatch(batch, Math.max(living, batch.capacity * 2));
    }

    const shadowArray = this.shadows.instanceMatrix.array as Float32Array;
    const ringArray = this.rings.instanceMatrix.array as Float32Array;
    let shadowCount = 0;
    let ringCount = 0;

    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 0) continue;
      const batch = batchOfType[world.entityType[slot]!];
      if (batch === undefined) continue;
      const curX = toFloat(world.posX[slot]!);
      const curY = toFloat(world.posY[slot]!);
      const x = this.prevX[slot]! + (curX - this.prevX[slot]!) * alpha;
      const y = this.prevY[slot]! + (curY - this.prevY[slot]!) * alpha;
      const ground = this.heightAt(x, y);
      const radius = toFloat(world.radius[slot]!) * TILE;

      // Turn smoothly toward the simulation's facing.
      const facing = Math.atan2(toFloat(world.dirX[slot]!), toFloat(world.dirY[slot]!));
      let turn = facing - this.yaw[slot]!;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const maxTurn = 11 * dt;
      this.yaw[slot] = this.yaw[slot]! + Math.max(-maxTurn, Math.min(maxTurn, turn));

      // Walk when covering ground, at a pace that matches it.
      const speed = Math.hypot(curX - this.prevX[slot]!, curY - this.prevY[slot]!) / tickSeconds;
      const nominal = toFloat(world.speed[slot]!) / tickSeconds;
      const walking = speed > nominal * 0.2;
      // Villagers swing their axe at whatever they are gathering, for now.
      const working = !walking && world.job[slot] === Job.Harvesting && batch.model.clips.has('chop');
      const clipName = walking ? 'walk' : working ? 'chop' : 'idle';
      const clipCode = walking ? 1 : working ? 2 : 0;
      if (clipCode !== this.clipOf[slot]) {
        this.clipOf[slot] = clipCode;
        this.animTime[slot] = (slot * 0.37) % 1;
      }
      this.animTime[slot] = this.animTime[slot]! + dt * (walking ? Math.max(0.5, speed / nominal) : 1);
      const clip = batch.model.clips.get(clipName)!;
      const frame = Math.floor(this.animTime[slot]! * BAKE_FPS) % clip.frames;

      const index = batch.count++;
      const cos = Math.cos(this.yaw[slot]!);
      const sin = Math.sin(this.yaw[slot]!);
      const px = x * TILE;
      const pz = y * TILE;
      this.placeParts(batch, clip, frame, index, cos, sin, px, ground, pz);
      const team = this.teamLinear[world.owner[slot]! % this.teamLinear.length]!;
      batch.meshes.forEach((mesh) => {
        if (mesh.instanceColor !== null) {
          const colours = mesh.instanceColor.array as Float32Array;
          colours[index * 3] = team.r;
          colours[index * 3 + 1] = team.g;
          colours[index * 3 + 2] = team.b;
        }
      });

      writeFlat(shadowArray, shadowCount++, px, ground + 0.04, pz, radius * 1.25);
      if (selected.has(world.idAt(slot))) writeFlat(ringArray, ringCount++, px, ground + 0.07, pz, radius * 1.45);
    }

    for (const batch of this.batches) {
      for (const mesh of batch.meshes) {
        mesh.count = batch.count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.shadows.count = shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.rings.count = ringCount;
    this.rings.instanceMatrix.needsUpdate = true;
  }

  /** Writes one soldier's parts: his place in the world times each part's place in the model. */
  private placeParts(
    batch: UnitBatch,
    clip: BakedClip,
    frame: number,
    index: number,
    cos: number,
    sin: number,
    x: number,
    y: number,
    z: number,
  ): void {
    const parts = batch.meshes.length;
    const pose = clip.matrices;
    for (let part = 0; part < parts; part++) {
      const out = batch.meshes[part]!.instanceMatrix.array as Float32Array;
      const o = index * 16;
      const p = (frame * parts + part) * 16;
      for (let column = 0; column < 4; column++) {
        const bx = pose[p + column * 4]!;
        const by = pose[p + column * 4 + 1]!;
        const bz = pose[p + column * 4 + 2]!;
        const bw = pose[p + column * 4 + 3]!;
        out[o + column * 4] = cos * bx + sin * bz + x * bw;
        out[o + column * 4 + 1] = by + y * bw;
        out[o + column * 4 + 2] = -sin * bx + cos * bz + z * bw;
        out[o + column * 4 + 3] = bw;
      }
    }
  }

  // ---- Camera ----------------------------------------------------------------

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const ratio = this.renderer.getPixelRatio();
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  private placeCamera(): void {
    const { map } = this.world;
    this.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, this.distance));
    this.targetX = Math.min(map.width, Math.max(0, this.targetX));
    this.targetY = Math.min(map.height, Math.max(0, this.targetY));
    const ground = this.heightAt(this.targetX, this.targetY);
    const x = this.targetX * TILE;
    const z = this.targetY * TILE;
    this.camera.position.set(x, ground + Math.sin(PITCH) * this.distance, z + Math.cos(PITCH) * this.distance);
    this.camera.lookAt(x, ground, z);
    this.camera.updateMatrixWorld();
  }

  lookAt(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /** Moves the view by a fraction of what is on screen, so panning feels the same at any zoom. */
  pan(right: number, down: number): void {
    const reach = this.distance * 0.5;
    this.targetX += (right * reach) / TILE;
    this.targetY += (down * reach) / TILE;
  }

  zoom(factor: number): void {
    this.distance *= factor;
  }

  private aim(clientX: number, clientY: number): THREE.Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  /** How far along a ray it meets the ground, or null if it never comes down. */
  private groundDistance(ray: THREE.Ray): number | null {
    const { origin, direction } = ray;
    if (direction.y >= -1e-4) return null;
    // Walk down the ray until it dips below the ground, then narrow it down.
    const above = (t: number): number =>
      origin.y + direction.y * t - this.heightAt((origin.x + direction.x * t) / TILE, (origin.z + direction.z * t) / TILE);
    let near = Math.max(0, (origin.y - 14) / -direction.y);
    const far = (origin.y + 3) / -direction.y;
    const stride = (far - near) / 40;
    let hit = far;
    for (let t = near; t <= far; t += stride) {
      if (above(t) <= 0) {
        hit = t;
        break;
      }
      near = t;
    }
    for (let i = 0; i < 12; i++) {
      const mid = (near + hit) / 2;
      if (above(mid) > 0) near = mid;
      else hit = mid;
    }
    return hit;
  }

  /** The point on the ground under a screen position, in tiles, or null if it misses the map. */
  screenToGround(clientX: number, clientY: number): { x: number; y: number } | null {
    const ray = this.aim(clientX, clientY);
    const hit = this.groundDistance(ray);
    if (hit === null) return null;
    const x = (ray.origin.x + ray.direction.x * hit) / TILE;
    const y = (ray.origin.z + ray.direction.z * hit) / TILE;
    const { map } = this.world;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return { x, y };
  }

  /**
   * What a screen position is over: a tree or deposit, a building, or bare
   * ground. Tall things are hit where they are seen, not where the ground
   * behind them is.
   */
  pick(clientX: number, clientY: number): Pick | null {
    const { map } = this.world;
    const ray = this.aim(clientX, clientY);
    const hit = this.groundDistance(ray);
    if (hit === null) return null;
    const { origin, direction } = ray;
    const classify = (x: number, y: number, lift: number): Pick | null => {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
      const tile = Math.floor(y) * map.width + Math.floor(x);
      const terrain = map.terrain[tile]!;
      if (resourceOfTerrain(terrain) !== -1 && lift <= (PROP_HEIGHT[terrain] ?? 0)) return { kind: 'tile', tile };
      if (map.blocked[tile] === 1 && lift <= BUILDING_HEIGHT) {
        const id = this.buildingOn(tile);
        if (id !== null) return { kind: 'building', id };
      }
      return null;
    };
    // Come down the last stretch of the ray a quarter of a metre at a time.
    const from = Math.max(0, hit - 16);
    for (let t = from; t < hit; t += 0.25) {
      const x = (origin.x + direction.x * t) / TILE;
      const y = (origin.z + direction.z * t) / TILE;
      const found = classify(x, y, origin.y + direction.y * t - this.heightAt(x, y));
      if (found !== null) return found;
    }
    const x = (origin.x + direction.x * hit) / TILE;
    const y = (origin.z + direction.z * hit) / TILE;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return classify(x, y, 0) ?? { kind: 'ground', x, y };
  }

  /** Where a point above the ground appears on screen, in page pixels. */
  toScreen(x: number, y: number, lift: number): { x: number; y: number; visible: boolean } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(x * TILE, this.heightAt(x, y) + lift, y * TILE).project(this.camera);
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
      visible: v.z > -1 && v.z < 1,
    };
  }

  /** The ground under the four corners of the screen, in tiles, clockwise from top left. */
  viewCorners(): { x: number; y: number }[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const corners: [number, number][] = [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.right, rect.bottom],
      [rect.left, rect.bottom],
    ];
    return corners.map(([sx, sy]) => {
      const ndc = new THREE.Vector2(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const { origin, direction } = this.raycaster.ray;
      const t = direction.y < -1e-4 ? origin.y / -direction.y : 0;
      return { x: (origin.x + direction.x * t) / TILE, y: (origin.z + direction.z * t) / TILE };
    });
  }

  // ---- Frame -----------------------------------------------------------------

  /** Shows a ring on the ground where an order was given. */
  addMarker(x: number, y: number, kind: keyof typeof MARKER_COLOURS): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(MARKER_COLOURS[kind]),
        transparent: true,
        depthWrite: false,
      }),
    );
    mesh.position.set(x * TILE, this.heightAt(x, y) + 0.1, y * TILE);
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.markers.push({ mesh, born: this.seconds });
  }

  render(alpha: number, dt: number, selected: ReadonlySet<number>): void {
    this.seconds += dt;
    this.resize();
    this.placeCamera();
    this.syncTerrain();
    this.syncBuildings();
    this.drawUnits(alpha, dt, selected);
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const marker = this.markers[i]!;
      const age = (this.seconds - marker.born) / MARKER_SECONDS;
      if (age >= 1) {
        this.scene.remove(marker.mesh);
        marker.mesh.geometry.dispose();
        (marker.mesh.material as THREE.Material).dispose();
        this.markers.splice(i, 1);
        continue;
      }
      marker.mesh.scale.setScalar(1.5 - age * 0.9);
      (marker.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - age * age;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

/** A flat disc or ring lying on the ground: scale and position only. */
function writeFlat(out: Float32Array, index: number, x: number, y: number, z: number, scale: number): void {
  const o = index * 16;
  out.fill(0, o, o + 16);
  out[o] = scale;
  out[o + 5] = 1;
  out[o + 10] = scale;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}
