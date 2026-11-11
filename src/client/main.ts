/**
 * Tick Rate Lab: a debug view of the simulation core.
 *
 * This is display code. It may use floats and the clock freely, because it
 * only reads the world and issues commands; it never changes simulation state
 * directly.
 */

import { fromInt, toFloat } from '../sim/fixed';
import { hashHex, hashWorld } from '../sim/hash';
import { runReplay } from '../sim/replay';
import { fromFloat } from '../sim/units';
import { defaultConfig, entityIndex } from '../sim/world';
import { LocalSession } from '../session/localSession';
import { FixedStepper } from '../session/stepper';

const MAP_WIDTH = 64;
const MAP_HEIGHT = 40;
const UNIT_COUNT = 36;
const UNIT_SPEED = 7; // tiles per second
const UNIT_RADIUS = 0.3; // tiles
const MARKER_MS = 700;

interface Lab {
  session: LocalSession;
  stepper: FixedStepper;
  /** Where each unit was before the latest tick, for blending. */
  prevX: Float32Array;
  prevY: Float32Array;
}

interface PendingOrder {
  readonly issuedAt: number;
  readonly tick: number;
}

interface Marker {
  readonly x: number;
  readonly y: number;
  readonly bornAt: number;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

const canvas = byId<HTMLCanvasElement>('field');
const ctx = canvas.getContext('2d')!;
const out = {
  latency: byId('out-latency'),
  tick: byId('out-tick'),
  tps: byId('out-tps'),
  fps: byId('out-fps'),
  hash: byId('out-hash'),
  rateNote: byId('rate-note'),
  delayNote: byId('delay-note'),
  smoothNote: byId('smooth-note'),
  replayNote: byId('replay-note'),
};

let tickRate = 30;
let inputDelay = 0;
let smoothing = true;
let lab = startLab(tickRate);
let pending: PendingOrder | null = null;
let markers: Marker[] = [];
let colours = readColours();

function startLab(rate: number): Lab {
  const session = new LocalSession(
    defaultConfig({
      tickRate: rate,
      seed: 1066,
      playerCount: 1,
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT,
      maxEntities: 256,
    }),
  );
  const centreX = fromInt(MAP_WIDTH / 2);
  const centreY = fromInt(MAP_HEIGHT / 2);
  session.issue(0, {
    kind: 'spawn',
    x: centreX,
    y: centreY,
    count: UNIT_COUNT,
    speed: fromInt(UNIT_SPEED),
  });
  session.step();
  // The company arrives scattered and forms up, so the page opens in motion.
  session.issue(0, {
    kind: 'move',
    units: session.world.livingEntities(0),
    x: centreX,
    y: centreY,
  });
  const next: Lab = {
    session,
    stepper: new FixedStepper(rate),
    prevX: new Float32Array(256),
    prevY: new Float32Array(256),
  };
  rememberPositions(next);
  return next;
}

function rememberPositions(target: Lab): void {
  const { world } = target.session;
  for (let slot = 0; slot < world.highWater; slot++) {
    target.prevX[slot] = toFloat(world.posX[slot]!);
    target.prevY[slot] = toFloat(world.posY[slot]!);
  }
}

function order(tileX: number, tileY: number): void {
  const { session } = lab;
  session.inputDelayTicks = inputDelay;
  const entry = session.issue(0, {
    kind: 'move',
    units: session.world.livingEntities(0),
    x: fromFloat(tileX),
    y: fromFloat(tileY),
  });
  const now = performance.now();
  pending = { issuedAt: now, tick: entry.tick };
  markers.push({ x: tileX, y: tileY, bornAt: now });
  out.replayNote.textContent = '';
}

// ---- Drawing ---------------------------------------------------------------

function readColours(): { field: string; line: string; unit: string; unitEdge: string; marker: string } {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string): string => style.getPropertyValue(name).trim();
  return {
    field: get('--field'),
    line: get('--field-line'),
    unit: get('--woad'),
    unitEdge: get('--woad-ink'),
    marker: get('--madder'),
  };
}

