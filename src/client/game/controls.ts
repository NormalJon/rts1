/**
 * Mouse, keyboard and touch: choosing units and buildings and telling them
 * what to do.
 *
 * What is selected is the player's own business and never enters the
 * simulation. Orders do, as commands through the session.
 */

import { canPlace } from '../../sim/buildings';
import {
  buildPointsNeeded,
  ENTITY_TYPES,
  Kind,
  RESOURCE_NAMES,
  resourceOfTerrain,
  Tag,
  TRAIN_QUEUE_LENGTH,
  trainingTicks,
} from '../../sim/entityTypes';
import { Terrain } from '../../sim/map';
import { countPopulation } from '../../sim/production';
import { fromFloat } from '../../sim/units';
import { entityIndex, Job, MoveState, OrderKind, type EntityId } from '../../sim/world';
import type { LocalSession } from '../../session/localSession';
import type { GameView } from './view';

const CLICK_SLOP = 5; // pixels the pointer may wander and still count as a click
const PICK_RADIUS = 26; // pixels around the pointer in which a unit can be clicked
const DOUBLE_CLICK_MS = 320;
const PAN_PER_SECOND = 1.5;
const TOAST_MS = 2400;
/** The keys for the buttons in the action row, left to right. */
const ACTION_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o'];
/** The order buildings are offered in: what a town needs first, first. Anything not listed follows. */
const BUILD_ORDER: readonly number[] = [
  Kind.House,
  Kind.Farm,
  Kind.Mill,
  Kind.LumberCamp,
  Kind.MiningCamp,
  Kind.Barracks,
  Kind.ArcheryRange,
  Kind.Stable,
  Kind.Watchtower,
];
/** How far from the middle of the view something must be hit before the player is told, in tiles. */
const ALARM_DISTANCE = 22;
const ALARM_EVERY_MS = 12000;

const PLURALS: Record<string, string> = { spearman: 'spearmen', horseman: 'horsemen' };
/** What a weapon's bonus is against, in words, by tag. */
const TAG_WORDS: [number, string][] = [
  [Tag.Cavalry, 'horsemen'],
  [Tag.Ranged, 'archers'],
  [Tag.Spear, 'spearmen'],
  [Tag.Building, 'buildings'],
];
const ORDER_WORDS: Record<number, string> = {
  [OrderKind.AttackMove]: 'Marching to attack',
  [OrderKind.Patrol]: 'On patrol',
  [OrderKind.AttackTarget]: 'Attacking',
  [OrderKind.Hold]: 'Holding ground',
};
const RESOURCE_VERBS = ['Foraging', 'Felling', 'Quarrying', 'Mining'];
const RESOURCE_SOURCES = ['Berry bush', 'Tree', 'Stone outcrop', 'Gold ore'];

const capital = (text: string): string => text[0]!.toUpperCase() + text.slice(1);

/** A cost in words: "60 food, 20 wood". */
function costText(cost: readonly number[]): string {
  const parts = cost.flatMap((amount, r) => (amount > 0 ? [`${amount} ${RESOURCE_NAMES[r]}`] : []));
  return parts.length > 0 ? parts.join(', ') : 'free';
}

export interface Hud {
  readonly selection: HTMLElement;
  readonly groups: HTMLElement;
  /** The row of orders for selected units: attack-move, patrol, hold, stop. */
  readonly orders: HTMLElement;
  readonly attackMove: HTMLButtonElement;
  readonly patrol: HTMLButtonElement;
  readonly hold: HTMLButtonElement;
  readonly stop: HTMLButtonElement;
  readonly idle: HTMLButtonElement;
  /** Build or train buttons for whatever is selected. */
  readonly actions: HTMLElement;
  /** Units waiting to be trained at the selected building. */
  readonly queue: HTMLElement;
  readonly progress: HTMLElement;
  readonly progressBar: HTMLElement;
  readonly population: HTMLElement;
  readonly toast: HTMLElement;
  /** Everything the player has in training, at whichever building. */
  readonly production: HTMLElement;
}

export class Controls {
  readonly selected = new Set<EntityId>();
  /** The building being looked at. Only the player's own can be given orders. */
  private building: EntityId | null = null;
  /** A resource tile being looked at, or -1. */
  private inspectedTile = -1;
  /** An enemy unit being looked at. */
  private inspectedUnit: EntityId | null = null;
  /** The type of building being placed, while choosing where. */
  private placing: number | null = null;
  /** An order waiting for the player to click where: the next click on the field gives it. */
  private aiming: 'attackMove' | 'patrol' | null = null;
  /** Hit points of the player's own things as last seen, to notice an attack, and where the last one was. */
  private readonly hpSeen = new Map<EntityId, number>();
  private alarmAt: { x: number; y: number } | null = null;
  private alarmDue = 0;
  /** Told where on the map the player's attention is wanted. */
  onAlarm: ((x: number, y: number) => void) | null = null;
  private pointer: { x: number; y: number } | null = null;

  private readonly groups: EntityId[][] = Array.from({ length: 10 }, () => []);
  private readonly keysDown = new Set<string>();
  private dragStart: { x: number; y: number; id: number } | null = null;
  private panGrab: { x: number; y: number } | null = null;
  private lastClick = { time: 0, unit: -1 };
  private lastGroupKey = { time: 0, digit: -1 };
  private alpha = 1;
  private idleCursor = 0;
  private idleShown = -1;
  /** When the panel is next due a refresh. Much of what it shows changes without the player's say. */
  private hudDue = 0;
  /** What the action row was last built for, so it is only rebuilt when that changes. */
  private actionsFor = '';
  private queueFor = '';
  private productionFor = '';
  private groupsFor = '';
  private toastUntil = 0;

