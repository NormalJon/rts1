// Builds the project's pages: the Tick Rate Lab and the 3D playtest.
//
//   node scripts/pages.mjs           writes, for each page, dist/<name>.html (the
//                                    page's content with everything inlined) and
//                                    dist/<name>/index.html (the same, wrapped as
//                                    a full document)
//   node scripts/pages.mjs --serve   also serves them on http://localhost:5173,
//                                    rebuilding on every page load

import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;

// three.js is loaded by the page from a CDN and found as a global, so it is
// left out of the bundle.
const THREE_SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
];

const PAGES = {
  'tick-rate-lab': { entry: 'src/client/main.ts', template: 'src/client/demo.html' },
  playtest: {
    entry: 'src/client/game/main.ts',
    template: 'src/client/game/page.html',
    libraries: THREE_SCRIPTS,
    models: ['spearman', 'villager', 'oak', 'conifer'],
    // Used if present; the page shows plain blocks for any that are not built yet.
    optionalModels: [
      'hall', 'house', 'mill', 'lumber-camp', 'mining-camp', 'barracks',
      'berry-bush', 'stone-deposit', 'gold-deposit',
    ],
  },
};

const threeAsGlobal = {
  name: 'three-as-global',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'global' }));
    b.onLoad({ filter: /.*/, namespace: 'global' }, () => ({ contents: 'module.exports = window.THREE;' }));
  },
};

const inline = (code) => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}</script>`;

async function buildPage(name) {
  const page = PAGES[name];
  const result = await build({
    entryPoints: [join(root, page.entry)],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    write: false,
    plugins: [threeAsGlobal],
  });
  let scripts = '';
  if (page.models) {
    const models = {};
    for (const model of page.models) {
      models[model] = (await readFile(join(root, 'art-pipeline/models', `${model}.glb`))).toString('base64');
    }
    for (const model of page.optionalModels ?? []) {
      const file = join(root, 'art-pipeline/models', `${model}.glb`);
      if (existsSync(file)) models[model] = (await readFile(file)).toString('base64');
    }
    scripts += inline(`window.__MODELS = ${JSON.stringify(models)};`) + '\n';
  }
  scripts += inline(result.outputFiles[0].text);
  const libraries = (page.libraries ?? []).map((src) => `<script src="${src}"></script>`).join('\n');
  const template = await readFile(join(root, page.template), 'utf8');
  const content = template
    .replace('<!-- LIBRARIES -->', () => libraries)
    .replace('<!-- SCRIPT -->', () => scripts);
  // The same skeleton a published page is wrapped in.
  const document =
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif}' +
    'img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n' +
    content +
    '\n</body>\n</html>\n';
  await mkdir(join(root, 'dist', name), { recursive: true });
  await writeFile(join(root, 'dist', `${name}.html`), content);
  await writeFile(join(root, 'dist', name, 'index.html'), document);
  return document;
}

if (process.argv.includes('--serve')) {
  createServer(async (request, response) => {
    const name = (request.url ?? '/').replace(/^\/|\/$/g, '');
    try {
      if (name === '') {
        const links = Object.keys(PAGES).map((page) => `<li><a href="/${page}">${page}</a></li>`);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<ul>${links.join('')}</ul>`);
      } else if (name in PAGES) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await buildPage(name));
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
    }
  }).listen(PORT, () => console.log(`Pages: http://localhost:${PORT}`));
} else {
  for (const name of Object.keys(PAGES)) await buildPage(name);
  console.log(`Wrote ${Object.keys(PAGES).map((name) => `dist/${name}.html`).join(' and ')}`);
}
