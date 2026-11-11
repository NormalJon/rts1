// Renders sample-sheet.html in headless Chromium and saves screenshots for review.
// The page is wrapped the way the publisher wraps it; CDN scripts are served from node_modules.
//   node scripts/screenshot.mjs                    everything
//   node scripts/screenshot.mjs scene              one section: pages, closeups, icons, scene, village
//   node scripts/screenshot.mjs view <id> <yaw> <pitch> [name]    one card from one angle
//   node scripts/screenshot.mjs review [id ...]    each building on its plot from four sides
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { mulberry32 } from '../src/math.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'screenshots');
mkdirSync(shots, { recursive: true });

const only = process.argv.slice(2); // optional list of shot names to limit the run
const want = (name) => only.length === 0 || only.includes(name);

const content = readFileSync(join(root, 'sample-sheet.html'), 'utf8');
const wrapped = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>${content}</body></html>`;
const previewPath = join(shots, '_preview.html');
writeFileSync(previewPath, wrapped);

const local = {
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js': join(root, 'node_modules/three/build/three.min.js'),
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js': join(root, 'node_modules/three/examples/js/loaders/GLTFLoader.js'),
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function open({ width, height = 900, scheme = 'light', scale = 2 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  console error:', m.text()); });
  page.on('pageerror', (e) => console.log('  page error:', e.message));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (local[url]) return route.fulfill({ path: local[url], contentType: 'application/javascript' });
    if (url.startsWith('file:')) return route.continue();
    return route.abort(); // fonts: fall back to the declared stack when offline
  });
  await page.goto(pathToFileURL(previewPath).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('html[data-models-ready]', { timeout: 30000 });
  // Freeze animation so stills are repeatable, then let every viewer draw.
  await page.evaluate(() => {
    for (const id of ['spearman', 'villager']) window.__sheet.pose(id, '', 0);
  });
  await settle(page);
  return { ctx, page };
}

async function settle(page) {
  // Scroll through the page so off-screen viewers become visible and draw once.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
}

async function cardShot(page, id, name) {
  const card = page.locator(`figure.card:has(canvas[data-model="${id}"])`);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await card.locator('.stage').screenshot({ path: join(shots, `${name}.png`) });
  console.log(`  ${name}.png`);
}

// ---- Scenes: models set out on grass and lit as in the game -----------------------

/**
 * A page that sets `items` out on the game's grass, with tile lines every 2 m.
 *   items     [{ id, x, z, rot?, scale?, team? }]
 *   outlines  [{ x, z, half, color? }] squares drawn on the ground, such as a building plot
 * It exposes window.__scene, a promise of render(views). A view is { x, z, distance } with
 * optional pitch, yaw, fov and rect ([left, top, width, height] as shares of the canvas, for
 * several views in one picture). The default is the game camera: 0.96 rad above the horizon,
 * a 30 degree lens, looking from +Z.
 */
function scenePage(items, outlines = []) {
  const glb = {};
  for (const { id } of items) glb[id] ??= readFileSync(join(root, 'models', `${id}.glb`)).toString('base64');
  return `<!doctype html><html><body style="margin:0;overflow:hidden"><canvas id="c"></canvas>
