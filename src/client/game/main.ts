/**
 * The playtest page: a small skirmish map to try the controls on.
 *
 * Two companies face each other across a river. The player commands the blue
 * one; the red one stands its ground until there is an AI to lead it.
 */

import { hashHex, hashWorld } from '../../sim/hash';
import { UnitKind } from '../../sim/unitTypes';
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
      maxEntities: 2048,
    }),
  );
  const { world } = session;
  const [home, enemy] = world.map.starts;
  if (!home || !enemy) throw new Error('the map has no start positions');
  session.issue(0, { kind: 'spawn', x: home.x, y: home.y, count: 24, unitType: UnitKind.Spearman });
  session.issue(0, { kind: 'spawn', x: home.x + (5 << 16), y: home.y - (3 << 16), count: 8, unitType: UnitKind.Villager });
  session.issue(1, { kind: 'spawn', x: enemy.x, y: enemy.y, count: 24, unitType: UnitKind.Spearman });
  // Let everyone find their feet before the curtain goes up.
  for (let i = 0; i < 90; i++) session.step();

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
    selection: byId('selection'),
    groups: byId('groups'),
    stop: byId<HTMLButtonElement>('btn-stop'),
  });
  const minimap = new Minimap(byId<HTMLCanvasElement>('minimap'), world, view, (x, y, queue) =>
    controls.order(x, y, queue),
  );

  const help = byId('help');
  const helpButton = byId<HTMLButtonElement>('btn-help');
  const setHelp = (open: boolean): void => {
    help.hidden = !open;
    helpButton.setAttribute('aria-expanded', String(open));
  };
  // Open to begin with where there is room for it.
  setHelp(window.innerWidth >= 760);
  helpButton.addEventListener('click', () => setHelp(help.hasAttribute('hidden')));
  byId('btn-fullscreen').addEventListener('click', () => {
    const page = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else page.requestFullscreen?.().catch(() => undefined);
    canvas.focus();
  });

  // For poking at the match from the browser console, and for automated checks.
  (window as unknown as Record<string, unknown>).__playtest = { session, view, controls };

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
    view.render(stepper.alpha, dt, controls.selected);
    minimap.draw(controls.selected);

    frames++;
    if (now - windowStart >= 500) {
      const seconds = (now - windowStart) / 1000;
      stats.textContent =
        `tick ${world.tick} · ${(ticks / seconds).toFixed(0)} ticks/s · ` +
        `${ticks > 0 ? (simMs / ticks).toFixed(2) : '0.00'} ms/tick · ${(frames / seconds).toFixed(0)} fps · ` +
        `${world.livingEntities().length} units · ${hashHex(hashWorld(world))}`;
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
