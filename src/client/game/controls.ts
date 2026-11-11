/**
 * Mouse, keyboard and touch: choosing units and telling them what to do.
 *
 * Which units are selected is the player's own business and never enters the
 * simulation. Orders do, as commands through the session.
 */

import { fromFloat } from '../../sim/units';
import { UNIT_TYPES } from '../../sim/unitTypes';
import { entityIndex, type EntityId } from '../../sim/world';
import type { LocalSession } from '../../session/localSession';
import type { GameView } from './view';

const CLICK_SLOP = 5; // pixels the pointer may wander and still count as a click
const PICK_RADIUS = 26; // pixels around the pointer in which a unit can be clicked
const DOUBLE_CLICK_MS = 320;
const PAN_PER_SECOND = 1.5;

const PLURALS: Record<string, string> = { spearman: 'spearmen', villager: 'villagers' };

export class Controls {
  readonly selected = new Set<EntityId>();
  private readonly groups: EntityId[][] = Array.from({ length: 10 }, () => []);
  private readonly keysDown = new Set<string>();
  private dragStart: { x: number; y: number; id: number } | null = null;
  private panGrab: { x: number; y: number } | null = null;
  private lastClick = { time: 0, unit: -1 };
  private lastGroupKey = { time: 0, digit: -1 };
  private alpha = 1;

  constructor(
    private readonly player: number,
    private readonly session: LocalSession,
    private readonly view: GameView,
    private readonly canvas: HTMLCanvasElement,
    private readonly box: HTMLElement,
    private readonly hud: {
      readonly selection: HTMLElement;
      readonly groups: HTMLElement;
      readonly stop: HTMLButtonElement;
    },
  ) {
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
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
    hud.groups.addEventListener('click', (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-group]');
      if (chip) this.recallGroup(Number(chip.dataset.group), false);
      canvas.focus();
    });
    this.refreshHud();
  }

  // ---- Pointer ---------------------------------------------------------------

  private pointerDown(event: PointerEvent): void {
    this.canvas.focus();
    if (event.button === 1) {
      event.preventDefault();
      this.panGrab = this.view.screenToGround(event.clientX, event.clientY);
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 2) {
      const at = this.view.screenToGround(event.clientX, event.clientY);
      if (at) this.order(at.x, at.y, event.shiftKey);
      return;
    }
    if (event.button !== 0) return;
    this.dragStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    this.canvas.setPointerCapture(event.pointerId);
  }

  private pointerMove(event: PointerEvent): void {
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

  /** The player's own living units with where each appears on screen. */
  private *ownUnitsOnScreen(): Generator<{ id: EntityId; slot: number; x: number; y: number }> {
    const { world } = this.session;
    for (const id of world.livingEntities(this.player)) {
      const slot = entityIndex(id);
      const at = this.view.unitPosition(slot, this.alpha);
      const screen = this.view.toScreen(at.x, at.y, 0.9);
      if (screen.visible) yield { id, slot, x: screen.x, y: screen.y };
    }
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
      // On a touch screen there is no right button, so a tap on open ground is the order.
      if (touch && this.selected.size > 0) {
        const at = this.view.screenToGround(x, y);
        if (at) this.order(at.x, at.y, false);
      } else if (!add) {
        this.selected.clear();
      }
      this.lastClick = { time: 0, unit: -1 };
      return;
    }
    const { world } = this.session;
    const double = now - this.lastClick.time < DOUBLE_CLICK_MS && this.lastClick.unit === best.id;
    this.lastClick = { time: now, unit: best.id };
    if (double) {
      // Everyone of that kind in view.
      const kind = world.unitType[best.slot];
      if (!add) this.selected.clear();
      const frame = this.canvas.getBoundingClientRect();
      for (const unit of this.ownUnitsOnScreen()) {
        const inView = unit.x >= frame.left && unit.x <= frame.right && unit.y >= frame.top && unit.y <= frame.bottom;
        if (inView && world.unitType[unit.slot] === kind) this.selected.add(unit.id);
      }
      return;
    }
    if (add) {
      if (this.selected.has(best.id)) this.selected.delete(best.id);
      else this.selected.add(best.id);
    } else {
      this.selected.clear();
      this.selected.add(best.id);
    }
  }

  private selectInBox(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    if (!add) this.selected.clear();
    for (const unit of this.ownUnitsOnScreen()) {
      if (unit.x >= left && unit.x <= right && unit.y >= top && unit.y <= bottom) this.selected.add(unit.id);
    }
  }

  // ---- Orders ----------------------------------------------------------------

  /** Sends the selection to a place. With queue, as a waypoint after what they are already doing. */
  order(x: number, y: number, queue: boolean): void {
    this.dropTheDead();
    if (this.selected.size === 0) return;
    this.session.issue(this.player, {
      kind: 'move',
      units: [...this.selected],
      x: fromFloat(x),
      y: fromFloat(y),
      queue,
    });
    this.view.addMarker(x, y, queue);
  }

  stop(): void {
    this.dropTheDead();
    if (this.selected.size === 0) return;
    this.session.issue(this.player, { kind: 'stop', units: [...this.selected] });
  }

  private dropTheDead(): void {
    const { world } = this.session;
    for (const id of this.selected) if (!world.isAlive(id)) this.selected.delete(id);
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
    switch (key.toLowerCase()) {
      case 's':
        this.stop();
        break;
      case 'escape':
        this.selected.clear();
        this.refreshHud();
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
    this.selected.clear();
    for (const id of members) this.selected.add(id);
    if (jump) this.jumpToSelection();
    this.refreshHud();
  }

  /** Centres the view on the selection, or on all the player's units if nothing is selected. */
  jumpToSelection(): void {
    const { world } = this.session;
    this.dropTheDead();
    const ids = this.selected.size > 0 ? [...this.selected] : world.livingEntities(this.player);
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
    const before = this.selected.size;
    this.dropTheDead();
    if (this.selected.size !== before) this.refreshHud();
  }

  private refreshHud(): void {
    const { world } = this.session;
    const counts = new Map<number, number>();
    for (const id of this.selected) {
      const kind = world.unitType[entityIndex(id)]!;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const parts = [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([kind, n]) => {
        const name = UNIT_TYPES[kind]?.name ?? 'unit';
        return `${n} ${n === 1 ? name : (PLURALS[name] ?? `${name}s`)}`;
      });
    this.hud.selection.textContent = parts.length > 0 ? parts.join(' · ') : 'Nothing selected';
    this.hud.stop.disabled = this.selected.size === 0;

    this.hud.groups.replaceChildren(
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
