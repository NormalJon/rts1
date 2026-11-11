/**
 * Draws the match in 3D and answers questions about what is where on screen.
 *
 * This is display code. It reads the world and never changes it. The
 * simulation works in tiles; the scene works in metres, two to a tile, so
 * models made at real scale need no adjusting.
 */

import * as THREE from 'three';
import { toFloat } from '../../sim/fixed';
import { Terrain } from '../../sim/map';
import type { World } from '../../sim/world';
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

const TERRAIN_COLOURS: Record<number, string> = {
  [Terrain.Grass]: '#7f9b58',
  [Terrain.Forest]: '#566f43',
  [Terrain.Shallows]: '#c4bb8f',
  [Terrain.Water]: '#3f5557',
  [Terrain.Rock]: '#8d8b85',
};

interface UnitBatch {
  readonly model: UnitModel;
  readonly meshes: THREE.InstancedMesh[];
  capacity: number;
  count: number;
}

interface Marker {
  readonly mesh: THREE.Mesh;
  born: number;
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

  private readonly world: World;
  private readonly heights: Float32Array;
  private readonly batches: UnitBatch[];
  private readonly rings: THREE.InstancedMesh;
  private readonly shadows: THREE.InstancedMesh;
  private readonly markers: Marker[] = [];
  private readonly raycaster = new THREE.Raycaster();

  // Per-unit display state, by slot.
  private readonly prevX: Float32Array;
  private readonly prevY: Float32Array;
  private readonly yaw: Float32Array;
  private readonly animTime: Float32Array;
  private readonly walking: Uint8Array;
  private seconds = 0;

  constructor(canvas: HTMLCanvasElement, world: World, models: Models) {
    this.world = world;
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

    this.buildTerrain();
    this.buildTrees(models.oak, models.conifer);

    const n = world.config.maxEntities;
    this.prevX = new Float32Array(n);
    this.prevY = new Float32Array(n);
    this.yaw = new Float32Array(n);
    this.animTime = new Float32Array(n);
    this.walking = new Uint8Array(n);

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

    this.batches = models.units.map((model) => ({ model, meshes: [], capacity: 0, count: 0 }));
    for (const batch of this.batches) this.growBatch(batch, 256);

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

  private buildTerrain(): void {
    const { map } = this.world;
    const { width, height } = map;
    const row = width + 1;

    // A colour per tile, then blended at the corners so terrain types fade
    // into each other instead of meeting along the grid.
    const tileColour = new Float32Array(width * height * 3);
    const colour = new THREE.Color();
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const id = map.terrain[ty * width + tx]!;
        colour.set(TERRAIN_COLOURS[id] ?? '#ff00ff').convertSRGBToLinear();
        const shade = 0.9 + tileNoise(tx, ty) * 0.2;
        tileColour.set([colour.r * shade, colour.g * shade, colour.b * shade], (ty * width + tx) * 3);
      }
    }
    const cornerColour = new Float32Array(row * (height + 1) * 3);
    for (let cy = 0; cy <= height; cy++) {
      for (let cx = 0; cx <= width; cx++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        // Rock keeps a hard edge, so it takes no part in the blending.
        for (let oy = -1; oy <= 0; oy++) {
          for (let ox = -1; ox <= 0; ox++) {
            const tx = cx + ox;
            const ty = cy + oy;
            if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
            if (map.terrain[ty * width + tx] === Terrain.Rock) continue;
            const at = (ty * width + tx) * 3;
            r += tileColour[at]!;
            g += tileColour[at + 1]!;
            b += tileColour[at + 2]!;
            n++;
          }
        }
        if (n === 0) continue;
        cornerColour.set([r / n, g / n, b / n], (cy * row + cx) * 3);
      }
    }

