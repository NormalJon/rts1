// Plays the reference match from test/determinism.test.ts inside a real
// browser and checks that it reaches the same checksum as it does in Node.
// Run it against every browser engine available: a mismatch here means two
// players on different browsers would drift apart.
//
//   node scripts/browser-check.mjs

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = 'ab77540a'; // keep in step with test/determinism.test.ts

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { playRandomMatch } from './test/helpers';
      import { hashHex } from './src/sim/hash';
      import { defaultConfig } from './src/sim/world';
      const config = defaultConfig({ seed: 20261111, playerCount: 2, map: { kind: 'generated' }, start: 'standard' });
      const { hashes } = playRandomMatch(config, 77, 2100);
      globalThis.__referenceChecksum = hashHex(hashes[2099]);
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  target: 'es2022',
  write: false,
});
const script = outputFiles[0].text;

const results = [];

new Function(script)();
results.push([`Node ${process.version}`, globalThis.__referenceChecksum]);

const playwright = createRequire(import.meta.url)('playwright');
for (const engine of ['chromium', 'firefox', 'webkit']) {
  let browser;
  try {
    browser = await playwright[engine].launch();
  } catch {
    results.push([engine, 'not installed, skipped']);
    continue;
  }
  const page = await browser.newPage();
  await page.addScriptTag({ content: script });
  const checksum = await page.evaluate(() => globalThis.__referenceChecksum);
  results.push([`${engine} ${browser.version()}`, checksum]);
  await browser.close();
}

let failed = false;
for (const [name, checksum] of results) {
  const skipped = checksum.includes('skipped');
  const ok = skipped || checksum === EXPECTED;
  if (!ok) failed = true;
  console.log(`${ok ? (skipped ? '-' : 'ok') : 'MISMATCH'}  ${name}: ${checksum}`);
}
console.log(failed ? `Expected ${EXPECTED}` : `All engines that ran agree on ${EXPECTED}`);
process.exit(failed ? 1 : 0);
