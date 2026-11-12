/**
 * The minimap: the map from straight above as far as the player knows it,
 * with every unit in sight as a dot and the outline of what the main view is
 * showing.
 */

import { ENTITY_TYPES } from '../../sim/entityTypes';
import { toFloat } from '../../sim/fixed';
import { Terrain } from '../../sim/map';
import type { World } from '../../sim/world';
import { TEAM_COLOURS, type GameView } from './view';

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [Terrain.Grass]: [118, 146, 84],
  [Terrain.Forest]: [56, 84, 52],
  [Terrain.Shallows]: [150, 178, 170],
  [Terrain.Water]: [52, 96, 124],
  [Terrain.Rock]: [128, 126, 120],
  [Terrain.Berries]: [150, 72, 96],
  [Terrain.Stone]: [196, 194, 186],
  [Terrain.Gold]: [226, 186, 60],
  [Terrain.Field]: [158, 138, 84],
};

const PING_MS = 3600;

export class Minimap {
  private readonly pings: { x: number; y: number; born: number }[] = [];
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain: HTMLCanvasElement;
  private readonly paint: CanvasRenderingContext2D;
  /** The fog, a pixel per tile: opaque over ground never seen, a veil over ground seen before. */
  private readonly fog: HTMLCanvasElement;
  private readonly fogPaint: CanvasRenderingContext2D;
  private readonly fogImage: ImageData;
  private fogDue = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
    private readonly view: GameView,
    onOrder: (x: number, y: number, queue: boolean) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const { map } = world;

    // The terrain is painted once, a pixel per tile, and touched up as tiles change.
    this.terrain = document.createElement('canvas');
    this.terrain.width = map.width;
    this.terrain.height = map.height;
    this.paint = this.terrain.getContext('2d')!;
    const image = this.paint.createImageData(map.width, map.height);
    for (let tile = 0; tile < map.tileCount; tile++) {
      const [r, g, b] = TERRAIN_RGB[map.terrain[tile]!] ?? [255, 0, 255];
      image.data.set([r, g, b, 255], tile * 4);
    }
    this.paint.putImageData(image, 0, 0);

    this.fog = document.createElement('canvas');
    this.fog.width = map.width;
    this.fog.height = map.height;
    this.fogPaint = this.fog.getContext('2d')!;
    this.fogImage = this.fogPaint.createImageData(map.width, map.height);
    for (let tile = 0; tile < map.tileCount; tile++) this.fogImage.data.set([14, 18, 16], tile * 4);

    const toTiles = (event: PointerEvent | MouseEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.min(map.width - 0.01, Math.max(0, ((event.clientX - rect.left) / rect.width) * map.width)),
        y: Math.min(map.height - 0.01, Math.max(0, ((event.clientY - rect.top) / rect.height) * map.height)),
      };
    };
    let dragging = false;
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const at = toTiles(event);
      if (event.button === 2) {
        onOrder(at.x, at.y, event.shiftKey);
        return;
      }
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
      view.lookAt(at.x, at.y);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const at = toTiles(event);
      view.lookAt(at.x, at.y);
    });
    const release = (): void => {
      dragging = false;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** Flashes a ring on the map, to draw the eye to a place. */
  ping(x: number, y: number): void {
    this.pings.push({ x, y, born: performance.now() });
  }

  /** Repaints one tile after its terrain has changed. */
  repaintTile(tile: number): void {
    const { map } = this.world;
    const [r, g, b] = TERRAIN_RGB[map.terrain[tile]!] ?? [255, 0, 255];
    this.paint.fillStyle = `rgb(${r}, ${g}, ${b})`;
    this.paint.fillRect(tile % map.width, Math.floor(tile / map.width), 1, 1);
  }

  draw(selected: ReadonlySet<number>): void {
    const { canvas, ctx, world } = this;
    const { map } = world;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(canvas.clientWidth * ratio);
    const tall = Math.round(canvas.clientHeight * ratio);
    if (size === 0 || tall === 0) return;
    if (canvas.width !== size || canvas.height !== tall) {
      canvas.width = size;
      canvas.height = tall;
    }
    const sx = size / map.width;
    const sy = tall / map.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, 0, 0, size, tall);

    // The fog is redrawn a few times a second, which is as fast as it changes to the eye.
    const now = performance.now();
    if (now >= this.fogDue) {
      this.fogDue = now + 150;
      const alpha = this.fogImage.data;
      for (let tile = 0; tile < map.tileCount; tile++) {
        alpha[tile * 4 + 3] = this.view.seesTile(tile) ? 0 : this.view.knowsTile(tile) ? 120 : 255;
      }
      this.fogPaint.putImageData(this.fogImage, 0, 0);
    }
    ctx.drawImage(this.fog, 0, 0, size, tall);

    const dot = Math.max(2, Math.round(ratio * 2));
    // Buildings the player knows of, in sight or remembered, as squares the size of their footprint.
    for (const building of this.view.knownBuildings()) {
      // Farms show as the ground they are, not as blocks.
      if (ENTITY_TYPES[building.entityType]!.farm) continue;
      const side = Math.max(dot * 2, ENTITY_TYPES[building.entityType]!.footprint * sx);
      ctx.fillStyle = TEAM_COLOURS[building.owner % TEAM_COLOURS.length]!;
      ctx.fillRect(
        Math.round((building.tileX + 0.5) * sx - side / 2),
        Math.round((building.tileY + 0.5) * sy - side / 2),
        Math.round(side),
        Math.round(side),
      );
    }
    // Units, where they can be seen.
    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 0 || world.mobile[slot] === 0 || !this.view.showsNow(slot)) continue;
      const x = toFloat(world.posX[slot]!) * sx;
      const y = toFloat(world.posY[slot]!) * sy;
      ctx.fillStyle = selected.has(world.idAt(slot))
        ? '#ffffff'
        : TEAM_COLOURS[world.owner[slot]! % TEAM_COLOURS.length]!;
      ctx.fillRect(Math.round(x - dot / 2), Math.round(y - dot / 2), dot, dot);
    }

    for (let i = this.pings.length - 1; i >= 0; i--) {
      const ping = this.pings[i]!;
      const age = (now - ping.born) / PING_MS;
      if (age >= 1) {
        this.pings.splice(i, 1);
        continue;
      }
      // Three quick rings closing in on the spot.
      const pulse = (age * 3) % 1;
      ctx.strokeStyle = `rgba(255, 214, 120, ${(1 - age).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, ratio * 1.5);
      ctx.beginPath();
      ctx.arc(ping.x * sx, ping.y * sy, (3 + (1 - pulse) * 14) * ratio, 0, Math.PI * 2);
      ctx.stroke();
    }

    const corners = this.view.viewCorners();
    ctx.strokeStyle = '#f4f1e4';
    ctx.lineWidth = Math.max(1, ratio);
    ctx.beginPath();
    corners.forEach((corner, i) => {
      if (i === 0) ctx.moveTo(corner.x * sx, corner.y * sy);
      else ctx.lineTo(corner.x * sx, corner.y * sy);
    });
    ctx.closePath();
    ctx.stroke();
  }
}
