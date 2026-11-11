/**
 * Guards the one rule the whole multiplayer design rests on: code in src/sim
 * must give identical results on every machine. That rules out floating-point
 * arithmetic, clocks, unseeded randomness and anything locale- or
 * browser-dependent. This test reads the source and fails on any of them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIM_DIR = join(__dirname, '..', 'src', 'sim');

/** The only files where floating-point operations are allowed. */
const FLOAT_BOUNDARY = new Set(['fixed.ts', 'units.ts']);

interface Rule {
  readonly pattern: RegExp;
  readonly why: string;
  /** If true, the rule applies inside the float boundary files too. */
  readonly everywhere?: boolean;
}

const RULES: Rule[] = [
  { pattern: /\//, why: 'the / operator produces fractions; use div, idiv or mulDiv from fixed.ts' },
  {
    pattern: /\bMath\.(?!imul\b|min\b|max\b|abs\b)\w+/,
    why: 'only Math.imul, min, max and abs are safe on integers',
  },
  { pattern: /\b\d+\.\d+\b/, why: 'decimal literals are floats; build the value from integers' },
  { pattern: /\b(toFloat|fromFloat)\b/, why: 'float conversion belongs to data loading and display' },
  { pattern: /\*\*/, why: 'exponentiation can leave the exact integer range' },
  { pattern: /\bMath\.random\b/, why: 'use the world rng', everywhere: true },
  { pattern: /\b(Date|performance)\b/, why: 'the simulation must not read a clock', everywhere: true },
  { pattern: /\b(setTimeout|setInterval|requestAnimationFrame)\b/, why: 'no timers', everywhere: true },
  { pattern: /\b(window|document|navigator|globalThis)\b/, why: 'no browser access', everywhere: true },
  { pattern: /\b(localeCompare|toLocale\w*|Intl)\b/, why: 'locale-dependent', everywhere: true },
  { pattern: /\.sort\(\s*\)/, why: 'sort needs an explicit comparator', everywhere: true },
  { pattern: /\b(async|await|Promise)\b/, why: 'a tick must run start to finish', everywhere: true },
];

/** Blanks out comments and string contents so only code is checked. */
function codeOnly(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') i++;
        if (source[i] === '\n') out += '\n';
        i++;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

describe('simulation source', () => {
  const files = readdirSync(SIM_DIR).filter((f) => f.endsWith('.ts'));

  it('finds the simulation files', () => {
    expect(files).toContain('sim.ts');
    expect(files).toContain('fixed.ts');
  });

  it('strips comments and strings before checking', () => {
    expect(codeOnly('a = b; // x / y\n/* 1.5 */ c = "3.5 / 2";')).toBe('a = b; \n c = "";');
  });

  it('contains nothing that could differ between machines', () => {
    const problems: string[] = [];
    for (const file of files) {
      const lines = codeOnly(readFileSync(join(SIM_DIR, file), 'utf8')).split('\n');
      lines.forEach((line, index) => {
        for (const rule of RULES) {
          if (!rule.everywhere && FLOAT_BOUNDARY.has(file)) continue;
          if (rule.pattern.test(line)) {
            problems.push(`src/sim/${file}:${index + 1}  ${line.trim()}\n    ${rule.why}`);
          }
        }
      });
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('depends on nothing outside src/sim', () => {
    const problems: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(SIM_DIR, file), 'utf8');
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        if (!match[1]!.startsWith('./')) problems.push(`src/sim/${file} imports ${match[1]}`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