  constructor(
    private readonly player: number,
    private readonly session: LocalSession,
    private readonly view: GameView,
    private readonly canvas: HTMLCanvasElement,
    private readonly box: HTMLElement,
    private readonly hud: Hud,
  ) {
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        view.zoom(Math.exp(event.deltaY * 0.0012));
      },
      { passive: false },
    );
    canvas.addEventListener('keydown', (event) => this.keyDown(event));
    canvas.addEventListener('keyup', (event) => this.keysDown.delete(event.key));
    canvas.addEventListener('blur', () => this.keysDown.clear());
    hud.stop.addEventListener('click', () => {
      this.stop();
      canvas.focus();
    });
    hud.hold.addEventListener('click', () => {
      this.hold();
      canvas.focus();
    });
    hud.attackMove.addEventListener('click', () => {
      this.aim('attackMove');
      canvas.focus();
    });
    hud.patrol.addEventListener('click', () => {
      this.aim('patrol');
      canvas.focus();
    });
    hud.idle.addEventListener('click', () => {
      this.selectIdleVillager();
      canvas.focus();
    });
    hud.groups.addEventListener('click', (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-group]');
      if (chip) this.recallGroup(Number(chip.dataset.group), false);
      canvas.focus();
    });
    hud.actions.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (button && !button.disabled) this.act(Number(button.dataset.action));
      canvas.focus();
    });
    hud.production.addEventListener('click', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-building]');
      if (row) {
        const id = Number(row.dataset.building);
        if (this.session.world.isAlive(id)) {
          this.selectBuilding(id);
          const slot = entityIndex(id);
          this.view.lookAt(this.session.world.posX[slot]! / 65536, this.session.world.posY[slot]! / 65536);
          this.refreshHud();
        }
      }
      canvas.focus();
    });
    hud.queue.addEventListener('click', (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-queued]');
      if (chip && this.building !== null) {
        this.session.issue(this.player, { kind: 'cancelTrain', building: this.building, index: Number(chip.dataset.queued) });
        this.hudDue = performance.now() + 90;
      }
      canvas.focus();
    });
    this.refreshHud();
  }

  // ---- What is selected --------------------------------------------------------

  private clearSelection(): void {
    this.selected.clear();
    this.building = null;
    this.inspectedTile = -1;
    this.inspectedUnit = null;
    this.aiming = null;
    this.view.selectBuilding(null);
  }

  private selectUnits(ids: Iterable<EntityId>, add: boolean): void {
    if (!add) this.clearSelection();
    this.building = null;
    this.inspectedTile = -1;
    this.inspectedUnit = null;
    this.view.selectBuilding(null);
    for (const id of ids) this.selected.add(id);
  }

  /** What the view should ring and show the health of: the selection, and any enemy being looked at. */
  watched(): ReadonlySet<EntityId> {
    if (this.inspectedUnit === null) return this.selected;
    return new Set([...this.selected, this.inspectedUnit]);
  }

  private selectBuilding(id: EntityId): void {
    this.clearSelection();
    this.building = id;
    this.view.selectBuilding(id);
  }

  /** The selected building's slot if it belongs to the player, else -1. */
  private ownBuilding(): number {
    const { world } = this.session;
    if (this.building === null || !world.isAlive(this.building)) return -1;
    const slot = entityIndex(this.building);
    return world.owner[slot] === this.player ? slot : -1;
  }

  private buildersSelected(): boolean {
    const { world } = this.session;
    for (const id of this.selected) {
      if (ENTITY_TYPES[world.entityType[entityIndex(id)]!]!.builds) return true;
    }
    return false;
  }

  // ---- Pointer ---------------------------------------------------------------

  private pointerDown(event: PointerEvent): void {
    this.canvas.focus();
    this.pointer = { x: event.clientX, y: event.clientY };
    if (event.button === 1) {
      event.preventDefault();
      this.panGrab = this.view.screenToGround(event.clientX, event.clientY);
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 2) {
      if (this.placing !== null) this.stopPlacing();
      else if (this.aiming !== null) this.aim(null);
      else this.orderAt(event.clientX, event.clientY, event.shiftKey);
      return;
    }
    if (event.button !== 0) return;
    if (this.placing !== null) {
      this.placeAt(event.clientX, event.clientY, event.shiftKey);
      return;
    }
    if (this.aiming !== null) {
      const ground = this.view.screenToGround(event.clientX, event.clientY);
      if (ground !== null) this.order(ground.x, ground.y, event.shiftKey);
      return;
    }
    this.dragStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    this.canvas.setPointerCapture(event.pointerId);
  }

  private pointerMove(event: PointerEvent): void {
    this.pointer = { x: event.clientX, y: event.clientY };
    if (this.panGrab) {
      // Keep the grabbed patch of ground under the pointer.
      const now = this.view.screenToGround(event.clientX, event.clientY);
      if (now) {
        this.view.targetX += this.panGrab.x - now.x;
        this.view.targetY += this.panGrab.y - now.y;
      }
      return;
    }
    const start = this.dragStart;
    if (!start) return;
    const width = Math.abs(event.clientX - start.x);
    const height = Math.abs(event.clientY - start.y);
    if (width < CLICK_SLOP && height < CLICK_SLOP) {
      this.box.hidden = true;
      return;
    }
    const frame = this.canvas.getBoundingClientRect();
    this.box.hidden = false;
    this.box.style.left = `${Math.min(event.clientX, start.x) - frame.left}px`;
    this.box.style.top = `${Math.min(event.clientY, start.y) - frame.top}px`;
    this.box.style.width = `${width}px`;
    this.box.style.height = `${height}px`;
  }

  private pointerUp(event: PointerEvent): void {
    if (event.button === 1) {
      this.panGrab = null;
      return;
    }
    const start = this.dragStart;
    if (!start || event.button !== 0) return;
    this.dragStart = null;
    this.box.hidden = true;
    const dragged =
      Math.abs(event.clientX - start.x) >= CLICK_SLOP || Math.abs(event.clientY - start.y) >= CLICK_SLOP;
    if (dragged) {
      this.selectInBox(start.x, start.y, event.clientX, event.clientY, event.shiftKey);
    } else {
      this.click(event.clientX, event.clientY, event.shiftKey, event.pointerType === 'touch');
    }
    this.refreshHud();
  }

  private cancelDrag(): void {
    this.dragStart = null;
    this.panGrab = null;
    this.box.hidden = true;
  }

  /** Living units with where each appears on screen: the player's own, or everyone else's. */
  private *unitsOnScreen(own: boolean): Generator<{ id: EntityId; slot: number; x: number; y: number }> {
    const { world } = this.session;
    for (const id of world.livingUnits()) {
      const slot = entityIndex(id);
      if ((world.owner[slot] === this.player) !== own) continue;
      // Nobody can click on what they cannot see.
      if (!own && !this.view.showsNow(slot)) continue;
      const at = this.view.unitPosition(slot, this.alpha);
      const screen = this.view.toScreen(at.x, at.y, 0.9);
      if (screen.visible) yield { id, slot, x: screen.x, y: screen.y };
    }
  }

  private ownUnitsOnScreen(): Generator<{ id: EntityId; slot: number; x: number; y: number }> {
    return this.unitsOnScreen(true);
  }

  /** The unit of someone else's nearest a screen position, if one is close enough to be meant. */
  private otherUnitAt(x: number, y: number): EntityId | null {
    let best: EntityId | null = null;
    let bestDistance = PICK_RADIUS;
    for (const unit of this.unitsOnScreen(false)) {
      const distance = Math.hypot(unit.x - x, unit.y - y);
      if (distance < bestDistance) {
        best = unit.id;
        bestDistance = distance;
      }
    }
    return best;
  }

  private click(x: number, y: number, add: boolean, touch: boolean): void {
    let best: { id: EntityId; slot: number } | null = null;
    let bestDistance = PICK_RADIUS;
    for (const unit of this.ownUnitsOnScreen()) {
      const distance = Math.hypot(unit.x - x, unit.y - y);
      if (distance < bestDistance) {
        best = unit;
        bestDistance = distance;
      }
    }
    const now = performance.now();
    if (best === null) {
      this.lastClick = { time: 0, unit: -1 };
      // On a touch screen there is no right button, so a tap away from any unit is the order.
      if (touch && (this.selected.size > 0 || this.ownBuilding() !== -1)) {
        this.orderAt(x, y, false);
        return;
      }
      if (add) return;
      // None of the player's units here, but there may be an enemy to look
      // at, a building to select or a resource to inspect.
      const other = this.otherUnitAt(x, y);
      const under = other === null ? this.view.pick(x, y) : null;
      this.clearSelection();
      if (other !== null) this.inspectedUnit = other;
      else if (under?.kind === 'building') this.selectBuilding(under.id);
      else if (under?.kind === 'tile') this.inspectedTile = under.tile;
      return;
    }
    const { world } = this.session;
    const double = now - this.lastClick.time < DOUBLE_CLICK_MS && this.lastClick.unit === best.id;
    this.lastClick = { time: now, unit: best.id };
    if (double) {
      // Everyone of that kind in view.
      const kind = world.entityType[best.slot];
      const frame = this.canvas.getBoundingClientRect();
      const alike: EntityId[] = [];
      for (const unit of this.ownUnitsOnScreen()) {
        const inView = unit.x >= frame.left && unit.x <= frame.right && unit.y >= frame.top && unit.y <= frame.bottom;
        if (inView && world.entityType[unit.slot] === kind) alike.push(unit.id);
      }
      this.selectUnits(alike, add);
      return;
    }
    if (add && this.selected.has(best.id)) this.selected.delete(best.id);
    else this.selectUnits([best.id], add);
  }

  private selectInBox(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const inside: EntityId[] = [];
    for (const unit of this.ownUnitsOnScreen()) {
      if (unit.x >= left && unit.x <= right && unit.y >= top && unit.y <= bottom) inside.push(unit.id);
    }
    this.selectUnits(inside, add);
  }

  // ---- Orders ----------------------------------------------------------------

  /**
   * The right-click: whatever makes sense for what is selected and what is
   * under the pointer. With units: attack an enemy, gather from a tree, bush
   * or deposit, work on one of your building sites or mend a damaged building,
   * hand in at a drop-off, or go there. With one of your buildings: set where
   * the units it trains will go.
   */
  private orderAt(clientX: number, clientY: number, queue: boolean): void {
    this.dropTheDead();
    const { world } = this.session;
    // Show the result of the order as soon as the simulation has taken it up.
    this.hudDue = performance.now() + 90;

    if (this.selected.size > 0) {
      const foe = this.otherUnitAt(clientX, clientY);
      if (foe !== null && world.hostile(this.player, world.owner[entityIndex(foe)]!)) {
        this.session.issue(this.player, { kind: 'attack', units: [...this.selected], target: foe });
        const at = this.view.unitPosition(entityIndex(foe), this.alpha);
        this.view.addMarker(at.x, at.y, 'attack');
        return;
      }
    }

    const target = this.view.pick(clientX, clientY);
    if (target === null) return;
    const known = target.kind === 'building' ? this.view.building(target.id) : undefined;
    const spot =
      target.kind === 'tile'
        ? { x: (target.tile % world.map.width) + 0.5, y: Math.floor(target.tile / world.map.width) + 0.5 }
        : target.kind === 'building'
          ? { x: (known?.tileX ?? 0) + 0.5, y: (known?.tileY ?? 0) + 0.5 }
          : target;

    if (this.selected.size === 0) {
      const own = this.ownBuilding();
      if (own === -1 || target.kind === 'building') return;
      this.session.issue(this.player, { kind: 'rally', buildings: [this.building!], x: fromFloat(spot.x), y: fromFloat(spot.y) });
      this.view.addMarker(spot.x, spot.y, 'queue');
      return;
    }

    const units = [...this.selected];
    if (target.kind === 'tile' && resourceOfTerrain(world.map.terrain[target.tile]!) !== -1) {
      this.session.issue(this.player, { kind: 'gather', units, tile: target.tile });
      this.view.addMarker(spot.x, spot.y, 'work');
      return;
    }
    if (target.kind === 'building' && !world.isAlive(target.id)) {
      // A building remembered from an earlier look, which has in truth been
      // destroyed since. The player cannot know that: the soldiers march on
      // the place ready to fight, and find out when they get there.
      this.session.issue(this.player, { kind: 'attackMove', units, x: fromFloat(spot.x), y: fromFloat(spot.y), queue });
      this.view.addMarker(spot.x, spot.y, 'attack');
      return;
    }
    if (target.kind === 'building') {
      const slot = entityIndex(target.id);
      const mine = world.owner[slot] === this.player;
      const type = ENTITY_TYPES[world.entityType[slot]!]!;
      const damaged = world.hp[slot]! < type.hp;
      if (!mine && world.hostile(this.player, world.owner[slot]!)) {
        this.session.issue(this.player, { kind: 'attack', units, target: target.id });
        this.view.addMarker(spot.x, spot.y, 'attack');
      } else if (mine && type.farm && world.built[slot] === 1 && !damaged) {
        // A farm: work it. The crop is gathered from its middle tile.
        const middle = (world.posY[slot]! >> 16) * world.map.width + (world.posX[slot]! >> 16);
        this.session.issue(this.player, { kind: 'gather', units, tile: middle });
        this.view.addMarker(spot.x, spot.y, 'work');
      } else if (mine && (world.built[slot] === 0 || (damaged && this.buildersSelected() && !this.carrying(type.accepts)))) {
        // Finish it, or mend it.
        this.session.issue(this.player, { kind: 'construct', units, target: target.id });
        this.view.addMarker(spot.x, spot.y, 'work');
      } else if (mine && type.accepts !== 0) {
        this.session.issue(this.player, { kind: 'deliver', units, target: target.id });
        this.view.addMarker(spot.x, spot.y, 'work');
      } else {
        this.order(spot.x, spot.y, queue);
      }
      return;
    }
    this.order(spot.x, spot.y, queue);
  }

  /** Whether anyone selected is carrying something a building with these `accepts` bits takes in. */
  private carrying(accepts: number): boolean {
    const { world } = this.session;
    for (const id of this.selected) {
      const slot = entityIndex(id);
      if (world.carry[slot]! > 0 && (accepts & (1 << world.carryKind[slot]!)) !== 0) return true;
    }
    return false;
  }

  /**
   * Sends the selection to a place: as a plain march, or, if the player has
   * picked attack-move or patrol and is choosing where, as that. With queue,
   * as a waypoint after what they are already doing.
   */
  order(x: number, y: number, queue: boolean): void {
    this.dropTheDead();
    if (this.selected.size === 0) return;
    const units = [...this.selected];
    const aiming = this.aiming;
    if (aiming === 'patrol') {
      this.session.issue(this.player, { kind: 'patrol', units, x: fromFloat(x), y: fromFloat(y) });
    } else {
      this.session.issue(this.player, { kind: aiming ?? 'move', units, x: fromFloat(x), y: fromFloat(y), queue });
    }
    this.view.addMarker(x, y, aiming === 'attackMove' ? 'attack' : queue || aiming === 'patrol' ? 'queue' : 'move');
    // Shift keeps the order in hand for another click.
    if (aiming !== null && !queue) this.aim(null);
    this.hudDue = performance.now() + 90;
  }

  /** Takes up an order that needs a place (the next click on the field gives it), or puts it down. */
  aim(order: 'attackMove' | 'patrol' | null): void {
    this.dropTheDead();
    this.aiming = order !== null && this.selected.size > 0 ? order : null;
    if (this.aiming !== null && this.placing !== null) this.stopPlacing();
    this.refreshHud();
  }

  hold(): void {
    this.dropTheDead();
    if (this.selected.size === 0) return;
    this.session.issue(this.player, { kind: 'hold', units: [...this.selected] });
    this.hudDue = performance.now() + 90;
  }

  /** The player's villagers with nothing to do, in slot order. */
  private idleVillagers(): EntityId[] {
    const { world } = this.session;
    return world.livingUnits(this.player).filter((id) => {
      const slot = entityIndex(id);
      return (
        ENTITY_TYPES[world.entityType[slot]!]!.carries > 0 &&
        world.job[slot] === Job.None &&
        world.moveState[slot] === MoveState.Idle
      );
    });
  }

  /** Selects the next idle villager and brings them into view. */
  selectIdleVillager(): void {
    const idle = this.idleVillagers();
    if (idle.length === 0) return;
    this.idleCursor = (this.idleCursor + 1) % idle.length;
    this.selectUnits([idle[this.idleCursor]!], false);
    this.jumpToSelection();
    this.refreshHud();
  }

  stop(): void {
    this.dropTheDead();
    if (this.selected.size === 0) return;
    this.session.issue(this.player, { kind: 'stop', units: [...this.selected] });
  }

  private dropTheDead(): void {
    const { world } = this.session;
    for (const id of this.selected) if (!world.isAlive(id)) this.selected.delete(id);

    if (this.inspectedUnit !== null && (!world.isAlive(this.inspectedUnit) || !this.view.showsNow(entityIndex(this.inspectedUnit)))) {
      this.inspectedUnit = null;
    }
    if (this.selected.size === 0) this.aiming = null;
    // A building stays selected for as long as the player knows of it. One
    // remembered from an earlier look may be gone, but they cannot tell yet.
    if (this.building !== null && this.view.building(this.building) === undefined) {
      this.building = null;
      this.view.selectBuilding(null);
    }
  }

  // ---- Building and training ---------------------------------------------------

  /** What the buttons in the action row do just now, left to right. */
  private actions(): { label: string; detail: string; cost: readonly number[] | null; run: () => void }[] {
    const { world } = this.session;
    const own = this.ownBuilding();
    if (own !== -1) {
      const type = ENTITY_TYPES[world.entityType[own]!]!;
      const list = world.built[own] === 1
        ? type.trains.map((unitType) => ({
            label: `Train ${ENTITY_TYPES[unitType]!.name}`,
            detail: costText(ENTITY_TYPES[unitType]!.cost),
            cost: ENTITY_TYPES[unitType]!.cost as readonly number[] | null,
            run: () => this.train(unitType),
          }))
        : [];
      list.push({
        label: world.built[own] === 1 ? 'Pull down' : 'Cancel site',
        detail: world.built[own] === 1 ? 'no refund' : `refunds ${costText(type.cost)}`,
        cost: null,
        run: () => this.demolish(),
      });
      return list;
    }
    if (this.buildersSelected()) {
      const rank = (entityType: number): number => {
        const at = BUILD_ORDER.indexOf(entityType);
        return at === -1 ? BUILD_ORDER.length + entityType : at;
      };
      return ENTITY_TYPES.map((type, entityType) => ({ type, entityType }))
        .filter(({ type }) => type.building && type.buildable)
        .sort((a, b) => rank(a.entityType) - rank(b.entityType))
        .map(({ type, entityType }) => ({
          label: capital(type.name),
          detail: costText(type.cost),
          cost: type.cost as readonly number[] | null,
          run: () => this.startPlacing(entityType),
        }));
    }
    return [];
  }

  private act(index: number): void {
    this.actions()[index]?.run();
    this.hudDue = performance.now() + 90;
    this.refreshHud();
  }

  private train(unitType: number): void {
    const { world } = this.session;
    const own = this.ownBuilding();
    if (own === -1) return;
    const type = ENTITY_TYPES[unitType]!;
    if (world.trainLength[own]! >= TRAIN_QUEUE_LENGTH) return this.toast('The queue is full');
    if (!world.canAfford(this.player, type.cost)) return this.toast(`Not enough for a ${type.name}: ${costText(type.cost)}`);
    this.session.issue(this.player, { kind: 'train', building: this.building!, unitType });
  }

  private demolish(): void {
    if (this.ownBuilding() === -1) return;
    this.session.issue(this.player, { kind: 'demolish', targets: [this.building!] });
  }

  private startPlacing(entityType: number): void {
    const type = ENTITY_TYPES[entityType]!;
    if (!this.session.world.canAfford(this.player, type.cost)) {
      return this.toast(`Not enough for a ${type.name}: ${costText(type.cost)}`);
    }
    this.placing = entityType;
    this.aiming = null;
  }

  private stopPlacing(): void {
    this.placing = null;
    this.view.showPlot(null);
    this.refreshHud();
  }

  /** The tile under a screen position and whether the building being placed can go there. */
  private plotAt(clientX: number, clientY: number): { tileX: number; tileY: number; size: number; allowed: boolean } | null {
    if (this.placing === null) return null;
    const ground = this.view.screenToGround(clientX, clientY);
    if (ground === null) return null;
    const { world } = this.session;
    const type = ENTITY_TYPES[this.placing]!;
    const tileX = Math.floor(ground.x);
    const tileY = Math.floor(ground.y);
    const allowed = canPlace(world, this.placing, tileX, tileY, this.player) && world.canAfford(this.player, type.cost);
    return { tileX, tileY, size: type.footprint, allowed };
  }

  private placeAt(clientX: number, clientY: number, keepPlacing: boolean): void {
    const plot = this.plotAt(clientX, clientY);
    if (plot === null || this.placing === null) return;
    const { world } = this.session;
    const type = ENTITY_TYPES[this.placing]!;
    if (!plot.allowed) {
      this.toast(
        world.canAfford(this.player, type.cost)
          ? 'It needs open grass you have explored: no trees, water, rock or buildings'
          : `Not enough for a ${type.name}: ${costText(type.cost)}`,
      );
      return;
    }
    this.dropTheDead();
    this.session.issue(this.player, {
      kind: 'build',
      units: [...this.selected],
      buildingType: this.placing,
      tileX: plot.tileX,
      tileY: plot.tileY,
    });
    this.view.addMarker(plot.tileX + 0.5, plot.tileY + 0.5, 'work');
    this.hudDue = performance.now() + 90;
    if (!keepPlacing) this.stopPlacing();
  }

  private toast(message: string): void {
    this.hud.toast.textContent = message;
    this.hud.toast.hidden = false;
    this.toastUntil = performance.now() + TOAST_MS;
  }

  // ---- Keyboard --------------------------------------------------------------

  private keyDown(event: KeyboardEvent): void {
    const { key } = event;
    if (key.startsWith('Arrow')) {
      event.preventDefault();
      this.keysDown.add(key);
      return;
    }
    // Read the physical key, since shift turns the digits into symbols.
    const digitKey = /^(?:Digit|Numpad)(\d)$/.exec(event.code);
    if (digitKey && !event.altKey) {
      event.preventDefault();
      const digit = Number(digitKey[1]);
      // Browsers keep ctrl + digit for switching tabs, so shift saves a group too.
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        this.dropTheDead();
        this.groups[digit] = [...this.selected];
      } else {
        const now = performance.now();
        const again = this.lastGroupKey.digit === digit && now - this.lastGroupKey.time < DOUBLE_CLICK_MS * 1.5;
        this.lastGroupKey = { time: now, digit };
        this.recallGroup(digit, again);
      }
      this.refreshHud();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const lower = key.toLowerCase();
    const action = ACTION_KEYS.indexOf(lower);
    if (action !== -1 && action < this.actions().length) {
      // The last button is "pull down", which has its own key so it is not hit by accident.
      if (this.ownBuilding() !== -1 && action === this.actions().length - 1) return;
      this.act(action);
      return;
    }
    switch (lower) {
      case 's':
        this.stop();
        break;
      case 'a':
        this.aim('attackMove');
        break;
      case 'p':
        this.aim('patrol');
        break;
      case 'h':
        this.hold();
        break;
      case 'f':
        if (this.alarmAt !== null) this.view.lookAt(this.alarmAt.x, this.alarmAt.y);
        break;
      case 'escape':
        if (this.placing !== null) this.stopPlacing();
        else if (this.aiming !== null) this.aim(null);
        else this.clearSelection();
        this.refreshHud();
        break;
      case 'delete':
      case 'backspace':
        this.demolish();
        break;
      case '.':
        this.selectIdleVillager();
        break;
      case ' ':
        event.preventDefault();
        this.jumpToSelection();
        break;
      case '=':
      case '+':
        this.view.zoom(0.85);
        break;
      case '-':
        this.view.zoom(1 / 0.85);
        break;
    }
  }

  private recallGroup(digit: number, jump: boolean): void {
    const { world } = this.session;
    const members = (this.groups[digit] ?? []).filter((id) => world.isAlive(id));
    this.groups[digit] = members;
    if (members.length === 0) return;
    this.selectUnits(members, false);
    if (jump) this.jumpToSelection();
    this.refreshHud();
  }

  /** Centres the view on the selection, or on all the player's units if nothing is selected. */
  jumpToSelection(): void {
    const { world } = this.session;
    this.dropTheDead();
    const ids = this.selected.size > 0 ? [...this.selected] : world.livingUnits(this.player);
    if (ids.length === 0) return;
    let x = 0;
    let y = 0;
    for (const id of ids) {
      const at = this.view.unitPosition(entityIndex(id), 1);
      x += at.x;
      y += at.y;
    }
    this.view.lookAt(x / ids.length, y / ids.length);
  }

  // ---- Every frame -----------------------------------------------------------

  update(dt: number, alpha: number): void {
    this.alpha = alpha;
    const step = PAN_PER_SECOND * dt;
    if (this.keysDown.has('ArrowLeft')) this.view.pan(-step, 0);
    if (this.keysDown.has('ArrowRight')) this.view.pan(step, 0);
    if (this.keysDown.has('ArrowUp')) this.view.pan(0, -step);
    if (this.keysDown.has('ArrowDown')) this.view.pan(0, step);

    // The plot follows the pointer, and is checked again as the world changes under it.
    if (this.placing !== null && !this.buildersSelected()) this.stopPlacing();
    if (this.placing !== null && this.pointer !== null) this.view.showPlot(this.plotAt(this.pointer.x, this.pointer.y));

    const before = this.selected.size;
    const hadBuilding = this.building;
    this.dropTheDead();
    this.canvas.style.cursor = this.aiming !== null ? 'cell' : '';
    const now = performance.now();
    if (this.toastUntil !== 0 && now >= this.toastUntil) {
      this.hud.toast.hidden = true;
      this.toastUntil = 0;
    }
    if (this.selected.size !== before || this.building !== hadBuilding || now >= this.hudDue) {
      this.hudDue = now + 200;
      this.watchForAttack(now);
      this.refreshHud();
    }
  }

  /**
   * Tells the player when something of theirs is hit somewhere they are not
   * looking: a message, a mark on the map, and F to go there.
   */
  private watchForAttack(now: number): void {
    const { world } = this.session;
    let hit: { x: number; y: number } | null = null;
    const seen = this.hpSeen;
    const present = new Set<EntityId>();
    for (const id of world.livingEntities(this.player)) {
      const slot = entityIndex(id);
      present.add(id);
      const before = seen.get(id);
      const hp = world.hp[slot]!;
      seen.set(id, hp);
      if (before === undefined || hp >= before) continue;
      const x = world.posX[slot]! / 65536;
      const y = world.posY[slot]! / 65536;
      if (Math.hypot(x - this.view.targetX, y - this.view.targetY) > ALARM_DISTANCE) hit = { x, y };
    }
    for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
    if (hit === null || now < this.alarmDue) return;
    this.alarmDue = now + ALARM_EVERY_MS;
    this.alarmAt = hit;
    this.toast('Your people are under attack — press F to look');
    this.onAlarm?.(hit.x, hit.y);
  }

  /** One unit's vital statistics, for the panel. */
  private statsOf(slot: number): string {
    const { world } = this.session;
    const type = ENTITY_TYPES[world.entityType[slot]!]!;
    let text = `${world.hp[slot]}/${type.hp} hp`;
    if (type.damage > 0) {
      const bonuses = type.bonuses.map(([tags, extra]) => {
        const against = TAG_WORDS.find(([tag]) => (tags & tag) !== 0)?.[1] ?? 'some';
        return `+${extra} against ${against}`;
      });
      if (type.charge > 0) bonuses.push(`+${type.charge} on a charge`);
      text += ` · ${type.ranged ? 'shoots' : 'hits'} for ${type.damage}${bonuses.length > 0 ? ` (${bonuses.join(', ')})` : ''}`;
    }
    if (type.meleeArmor > 0 || type.rangedArmor > 0) text += ` · armour ${type.meleeArmor} / ${type.rangedArmor} vs arrows`;
    return text;
  }

  private summary(): string {
    const { world } = this.session;
    if (this.placing !== null) {
      return `Placing a ${ENTITY_TYPES[this.placing]!.name} — click to build, shift-click for more, right-click to cancel`;
    }
    if (this.aiming !== null) {
      return this.aiming === 'attackMove'
        ? 'Attack-move — click where to march; they fight whatever they meet. Right-click to cancel'
        : 'Patrol — click the far end of the beat. Right-click to cancel';
    }
    if (this.inspectedUnit !== null && world.isAlive(this.inspectedUnit)) {
      const slot = entityIndex(this.inspectedUnit);
      const whose = world.hostile(this.player, world.owner[slot]!) ? 'Enemy' : 'Allied';
      return `${whose} ${ENTITY_TYPES[world.entityType[slot]!]!.name} · ${this.statsOf(slot)}`;
    }
    const remembered = this.building === null ? undefined : this.view.building(this.building);
    if (remembered !== undefined && !this.view.seesBuilding(remembered.id)) {
      // Out of sight, all the player has is the memory of it.
      const whose = world.hostile(this.player, remembered.owner) ? "the enemy's" : "an ally's";
      return `${capital(ENTITY_TYPES[remembered.entityType]!.name)} · ${whose} · as last seen`;
    }
    if (this.building !== null && world.isAlive(this.building)) {
      const slot = entityIndex(this.building);
      const type = ENTITY_TYPES[world.entityType[slot]!]!;
      const name = capital(type.name);
      const health = `${world.hp[slot]}/${type.hp} hp`;
      if (world.owner[slot] !== this.player) return `${name} · the enemy's · ${health}`;
      if (world.built[slot] === 0) {
        const done = world.buildPoints[slot]! / buildPointsNeeded(world.entityType[slot]!, world.config.tickRate);
        return `${name} · ${Math.floor(done * 100)}% built · ${health}`;
      }
      const arrows = type.damage > 0 ? ` · shoots for ${type.damage}, ${type.range / 65536} tiles` : type.farm ? ' · one villager farms it, and the food never runs out' : '';
      const mend = world.hp[slot]! < type.hp ? ' · right-click it with villagers to mend' : '';
      return `${name} · ${health}${arrows}${mend}`;
    }
    if (this.inspectedTile >= 0) {
      const resource = resourceOfTerrain(world.map.terrain[this.inspectedTile]!);
      if (resource === -1) this.inspectedTile = -1;
      else return `${RESOURCE_SOURCES[resource]} · ${world.map.amount[this.inspectedTile]} ${RESOURCE_NAMES[resource]} left`;
    }
    const counts = new Map<number, number>();
    for (const id of this.selected) {
      const kind = world.entityType[entityIndex(id)]!;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    if (counts.size === 0) return 'Nothing selected';
    let text = [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([kind, n]) => {
        const name = ENTITY_TYPES[kind]?.name ?? 'unit';
        return `${n} ${n === 1 ? name : (PLURALS[name] ?? `${name}s`)}`;
      })
      .join(' · ');
    // For a single unit, its figures, and for a villager what they are up to.
    if (this.selected.size === 1) {
      const slot = entityIndex([...this.selected][0]!);
      text = `${capital(ENTITY_TYPES[world.entityType[slot]!]!.name)} · ${this.statsOf(slot)}`;
      const order = ORDER_WORDS[world.orderKind[slot]!];
      if (order !== undefined) text += ` — ${order}`;
      if (ENTITY_TYPES[world.entityType[slot]!]!.carries > 0 && order === undefined) {
        const job = world.job[slot];
        let doing = 'Idle';
        if (job === Job.ToDropOff) doing = 'Carrying a load home';
        else if (job === Job.ToResource || job === Job.Harvesting) {
          doing = world.jobTerrain[slot] === Terrain.Field ? 'Farming' : (RESOURCE_VERBS[resourceOfTerrain(world.jobTerrain[slot]!)] ?? 'Working');
        } else if (job === Job.ToSite || job === Job.Constructing) doing = 'Building';
        if (world.carry[slot]! > 0) doing += ` · carrying ${world.carry[slot]}`;
        text += ` — ${doing}`;
      }
    }
    return text;
  }

  private refreshHud(): void {
    const { world } = this.session;
    const { hud } = this;
    hud.selection.textContent = this.summary();
    hud.orders.hidden = this.selected.size === 0;
    hud.attackMove.setAttribute('aria-pressed', String(this.aiming === 'attackMove'));
    hud.patrol.setAttribute('aria-pressed', String(this.aiming === 'patrol'));

    // The action row is rebuilt only when what it offers changes, so a click is never lost to a redraw.
    const actions = this.placing !== null ? [] : this.actions();
    const own = this.ownBuilding();
    const actionsFor = actions.map((a) => `${a.label}|${a.detail}`).join(';');
    if (actionsFor !== this.actionsFor) {
      this.actionsFor = actionsFor;
      hud.actions.replaceChildren(
        ...actions.map((action, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'action';
          button.dataset.action = String(index);
          const pullDown = own !== -1 && index === actions.length - 1;
          const key = pullDown ? 'del' : ACTION_KEYS[index];
          button.innerHTML = `<span class="action-name"></span><span class="action-detail"></span>${key ? `<kbd>${key.toUpperCase()}</kbd>` : ''}`;
          button.children[0]!.textContent = action.label;
          button.children[1]!.textContent = action.detail;
          if (pullDown) button.classList.add('action--quiet');
          return button;
        }),
      );
      hud.actions.hidden = actions.length === 0;
    }
    actions.forEach((action, index) => {
      const button = hud.actions.children[index] as HTMLButtonElement | undefined;
      // Shown as unaffordable rather than disabled, so a click can still say what is missing.
      button?.classList.toggle('action--short', action.cost !== null && !world.canAfford(this.player, action.cost));
    });

    // Progress: of the building going up, or of the unit being trained.
    let progress = -1;
    const waiting = own === -1 ? 0 : world.trainLength[own]!;
    if (own !== -1 && world.built[own] === 0) {
      progress = world.buildPoints[own]! / buildPointsNeeded(world.entityType[own]!, world.config.tickRate);
    } else if (waiting > 0) {
      const head = world.trainQueue[own * TRAIN_QUEUE_LENGTH]! - 1;
      progress = world.trainTicks[own]! / trainingTicks(ENTITY_TYPES[head]!, world.config.tickRate);
    }
    hud.progress.hidden = progress < 0;
    if (progress >= 0) hud.progressBar.style.width = `${Math.min(100, progress * 100).toFixed(1)}%`;

    const held = waiting > 0 && world.trainStarted[own] === 0;
    const queued = Array.from({ length: waiting }, (_, k) => world.trainQueue[own * TRAIN_QUEUE_LENGTH + k]! - 1);
    const queueFor = `${own}:${queued.join(',')}:${held}`;
    if (queueFor !== this.queueFor) {
      this.queueFor = queueFor;
      hud.queue.replaceChildren(
        ...queued.map((unitType, k) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'queued';
          chip.dataset.queued = String(k);
          chip.textContent = capital(ENTITY_TYPES[unitType]!.name) + (k === 0 && held ? ' · needs a house' : '');
          chip.title = 'Click to cancel and get the cost back';
          return chip;
        }),
      );
      hud.queue.hidden = waiting === 0;
    }

    // Everything in training, across all the player's buildings.
    const busy: number[] = [];
    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 1 && world.mobile[slot] === 0 && world.owner[slot] === this.player && world.trainLength[slot]! > 0) {
        busy.push(slot);
      }
    }
    const productionFor = busy
      .map((slot) => `${world.idAt(slot)}:${world.trainQueue[slot * TRAIN_QUEUE_LENGTH]}:${world.trainLength[slot]}:${world.trainStarted[slot]}`)
      .join(';');
    if (productionFor !== this.productionFor) {
      this.productionFor = productionFor;
      hud.production.replaceChildren(
        ...busy.map((slot) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'producing';
          row.dataset.building = String(world.idAt(slot));
          const unit = ENTITY_TYPES[world.trainQueue[slot * TRAIN_QUEUE_LENGTH]! - 1]!.name;
          const more = world.trainLength[slot]! - 1;
          const label = document.createElement('span');
          label.textContent =
            `${capital(unit)}${more > 0 ? ` +${more}` : ''}` + (world.trainStarted[slot] === 0 ? ' · needs a house' : '');
          const bar = document.createElement('i');
          row.append(label, bar);
          row.title = `In training at the ${ENTITY_TYPES[world.entityType[slot]!]!.name}. Click to go there.`;
          return row;
        }),
      );
      hud.production.hidden = busy.length === 0;
    }
    busy.forEach((slot, index) => {
      const head = world.trainQueue[slot * TRAIN_QUEUE_LENGTH]! - 1;
      const bar = hud.production.children[index]?.lastElementChild as HTMLElement | null;
      if (bar) bar.style.width = `${Math.min(100, (world.trainTicks[slot]! / trainingTicks(ENTITY_TYPES[head]!, world.config.tickRate)) * 100).toFixed(1)}%`;
    });

    const population = countPopulation(world);
    hud.population.textContent = `${population.used[this.player]}/${population.room[this.player]}`;
    hud.population.classList.toggle('full', population.used[this.player]! >= population.room[this.player]!);

    const idle = this.idleVillagers().length;
    if (idle !== this.idleShown) {
      this.idleShown = idle;
      hud.idle.hidden = idle === 0;
      hud.idle.textContent = `${idle} idle ${idle === 1 ? 'villager' : 'villagers'}`;
    }

    const groupsFor = this.groups.map((members) => members.filter((id) => world.isAlive(id)).length).join(',');
    if (groupsFor === this.groupsFor) return;
    this.groupsFor = groupsFor;
    hud.groups.replaceChildren(
      ...this.groups.flatMap((members, digit) => {
        const living = members.filter((id) => world.isAlive(id)).length;
        if (living === 0) return [];
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'group-chip';
        chip.dataset.group = String(digit);
        chip.innerHTML = `<b>${digit}</b>${living}`;
        chip.title = `Group ${digit}: ${living} units`;
        return [chip];
      }),
    );
  }
}
