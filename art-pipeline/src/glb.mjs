// Minimal binary glTF 2.0 (.glb) writer: nodes, meshes, two materials, node animations.
import { hexToLinear } from './mesh.mjs';

const FLOAT = 5126, USHORT = 5123;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

/** Default tint for TeamColor so files look right before an engine recolours them. */
export const DEFAULT_TEAM_HEX = '#2c5aa8';

/**
 * model = {
 *   name,
 *   roots: [node],            node = { name, translation?, rotation?, mesh?, children? }
 *   animations?: [{ name, channels: [{ node, path: 'rotation'|'translation', times, values }] }]
 * }
 * Returns { glb: Buffer, triangles: number }.
 */
export function writeGLB(model) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [], meshes = [], nodes = [];
  let triangles = 0;

  function addView(typed, target) {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteLength += pad;
    }
    const view = { buffer: 0, byteOffset: byteLength, byteLength: bytes.length };
    if (target) view.target = target;
    chunks.push(bytes);
    byteLength += bytes.length;
    bufferViews.push(view);
    return bufferViews.length - 1;
  }

  function addAccessor(typed, type, componentType, target, withBounds = false) {
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: addView(typed, target), componentType, count: typed.length / size, type };
    if (withBounds) {
      const min = new Array(size).fill(Infinity), max = new Array(size).fill(-Infinity);
      for (let i = 0; i < typed.length; i++) {
        const k = i % size;
        if (typed[i] < min[k]) min[k] = typed[i];
        if (typed[i] > max[k]) max[k] = typed[i];
      }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  }

  const materialIndex = { Palette: 0, TeamColor: 1 };
  const team = hexToLinear(DEFAULT_TEAM_HEX);
  const materials = [
    { name: 'Palette', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } },
    { name: 'TeamColor', pbrMetallicRoughness: { baseColorFactor: [...team, 1], metallicFactor: 0, roughnessFactor: 0.85 } },
  ];
  let usesTeam = false;

  function addMesh(mesh) {
    const primitives = mesh.primitives.map((p) => {
      triangles += p.indices.length / 3;
      if (p.material === 'TeamColor') usesTeam = true;
      const attributes = {
        POSITION: addAccessor(p.positions, 'VEC3', FLOAT, ARRAY_BUFFER, true),
        NORMAL: addAccessor(p.normals, 'VEC3', FLOAT, ARRAY_BUFFER),
      };
      if (p.colors) attributes.COLOR_0 = addAccessor(p.colors, 'VEC3', FLOAT, ARRAY_BUFFER);
      return {
        attributes,
        indices: addAccessor(p.indices, 'SCALAR', USHORT, ELEMENT_ARRAY_BUFFER),
        material: materialIndex[p.material],
        mode: 4,
      };
    });
    meshes.push({ name: mesh.name, primitives });
    return meshes.length - 1;
  }

  const nodeIndex = new Map();
  function addNode(n) {
    const out = { name: n.name };
    const index = nodes.length;
    nodes.push(out);
    nodeIndex.set(n, index);
    if (n.translation) out.translation = n.translation;
    if (n.rotation) out.rotation = n.rotation;
    if (n.mesh && n.mesh.primitives.length) out.mesh = addMesh(n.mesh);
    if (n.children?.length) out.children = n.children.map(addNode);
    return index;
  }
  const rootIndices = model.roots.map(addNode);

  const animations = (model.animations ?? []).map((anim) => {
    const samplers = [], channels = [];
    const timeAccessors = new Map();
    for (const ch of anim.channels) {
      const key = ch.times.join(',');
      if (!timeAccessors.has(key)) {
        timeAccessors.set(key, addAccessor(new Float32Array(ch.times), 'SCALAR', FLOAT, undefined, true));
      }
      const type = ch.path === 'rotation' ? 'VEC4' : 'VEC3';
      const output = addAccessor(new Float32Array(ch.values.flat()), type, FLOAT);
      samplers.push({ input: timeAccessors.get(key), output, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex.get(ch.node), path: ch.path } });
    }
    return { name: anim.name, samplers, channels };
  });

  const json = {
    asset: { version: '2.0', generator: 'medieval-rts art-pipeline' },
    scene: 0,
    scenes: [{ name: model.name, nodes: rootIndices }],
    nodes,
    meshes,
    materials: usesTeam ? materials : materials.slice(0, 1),
    accessors,
    bufferViews,
    buffers: [{ byteLength: 0 }],
  };
  if (animations.length) json.animations = animations;

  let bin = Buffer.concat(chunks);
  if (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
  json.buffers[0].byteLength = bin.length;

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);

  return { glb: Buffer.concat([header, jsonHead, jsonBuf, binHead, bin]), triangles };
}