${Object.keys(local).map((src) => `<script src="${src}"></script>`).join('\n')}
<script>
window.__scene = (async function () {
  var ITEMS = ${JSON.stringify(items)}, OUTLINES = ${JSON.stringify(outlines)}, GLB = ${JSON.stringify(glb)};
  var renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  function linear(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  var scene = new THREE.Scene();
  scene.background = new THREE.Color('#7f9b58'); // the game's grass; a clear colour is not converted, so no linear()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7163, 0.72));
  var sun = new THREE.DirectionalLight(0xfff1dc, 0.95);
  sun.position.set(-40, 80, 52);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  var sc = sun.shadow.camera;
  sc.left = sc.bottom = -34; sc.right = sc.top = 34; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  var grass = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.26 }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);
  // Tile lines every 2 m; tile centres fall on even coordinates.
  var pts = [];
  for (var i = -15; i <= 15; i++) pts.push(new THREE.Vector3(i * 2 - 1, 0.02, -31), new THREE.Vector3(i * 2 - 1, 0.02, 29), new THREE.Vector3(-31, 0.02, i * 2 - 1), new THREE.Vector3(29, 0.02, i * 2 - 1));
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x24301a, transparent: true, opacity: 0.16 })));
  OUTLINES.forEach(function (o) {
    var h = o.half, y = 0.025;
    var square = [[-h, -h], [h, -h], [h, h], [-h, h]].map(function (c) { return new THREE.Vector3(o.x + c[0], y, o.z + c[1]); });
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(square), new THREE.LineBasicMaterial({ color: o.color || '#24301a', transparent: true, opacity: o.opacity || 0.55 })));
  });
  var loader = new THREE.GLTFLoader();
  function parse(id) {
    return new Promise(function (resolve, reject) {
      var bin = atob(GLB[id]), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      loader.parse(bytes.buffer, '', resolve, reject);
    });
  }
  for (var k = 0; k < ITEMS.length; k++) {
    var it = ITEMS[k], model = (await parse(it.id)).scene;
    model.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      if (o.material.name === 'TeamColor') o.material.color.copy(linear(it.team || '#2c5aa8'));
    });
    model.position.set(it.x, 0, it.z);
    model.rotation.y = it.rot || 0;
    model.scale.setScalar(it.scale || 1);
    scene.add(model);
  }
  var camera = new THREE.PerspectiveCamera(30, 1, 2, 2500);
  return function (views) {
    var W = window.innerWidth, H = window.innerHeight;
    renderer.setScissorTest(true);
    views.forEach(function (v) {
      var r = v.rect || [0, 0, 1, 1], w = r[2] * W, h = r[3] * H;
      var pitch = v.pitch == null ? 0.96 : v.pitch, yaw = v.yaw || 0;
      camera.fov = v.fov || 30;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      camera.position.set(v.x + Math.sin(yaw) * Math.cos(pitch) * v.distance, Math.sin(pitch) * v.distance, v.z + Math.cos(yaw) * Math.cos(pitch) * v.distance);
      camera.lookAt(v.x, v.y || 0, v.z);
      // WebGL measures a viewport from the bottom left.
      renderer.setViewport(r[0] * W, (1 - r[1] - r[3]) * H, w, h);
      renderer.setScissor(r[0] * W, (1 - r[1] - r[3]) * H, w, h);
      renderer.render(scene, camera);
    });
  };
})();
</script></body></html>`;
}

/** Open a scene page; the returned shot(name, views) renders the views and saves the picture. */
async function openScene(items, outlines, viewport = { width: 1600, height: 1000 }) {
  const scenePath = join(shots, '_scene.html');
  writeFileSync(scenePath, scenePage(items, outlines));
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  console error:', m.text()); });
  page.on('pageerror', (e) => console.log('  page error:', e.message));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (local[url]) return route.fulfill({ path: local[url], contentType: 'application/javascript' });
    return url.startsWith('file:') ? route.continue() : route.abort();
  });
  await page.goto(pathToFileURL(scenePath).href);
  return {
    async shot(name, views) {
      await page.evaluate(async (v) => (await window.__scene)(v), views);
      await page.screenshot({ path: join(shots, `${name}.png`) });
      console.log(`  ${name}.png`);
    },
    async close() {
      await ctx.close();
      rmSync(scenePath, { force: true });
    },
  };
}

// How far a vertex may be from the middle of a plot of that many tiles: see src/build.mjs.
const PLOT_LIMIT = { 3: 2.85, 5: 4.7 };
const manifest = JSON.parse(readFileSync(join(root, 'models', 'manifest.json'), 'utf8'));
const plotOf = Object.fromEntries(manifest.filter((m) => m.plot).map((m) => [m.id, m.plot]));
/** The plot of a building at x, z as two squares: the tiles it takes, and the limit inside them. */
const plotOutlines = (id, x = 0, z = 0) => [
  { x, z, half: plotOf[id], color: '#1d2616', opacity: 0.7 },
  { x, z, half: PLOT_LIMIT[plotOf[id]], color: '#f4f0df', opacity: 0.6 },
];

// `review <id> ...`: each building alone on its plot, four views in one picture: the game
// camera, two lower three-quarter views, and a plan. A villager stands beside it for scale.
// The dark square is the edge of the plot, the pale one the limit the model must keep inside.
async function reviews(ids) {
  for (const id of ids) {
    if (!plotOf[id]) throw new Error(`${id} has no plot in models/manifest.json`);
    const half = plotOf[id], d = half * 5.6;
    const scene = await openScene([{ id, x: 0, z: 0 }, { id: 'villager', x: half + 1, z: half - 1, rot: -0.6 }], plotOutlines(id), { width: 1800, height: 1300 });
    await scene.shot(`review-${id}`, [
      { x: 0, z: 0.2, y: 0.8, distance: d * 1.06, rect: [0, 0, 0.5, 0.5] },
      { x: 0, z: 0, y: 1, distance: d, yaw: 0.65, pitch: 0.5, rect: [0.5, 0, 0.5, 0.5] },
      { x: 0, z: 0, y: 1, distance: d, yaw: -0.75, pitch: 0.3, rect: [0, 0.5, 0.5, 0.5] },
      { x: 0, z: 0, distance: d * 1.05, pitch: 1.565, rect: [0.5, 0.5, 0.5, 0.5] },
    ]);
    await scene.close();
  }
}
if (only[0] === 'review') {
  await reviews(only.length > 1 ? only.slice(1) : Object.keys(plotOf));
  await browser.close();
  rmSync(previewPath, { force: true });
  process.exit(0);
}

if (only[0] === 'view') {
  const [, id, yaw, pitch, name = `view-${id}`] = only;
  const { ctx, page } = await open({ width: 1500, height: 1000 });
  await page.evaluate(([i, y, p]) => window.__sheet.view(i, +y, +p), [id, yaw, pitch]);
  await cardShot(page, id, name);
  await ctx.close();
  await browser.close();
  rmSync(previewPath, { force: true });
  process.exit(0);
}

// Whole page, light and dark, plus phone width.
for (const [name, opts] of [
  ['page-light', { width: 1200 }],
  ['page-dark', { width: 1200, scheme: 'dark' }],
  ['page-phone', { width: 400, height: 800 }],
]) {
  if (!want(name) && !want('pages')) continue;
  const { ctx, page } = await open(opts);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  // Software GL caps a capture at 8192 device px, so tall pages are saved in parts.
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const part = 3600;
  const parts = Math.ceil(total / part);
  for (let i = 0; i < parts; i++) {
    const file = parts === 1 ? `${name}.png` : `${name}-${i + 1}.png`;
    await page.screenshot({
      path: join(shots, file),
      fullPage: true,
      clip: { x: 0, y: i * part, width: opts.width, height: Math.min(part, total - i * part) },
    });
    console.log(`  ${file}`);
  }
  console.log(`  ${name}: horizontal overflow ${overflow}px, height ${total}px`);
  await ctx.close();
}

// Close-ups: a wide viewport makes each card large.
if (only.length === 0 || only.some((n) => n.startsWith('model') || n === 'closeups')) {
  const { ctx, page } = await open({ width: 1500, height: 1000 });
  const ids = await page.evaluate(() => [...document.querySelectorAll('canvas[data-model]')].map((c) => c.dataset.model));
  for (const id of ids) await cardShot(page, id, `model-${id}`);

  // The RTS view: the same models from a high camera.
  for (const id of ids) await page.evaluate((i) => window.__sheet.view(i, 0.6, 0.95), id);
  await settle(page);
  for (const id of ['house', 'hall', 'barracks', 'lumber-camp', 'mill', 'mining-camp', 'keep', 'spearman', 'trebuchet', 'berry-bush', 'stone-deposit', 'gold-deposit']) {
    await cardShot(page, id, `model-${id}-high`);
  }
  // Buildings square on from the front, which is how the game camera meets an unturned building.
  for (const id of Object.keys(plotOf)) {
    await page.evaluate((i) => window.__sheet.view(i, 0, 0.96), id);
    await cardShot(page, id, `model-${id}-front-high`);
  }
  for (const id of ids) await page.evaluate((i) => window.__sheet.view(i, 0.55, 0.42), id);

  // Animation stills.
  const poses = [
    ['spearman', 'walk', 0.22], ['spearman', 'walk', 0.62], ['spearman', 'attack', 0.4], ['spearman', 'attack', 0.52],
    ['villager', 'walk', 0.22], ['villager', 'chop', 0.36], ['villager', 'chop', 0.56],
  ];
  for (const [id, clip, t] of poses) {
    await page.evaluate(([i, c, time]) => window.__sheet.pose(i, c, time), [id, clip, t]);
    await cardShot(page, id, `model-${id}-${clip}-${String(t).replace('.', '_')}`);
  }
  await ctx.close();
}

// Icons at true size and enlarged.
if (want('icons') || only.length === 0) {
  const { ctx, page } = await open({ width: 1200 });
  const panel = page.locator('.icon-panel');
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: join(shots, 'icons.png') });
  console.log('  icons.png');
  await ctx.close();
}

// Map objects as the game lays them out: on grass, from the game camera, the deposits and
// bushes on neighbouring 2 m tiles, each turned in quarter steps and scaled 0.85 to 1.1, with
// the hall on its 5 x 5 tile plot.
if (want('scene') || only.length === 0) {
  const rng = mulberry32(7);
  const items = [{ id: 'hall', x: 0, z: 0 }];
  const tiles = (id, list) => {
    for (const [tx, tz] of list) items.push({ id, x: tx * 2, z: tz * 2, rot: (Math.floor(rng() * 4) * Math.PI) / 2, scale: 0.85 + rng() * 0.25 });
  };
  tiles('stone-deposit', [[-9, -2], [-8, -2], [-7, -2], [-9, -1], [-8, -1], [-7, -1], [-8, 0], [-8, 3]]);
  tiles('gold-deposit', [[6, -2], [7, -2], [8, -2], [7, -1], [8, -1], [7, 2]]);
  tiles('berry-bush', [[-5, 5], [-4, 5], [-3, 5], [-5, 6], [-4, 6], [4, 5]]);
  items.push({ id: 'oak', x: 12, z: -10 }, { id: 'conifer', x: -13, z: -9 }, { id: 'conifer', x: 15, z: 9 });
  for (const [x, z, rot] of [[-6.5, 6.5, 2], [-5.5, 12.8, 0.5], [1, 6.5, 3], [-1.2, 8, 0.4], [13, 5.2, -1]]) items.push({ id: 'villager', x, z, rot });
  items.push({ id: 'spearman', x: 2.6, z: 7.2, rot: 0.3 }, { id: 'spearman', x: 9, z: 9, rot: -2, team: '#b3312c' });
  const scene = await openScene(items);
  // 47 m is a middling zoom; 190 m is as far out as the game camera goes.
  for (const [name, distance] of [['scene-game-view', 47], ['scene-game-view-far', 190]]) await scene.shot(name, [{ x: -1, z: 2.5, distance }]);
  await scene.close();
}

// A first-age village from the game camera: every building unturned on its own plot of 2 m
// tiles, which is outlined, with villagers and spearmen among them for scale.
if (want('scene') || want('village') || only.length === 0) {
  const buildings = [
    { id: 'barracks', x: -12, z: -6 }, { id: 'hall', x: 0, z: -6 }, { id: 'mill', x: 10, z: -4 },
    { id: 'house', x: -10, z: 4 }, { id: 'lumber-camp', x: -2, z: 4 }, { id: 'mining-camp', x: 6, z: 4 }, { id: 'house', x: 14, z: 4, team: '#b3312c' },
  ];
  const items = [...buildings];
  for (const [x, z, rot] of [[-6.2, 0.2, 1.2], [1.6, 0.1, -0.4], [2.2, 8.6, 2.6], [-5.8, 8.2, 0.5], [10.2, 0.6, 0.3], [9.4, 9.2, -2.2]]) items.push({ id: 'villager', x, z, rot });
  items.push({ id: 'spearman', x: -15.6, z: 0.5, rot: 0.2 }, { id: 'spearman', x: -14.2, z: 0.2, rot: -0.3 });
  items.push({ id: 'conifer', x: -17, z: 9 }, { id: 'oak', x: 17.5, z: -9.5 });
  const scene = await openScene(items, buildings.map(({ id, x, z }) => plotOutlines(id, x, z)[0]));
  await scene.shot('scene-village', [{ x: 0.5, z: -0.6, distance: 46 }]);
  await scene.shot('scene-village-far', [{ x: 0.5, z: -0.6, distance: 110 }]);
  await scene.close();
}

if (only.length === 0) await reviews(Object.keys(plotOf));

await browser.close();
rmSync(previewPath, { force: true });