function fitCanvas(): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function draw(alpha: number, now: number): void {
  fitCanvas();
  const tile = canvas.width / MAP_WIDTH;
  ctx.fillStyle = colours.field;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = colours.line;
  ctx.lineWidth = Math.max(1, tile * 0.05);
  ctx.beginPath();
  for (let x = 4; x < MAP_WIDTH; x += 4) {
    ctx.moveTo(x * tile, 0);
    ctx.lineTo(x * tile, canvas.height);
  }
  for (let y = 4; y < MAP_HEIGHT; y += 4) {
    ctx.moveTo(0, y * tile);
    ctx.lineTo(canvas.width, y * tile);
  }
  ctx.stroke();

  markers = markers.filter((m) => now - m.bornAt < MARKER_MS);
  for (const m of markers) {
    const age = (now - m.bornAt) / MARKER_MS;
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = colours.marker;
    ctx.lineWidth = Math.max(1.5, tile * 0.12);
    ctx.beginPath();
    ctx.arc(m.x * tile, m.y * tile, tile * (0.5 + age * 1.2), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const { world } = lab.session;
  ctx.fillStyle = colours.unit;
  ctx.strokeStyle = colours.unitEdge;
  ctx.lineWidth = Math.max(1, tile * 0.06);
  for (const id of world.livingEntities(0)) {
    const slot = entityIndex(id);
    const x = lab.prevX[slot]! + (toFloat(world.posX[slot]!) - lab.prevX[slot]!) * alpha;
    const y = lab.prevY[slot]! + (toFloat(world.posY[slot]!) - lab.prevY[slot]!) * alpha;
    ctx.beginPath();
    ctx.arc(x * tile, y * tile, tile * UNIT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// ---- Main loop -------------------------------------------------------------

let lastFrame = performance.now();
let windowStart = lastFrame;
let framesInWindow = 0;
let ticksInWindow = 0;

function frame(now: number): void {
  const elapsed = now - lastFrame;
  lastFrame = now;

  const ticks = lab.stepper.advance(elapsed);
  for (let i = 0; i < ticks; i++) {
    rememberPositions(lab);
    lab.session.step();
    ticksInWindow++;
    if (pending && lab.session.world.tick > pending.tick) {
      const ms = Math.round(performance.now() - pending.issuedAt);
      out.latency.innerHTML = `${ms} ms <small>to take effect</small>`;
      pending = null;
    }
  }

  draw(smoothing ? lab.stepper.alpha : 1, now);

  framesInWindow++;
  if (now - windowStart >= 500) {
    const seconds = (now - windowStart) / 1000;
    out.tps.textContent = (ticksInWindow / seconds).toFixed(1);
    out.fps.textContent = (framesInWindow / seconds).toFixed(0);
    out.hash.textContent = hashHex(hashWorld(lab.session.world));
    colours = readColours();
    windowStart = now;
    framesInWindow = 0;
    ticksInWindow = 0;
  }
  out.tick.textContent = String(lab.session.world.tick);
  requestAnimationFrame(frame);
}

// ---- Controls --------------------------------------------------------------

function describeSettings(): void {
  const tickMs = 1000 / tickRate;
  out.rateNote.textContent = `One tick lasts ${tickMs.toFixed(0)} ms.`;
  out.delayNote.textContent =
    inputDelay === 0
      ? 'Orders run on the very next tick.'
      : `Orders wait ${Math.round(inputDelay * tickMs)} ms more, plus the rest of the current tick.`;
  out.smoothNote.textContent = smoothing
    ? 'Drawing blends between the last two ticks.'
    : 'Drawing shows the latest tick only.';
}

function selected(name: string): string {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
}

document.querySelectorAll<HTMLInputElement>('input[name="rate"]').forEach((input) =>
  input.addEventListener('change', () => {
    tickRate = Number(selected('rate'));
    lab = startLab(tickRate);
    pending = null;
    markers = [];
    out.latency.textContent = 'none yet';
    out.replayNote.textContent = '';
    describeSettings();
  }),
);
document.querySelectorAll<HTMLInputElement>('input[name="delay"]').forEach((input) =>
  input.addEventListener('change', () => {
    inputDelay = Number(selected('delay'));
    describeSettings();
  }),
);
document.querySelectorAll<HTMLInputElement>('input[name="smooth"]').forEach((input) =>
  input.addEventListener('change', () => {
    smoothing = selected('smooth') === 'on';
    describeSettings();
  }),
);

canvas.addEventListener('pointerdown', (event) => {
  const rect = canvas.getBoundingClientRect();
  order(
    ((event.clientX - rect.left) / rect.width) * MAP_WIDTH,
    ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT,
  );
});

byId('btn-random').addEventListener('click', () => {
  order(3 + Math.random() * (MAP_WIDTH - 6), 3 + Math.random() * (MAP_HEIGHT - 6));
});

byId('btn-replay').addEventListener('click', () => {
  const live = lab.session;
  const replay = live.replay();
  const rerun = runReplay(replay);
  const a = hashHex(hashWorld(live.world));
  const b = hashHex(hashWorld(rerun));
  out.replayNote.textContent =
    a === b
      ? `Match: ${replay.ticks} ticks and ${replay.commands.length} orders re-run to the same checksum, ${a}.`
      : `Mismatch: live ${a}, replay ${b}. The simulation is not deterministic.`;
});

// Restore whatever the radio buttons hold (a republish can preserve them).
tickRate = Number(selected('rate')) || 30;
inputDelay = Number(selected('delay')) || 0;
smoothing = selected('smooth') !== 'off';
if (tickRate !== 30) lab = startLab(tickRate);
describeSettings();
requestAnimationFrame(frame);
