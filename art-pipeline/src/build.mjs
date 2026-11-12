// Regenerates every output: models/*.glb, models/manifest.json and sample-sheet.html.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { writeGLB } from './glb.mjs';
import { identity, mul, T, qMatrix, transformPoint } from './math.mjs';
import { build as house } from './models/house.mjs';
import { build as hall } from './models/hall.mjs';
import { build as barracks } from './models/barracks.mjs';
import { build as archeryRange } from './models/archery-range.mjs';
import { build as stable } from './models/stable.mjs';
import { build as lumberCamp } from './models/lumber-camp.mjs';
import { build as mill } from './models/mill.mjs';
import { build as miningCamp } from './models/mining-camp.mjs';
import { build as keep } from './models/keep.mjs';
import { buildWall, buildGate } from './models/palisade.mjs';
import { build as watchtower } from './models/watchtower.mjs';
import { buildOak, buildConifer } from './models/trees.mjs';
import { build as trebuchet } from './models/trebuchet.mjs';
import { build as spearman } from './models/spearman.mjs';
import { build as villager } from './models/villager.mjs';
import { build as archer } from './models/archer.mjs';
import { build as horseman } from './models/horseman.mjs';
import { build as berryBush } from './models/bush.mjs';
import { buildStone, buildGold } from './models/deposits.mjs';

const require = createRequire(import.meta.url);
const validator = require('gltf-validator');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'models');
mkdirSync(out, { recursive: true });

const GROUPS = [
  { key: 'units', title: 'Units', blurb: 'Rigid parts on a joint hierarchy, animated by rotating the joints. Nothing bends: there is no skinning.', builders: [spearman, archer, horseman, villager] },
  { key: 'buildings', title: 'Buildings and siege', blurb: 'Hard-surface work is where generated geometry holds up best.', builders: [house, hall, barracks, archeryRange, stable, lumberCamp, mill, miningCamp, keep, watchtower, buildGate, buildWall, trebuchet] },
  { key: 'nature', title: 'Trees', blurb: 'Neutral map objects, so they carry no team colour.', builders: [buildOak, buildConifer] },
  { key: 'resources', title: 'Resources', blurb: 'What villagers gather. Each fits one 2 m tile and carries no team colour.', builders: [berryBush, buildStone, buildGold] },
];

// A building stands on a square plot of 2 m tiles, and the whole model has to stay inside it
// with a little margin: this is how far a vertex may be from the origin in x or z.
const PLOT_LIMIT = { 3: 2.85, 5: 4.7 };

/** Bounding box over every vertex in model space, the nodes in their rest pose. */
function bounds(roots) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const visit = (node, parent) => {
    let M = parent;
    if (node.translation) M = mul(M, T(...node.translation));
    if (node.rotation) M = mul(M, qMatrix(node.rotation));
    for (const { positions } of node.mesh?.primitives ?? []) {
      for (let i = 0; i < positions.length; i += 3) {
        const p = transformPoint(M, [positions[i], positions[i + 1], positions[i + 2]]);
        for (let k = 0; k < 3; k++) {
          if (p[k] < min[k]) min[k] = p[k];
          if (p[k] > max[k]) max[k] = p[k];
        }
      }
    }
    for (const child of node.children ?? []) visit(child, M);
  };
  for (const node of roots) visit(node, identity());
  const round = (v) => v.map((n) => Math.round(n * 1000) / 1000);
  return { min: round(min), max: round(max) };
}

