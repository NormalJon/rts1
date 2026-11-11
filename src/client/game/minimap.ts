/**
 * The minimap: the whole map from straight above, with every unit as a dot
 * and the outline of what the main view is showing.
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
};

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain: HTMLCanvasElement;
  private readonly paint: CanvasRenderingContext2D;

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

    const dot = Math.max(2, Math.round(ratio * 2));
    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 0) continue;
      const x = toFloat(world.posX[slot]!) * sx;
      const y = toFloat(world.posY[slot]!) * sy;
      ctx.fillStyle = selected.has(world.idAt(slot))
        ? '#ffffff'
        : TEAM_COLOURS[world.owner[slot]! % TEAM_COLOURS.length]!;
      // Buildings show as a square the size of their footprint.
      const side = world.mobile[slot] === 1 ? dot : Math.max(dot * 2, ENTITY_TYPES[world.entityType[slot]!]!.footprint * sx);
      ctx.fillRect(Math.round(x - side / 2), Math.round(y - side / 2), Math.round(side), Math.round(side));
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
