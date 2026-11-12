/**
 * Loads the game's models and prepares them for drawing in bulk.
 *
 * Units are built from rigid parts (a torso, two legs, a shield and so on)
 * moved by rotating joints. Rather than animating every soldier separately,
 * each clip is sampled once into a table of part positions, frame by frame.
 * Drawing a thousand spearmen is then one instanced draw per part, with each
 * soldier looking up his own frame.
 */

import * as THREE from 'three';
import type { GLTF, GLTFLoader as GLTFLoaderType } from 'three/examples/jsm/loaders/GLTFLoader';

declare global {
  interface Window {
    /** Model files as base64, written into the page by the build. */
    __MODELS?: Record<string, string>;
  }
}

export const BAKE_FPS = 30;

export interface ModelPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  /** Whether this part takes the player's colour. */
  readonly team: boolean;
}

export interface BakedClip {
  readonly frames: number;
  /** frames x parts x 16: each part's placement within the model, per frame. */
  readonly matrices: Float32Array;
}

export interface UnitModel {
  readonly parts: readonly ModelPart[];
  readonly clips: ReadonlyMap<string, BakedClip>;
  /** How tall it stands, in metres, spear tip and all. */
  readonly height: number;
}

export interface StaticModel {
  readonly parts: readonly (ModelPart & { readonly matrix: THREE.Matrix4 })[];
  /** How far the model reaches from its centre along the ground, in metres. */
  readonly reach: number;
  readonly height: number;
}

/** The furthest any part of a model gets from the vertical axis through its origin, measured along X or Z. */
function reachOf(parts: StaticModel['parts']): number {
  const box = new THREE.Box3();
  let reach = 0;
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    box.copy(part.geometry.boundingBox!).applyMatrix4(part.matrix);
    reach = Math.max(reach, Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
  }
  return reach;
}

function heightOf(parts: StaticModel['parts']): number {
  const box = new THREE.Box3();
  let height = 0;
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    box.copy(part.geometry.boundingBox!).applyMatrix4(part.matrix);
    height = Math.max(height, box.max.y);
  }
  return height;
}

export interface Models {
  /** By entity type, as in the simulation's ENTITY_TYPES. Buildings have no entry here. */
  readonly units: readonly (UnitModel | undefined)[];
  /** By entity type. Units have no entry here. */
  readonly buildings: readonly (StaticModel | undefined)[];
  readonly oak: StaticModel;
  readonly conifer: StaticModel;
  readonly berries: StaticModel;
  readonly stone: StaticModel;
  readonly gold: StaticModel;
}

function decode(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function parse(name: string): Promise<GLTF> {
  const data = window.__MODELS?.[name];
  if (data === undefined) return Promise.reject(new Error(`model "${name}" is missing from the page`));
  const Loader = (THREE as unknown as { GLTFLoader?: typeof GLTFLoaderType }).GLTFLoader;
  if (Loader === undefined) return Promise.reject(new Error('the model loader did not load'));
  return new Promise((resolve, reject) => new Loader().parse(decode(data), '', resolve, reject));
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
}

function partOf(mesh: THREE.Mesh): ModelPart {
  const source = mesh.material as THREE.MeshStandardMaterial;
  const team = source.name === 'TeamColor';
  const material = source.clone();
  // The team part is drawn white and tinted per soldier.
  if (team) material.color.setRGB(1, 1, 1);
  return { geometry: mesh.geometry, material, team };
}

/**
 * Loads a unit and bakes its clips. A clip the model lacks is left out, and
 * the view falls back on another; "idle" and "walk" it must have.
 */
async function loadUnit(name: string, clipNames: readonly string[]): Promise<UnitModel> {
  const gltf = await parse(name);
  const root = gltf.scene;
  const meshes = meshesOf(root);
  const mixer = new THREE.AnimationMixer(root);
  const clips = new Map<string, BakedClip>();
  for (const clipName of clipNames) {
    const clip = gltf.animations.find((c) => c.name === clipName);
    if (clip === undefined) {
      if (clipName === 'idle' || clipName === 'walk') throw new Error(`model "${name}" has no "${clipName}" clip`);
      continue;
    }
    const frames = Math.max(1, Math.round(clip.duration * BAKE_FPS));
    const matrices = new Float32Array(frames * meshes.length * 16);
    const action = mixer.clipAction(clip);
    action.play();
    for (let frame = 0; frame < frames; frame++) {
      mixer.setTime(frame / BAKE_FPS);
      root.updateMatrixWorld(true);
      meshes.forEach((mesh, part) => mesh.matrixWorld.toArray(matrices, (frame * meshes.length + part) * 16));
    }
    action.stop();
    mixer.uncacheAction(clip);
    clips.set(clipName, { frames, matrices });
  }
  // Its height standing idle, from the first frame.
  const idle = clips.get('idle')!;
  const box = new THREE.Box3();
  const pose = new THREE.Matrix4();
  let height = 0;
  meshes.forEach((mesh, part) => {
    mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox!).applyMatrix4(pose.fromArray(idle.matrices, part * 16));
    height = Math.max(height, box.max.y);
  });
  return { parts: meshes.map(partOf), clips, height };
}

