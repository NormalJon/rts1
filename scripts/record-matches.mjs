// Plays the reference matches of test/recordings.ts in the TypeScript game and
// writes them into recordings/, where the C# tests read them: the settings,
// every command, and the world checksum after every tick.
//
//   node scripts/record-matches.mjs           writes recordings/*.json
//   node scripts/record-matches.mjs --check   plays everything again and compares
//                                             it with the files, changing nothing

import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'recordings');
const check = process.argv.includes('--check');

const { outputFiles } = await build({
  entryPoints: [join(root, 'test/recordings.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  write: false,
});
const recordings = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

/** The files as they should be: name and text. */
const wanted = new Map();
for (const spec of recordings.MATCHES) {
  const started = Date.now();
  const recording = recordings.record(spec);
  wanted.set(`${spec.name}.json`, recordings.formatRecording(recording));
  const last = recordings.checksumAfter(recording, recording.ticks - 1);
  console.log(
    `${spec.name}: ${recording.ticks} ticks, ${recording.commands.length} commands, ends on ${last} (${Date.now() - started} ms)`,
  );
}
wanted.set('figures.json', recordings.formatFigures(recordings.figures()));

// Line endings are not part of what is recorded.
const same = (a, b) => a.replaceAll('\r\n', '\n') === b.replaceAll('\r\n', '\n');

if (check) {
  let stale = 0;
  for (const [name, text] of wanted) {
    const path = join(outDir, name);
    const onDisk = existsSync(path) ? await readFile(path, 'utf8') : null;
    if (onDisk !== null && same(onDisk, text)) continue;
    stale++;
    console.log(`${onDisk === null ? 'MISSING' : 'DIFFERENT'}  recordings/${name}`);
  }
  const extra = existsSync(outDir) ? (await readdir(outDir)).filter((name) => name.endsWith('.json') && !wanted.has(name)) : [];
  for (const name of extra) console.log(`UNEXPECTED  recordings/${name}`);
  if (stale + extra.length > 0) {
    console.log('The recordings do not match what the game does now. If the change was intended, run: npm run record');
    process.exit(1);
  }
  console.log(`All ${wanted.size} files in recordings/ match what the game does now.`);
} else {
  await mkdir(outDir, { recursive: true });
  for (const [name, text] of wanted) await writeFile(join(outDir, name), text);
  console.log(`Wrote ${wanted.size} files to recordings/`);
}
