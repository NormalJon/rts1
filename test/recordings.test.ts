import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashHex, hashWorld } from '../src/sim/hash';
import { runReplay } from '../src/sim/replay';
import { checksumAfter, formatRecording, MATCHES, record, REFERENCE_TICKS, type Recording } from './recordings';

/**
 * The files in recordings/ are what the C# port is checked against. These
 * tests look at the two short reference matches; `npm run check:recordings`
 * plays all of them again, which takes longer.
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'recordings');
const load = (name: string): Recording => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as Recording;

describe('recorded matches', () => {
  it('has a file for every match, and no others', () => {
    expect(existsSync(dir), 'recordings/ is missing: run `npm run record`').toBe(true);
    const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
    expect(files).toEqual([...MATCHES.map((spec) => `${spec.name}.json`), 'figures.json'].sort());
  });

  it('holds the reference match, ending on the reference checksum', () => {
    const recording = load('reference');
    expect(recording.ticks).toBe(REFERENCE_TICKS);
    // Keep in step with test/determinism.test.ts. If this fails after a
    // deliberate change to how matches play out, run `npm run record`.
    expect(checksumAfter(recording, REFERENCE_TICKS - 1)).toBe('8faaf6a6');
  });

  it('is what the game plays today, for the two reference matches', () => {
    for (const name of ['reference', 'reference-starved']) {
      const spec = MATCHES.find((match) => match.name === name)!;
      const onDisk = readFileSync(join(dir, `${name}.json`), 'utf8').replaceAll('\r\n', '\n');
      expect(formatRecording(record(spec)) === onDisk, `recordings/${name}.json is out of date: run \`npm run record\``).toBe(true);
    }
  });

  it('replays from the file to the same checksum on every tick', () => {
    const recording = load('reference');
    let tick = 0;
    let firstWrong = -1;
    runReplay({ version: 1, config: recording.config, ticks: recording.ticks, commands: recording.commands }, (world) => {
      if (firstWrong === -1 && hashHex(hashWorld(world)) !== checksumAfter(recording, tick)) firstWrong = tick;
      tick++;
    });
    expect(tick).toBe(recording.ticks);
    expect(firstWrong).toBe(-1);
  });
});
