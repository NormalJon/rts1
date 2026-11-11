// Renders sample-sheet.html in headless Chromium and saves screenshots for review.
// The page is wrapped the way the publisher wraps it; CDN scripts are served from node_modules.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

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
  for (const id of ['house', 'keep', 'spearman', 'trebuchet']) await cardShot(page, id, `model-${id}-high`);
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

await browser.close();
rmSync(previewPath, { force: true });
