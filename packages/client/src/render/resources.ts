import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, type ResourceInit, type ResourceNodeType, RESOURCE_NODES } from '@thrones/shared';
import { patchFow, timeUniform } from './fow';
import { scaleUV, boxUV } from './materials';
import * as TX from './textures';
import { getModel, getPbr, type ModelName } from './assets';
import type { TerrainView } from './terrain';

type Rng = () => number;

/** normalise a geometry so it can be merged: non-indexed with position/normal/uv */
function ni(g: THREE.BufferGeometry, m?: THREE.Matrix4) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  if (m) out.applyMatrix4(m);
  return out;
}
const M = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------
/** vertex wind sway for foliage; `from` = local height where sway starts */
function windPatch(amp: number, from: number, useUv = false) {
  return (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = timeUniform;
    // double-sided foliage: keep the outward normal on back faces so leaves aren't black underneath
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec3 wIp = vec3(0.0);
      #ifdef USE_INSTANCING
        wIp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #endif
      float wH = ${useUv ? 'uv.y' : `max(0.0, position.y - ${from.toFixed(2)})`};
      float wS = sin(uTime * 1.7 + wIp.x * 0.61 + wIp.z * 0.43) + 0.5 * sin(uTime * 3.1 + wIp.x * 1.3);
      transformed.x += wS * ${amp.toFixed(3)} * wH;
      transformed.z += wS * ${(amp * 0.6).toFixed(3)} * wH;`,
    );
  };
}

interface PartMat {
  color?: number;
  map?: THREE.Texture;
  normal?: THREE.Texture;
  rough?: number;
  metal?: number;
  alpha?: boolean;
  wind?: [number, number, boolean?];
  flat?: boolean;
  emissive?: number;
}

function makeMat(o: PartMat) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: o.map ?? null,
    normalMap: o.normal ?? null,
    roughness: o.rough ?? 0.85,
    metalness: o.metal ?? 0,
    flatShading: o.flat ?? false,
    alphaTest: o.alpha ? 0.42 : 0,
    side: o.alpha ? THREE.DoubleSide : THREE.FrontSide,
    emissive: o.emissive ?? 0,
    emissiveIntensity: o.emissive ? 0.25 : 0,
  });
  const key = 'res' + (o.wind ? `w${o.wind.join(',')}` : '');
  return patchFow(m, o.wind ? windPatch(o.wind[0], o.wind[1], o.wind[2]) : undefined, key);
}

// ---------------------------------------------------------------------------
// geometry builders
// ---------------------------------------------------------------------------
/** leaf cards arranged around ellipsoid clusters, with normals pointing outward for soft volume */
function canopy(clusters: { c: THREE.Vector3; r: THREE.Vector3 }[], cardsPer: number, size: number, rng: Rng) {
  const parts: THREE.BufferGeometry[] = [];
  for (const cl of clusters) {
    for (let i = 0; i < cardsPer; i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2;
      const d = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(a), Math.abs(u) * 0.9 + 0.1, Math.sqrt(1 - u * u) * Math.sin(a)).normalize();
      const pos = cl.c.clone().add(new THREE.Vector3(d.x * cl.r.x, d.y * cl.r.y, d.z * cl.r.z).multiplyScalar(0.72));
      const p = new THREE.PlaneGeometry(size, size);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.9)).normalize());
      p.applyMatrix4(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
      const pa = p.getAttribute('position'), na = p.getAttribute('normal');
      for (let k = 0; k < pa.count; k++) {
        const n = new THREE.Vector3(pa.getX(k), pa.getY(k), pa.getZ(k)).sub(cl.c).normalize();
        na.setXYZ(k, n.x, n.y + 0.3, n.z);
      }
      parts.push(ni(p));
    }
  }
  return mergeGeometries(parts)!;
}

function rockGeo(r: number, seed: number, flatTop = 0.75) {
  const g = new THREE.IcosahedronGeometry(r, 2);
  const pa = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i);
    const n = Math.sin(v.x * 9.1 + seed) * Math.cos(v.z * 7.3 + seed * 2) * Math.sin(v.y * 8.7 + seed * 3);
    v.multiplyScalar(1 + n * 0.18);
    if (v.y < 0) v.y *= 0.3;
    v.y *= flatTop;
    pa.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return scaleUV(g, r * 4, r * 4);
}

interface Part {
  geo: THREE.BufferGeometry;
  mat: PartMat;
  /** ready-made material (scanned models) */
  material?: THREE.Material;
  color: number;
  vary?: number;
}

function partsFor(type: ResourceNodeType, rng: Rng): Part[] {
  const leaf = TX.leafCluster();
  const sb = getPbr('bark'), sr = getPbr('rock');
  const bark = sb ? { map: sb.map, normal: sb.normal } : TX.bark();
  const rock = sr ? { map: sr.map, normal: sr.normal } : TX.rock();
  switch (type) {
    case 'tree': {
      const trunk = mergeGeometries([
        ni(scaleUV(new THREE.CylinderGeometry(0.07, 0.13, 1.15, 10), 0.6, 1.2), M(0, 0.57, 0)),
        ni(scaleUV(new THREE.CylinderGeometry(0.035, 0.06, 0.6, 7), 0.3, 0.6), M(0.16, 1.05, 0.02, 1, 1, 1, 0, 0, -0.75)),
        ni(scaleUV(new THREE.CylinderGeometry(0.03, 0.055, 0.55, 7), 0.3, 0.6), M(-0.14, 1.0, -0.08, 1, 1, 1, 0.3, 0, 0.7)),
        ni(scaleUV(new THREE.CylinderGeometry(0.025, 0.045, 0.45, 7), 0.3, 0.5), M(0.02, 1.15, 0.15, 1, 1, 1, -0.7, 0, 0)),
        // root flare
        ni(scaleUV(new THREE.ConeGeometry(0.2, 0.25, 10, 1, true), 1, 0.3), M(0, 0.1, 0)),
      ])!;
      const clusters = [
        { c: new THREE.Vector3(0, 1.45, 0), r: new THREE.Vector3(0.55, 0.42, 0.55) },
        { c: new THREE.Vector3(0.38, 1.25, 0.1), r: new THREE.Vector3(0.38, 0.32, 0.38) },
        { c: new THREE.Vector3(-0.32, 1.22, -0.2), r: new THREE.Vector3(0.36, 0.3, 0.36) },
        { c: new THREE.Vector3(0.05, 1.3, 0.38), r: new THREE.Vector3(0.34, 0.3, 0.34) },
        { c: new THREE.Vector3(0.0, 1.8, -0.05), r: new THREE.Vector3(0.36, 0.28, 0.36) },
      ];
      const inner = mergeGeometries(clusters.map((c) => ni(new THREE.IcosahedronGeometry(1, 2), M(c.c.x, c.c.y, c.c.z, c.r.x * 0.82, c.r.y * 0.82, c.r.z * 0.82))))!;
      return [
        { geo: trunk, mat: { map: bark.map, normal: bark.normal }, color: 0x6a5240 },
        { geo: inner, mat: { wind: [0.03, 0.9] }, color: 0x3d5a24, vary: 0.15 },
        { geo: canopy(clusters, 16, 0.62, rng), mat: { map: leaf, alpha: true, wind: [0.04, 0.9] }, color: 0xffffff, vary: 0.2 },
      ];
    }
    case 'palm': {
      const segs: THREE.BufferGeometry[] = [];
      let x = 0, y = 0, lean = 0.08;
      for (let i = 0; i < 6; i++) {
        const h = 0.32;
        const r0 = 0.07 - i * 0.006;
        segs.push(ni(scaleUV(new THREE.CylinderGeometry(r0 - 0.006, r0, h + 0.02, 9), 0.5, 0.35), M(x, y + h / 2, 0, 1, 1, 1, 0, 0, -lean)));
        segs.push(ni(new THREE.TorusGeometry(r0, 0.012, 4, 10), M(x, y + 0.02, 0, 1, 1, 1, Math.PI / 2, 0, -lean)));
        x += Math.sin(lean) * h;
        y += Math.cos(lean) * h;
        lean += 0.05;
      }
      const top = new THREE.Vector3(x, y, 0);
      const fronds: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + rng() * 0.3;
        const p = new THREE.PlaneGeometry(0.5, 1.0, 1, 6);
        const pa = p.getAttribute('position');
        for (let k = 0; k < pa.count; k++) {
          const t = pa.getY(k) + 0.5; // 0 at base, 1 at tip
          pa.setXYZ(k, pa.getX(k), 0, t * 0.95);
          pa.setY(k, 0.35 * t - 0.75 * t * t);
        }
        p.rotateY(a);
        p.translate(top.x, top.y - 0.02, top.z);
        p.computeVertexNormals();
        const na = p.getAttribute('normal');
        for (let k = 0; k < na.count; k++) na.setXYZ(k, na.getX(k) * 0.3, Math.abs(na.getY(k)) + 0.4, na.getZ(k) * 0.3);
        fronds.push(ni(p));
      }
      const nuts = mergeGeometries([0, 1, 2, 3].map((k) => ni(new THREE.SphereGeometry(0.05, 8, 6), M(top.x + Math.cos(k * 1.7) * 0.07, top.y - 0.07, Math.sin(k * 1.7) * 0.07))))!;
      return [
        { geo: mergeGeometries(segs)!, mat: { map: bark.map, normal: bark.normal }, color: 0x8a6a4a },
        { geo: nuts, mat: {}, color: 0x5a4a2a },
        { geo: mergeGeometries(fronds)!, mat: { map: TX.frondTex(), alpha: true, wind: [0.05, 1.0] }, color: 0xffffff, vary: 0.15 },
      ];
    }
    case 'berry_bush': {
      const clusters = [
        { c: new THREE.Vector3(0, 0.3, 0), r: new THREE.Vector3(0.36, 0.28, 0.36) },
        { c: new THREE.Vector3(0.22, 0.22, 0.14), r: new THREE.Vector3(0.24, 0.2, 0.24) },
      ];
      const inner = mergeGeometries(clusters.map((c) => ni(new THREE.IcosahedronGeometry(1, 2), M(c.c.x, c.c.y, c.c.z, c.r.x * 0.85, c.r.y * 0.85, c.r.z * 0.85))))!;
      const berries = mergeGeometries(
        Array.from({ length: 14 }, (_, i) => {
          const a = i * 2.4, h = 0.22 + (i % 4) * 0.07;
          return ni(new THREE.SphereGeometry(0.035, 8, 6), M(Math.cos(a) * 0.3, h, Math.sin(a) * 0.3));
        }),
      )!;
      return [
        { geo: inner, mat: {}, color: 0x3a5a26, vary: 0.12 },
        { geo: canopy(clusters, 12, 0.36, rng), mat: { map: leaf, alpha: true, wind: [0.02, 0.15] }, color: 0xe8ffe0, vary: 0.15 },
        { geo: berries, mat: { rough: 0.3 }, color: 0x4a1f5c },
      ];
    }
    case 'gold_mine':
    case 'stone_mine': {
      const scanned = scannedRocks(type);
      if (scanned) return scanned;
      return type === 'gold_mine' ? goldProc(rock) : stoneProc(rock);
    }
  }
}

/** photo-scanned boulders (CC0) for mines; nuggets / cut blocks added procedurally */
function scannedRocks(type: 'gold_mine' | 'stone_mine'): Part[] | null {
  const pick = (n: ModelName) => getModel(n);
  const big = pick(type === 'gold_mine' ? 'boulder_brown' : 'boulder');
  const small = pick('rock_small');
  if (!big) return null;
  const parts: Part[] = [];
  const place = (m: NonNullable<ReturnType<typeof pick>>, mats: THREE.Matrix4[]) => {
    for (const p of m.parts) parts.push({ geo: mergeGeometries(mats.map((mx) => ni(p.geometry, mx)))!, mat: {}, material: p.material, color: type === 'gold_mine' ? 0xe8d2b0 : 0xffffff, vary: 0.06 });
  };
  place(big, [M(0, -0.02, 0, 0.82, 0.82, 0.82, 0, 0.4, 0)]);
  if (small) place(small, [M(0.34, -0.02, 0.26, 0.32, 0.32, 0.32, 0, 1.3, 0), M(-0.3, -0.02, 0.3, 0.26, 0.26, 0.26, 0, 2.5, 0)]);
  if (type === 'gold_mine') {
    const nuggets = mergeGeometries([
      ni(new THREE.OctahedronGeometry(0.07, 0), M(0.12, 0.32, 0.3)),
      ni(new THREE.OctahedronGeometry(0.055, 0), M(-0.22, 0.22, 0.28)),
      ni(new THREE.OctahedronGeometry(0.06, 0), M(0.36, 0.18, 0.12)),
      ni(new THREE.OctahedronGeometry(0.05, 0), M(-0.05, 0.4, 0.18)),
      ni(new THREE.OctahedronGeometry(0.045, 0), M(0.25, 0.3, -0.15)),
    ])!;
    parts.push({ geo: nuggets, mat: { rough: 0.2, metal: 1, flat: true, emissive: 0x6a4a00 }, color: 0xf6c84a });
  } else {
    const ash = TX.ashlar(true);
    const blocks = mergeGeometries([
      ni(boxUV(new THREE.BoxGeometry(0.22, 0.14, 0.16), 0.22, 0.14, 0.16), M(0.3, 0.07, 0.36, 1, 1, 1, 0, 0.4, 0)),
      ni(boxUV(new THREE.BoxGeometry(0.2, 0.13, 0.14), 0.2, 0.13, 0.14), M(-0.02, 0.065, 0.44, 1, 1, 1, 0, -0.2, 0)),
    ])!;
    parts.push({ geo: blocks, mat: { map: ash.map, normal: ash.normal }, color: 0xc4bfb2 });
  }
  return parts;
}

function goldProc(rock: { map: THREE.Texture; normal: THREE.Texture }): Part[] {
  switch ('gold_mine' as string) {
    case 'gold_mine': {
      const rocks = mergeGeometries([
        ni(rockGeo(0.4, 1), M(0, 0.12, 0)),
        ni(rockGeo(0.26, 2), M(0.3, 0.06, 0.2)),
        ni(rockGeo(0.22, 3), M(-0.26, 0.05, 0.18)),
        ni(rockGeo(0.2, 4), M(-0.1, 0.05, -0.32)),
      ])!;
      const nuggets = mergeGeometries([
        ni(new THREE.OctahedronGeometry(0.08, 0), M(0.06, 0.4, 0.14)),
        ni(new THREE.OctahedronGeometry(0.06, 0), M(-0.18, 0.28, 0.25)),
        ni(new THREE.OctahedronGeometry(0.07, 0), M(0.32, 0.22, 0.08)),
        ni(new THREE.OctahedronGeometry(0.05, 0), M(-0.04, 0.33, -0.25)),
        ni(new THREE.OctahedronGeometry(0.045, 0), M(0.2, 0.32, -0.08)),
      ])!;
      return [
        { geo: rocks, mat: { map: rock.map, normal: rock.normal }, color: 0x9a8566, vary: 0.08 },
        { geo: nuggets, mat: { rough: 0.2, metal: 1, flat: true, emissive: 0x6a4a00 }, color: 0xf6c84a },
      ];
    }
  }
  return [];
}

function stoneProc(rock: { map: THREE.Texture; normal: THREE.Texture }): Part[] {
  switch ('stone_mine' as string) {
    case 'stone_mine': {
      const rocks = mergeGeometries([
        ni(rockGeo(0.4, 11, 0.85), M(0, 0.14, 0)),
        ni(rockGeo(0.28, 12), M(0.3, 0.08, -0.15)),
        ni(rockGeo(0.25, 13), M(-0.28, 0.07, 0.2)),
      ])!;
      const blocks = mergeGeometries([
        ni(boxUV(new THREE.BoxGeometry(0.22, 0.14, 0.16), 0.22, 0.14, 0.16), M(0.28, 0.07, 0.3, 1, 1, 1, 0, 0.4, 0)),
        ni(boxUV(new THREE.BoxGeometry(0.2, 0.13, 0.14), 0.2, 0.13, 0.14), M(-0.05, 0.065, 0.42, 1, 1, 1, 0, -0.2, 0)),
        ni(boxUV(new THREE.BoxGeometry(0.18, 0.12, 0.14), 0.18, 0.12, 0.14), M(0.15, 0.19, 0.33, 1, 1, 1, 0, 0.9, 0)),
      ])!;
      const ash = TX.ashlar(true);
      return [
        { geo: rocks, mat: { map: rock.map, normal: rock.normal }, color: 0xb2aea4, vary: 0.08 },
        { geo: blocks, mat: { map: ash.map, normal: ash.normal }, color: 0xc4bfb2 },
      ];
    }
  }
  return [];
}

interface Entry {
  type: ResourceNodeType;
  index: number;
  x: number;
  y: number;
  amount: number;
  max: number;
  scale: number;
  rot: number;
  base: number;
  /** instanced meshes of this entry's map chunk, and its index there */
  chunk: THREE.InstancedMesh[];
  slot: number;
}

/** map chunk size (tiles): each chunk is its own instanced mesh so off-screen chunks are culled */
const CHUNK = 16;

export class ResourcesView {
  group = new THREE.Group();
  entries = new Map<number, Entry>();
  meshes = new Map<ResourceNodeType, THREE.InstancedMesh[]>();
  /** tile -> resource id */
  resAt: Int32Array;
  private tmp = new THREE.Matrix4();

  constructor(private terrain: TerrainView, list: ResourceInit[], seed: number) {
    const size = terrain.size;
    this.resAt = new Int32Array(size * size);
    const byType = new Map<ResourceNodeType, ResourceInit[]>();
    for (const r of list) {
      if (!byType.has(r.t)) byType.set(r.t, []);
      byType.get(r.t)!.push(r);
    }
    const rng = mulberry32(seed ^ 0xabc);
    const c = new THREE.Color();
    for (const [type, items] of byType) {
      const parts = partsFor(type, mulberry32(77));
      // group this type's nodes by map chunk
      const chunks = new Map<number, ResourceInit[]>();
      for (const r of items) {
        const k = Math.floor(r.y / CHUNK) * 1024 + Math.floor(r.x / CHUNK);
        if (!chunks.has(k)) chunks.set(k, []);
        chunks.get(k)!.push(r);
      }
      const mats = parts.map((p) => p.material ?? makeMat(p.mat));
      const all: THREE.InstancedMesh[] = [];
      for (const list of chunks.values()) {
        const meshes = parts.map((p, k) => {
          const im = new THREE.InstancedMesh(p.geo, mats[k], list.length);
          im.castShadow = true;
          im.receiveShadow = true;
          this.group.add(im);
          all.push(im);
          return im;
        });
        list.forEach((r, slot) => {
          const tree = type === 'tree' || type === 'palm';
          const e: Entry = {
            type, index: slot, x: r.x + 0.5, y: r.y + 0.5, amount: r.a, max: RESOURCE_NODES[type].amount,
            scale: tree ? 0.8 + rng() * 0.5 : 0.9 + rng() * 0.25,
            rot: rng() * Math.PI * 2,
            base: 0,
            chunk: meshes,
            slot,
          };
          if (tree) {
            e.x += (rng() - 0.5) * 0.35;
            e.y += (rng() - 0.5) * 0.35;
          }
          e.base = terrain.groundAt(e.x, e.y) - 0.02;
          this.entries.set(r.i, e);
          this.resAt[r.y * size + r.x] = r.i;
          this.writeMatrix(e);
          parts.forEach((p, k) => {
            c.setHex(p.color);
            if (p.vary) c.offsetHSL((rng() - 0.5) * p.vary * 0.25, (rng() - 0.5) * p.vary * 0.5, (rng() - 0.5) * p.vary);
            meshes[k].setColorAt(slot, c);
          });
        });
        for (const m of meshes) {
          m.instanceMatrix.needsUpdate = true;
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          m.computeBoundingSphere();
        }
      }
      this.meshes.set(type, all);
    }
  }

  private writeMatrix(e: Entry, hidden = false) {
    let s = e.scale;
    if (hidden) s = 0;
    else if (e.type === 'gold_mine' || e.type === 'stone_mine' || e.type === 'berry_bush') s *= 0.55 + 0.45 * Math.min(1, e.amount / e.max);
    this.tmp.compose(
      new THREE.Vector3(e.x, e.base, e.y),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), e.rot),
      new THREE.Vector3(s, s, s),
    );
    for (const m of e.chunk) {
      m.setMatrixAt(e.slot, this.tmp);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  setAmount(id: number, amount: number) {
    const e = this.entries.get(id);
    if (!e) return;
    e.amount = amount;
    if (amount <= 0) {
      this.writeMatrix(e, true);
      this.entries.delete(id);
      const size = this.terrain.size;
      for (const [k, v] of [[Math.floor(e.y) * size + Math.floor(e.x), id]] as const) if (this.resAt[k] === v) this.resAt[k] = 0;
      // trees were jittered; clear by id scan of the neighbourhood
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const k = (Math.floor(e.y) + dy) * size + Math.floor(e.x) + dx;
          if (k >= 0 && k < this.resAt.length && this.resAt[k] === id) this.resAt[k] = 0;
        }
    } else if (e.type !== 'tree' && e.type !== 'palm') this.writeMatrix(e);
  }

  get(id: number) {
    return this.entries.get(id);
  }
}
