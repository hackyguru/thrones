import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain as T, makeNoise, mulberry32 } from '@thrones/shared';
import { patchFow, timeUniform } from './fow';
import * as TX from './textures';
import { getPbr } from './assets';

const R = 2; // vertices per tile

export class TerrainView {
  size: number;
  terrain: Uint8Array;
  heights: Float32Array;
  vw: number;
  mesh: THREE.Mesh;
  water: THREE.Mesh;
  /** grass tufts, one instanced mesh per map chunk (so off-screen chunks are culled) */
  grass: THREE.Group;
  private grassAt = new Map<number, { m: THREE.InstancedMesh; i: number }[]>();
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

    const n = vw * vw;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const splat = new Float32Array(n * 4);
    for (let vy = 0; vy < vw; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        const X = vx / R, Y = vy / R;
        // weighted terrain mix around the vertex (soft transitions)
        const w = [0, 0, 0, 0];
        let wsum = 0, wn = 0;
        for (let dy = -2; dy <= 1; dy++)
          for (let dx = -2; dx <= 1; dx++) {
            const tx = Math.floor(X + dx + 0.5), ty = Math.floor(Y + dy + 0.5);
            const d = Math.hypot(tx + 0.5 - X, ty + 0.5 - Y);
            const wgt = Math.max(0, 1.9 - d);
            const t = tileAt(tx, ty);
            wsum += (t === T.WATER ? 1 : 0) * wgt;
            wn += wgt;
            const ch = t === T.GRASS ? 0 : t === T.DRY ? 1 : t === T.DIRT ? 2 : 3;
            w[ch] += wgt;
          }
        const wf = wsum / wn;
        // break up hard borders with noise
        const nz = tint(X / 5, Y / 5);
        w[1] += Math.max(0, nz - 0.62) * wn * 0.6;
        w[2] += Math.max(0, tint(X / 3 + 40, Y / 3) - 0.68) * wn * 0.5;
        const ws = w[0] + w[1] + w[2] + w[3];
        const i = vy * vw + vx;
        for (let k = 0; k < 4; k++) splat[i * 4 + k] = w[k] / ws;
        const land = hill(X / 18, Y / 18) * 0.55 - 0.1;
        const h = land * (1 - Math.min(1, wf * 2)) - 0.85 * Math.pow(wf, 0.8);
        this.heights[i] = h;
        pos[i * 3] = X;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = Y;
        uv[i * 2] = X / 3.2;
        uv[i * 2 + 1] = Y / 3.2;
        // vertex colour = large-scale tint & wet/underwater darkening
        const b = 0.9 + tint(X * 0.35, Y * 0.35) * 0.2;
        let r = b, g = b, bl = b;
        if (h < -0.08) {
          const k = Math.min(1, (-h - 0.08) * 2.2);
          r *= 1 - k * 0.55;
          g *= 1 - k * 0.42;
          bl *= 1 - k * 0.3;
        }
        col[i * 3] = r;
        col[i * 3 + 1] = g;
        col[i * 3 + 2] = bl;
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
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    // photo-scanned ground (CC0) when available, procedural fallback otherwise
    const layer = (scan: 'ground_grass' | 'ground_dry' | 'ground_dirt' | 'ground_sand', proc: 'grass' | 'dry' | 'dirt' | 'sand') => {
      const s = getPbr(scan);
      if (s) return { map: s.map, normal: s.normal };
      const t = TX.groundTex(proc);
      return { map: t.map, normal: t.normal };
    };
    const grassT = layer('ground_grass', 'grass'), dryT = layer('ground_dry', 'dry'), dirtT = layer('ground_dirt', 'dirt'), sandT = layer('ground_sand', 'sand');
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: grassT.map, normalMap: grassT.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, metalness: 0 });
    patchFow(m, (shader) => {
      shader.uniforms.tDry = { value: dryT.map };
      shader.uniforms.tDirt = { value: dirtT.map };
      shader.uniforms.tSand = { value: sandT.map };
      shader.uniforms.nDry = { value: dryT.normal };
      shader.uniforms.nDirt = { value: dirtT.normal };
      shader.uniforms.nSand = { value: sandT.normal };
      shader.vertexShader = 'attribute vec4 splat;\nvarying vec4 vSplat;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvSplat = splat;');
      shader.fragmentShader =
        'uniform sampler2D tDry;\nuniform sampler2D tDirt;\nuniform sampler2D tSand;\nuniform sampler2D nDry;\nuniform sampler2D nDirt;\nuniform sampler2D nSand;\nvarying vec4 vSplat;\n' +
        shader.fragmentShader.replace(
          '#include <normal_fragment_maps>',
          THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = (texture2D(normalMap, vNormalMapUv).xyz * sw.x + texture2D(nDry, vNormalMapUv).xyz * sw.y + texture2D(nDirt, vNormalMapUv).xyz * sw.z + texture2D(nSand, vNormalMapUv).xyz * sw.w) * 2.0 - 1.0;'),
        ).replace(
          '#include <map_fragment>',
          `vec2 tuv = vMapUv;
          vec2 tuv2 = vMapUv * 0.27 + vec2(0.31, 0.17);
          vec4 sw = vSplat;
          // sharpen blends a little so patches read clearly
          sw = pow(max(sw, vec4(0.0)), vec4(1.6)); sw /= max(1e-4, sw.x + sw.y + sw.z + sw.w);
          vec4 c1 = texture2D(map, tuv) * sw.x + texture2D(tDry, tuv) * sw.y + texture2D(tDirt, tuv) * sw.z + texture2D(tSand, tuv) * sw.w;
          vec4 c2 = texture2D(map, tuv2) * sw.x + texture2D(tDry, tuv2) * sw.y + texture2D(tDirt, tuv2) * sw.z + texture2D(tSand, tuv2) * sw.w;
          diffuseColor *= mix(c1, c2, 0.4);`,
        );
    }, 'terrain');
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // water: glossy, reflective (picks up the scene environment) and slowly rippling
    this.waterNormal = makeWaterNormal();
    const wm = patchFow(
      new THREE.MeshStandardMaterial({
        color: 0x1f6f7c, roughness: 0.14, metalness: 0.15, transparent: true, opacity: 0.86,
        normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2,
        // never bleed through the land above it
        polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 8,
      }),
    );
    const wg = new THREE.PlaneGeometry(size, size, 1, 1);
    wg.rotateX(-Math.PI / 2);
    wg.translate(size / 2, -0.28, size / 2);
    this.water = new THREE.Mesh(wg, wm);
    this.water.receiveShadow = true;
    this.group.add(this.water);

    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 4, size * 4).rotateX(-Math.PI / 2).translate(size / 2, -1.2, size / 2),
      new THREE.MeshBasicMaterial({ color: 0x0b0907 }),
    );
    this.group.add(outer);

    this.grass = this.buildGrass(seed);
    this.group.add(this.grass);
  }

  /** instanced grass tufts on grass & dry tiles */
  private buildGrass(seed: number) {
    const rng = mulberry32(seed ^ 0x6a55);
    const card = (rot: number) => {
      const p = new THREE.PlaneGeometry(1, 0.6, 1, 2);
      p.translate(0, 0.3, 0);
      p.rotateY(rot);
      const na = p.getAttribute('normal');
      for (let i = 0; i < na.count; i++) na.setXYZ(i, 0, 1, 0);
      return p;
    };
    const geo = mergeGeometries([card(0), card(Math.PI / 3), card((2 * Math.PI) / 3)])!;
    const m = new THREE.MeshStandardMaterial({ map: TX.grassTuft(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
    patchFow(m, (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 gIp = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float gS = sin(uTime * 2.2 + gIp.x * 0.8 + gIp.z * 0.6) * 0.5 + sin(uTime * 3.7 + gIp.z) * 0.25;
        transformed.x += gS * 0.08 * position.y;
        transformed.z += gS * 0.05 * position.y;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    }, 'grass');
    const spots: { x: number; y: number; t: number }[] = [];
    const size = this.size;
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        const t = this.terrain[y * size + x];
        if (t !== T.GRASS && t !== T.DRY && t !== T.DIRT) continue;
        const count = t === T.GRASS ? 2 : 1;
        for (let k = 0; k < count; k++) if (rng() < (t === T.DIRT ? 0.08 : t === T.DRY ? 0.3 : 0.5)) spots.push({ x: x + rng(), y: y + rng(), t });
      }
    const CH = 16;
    const chunks = new Map<number, typeof spots>();
    for (const sp of spots) {
      const k = Math.floor(sp.y / CH) * 1024 + Math.floor(sp.x / CH);
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k)!.push(sp);
    }
    const out = new THREE.Group();
    const mtx = new THREE.Matrix4();
    const c = new THREE.Color();
    for (const list of chunks.values()) {
    const im = new THREE.InstancedMesh(geo, m, list.length);
    im.receiveShadow = true;
    out.add(im);
    list.forEach((s, i) => {
      const sc = 0.32 + rng() * 0.38;
      mtx.compose(new THREE.Vector3(s.x, this.groundAt(s.x, s.y) - 0.02, s.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28), new THREE.Vector3(sc, sc * (0.8 + rng() * 0.5), sc));
      im.setMatrixAt(i, mtx);
      if (s.t === T.GRASS) c.setRGB(1.0 + rng() * 0.2, 1.05 + rng() * 0.1, 0.75 + rng() * 0.15);
      else if (s.t === T.DRY) c.setRGB(1.5, 1.25, 0.7);
      else c.setRGB(1.2, 1.1, 0.75);
      im.setColorAt(i, c);
      const key = Math.floor(s.y) * size + Math.floor(s.x);
      let l = this.grassAt.get(key);
      if (!l) this.grassAt.set(key, (l = []));
      l.push({ m: im, i });
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    }
    return out;
  }

  /** hide grass under a footprint (buildings, farms) */
  clearGrass(tx: number, ty: number, size: number) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const changed = new Set<THREE.InstancedMesh>();
    for (let y = ty - 1; y <= ty + size; y++)
      for (let x = tx - 1; x <= tx + size; x++) {
        const inside = x >= tx && y >= ty && x < tx + size && y < ty + size;
        const l = this.grassAt.get(y * this.size + x);
        if (!l || !inside) continue;
        for (const { m, i } of l) {
          m.setMatrixAt(i, zero);
          changed.add(m);
        }
        this.grassAt.delete(y * this.size + x);
      }
    for (const m of changed) m.instanceMatrix.needsUpdate = true;
  }

  /** hide grass on a resource tile */
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
    timeUniform.value = t;
    this.waterNormal.offset.set(t * 0.012, t * 0.007);
  }
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
