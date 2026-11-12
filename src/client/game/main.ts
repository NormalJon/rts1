/**
 * The playtest page: a small skirmish map to try the game on.
 *
 * Two towns face each other across a river. The player leads the blue one.
 * The red one has no general until the game has an AI, so a short script
 * stands in for it here: its villagers work, a garrison guards the town, and
 * a raiding party sets out for the player's town every so often.
 */

import { Kind, RESOURCE_COUNT, RESOURCE_NAMES } from '../../sim/entityTypes';
import { hashHex, hashWorld } from '../../sim/hash';
import { Terrain } from '../../sim/map';
import { defaultConfig, OrderKind } from '../../sim/world';
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
      start: 'standard',
      maxEntities: 2048,
    }),
  );
  const { world } = session;
  const [home, enemy] = world.map.starts;
  if (!home || !enemy) throw new Error('the map has no start positions');
  // Three spearmen beside the player's town to begin with; the rest must be
  // trained. Red gets a garrison of five, who never leave home.
  const tile = 1 << 16;
  session.issue(0, { kind: 'spawn', x: home.x - 6 * tile, y: home.y + 2 * tile, count: 3, unitType: Kind.Spearman });
  session.issue(1, { kind: 'spawn', x: enemy.x + 6 * tile, y: enemy.y - 2 * tile, count: 3, unitType: Kind.Spearman });
  session.issue(1, { kind: 'spawn', x: enemy.x - 6 * tile, y: enemy.y - 3 * tile, count: 2, unitType: Kind.Archer });
  // Let everyone find their feet before the curtain goes up.
  for (let i = 0; i < 60; i++) session.step();
  // There is no AI yet, so the red villagers are simply set to work near home:
  // two to the berries, two to the trees, one each to gold and stone.
  const redVillagers = world.livingUnits(1).filter((id) => world.entityType[id & 0xfffff] === Kind.Villager);
  [Terrain.Berries, Terrain.Berries, Terrain.Forest, Terrain.Forest, Terrain.Gold, Terrain.Stone].forEach((terrain, i) => {
    const near = world.map.nearestTile(enemy.x >> 16, enemy.y >> 16, 16, (t) => world.map.terrain[t] === terrain);
    if (near !== -1 && redVillagers[i] !== undefined) {
      session.issue(1, { kind: 'gather', units: [redVillagers[i]], tile: near });
    }
  });
  for (let i = 0; i < 30; i++) session.step();

  // The stand-in for a red general. Everything it does goes through the same
  // commands a player's clicks do, so a replay of the match still plays back.
  const townCentreOf = (player: number): number =>
    world.livingEntities(player).find((id) => world.entityType[id & 0xfffff] === Kind.TownCentre) ?? -1;
  const blueTown = townCentreOf(0);
  const redTown = townCentreOf(1);
  const isSoldier = (id: number): boolean => world.entityType[id & 0xfffff] !== Kind.Villager;
  const garrison = new Set(world.livingUnits(1).filter(isSoldier));
  const RAID_FIRST = 180 * world.config.tickRate;
  const RAID_EVERY = 90 * world.config.tickRate;
  let raids = 0;
  let nextRaid = RAID_FIRST;
  let musterAt = -1;
  const redGeneral = (): void => {
    if (!world.isAlive(redTown)) return;
    if (world.tick >= nextRaid) {
      // Half spears, a third bows, the rest on horseback; one more each time, up to fourteen.
      const size = Math.min(3 + raids, 14);
      const spears = Math.ceil(size / 2);
      const bows = Math.floor(size / 3);
      const towardMiddle = enemy.x > home.x ? -1 : 1;
      const muster = { x: enemy.x + towardMiddle * 8 * tile, y: enemy.y + towardMiddle * 4 * tile };
      session.issue(1, { kind: 'spawn', ...muster, count: spears, unitType: Kind.Spearman });
      session.issue(1, { kind: 'spawn', ...muster, count: bows, unitType: Kind.Archer });
      session.issue(1, { kind: 'spawn', ...muster, count: size - spears - bows, unitType: Kind.Horseman });
      raids++;
      nextRaid += RAID_EVERY;
      musterAt = world.tick + 10;
    }
    if (world.tick === musterAt) {
      // Every red soldier who is not garrison and has nothing to do marches on the player's town.
      const party = world.livingUnits(1).filter((id) => {
        const slot = id & 0xfffff;
        return isSoldier(id) && !garrison.has(id) && world.orderKind[slot] === OrderKind.None && world.engaged[slot] === 0;
      });
      if (party.length > 0) session.issue(1, { kind: 'attackMove', units: party, x: home.x, y: home.y });
    }
  };

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
    /** Runs the match forward a number of ticks at once. */
    advance: (ticks: number): void => {
      for (let i = 0; i < ticks; i++) {
        view.rememberPositions();
        redGeneral();
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
      redGeneral();
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
        `tick ${world.tick} · ${(ticks / seconds).toFixed(0)} ticks/s · ` +
        `${ticks > 0 ? (simMs / ticks).toFixed(2) : '0.00'} ms/tick · ${(frames / seconds).toFixed(0)} fps · ` +
        `${world.livingUnits().length} units · ${hashHex(hashWorld(world))}`;
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
