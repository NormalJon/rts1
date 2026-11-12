/**
 * The playtest page: a skirmish against the computer.
 *
 * Two towns face each other across a river. The player leads the blue one
 * and the skirmish AI the red, at a level the player picks.
 */

import { SkirmishAi, type Difficulty } from '../../ai/skirmish';
import { Kind, RESOURCE_COUNT, RESOURCE_NAMES } from '../../sim/entityTypes';
import { hashHex, hashWorld } from '../../sim/hash';
import { defaultConfig } from '../../sim/world';
import { LocalSession } from '../../session/localSession';
import { FixedStepper } from '../../session/stepper';
import { Controls } from './controls';
import { Minimap } from './minimap';
import { loadModels } from './models';
import { GameView } from './view';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

const LEVELS: readonly Difficulty[] = ['easy', 'standard', 'hard'];
const LEVEL_KEY = 'rts-opponent-level';

/** The opponent the player last asked for, or the gentlest if they never have. */
function chosenLevel(): Difficulty {
  try {
    const saved = localStorage.getItem(LEVEL_KEY);
    if (saved !== null && (LEVELS as readonly string[]).includes(saved)) return saved as Difficulty;
  } catch {
    // No storage here (a private window, say): the default will do.
  }
  return 'easy';
}

function fail(message: string): void {
  const note = byId('fatal');
  note.textContent = message;
  note.hidden = false;
}

async function start(): Promise<void> {
  const canvas = byId<HTMLCanvasElement>('game');
  const session = new LocalSession(
    defaultConfig({
      seed: 1066,
      playerCount: 2,
      mapWidth: 128,
      mapHeight: 128,
      map: { kind: 'generated' },
      start: 'standard',
      maxEntities: 2048,
    }),
  );
  const { world } = session;
  const [home, enemy] = world.map.starts;
  if (!home || !enemy) throw new Error('the map has no start positions');
  // The red side is led by the skirmish AI, at the level the player last chose.
  const level = chosenLevel();
  const ai = new SkirmishAi(1, level);
  session.control(1, ai);
  const townCentreOf = (player: number): number =>
    world.livingEntities(player).find((id) => world.entityType[id & 0xfffff] === Kind.TownCentre) ?? -1;
  const blueTown = townCentreOf(0);
  const redTown = townCentreOf(1);

  let view: GameView;
  try {
    view = new GameView(canvas, world, await loadModels());
  } catch (error) {
    fail(
      `The 3D view could not start (${error instanceof Error ? error.message : String(error)}). ` +
        'It needs a browser with WebGL.',
    );
    return;
  }
  view.lookAt(home.x / 65536, home.y / 65536);

  const controls = new Controls(0, session, view, canvas, byId('select-box'), {
    age: byId('age'),
    selection: byId('selection'),
    groups: byId('groups'),
    orders: byId('orders'),
    attackMove: byId<HTMLButtonElement>('btn-attack'),
    patrol: byId<HTMLButtonElement>('btn-patrol'),
    hold: byId<HTMLButtonElement>('btn-hold'),
    stop: byId<HTMLButtonElement>('btn-stop'),
    idle: byId<HTMLButtonElement>('btn-idle'),
    actions: byId('actions'),
    queue: byId('queue'),
    progress: byId('progress'),
    progressBar: byId('progress-bar'),
    population: byId('population'),
    toast: byId('toast'),
    production: byId('production'),
  });
  const minimap = new Minimap(byId<HTMLCanvasElement>('minimap'), world, view, (x, y, queue) =>
    controls.order(x, y, queue),
  );

  view.onTileChanged = (changed) => minimap.repaintTile(changed);
  controls.onAlarm = (x, y) => minimap.ping(x, y);

  // The match is decided when a town centre falls, though play carries on.
  const banner = byId('banner');
  let decided = false;
  const judge = (): void => {
    if (decided) return;
    const won = !world.isAlive(redTown);
    const lost = !world.isAlive(blueTown);
    if (!won && !lost) return;
    decided = true;
    banner.children[0]!.textContent = won ? 'Victory' : 'Defeat';
    banner.children[1]!.textContent = won ? 'The red town centre has fallen.' : 'Your town centre has fallen.';
    banner.hidden = false;
    setTimeout(() => (banner.hidden = true), 9000);
  };

  const stores = RESOURCE_NAMES.map((name) => byId(`stock-${name}`));
  const shown = new Array<number>(RESOURCE_COUNT).fill(-1);
  const showStores = (): void => {
    for (let i = 0; i < RESOURCE_COUNT; i++) {
      const amount = world.stock[i]!; // player 0's row
      if (amount !== shown[i]) {
        shown[i] = amount;
        stores[i]!.textContent = String(amount);
      }
    }
  };
  showStores();

  const help = byId('help');
  const helpButton = byId<HTMLButtonElement>('btn-help');
  const setHelp = (open: boolean): void => {
    help.hidden = !open;
    helpButton.setAttribute('aria-expanded', String(open));
  };
  // Open to begin with where there is room for it.
  setHelp(window.innerWidth >= 760);
  helpButton.addEventListener('click', () => setHelp(help.hasAttribute('hidden')));
  // Choosing another opponent starts the match afresh.
  const levelPicker = byId<HTMLSelectElement>('level');
  levelPicker.value = level;
  levelPicker.addEventListener('change', () => {
    try {
      localStorage.setItem(LEVEL_KEY, levelPicker.value);
    } catch {
      // Without storage the choice cannot outlive the page, so there is nothing to restart into.
      return;
    }
    location.reload();
  });

  // A testing aid: draw the whole map as if there were no fog. The rules do not change.
  const fogButton = byId<HTMLButtonElement>('btn-fog');
  fogButton.addEventListener('click', () => {
    view.liftFog(!view.fogLifted);
    fogButton.setAttribute('aria-pressed', String(view.fogLifted));
    canvas.focus();
  });
  byId('btn-fullscreen').addEventListener('click', () => {
    const page = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else page.requestFullscreen?.().catch(() => undefined);
    canvas.focus();
  });

  // For poking at the match from the browser console, and for automated checks.
  (window as unknown as Record<string, unknown>).__playtest = {
    session,
    view,
    controls,
    ai,
    /** Runs the match forward a number of ticks at once. */
    advance: (ticks: number): void => {
      for (let i = 0; i < ticks; i++) {
        view.rememberPositions();
        session.step();
      }
    },
  };

  const stats = byId('stats');
  const stepper = new FixedStepper(world.config.tickRate);
  let last = performance.now();
  let windowStart = last;
  let frames = 0;
  let ticks = 0;
  let simMs = 0;

  const frame = (now: number): void => {
    const elapsed = now - last;
    last = now;
    const due = stepper.advance(elapsed);
    for (let i = 0; i < due; i++) {
      view.rememberPositions();
      const before = performance.now();
      session.step();
      simMs += performance.now() - before;
      ticks++;
    }
    const dt = Math.min(0.1, elapsed / 1000);
    controls.update(dt, stepper.alpha);
    view.render(stepper.alpha, dt, controls.watched());
    minimap.draw(controls.selected);
    showStores();
    judge();

    frames++;
    if (now - windowStart >= 500) {
      const seconds = (now - windowStart) / 1000;
      stats.textContent =
        `tick ${world.tick} · ${(ticks / seconds).toFixed(0)}/s · ` +
        `${ticks > 0 ? (simMs / ticks).toFixed(2) : '0.00'} ms · ${(frames / seconds).toFixed(0)} fps · ` +
        `${hashHex(hashWorld(world))}`;
      windowStart = now;
      frames = 0;
      ticks = 0;
      simMs = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.focus();
}

start().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
