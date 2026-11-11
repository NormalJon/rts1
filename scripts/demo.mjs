// Builds the Tick Rate Lab debug page.
//
//   node scripts/demo.mjs           writes dist/tick-rate-lab.html (page content
//                                   with the script inlined) and dist/index.html
//                                   (the same, wrapped as a full document)
//   node scripts/demo.mjs --serve   also serves it on http://localhost:5173,
//                                   rebuilding on every page load

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;

async function buildPage() {
  const result = await build({
    entryPoints: [join(root, 'src/client/main.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    write: false,
  });
  const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const template = await readFile(join(root, 'src/client/demo.html'), 'utf8');
  const content = template.replace('<!-- SCRIPT -->', () => `<script>\n${script}</script>`);
  const document =
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n' +
    content +
    '\n</body>\n</html>\n';
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/tick-rate-lab.html'), content);
  await writeFile(join(root, 'dist/index.html'), document);
  return document;
}

if (process.argv.includes('--serve')) {
  createServer(async (request, response) => {
    if (request.url !== '/' && request.url !== '/index.html') {
      response.writeHead(404).end();
      return;
    }
    try {
      const page = await buildPage();
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
    }
  }).listen(PORT, () => console.log(`Tick Rate Lab: http://localhost:${PORT}`));
} else {
  await buildPage();
  console.log('Wrote dist/tick-rate-lab.html and dist/index.html');
}