/** A plain block, shown in place of a model the page was built without. */
function standIn(colour: string, width: number, height: number, team = false): StaticModel {
  const geometry = new THREE.BoxGeometry(width, height, width).translate(0, height / 2, 0);
  const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(colour) });
  const parts = [{ geometry, material, team, matrix: new THREE.Matrix4() }];
  return { parts, reach: reachOf(parts), height };
}

async function loadStatic(name: string, fallback?: () => StaticModel): Promise<StaticModel> {
  if (fallback !== undefined && window.__MODELS?.[name] === undefined) return fallback();
  const gltf = await parse(name);
  gltf.scene.updateMatrixWorld(true);
  const parts = meshesOf(gltf.scene).map((mesh) => ({ ...partOf(mesh), matrix: mesh.matrixWorld.clone() }));
  return { parts, reach: reachOf(parts), height: heightOf(parts) };
}

export async function loadModels(): Promise<Models> {
  const has = (name: string): boolean => window.__MODELS?.[name] !== undefined;
  const [spearman, villager, hall, house, mill, lumberCamp, miningCamp, barracks, oak, conifer, berries, stone, gold] =
    await Promise.all([
      loadUnit('spearman', ['idle', 'walk', 'attack']),
      loadUnit('villager', ['idle', 'walk', 'chop']),
      loadStatic('hall', () => standIn('#8a6a45', 9, 4, true)),
      loadStatic('house', () => standIn('#b89b6a', 5, 3, true)),
      loadStatic('mill', () => standIn('#c9b458', 5, 3.4, true)),
      loadStatic('lumber-camp', () => standIn('#7a5a3a', 5, 2.4, true)),
      loadStatic('mining-camp', () => standIn('#8f8f96', 5, 2.4, true)),
      loadStatic('barracks', () => standIn('#7d4a3a', 9, 3.6, true)),
      loadStatic('oak'),
      loadStatic('conifer'),
      loadStatic('berry-bush', () => standIn('#4d7a3a', 1.4, 0.9)),
      loadStatic('stone-deposit', () => standIn('#a9a7a0', 1.7, 1.2)),
      loadStatic('gold-deposit', () => standIn('#c9a227', 1.7, 1.2)),
    ]);
  // Until a soldier has a model of his own he is drawn as a spearman.
  const [archer, horseman, archeryRange, stable, watchtower, farm] = await Promise.all([
    has('archer') ? loadUnit('archer', ['idle', 'walk', 'attack']) : spearman,
    has('horseman') ? loadUnit('horseman', ['idle', 'walk', 'attack']) : spearman,
    loadStatic('archery-range', () => standIn('#9a7a4a', 9, 2.6, true)),
    loadStatic('stable', () => standIn('#6f5a3f', 9, 3, true)),
    loadStatic('watchtower', () => standIn('#8c8a84', 3.4, 8, true)),
    loadStatic('farm', () => standIn('#7b6a45', 5.6, 0.12)),
  ]);
  // Both lists are in the order of the simulation's ENTITY_TYPES: spearman,
  // villager, town centre, house, mill, lumber camp, mining camp, barracks,
  // archer, horseman, archery range, stable, watchtower, farm.
  const none = undefined;
  return {
    units: [spearman, villager, none, none, none, none, none, none, archer, horseman],
    buildings: [none, none, hall, house, mill, lumberCamp, miningCamp, barracks, none, none, archeryRange, stable, watchtower, farm],
    oak,
    conifer,
    berries,
    stone,
    gold,
  };
}
