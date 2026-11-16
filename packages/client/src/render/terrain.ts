import * as THREE from 'three';
import { Terrain as T, makeNoise, mulberry32 } from '@thrones/shared';
import { patchFow } from './fow';

const R = 2; // vertices per tile

const COLORS: Record<number, number[]> = {
  [T.GRASS]: [0x7d9a4c, 0x8ca456, 0x6e8c42],
  [T.DRY]: [0xb4a064, 0xa8925a, 0xc0ab72],
  [T.DIRT]: [0x9a7a56, 0x8d6c4a, 0xa6865e],
  [T.SAND]: [0xd8c58f, 0xcfb980, 0xe2d29e],
  [T.WATER]: [0x6b7f60, 0x6b7f60, 0x6b7f60],
};

export class TerrainView {
  size: number;
  terrain: Uint8Array;
  heights: Float32Array;
  vw: number;
  mesh: THREE.Mesh;
  water: THREE.Mesh;
  private waterNormal: THREE.Texture;
  group = new THREE.Group();

  constructor(size: number, terrainStr: string, seed: number) {
    this.size = size;
    this.terrain = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) this.terrain[i] = terrainStr.charCodeAt(i) - 48;
    const vw = (this.vw = size * R + 1);
    this.heights = new Float32Array(vw * vw);
    const rng = mulberry32(seed ^ 0x5eed);
    const hill = makeNoise(rng);
    const tint = makeNoise(rng);

    const tileAt = (x: number, y: number) => {
      x = Math.max(0, Math.min(size - 1, x));
      y = Math.max(0, Math.min(size - 1, y));
      return this.terrain[y * size + x];
    };

    // water fraction around each vertex (blurred)
    const pos = new Float32Array(vw * vw * 3);
    const col = new Float32Array(vw * vw * 3);
    const uv = new Float32Array(vw * vw * 2);
    const c = new THREE.Color();
    const acc = new THREE.Color();
    for (let vy = 0; vy < vw; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        const X = vx / R, Y = vy / R;
        let wsum = 0, wn = 0;
        for (let dy = -2; dy <= 1; dy++)
          for (let dx = -2; dx <= 1; dx++) {
            const tx = Math.floor(X + dx + 0.5), ty = Math.floor(Y + dy + 0.5);
            const d = Math.hypot(tx + 0.5 - X, ty + 0.5 - Y);
            const wgt = Math.max(0, 1.9 - d);
            wsum += (tileAt(tx, ty) === T.WATER ? 1 : 0) * wgt;
            wn += wgt;
          }
        const wf = wsum / wn;
        const land = hill(X / 18, Y / 18) * 0.55 - 0.1;
        const h = land * (1 - Math.min(1, wf * 2)) - 0.85 * Math.pow(wf, 0.8);
        const i = vy * vw + vx;
        this.heights[i] = h;
        pos[i * 3] = X;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = Y;
        uv[i * 2] = X / 5;
        uv[i * 2 + 1] = Y / 5;
        // colour: blend surrounding tiles
        acc.setRGB(0, 0, 0);
        let n = 0;
        for (let dy = -1; dy <= 0; dy++)
          for (let dx = -1; dx <= 0; dx++) {
            const t = tileAt(Math.floor(X + dx + 0.5 * (dx + 1)), Math.floor(Y + dy + 0.5 * (dy + 1)));
            const pal = COLORS[t];
            const tv = tint(X / 6 + t * 10, Y / 6);
            c.setHex(pal[0]).lerp(new THREE.Color(tv > 0.5 ? pal[1] : pal[2]), Math.abs(tv - 0.5) * 1.6);
            acc.add(c);
            n++;
          }
        acc.multiplyScalar(1 / n);
        if (h < -0.15) acc.lerp(new THREE.Color(0x4f5d44), Math.min(1, (-h - 0.15) * 2));
        const bright = 0.92 + tint(X * 0.9, Y * 0.9) * 0.16;
        col[i * 3] = acc.r * bright;
        col[i * 3 + 1] = acc.g * bright;
        col[i * 3 + 2] = acc.b * bright;
      }
    }
    const idx = new Uint32Array((vw - 1) * (vw - 1) * 6);
    let k = 0;
    for (let y = 0; y < vw - 1; y++)
      for (let x = 0; x < vw - 1; x++) {
        const a = y * vw + x, b = a + 1, d = a + vw, e = d + 1;
        idx[k++] = a; idx[k++] = d; idx[k++] = b;
        idx[k++] = b; idx[k++] = d; idx[k++] = e;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const detail = makeDetailTexture();
    const m = patchFow(new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0 }));
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // water
    this.waterNormal = makeWaterNormal();
    const wm = patchFow(
      new THREE.MeshStandardMaterial({
        color: 0x2b7d8c, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.84,
        normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.6, 0.6),
      }),
    );
    const wg = new THREE.PlaneGeometry(size, size, 1, 1);
    wg.rotateX(-Math.PI / 2);
    wg.translate(size / 2, -0.28, size / 2);
    this.water = new THREE.Mesh(wg, wm);
    this.water.receiveShadow = true;
    this.group.add(this.water);

    // world border skirt
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 4, size * 4).rotateX(-Math.PI / 2).translate(size / 2, -1.2, size / 2),
      new THREE.MeshBasicMaterial({ color: 0x0b0907 }),
    );
    this.group.add(outer);
  }

  tile(x: number, y: number) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return T.WATER;
    return this.terrain[ty * this.size + tx];
  }

  heightAt(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.vw - 1.001, x * R));
    const fy = Math.max(0, Math.min(this.vw - 1.001, y * R));
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const ax = fx - ix, ay = fy - iy;
    const h = this.heights, w = this.vw;
    const a = h[iy * w + ix], b = h[iy * w + ix + 1], c = h[(iy + 1) * w + ix], d = h[(iy + 1) * w + ix + 1];
    return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
  }

  /** for placing objects: never below the water surface */
  groundAt(x: number, y: number) {
    return Math.max(-0.25, this.heightAt(x, y));
  }

  update(t: number) {
    this.waterNormal.offset.set(t * 0.012, t * 0.007);
  }
}

function makeDetailTexture(): THREE.Texture {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(s, s);
  const rng = mulberry32(99);
  const n = makeNoise(rng);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      // tileable noise: blend of wrapped lattice + grain
      const v = (n((x / s) * 8, (y / s) * 8, 3) + n(((x + s / 2) % s) / s * 8 + 20, ((y + s / 2) % s) / s * 8 + 20, 3)) * 0.3 + rng() * 0.4;
      const c = 222 + v * 33;
      const i = (y * s + x) * 4;
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeWaterNormal(): THREE.Texture {
  const s = 128;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const a = (x / s) * Math.PI * 2, b = (y / s) * Math.PI * 2;
      const dx = Math.cos(a * 3 + b * 2) * 0.5 + Math.cos(a * 7 - b * 3) * 0.25 + Math.sin(a * 11 + b * 5) * 0.12;
      const dy = Math.cos(b * 4 - a) * 0.5 + Math.sin(b * 9 + a * 2) * 0.25 + Math.cos(b * 13 - a * 6) * 0.12;
      const len = Math.hypot(dx * 0.4, dy * 0.4, 1);
      const i = (y * s + x) * 4;
      data[i] = ((dx * 0.4) / len * 0.5 + 0.5) * 255;
      data[i + 1] = ((dy * 0.4) / len * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 12);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
