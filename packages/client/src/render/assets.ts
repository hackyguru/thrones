import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchFow } from './fow';

/**
 * Loads the CC0 art fetched by scripts/fetch-assets.mjs (see ASSETS.md):
 * photo-scanned PBR materials, an HDRI sky, scanned props, and photographed foliage atlases.
 */
const BASE = `${import.meta.env.BASE_URL}assets/`;

export const PBR_NAMES = [
  'ground_grass', 'ground_dry', 'ground_dirt', 'ground_sand',
  'sandstone', 'sandstone_large', 'red_sandstone', 'red_sandstone_floor', 'marble', 'marble_floor',
  'plaster', 'clay_plaster', 'granite', 'basalt', 'stone_floor', 'roof_tiles', 'thatch', 'wood', 'planks', 'bark', 'rock',
] as const;
export type PbrName = (typeof PBR_NAMES)[number];

export const MODEL_NAMES = ['boulder', 'boulder_brown', 'rock_small', 'stones', 'barrels', 'crate', 'basket', 'brass_pot', 'clay_pot', 'log'] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

export const ATLAS_NAMES = ['LeafSet024', 'LeafSet030', 'Foliage001', 'Foliage006'] as const;
export type AtlasName = (typeof ATLAS_NAMES)[number];

export interface PbrSet {
  map: THREE.Texture;
  normal: THREE.Texture;
  arm: THREE.Texture;
}

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

export interface LoadedModel {
  /** parts in the model's local space, normalised so the base sits at y=0 and the largest horizontal extent is 1 */
  parts: ModelPart[];
  /** height relative to the unit footprint */
  height: number;
}

export interface Atlas {
  image: HTMLCanvasElement;
  /** bounding boxes of individual leaves / blades (pixels) */
  sprites: { x: number; y: number; w: number; h: number }[];
}

const pbr = new Map<PbrName, PbrSet>();
/** average albedo (linear) of each scanned material, used to re-tint scans to a target colour */
const pbrAvg = new Map<PbrName, THREE.Color>();
export const getPbrAverage = (n: PbrName) => pbrAvg.get(n);

function averageColor(img: HTMLImageElement | ImageBitmap): THREE.Color {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img as CanvasImageSource, 0, 0, 16, 16);
  const d = x.getImageData(0, 0, 16, 16).data;
  const col = new THREE.Color(0, 0, 0);
  const t = new THREE.Color();
  for (let i = 0; i < d.length; i += 4) {
    t.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace);
    col.r += t.r;
    col.g += t.g;
    col.b += t.b;
  }
  return col.multiplyScalar(1 / 256);
}
const models = new Map<ModelName, LoadedModel>();
const atlases = new Map<AtlasName, Atlas>();
let sky: THREE.DataTexture | null = null;
let loaded = false;

export const assetsReady = () => loaded;
export const getSky = () => sky;
export const getAtlas = (n: AtlasName) => atlases.get(n);
export const getModel = (n: ModelName) => models.get(n);

export function getPbr(name: PbrName): PbrSet | undefined {
  return pbr.get(name);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('failed to load ' + url));
    img.src = url;
  });
}

/** find individual leaves/blades in an atlas via connected components on a coarse alpha grid */
function findSprites(cv: HTMLCanvasElement) {
  const g = 128;
  const small = document.createElement('canvas');
  small.width = small.height = g;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(cv, 0, 0, g, g);
  const a = sctx.getImageData(0, 0, g, g).data;
  const seen = new Uint8Array(g * g);
  const out: Atlas['sprites'] = [];
  const s = cv.width / g;
  for (let i = 0; i < g * g; i++) {
    if (seen[i] || a[i * 4 + 3] < 40) continue;
    let x0 = g, y0 = g, x1 = 0, y1 = 0, n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % g, y = (k / g) | 0;
      n++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g || ny >= g) continue;
        const j = ny * g + nx;
        if (!seen[j] && a[j * 4 + 3] >= 40) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (n > 12) out.push({ x: Math.max(0, (x0 - 1) * s), y: Math.max(0, (y0 - 1) * s), w: (x1 - x0 + 3) * s, h: (y1 - y0 + 3) * s });
  }
  return out;
}

/** merge all meshes of a glTF scene into one geometry per material, normalised */
function prepareModel(scene: THREE.Object3D): LoadedModel {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = 1 / Math.max(size.x, size.z, 1e-6);
  const centre = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  const norm = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, m.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g.index ? g.toNonIndexed() : g);
  });
  const parts: ModelPart[] = [];
  for (const [mat, geos] of byMat) {
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos)!;
    const material = (mat as THREE.MeshStandardMaterial).clone();
    material.envMapIntensity = 1;
    patchFow(material, undefined, 'model');
    parts.push({ geometry, material });
  }
  return { parts, height: size.y * scale };
}

/** Load everything; resolves when the game can start. */
export async function preloadAssets(onProgress?: (p: number) => void): Promise<void> {
  if (loaded) return;
  const tl = new THREE.TextureLoader();
  const jobs: Promise<unknown>[] = [];
  let done = 0;
  const track = <T>(p: Promise<T>) => {
    jobs.push(p.then((v) => (onProgress?.(++done / jobs.length), v)));
    return p;
  };
  const tex = (url: string, srgb: boolean) =>
    track(
      tl.loadAsync(url).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      }),
    );
  for (const name of PBR_NAMES) {
    const d = `${BASE}tex/${name}/`;
    track(Promise.all([tex(d + 'diff.jpg', true), tex(d + 'nor.jpg', false), tex(d + 'arm.jpg', false)]).then(([map, normal, arm]) => {
      pbr.set(name, { map, normal, arm });
      pbrAvg.set(name, averageColor(map.image));
    }));
  }
  track(
    new RGBELoader().loadAsync(`${BASE}hdri/sky.hdr`).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      sky = t;
    }),
  );
  const gl = new GLTFLoader();
  for (const name of MODEL_NAMES) track(gl.loadAsync(`${BASE}models/${name}.glb`).then((g) => models.set(name, prepareModel(g.scene))));
  for (const name of ATLAS_NAMES)
    track(
      loadImage(`${BASE}foliage/${name}/atlas.webp`).then((img) => {
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        cv.getContext('2d')!.drawImage(img, 0, 0);
        atlases.set(name, { image: cv, sprites: findSprites(cv) });
      }),
    );
  await Promise.allSettled(jobs);
  // all-or-nothing is not required: missing assets fall back to procedural art
  loaded = true;
}