/** A clip's length in seconds and, where it strikes, the moment the blow lands or the arrow leaves. */
function timing(animation) {
  const duration = Math.max(...animation.channels.map((ch) => ch.times[ch.times.length - 1]));
  return { duration: +duration.toFixed(4), ...(animation.hit === undefined ? {} : { hit: animation.hit }) };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => n.toLocaleString('en-US');

const manifest = [];
const glbData = {};
let problems = 0;

for (const group of GROUPS) {
  for (const builder of group.builders) {
    const model = builder();
    const { glb, triangles } = writeGLB({ name: model.id, roots: model.roots, animations: model.animations });
    writeFileSync(join(out, `${model.id}.glb`), glb);
    const report = await validator.validateBytes(new Uint8Array(glb));
    const { numErrors, numWarnings, numInfos, numHints, messages } = report.issues;
    if (numErrors || numWarnings) {
      problems++;
      console.error(`${model.id}: ${numErrors} errors, ${numWarnings} warnings`);
      for (const msg of messages.slice(0, 8)) console.error(`  [${msg.severity}] ${msg.code} ${msg.pointer ?? ''} ${msg.message}`);
    }
    const box = bounds(model.roots);
    if (model.plot) {
      const limit = PLOT_LIMIT[model.plot];
      if (!limit) throw new Error(`${model.id}: no size limit known for a ${model.plot} tile plot`);
      const reach = Math.max(-box.min[0], box.max[0], -box.min[2], box.max[2]);
      if (reach > limit) {
        problems++;
        console.error(`${model.id}: reaches ${reach.toFixed(3)} m from the origin, over the ${limit} m limit of a ${model.plot} x ${model.plot} tile plot`);
      }
    }
    const entry = {
      id: model.id,
      group: group.key,
      label: model.label,
      note: model.note,
      file: `models/${model.id}.glb`,
      triangles,
      bytes: glb.length,
      bounds: box,
      ...(model.plot ? { plot: model.plot } : {}),
      yaw: model.yaw ?? 0.6,
      clips: (model.animations ?? []).map((a) => a.name),
      ...(model.animations?.length ? { timing: Object.fromEntries(model.animations.map((a) => [a.name, timing(a)])) } : {}),
      validator: { errors: numErrors, warnings: numWarnings, infos: numInfos, hints: numHints },
    };
    manifest.push(entry);
    glbData[model.id] = glb.toString('base64');
    console.log(`${model.id.padEnd(13)} ${String(triangles).padStart(5)} tris  ${(glb.length / 1024).toFixed(1).padStart(6)} KB  validator: ${numErrors}E ${numWarnings}W ${numInfos}I ${numHints}H`);
  }
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log('\nPlots (2 m tiles): bounding box over all vertices, x y z in metres');
for (const m of manifest.filter((e) => e.plot)) {
  const f = (v) => v.map((n) => n.toFixed(2).padStart(6)).join(' ');
  console.log(`${m.id.padEnd(13)} ${m.plot} x ${m.plot}, limit ${PLOT_LIMIT[m.plot].toFixed(2)}  min ${f(m.bounds.min)}  max ${f(m.bounds.max)}`);
}

// ---- Sample sheet ----------------------------------------------------------------

const ICONS = [
  ['Resources', [['food', 'Food'], ['wood', 'Wood'], ['stone', 'Stone'], ['gold', 'Gold']]],
  ['Commands', [['move', 'Move'], ['attack-move', 'Attack-move'], ['stop', 'Stop'], ['patrol', 'Patrol'], ['build', 'Build']]],
  ['Unit classes', [['spear', 'Spear infantry'], ['archer', 'Archer'], ['cavalry', 'Cavalry'], ['siege', 'Siege']]],
];
const iconFiles = new Set(readdirSync(join(root, 'icons')).filter((f) => f.endsWith('.svg')));
const iconSvg = (id) => {
  if (!iconFiles.has(`${id}.svg`)) throw new Error(`missing icon ${id}.svg`);
  return readFileSync(join(root, 'icons', `${id}.svg`), 'utf8').trim().replace('<svg ', '<svg aria-hidden="true" ');
};

const card = (m) => `
      <figure class="card${m.clips.length ? ' card--unit' : ''}">
        <div class="stage">
          <canvas data-model="${m.id}" tabindex="0" role="img" aria-label="${esc(m.label)}, 3D model. Drag or use the arrow keys to turn it."></canvas>
        </div>
        <figcaption>
          <h3>${esc(m.label)}</h3>
          <p class="note">${esc(m.note)}</p>
          ${m.clips.length ? `<div class="clips" role="group" aria-label="${esc(m.label)} animation">
            ${m.clips.map((c) => `<button type="button" class="clip" id="clip-${m.id}-${c}" data-model="${m.id}" data-clip="${c}" aria-pressed="false">${c}</button>`).join('')}
            <button type="button" class="clip clip--rest" id="clip-${m.id}-rest" data-model="${m.id}" data-clip="" aria-pressed="false">rest pose</button>
          </div>` : ''}
          <p class="stats"><span>${fmt(m.triangles)} triangles</span><span>${(m.bytes / 1024).toFixed(0)} KB</span><span>${esc(m.id)}.glb</span></p>
        </figcaption>
      </figure>`;

const modelSections = GROUPS.map((g) => `
  <section class="group" aria-labelledby="h-${g.key}">
    <div class="group-head">
      <h2 id="h-${g.key}">${esc(g.title)}</h2>
      <p>${esc(g.blurb)}</p>
    </div>
    <div class="grid grid--${g.key}">${manifest.filter((m) => m.group === g.key).map(card).join('')}
    </div>
  </section>`).join('\n');

const iconSections = ICONS.map(([title, list]) => `
      <div class="icon-row">
        <h3>${esc(title)}</h3>
        <ul class="icons">${list.map(([id, label]) => `
          <li>
            <span class="icon-lg">${iconSvg(id)}</span>
            <span class="icon-btn" title="32 px, as a command button">${iconSvg(id)}</span>
            <span class="icon-name">${esc(label)}</span>
            <span class="icon-file">${id}.svg</span>
          </li>`).join('')}
        </ul>
      </div>`).join('\n');

const totalTris = manifest.reduce((s, m) => s + m.triangles, 0);
const iconCount = ICONS.reduce((s, [, l]) => s + l.length, 0);
const facts = `
      <div><dt>Models</dt><dd>${manifest.length}</dd></div>
      <div><dt>Triangles, all models</dt><dd>${fmt(totalTris)}</dd></div>
      <div><dt>Icons</dt><dd>${iconCount}</dd></div>
      <div><dt>Formats</dt><dd>glTF 2.0 binary, SVG</dd></div>`;

const template = readFileSync(join(root, 'src', 'sheet.template.html'), 'utf8');
const page = template
  .replace('<!--__FACTS__-->', facts)
  .replace('<!--__MODELS__-->', modelSections)
  .replace('<!--__ICONS__-->', iconSections)
  .replace('/*__MANIFEST__*/[]', JSON.stringify(manifest.map(({ id, yaw, clips, group }) => ({ id, yaw, clips, group }))))
  .replace('/*__GLB__*/{}', JSON.stringify(glbData));
writeFileSync(join(root, 'sample-sheet.html'), page);

console.log(`\n${manifest.length} models, ${fmt(totalTris)} triangles in total, ${iconCount} icons`);
console.log(`sample-sheet.html: ${(page.length / 1024).toFixed(0)} KB`);
if (problems) {
  console.error(`\n${problems} problem(s): see the validator and plot messages above`);
  process.exit(1);
}
