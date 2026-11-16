import * as THREE from 'three';
import { patchFow } from './fow';

const cache = new Map<string, THREE.MeshStandardMaterial>();

export interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: number;
  emissiveIntensity?: number;
  flat?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
}

/** Shared, fog-of-war aware standard material for a colour. */
export function mat(color: number | string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const c = typeof color === 'string' ? new THREE.Color(color).getHex() : color;
  const key = `${c}|${o.rough ?? 0.85}|${o.metal ?? 0}|${o.emissive ?? 0}|${o.emissiveIntensity ?? 0}|${o.flat ?? true}|${o.side ?? 0}|${o.opacity ?? 1}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: c,
      roughness: o.rough ?? 0.85,
      metalness: o.metal ?? 0,
      flatShading: o.flat ?? true,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 1,
      side: o.side ?? THREE.FrontSide,
      transparent: o.transparent ?? (o.opacity !== undefined && o.opacity < 1),
      opacity: o.opacity ?? 1,
    });
    patchFow(m);
    cache.set(key, m);
  }
  return m;
}

export const gold = () => mat(0xd9a93a, { rough: 0.35, metal: 0.8 });
export const wood = () => mat(0x6b4426);
export const darkWood = () => mat(0x4a2f1b);
export const steel = () => mat(0xb8bcc4, { rough: 0.3, metal: 0.85 });
export const cloth = (c: number) => mat(c, { rough: 0.95 });

/** Lighten / darken a hex colour. */
export function shade(hex: number, f: number): number {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color(0xffffff), f);
  else c.multiplyScalar(1 + f);
  return c.getHex();
}