    const positions = new Float32Array(width * height * 18);
    const colours = new Float32Array(width * height * 18);
    let at = 0;
    let source = cornerColour;
    let fixed = -1;
    const put = (cx: number, cy: number): void => {
      const corner = cy * row + cx;
      const from = fixed === -1 ? corner * 3 : fixed;
      positions[at] = cx * TILE;
      positions[at + 1] = this.heights[corner]!;
      positions[at + 2] = cy * TILE;
      colours[at] = source[from]!;
      colours[at + 1] = source[from + 1]!;
      colours[at + 2] = source[from + 2]!;
      at += 3;
    };
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        // A rock tile is one flat colour; every other tile blends corner to corner.
        const rock = map.terrain[ty * width + tx] === Terrain.Rock;
        source = rock ? tileColour : cornerColour;
        fixed = rock ? (ty * width + tx) * 3 : -1;
        put(tx, ty);
        put(tx, ty + 1);
        put(tx + 1, ty + 1);
        put(tx, ty);
        put(tx + 1, ty + 1);
        put(tx + 1, ty);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
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

  private buildTrees(oak: StaticModel, conifer: StaticModel): void {
    const { map } = this.world;
    const spots: { x: number; y: number; oak: boolean; turn: number; size: number; tint: number }[] = [];
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (map.terrain[ty * map.width + tx] !== Terrain.Forest) continue;
        const a = tileNoise(tx * 3 + 1, ty * 3 + 2);
        const b = tileNoise(tx * 5 + 7, ty * 5 + 3);
        const c = tileNoise(tx * 7 + 5, ty * 7 + 11);
        // Oaks spread wide, so they are planted sparsely among the firs.
        const isOak = a < 0.16;
        if (!isOak && a > 0.9) continue;
        spots.push({
          x: tx + 0.25 + b * 0.5,
          y: ty + 0.25 + c * 0.5,
          oak: isOak,
          turn: b * Math.PI * 2,
          size: (isOak ? 0.62 : 0.72) + c * 0.4,
          tint: 0.82 + a * 0.3,
        });
      }
    }
    const place = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const colour = new THREE.Color();
    for (const [model, wantOak] of [
      [oak, true],
      [conifer, false],
    ] as const) {
      const mine = spots.filter((s) => s.oak === wantOak);
      for (const part of model.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, mine.length);
        mine.forEach((s, i) => {
          turn.setFromAxisAngle(up, s.turn);
          place.compose(
            new THREE.Vector3(s.x * TILE, this.heightAt(s.x, s.y) - 0.05, s.y * TILE),
            turn,
            new THREE.Vector3(s.size, s.size, s.size),
          );
          mesh.setMatrixAt(i, place.multiply(part.matrix));
          mesh.setColorAt(i, colour.setScalar(s.tint));
        });
        mesh.frustumCulled = false;
        this.scene.add(mesh);
      }
    }
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
    for (const batch of this.batches) {
      batch.count = 0;
      let living = 0;
      for (let slot = 0; slot < world.highWater; slot++) {
        if (world.alive[slot] === 1 && world.unitType[slot] === this.batches.indexOf(batch)) living++;
      }
      if (living > batch.capacity) this.growBatch(batch, Math.max(living, batch.capacity * 2));
    }

    const shadowArray = this.shadows.instanceMatrix.array as Float32Array;
    const ringArray = this.rings.instanceMatrix.array as Float32Array;
    let shadowCount = 0;
    let ringCount = 0;

    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 0) continue;
      const batch = this.batches[world.unitType[slot]!];
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
      if (walking !== (this.walking[slot] === 1)) {
        this.walking[slot] = walking ? 1 : 0;
        this.animTime[slot] = (slot * 0.37) % 1;
      }
      this.animTime[slot] = this.animTime[slot]! + dt * (walking ? Math.max(0.5, speed / nominal) : 1);
      const clip = batch.model.clips.get(walking ? 'walk' : 'idle')!;
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

  /** The point on the ground under a screen position, in tiles, or null if it misses the map. */
  screenToGround(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
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
    const x = (origin.x + direction.x * hit) / TILE;
    const y = (origin.z + direction.z * hit) / TILE;
    const { map } = this.world;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return { x, y };
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
  addMarker(x: number, y: number, queued: boolean): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(queued ? '#e9c46a' : '#bfe38a'),
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
