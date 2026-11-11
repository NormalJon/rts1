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
}

export interface StaticModel {
  readonly parts: readonly (ModelPart & { readonly matrix: THREE.Matrix4 })[];
}

export interface Models {
  /** Indexed like UNIT_TYPES in the simulation. */
  readonly units: readonly UnitModel[];
  readonly oak: StaticModel;
  readonly conifer: StaticModel;
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

async function loadUnit(name: string, clipNames: readonly string[]): Promise<UnitModel> {
  const gltf = await parse(name);
  const root = gltf.scene;
  const meshes = meshesOf(root);
  const mixer = new THREE.AnimationMixer(root);
  const clips = new Map<string, BakedClip>();
  for (const clipName of clipNames) {
    const clip = gltf.animations.find((c) => c.name === clipName);
    if (clip === undefined) throw new Error(`model "${name}" has no "${clipName}" clip`);
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
  return { parts: meshes.map(partOf), clips };
}

async function loadStatic(name: string): Promise<StaticModel> {
  const gltf = await parse(name);
  gltf.scene.updateMatrixWorld(true);
  return {
    parts: meshesOf(gltf.scene).map((mesh) => ({ ...partOf(mesh), matrix: mesh.matrixWorld.clone() })),
  };
}

export async function loadModels(): Promise<Models> {
  const [spearman, villager, oak, conifer] = await Promise.all([
    loadUnit('spearman', ['idle', 'walk']),
    loadUnit('villager', ['idle', 'walk']),
    loadStatic('oak'),
    loadStatic('conifer'),
  ]);
  return { units: [spearman, villager], oak, conifer };
}
