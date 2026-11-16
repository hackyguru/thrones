import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, type ResourceInit, type ResourceNodeType, RESOURCE_NODES } from '@thrones/shared';
import { patchFow } from './fow';
import type { TerrainView } from './terrain';

function ni(g: THREE.BufferGeometry, m?: THREE.Matrix4) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  out.deleteAttribute('uv');
  if (m) out.applyMatrix4(m);
  return out;
}
const M = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  rough?: number;
  metal?: number;
  vary?: number;
}

function partsFor(type: ResourceNodeType): Part[] {
  switch (type) {
    case 'tree':
      return [
        { geo: ni(new THREE.CylinderGeometry(0.07, 0.12, 1.0, 6), M(0, 0.5, 0)), color: 0x5a3b22 },
        {
          geo: mergeGeometries([
            ni(new THREE.IcosahedronGeometry(0.55, 1), M(0, 1.25, 0, 1, 0.8, 1)),
            ni(new THREE.IcosahedronGeometry(0.42, 1), M(0.3, 1.0, 0.15, 1, 0.8, 1)),
            ni(new THREE.IcosahedronGeometry(0.4, 1), M(-0.25, 1.05, -0.2, 1, 0.8, 1)),
            ni(new THREE.IcosahedronGeometry(0.34, 1), M(0.0, 1.6, 0.05, 1, 0.8, 1)),
          ])!,
          color: 0x5b8c38,
          vary: 0.22,
        },
      ];
    case 'palm': {
      const fronds: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        fronds.push(ni(new THREE.BoxGeometry(0.1, 0.02, 0.62), M(Math.cos(a) * 0.26, 1.7, Math.sin(a) * 0.26, 1, 1, 1, 0.45, -a + Math.PI / 2, 0)));
      }
      return [
        {
          geo: mergeGeometries([
            ni(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 5), M(0.03, 0.45, 0, 1, 1, 1, 0, 0, -0.06)),
            ni(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 5), M(0.1, 1.28, 0, 1, 1, 1, 0, 0, -0.14)),
          ])!,
          color: 0x7a5a3a,
        },
        { geo: mergeGeometries(fronds)!.translate(0.14, 0, 0), color: 0x67a23c, vary: 0.2 },
      ];
    }
    case 'gold_mine':
      return [
        {
          geo: mergeGeometries([
            ni(new THREE.IcosahedronGeometry(0.38, 0), M(0, 0.2, 0, 1, 0.75, 1)),
            ni(new THREE.IcosahedronGeometry(0.25, 0), M(0.25, 0.15, 0.2)),
            ni(new THREE.IcosahedronGeometry(0.22, 0), M(-0.22, 0.12, 0.15)),
          ])!,
          color: 0x8a7a64,
          vary: 0.1,
        },
        {
          geo: mergeGeometries([
            ni(new THREE.OctahedronGeometry(0.1, 0), M(0.05, 0.45, 0.1)),
            ni(new THREE.OctahedronGeometry(0.08, 0), M(-0.18, 0.32, 0.22)),
            ni(new THREE.OctahedronGeometry(0.09, 0), M(0.3, 0.28, 0.05)),
            ni(new THREE.OctahedronGeometry(0.07, 0), M(-0.05, 0.36, -0.25)),
          ])!,
          color: 0xf2c440,
          rough: 0.25,
          metal: 0.9,
        },
      ];
    case 'stone_mine':
      return [
        {
          geo: mergeGeometries([
            ni(new THREE.IcosahedronGeometry(0.4, 0), M(0, 0.22, 0, 1, 0.8, 1)),
            ni(new THREE.IcosahedronGeometry(0.28, 0), M(0.28, 0.15, -0.15)),
            ni(new THREE.DodecahedronGeometry(0.24, 0), M(-0.25, 0.14, 0.2)),
          ])!,
          color: 0x9a978f,
          vary: 0.12,
        },
      ];
    case 'berry_bush':
      return [
        {
          geo: mergeGeometries([
            ni(new THREE.IcosahedronGeometry(0.34, 1), M(0, 0.28, 0, 1, 0.8, 1)),
            ni(new THREE.IcosahedronGeometry(0.24, 1), M(0.22, 0.2, 0.12)),
          ])!,
          color: 0x55853a,
          vary: 0.15,
        },
        {
          geo: mergeGeometries(
            Array.from({ length: 9 }, (_, i) => {
              const a = i * 2.4;
              return ni(new THREE.IcosahedronGeometry(0.05, 0), M(Math.cos(a) * 0.3, 0.3 + (i % 3) * 0.08, Math.sin(a) * 0.3));
            }),
          )!,
          color: 0x4a1f5c,
          rough: 0.4,
        },
      ];
  }
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
}

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
      const parts = partsFor(type);
      const meshes = parts.map((p) => {
        p.geo.computeVertexNormals();
        const m = patchFow(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: p.rough ?? 0.85, metalness: p.metal ?? 0, flatShading: true }));
        const im = new THREE.InstancedMesh(p.geo, m, items.length);
        im.castShadow = true;
        im.receiveShadow = true;
        this.group.add(im);
        return im;
      });
      this.meshes.set(type, meshes);
      items.forEach((r, index) => {
        const e: Entry = {
          type, index, x: r.x + 0.5, y: r.y + 0.5, amount: r.a, max: RESOURCE_NODES[type].amount,
          scale: type === 'tree' || type === 'palm' ? 0.85 + rng() * 0.45 : 0.9 + rng() * 0.25,
          rot: rng() * Math.PI * 2,
          base: terrain.groundAt(r.x + 0.5, r.y + 0.5),
        };
        // jitter trees a little inside their tile
        if (type === 'tree' || type === 'palm') {
          e.x += (rng() - 0.5) * 0.3;
          e.y += (rng() - 0.5) * 0.3;
        }
        this.entries.set(r.i, e);
        this.resAt[r.y * size + r.x] = r.i;
        this.writeMatrix(e);
        parts.forEach((p, k) => {
          c.setHex(p.color);
          if (p.vary) c.offsetHSL((rng() - 0.5) * p.vary * 0.2, 0, (rng() - 0.5) * p.vary);
          meshes[k].setColorAt(index, c);
        });
      });
      for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
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
    for (const m of this.meshes.get(e.type)!) {
      m.setMatrixAt(e.index, this.tmp);
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
      const k = Math.floor(e.y) * size + Math.floor(e.x);
      if (this.resAt[k] === id) this.resAt[k] = 0;
    } else if (e.type !== 'tree' && e.type !== 'palm') this.writeMatrix(e);
  }

  get(id: number) {
    return this.entries.get(id);
  }
}
