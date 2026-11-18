import * as THREE from 'three';
import { patchFow } from './fow';
import * as T from './textures';
import { getPbr, getPbrAverage, type PbrName } from './assets';

const cache = new Map<string, THREE.MeshStandardMaterial>();

export type TexKind = 'ashlar' | 'ashlarL' | 'plaster' | 'marble' | 'tiles' | 'planks' | 'thatch' | 'fabric' | 'frieze' | 'painted' | 'bark' | 'rock';

export interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: number;
  emissiveIntensity?: number;
  flat?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  tex?: TexKind;
  /** explicit scanned material (overrides tex) */
  pbr?: PbrName;
  /** keep the scan's own colours instead of re-tinting to `color` */
  raw?: boolean;
  /** texture repeats per world unit (default 1) */
  scale?: number;
  normal?: number;
}

/** scanned (photographic) material used for each texture kind, when available */
const SCAN: Partial<Record<TexKind, PbrName>> = {
  ashlar: 'sandstone', ashlarL: 'sandstone_large', plaster: 'plaster', marble: 'marble', tiles: 'roof_tiles',
  planks: 'planks', thatch: 'thatch', bark: 'bark', rock: 'rock', painted: 'clay_plaster',
};

function texFor(kind: TexKind) {
  switch (kind) {
    case 'ashlar': return T.ashlar(false);
    case 'ashlarL': return T.ashlar(true);
    case 'plaster': return T.plaster();
    case 'marble': return T.marble();
    case 'tiles': return T.roofTiles();
    case 'planks': return T.planks();
    case 'thatch': return T.thatch();
    case 'fabric': return T.fabric();
    case 'frieze': return T.frieze();
    case 'painted': return T.painted();
    case 'bark': return T.bark();
    case 'rock': return T.rock();
  }
}

const DEFAULT_ROUGH: Partial<Record<TexKind, number>> = { marble: 0.28, tiles: 0.7, fabric: 0.95, plaster: 0.88 };

/** Shared, fog-of-war aware PBR material. */
export function mat(color: number | string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const c = typeof color === 'string' ? new THREE.Color(color).getHex() : color;
  const key = JSON.stringify([c, o]);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: c,
      roughness: o.rough ?? (o.tex ? DEFAULT_ROUGH[o.tex] ?? 0.85 : 0.8),
      metalness: o.metal ?? 0,
      flatShading: o.flat ?? false,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 1,
      side: o.side ?? THREE.FrontSide,
      transparent: o.transparent ?? (o.opacity !== undefined && o.opacity < 1),
      opacity: o.opacity ?? 1,
    });
    const scanName = o.pbr ?? (o.tex ? SCAN[o.tex] : undefined);
    const scan = scanName ? getPbr(scanName) : undefined;
    if (scan && scanName) {
      const s = o.scale ?? 1;
      const rep = (t: THREE.Texture) => {
        const c = t.clone();
        c.repeat.set(s, s);
        c.needsUpdate = true;
        return c;
      };
      m.map = rep(scan.map);
      m.normalMap = rep(scan.normal);
      const arm = rep(scan.arm);
      m.aoMap = arm;
      m.aoMapIntensity = 0.8;
      m.roughnessMap = arm;
      m.roughness = o.rough !== undefined ? o.rough * 1.6 : 1;
      const n = o.normal ?? 1;
      m.normalScale = new THREE.Vector2(n, n);
      // re-tint the scan so its average albedo equals the requested colour
      const avg = getPbrAverage(scanName);
      if (avg && !o.raw) {
        // half brightness-match, half hue-match: keeps the scan's natural colour variation
        // without the odd hues a full per-channel correction produces
        const want = new THREE.Color(c);
        const lum = (x: THREE.Color) => 0.2126 * x.r + 0.7152 * x.g + 0.0722 * x.b;
        const L = lum(want) / Math.max(0.02, lum(avg));
        const ch = (w: number, a: number) => Math.min(2.5, L * 0.5 + (w / Math.max(0.02, a)) * 0.5);
        m.color.setRGB(ch(want.r, avg.r), ch(want.g, avg.g), ch(want.b, avg.b));
      } else if (o.raw) m.color.set(0xffffff);
    } else if (o.tex) {
      const t = texFor(o.tex);
      const s = o.scale ?? 1;
      const map = t.map.clone();
      const nrm = t.normal.clone();
      map.repeat.set(s, s);
      nrm.repeat.set(s, s);
      map.needsUpdate = nrm.needsUpdate = true;
      m.map = map;
      m.normalMap = nrm;
      const n = o.normal ?? 1;
      m.normalScale = new THREE.Vector2(n, n);
    }
    patchFow(m);
    cache.set(key, m);
  }
  return m;
}

export const gold = () => mat(0xd9a93a, { rough: 0.3, metal: 0.9 });
export const brass = () => mat(0xb88a3a, { rough: 0.35, metal: 0.85 });
export const wood = () => mat(0x7a5232, { tex: 'planks', scale: 2 });
export const darkWood = () => mat(0x50331d, { tex: 'planks', scale: 2 });
export const steel = () => mat(0xc4c8d0, { rough: 0.25, metal: 0.9 });
export const cloth = (c: number) => mat(c, { tex: 'fabric', scale: 4, rough: 0.95 });
export const skinMat = (c: number) => mat(c, { rough: 0.62 });

/** Lighten / darken a hex colour. */
export function shade(hex: number, f: number): number {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color(0xffffff), f);
  else c.multiplyScalar(1 + f);
  return c.getHex();
}

// ---------------------------------------------------------------------------
// world-scaled UVs so textures keep the same physical size on every shape
// ---------------------------------------------------------------------------
export function scaleUV(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

/** BoxGeometry faces: ±x (depth×height), ±y (width×depth), ±z (width×height) */
export function boxUV(g: THREE.BufferGeometry, w: number, h: number, d: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const per = uv.count / 6;
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < per; i++) {
      const k = f * per + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  uv.needsUpdate = true;
  return g;
}
