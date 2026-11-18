import * as THREE from 'three';
import { getAtlas, type AtlasName } from './assets';

/**
 * Procedural, tileable surface textures (albedo detail + normal maps) generated on canvases.
 * Albedo maps are mostly light/neutral so a material colour can tint them per civilization.
 */

// ---------------------------------------------------------------------------
// periodic value noise (tiles seamlessly at `period`)
// ---------------------------------------------------------------------------
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** fractal noise, u,v in [0,1) tiles; base = lattice cells across the texture */
function fbm(u: number, v: number, base: number, oct: number, seed: number) {
  let s = 0, a = 0.5, n = 0, f = base;
  for (let o = 0; o < oct; o++) {
    s += vnoise(u * f, v * f, f, seed + o * 17) * a;
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return s / n;
}

type Painter = (u: number, v: number, x: number, y: number) => [number, number, number, number]; // r,g,b (0-1), height (0-1)

interface TexPair {
  map: THREE.Texture;
  normal: THREE.Texture;
  rough?: THREE.Texture;
}

const cache = new Map<string, TexPair>();

function build(key: string, size: number, paint: Painter, normalStrength = 2.5, alpha = false): TexPair {
  const hit = cache.get(key);
  if (hit) return hit;
  const col = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b, h] = paint(x / size, y / size, x, y);
      const i = y * size + x;
      col[i * 4] = Math.max(0, Math.min(255, r * 255));
      col[i * 4 + 1] = Math.max(0, Math.min(255, g * 255));
      col[i * 4 + 2] = Math.max(0, Math.min(255, b * 255));
      col[i * 4 + 3] = alpha ? Math.max(0, Math.min(255, h * 255)) : 255;
      height[i] = h;
    }
  const map = canvasTex(col, size, true);
  // normal from height (wrapping sobel)
  const nrm = new Uint8ClampedArray(size * size * 4);
  const H = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * normalStrength;
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * normalStrength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nrm[i] = (-dx / l * 0.5 + 0.5) * 255;
      nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
    }
  const normal = canvasTex(nrm, size, false);
  const pair = { map, normal };
  cache.set(key, pair);
  return pair;
}

function canvasTex(data: Uint8ClampedArray, size: number, srgb: boolean) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.putImageData(new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// architecture
// ---------------------------------------------------------------------------

/** cut-stone masonry in running bond. One texture = 1 world unit. */
export function ashlar(large = false) {
  const rows = large ? 4 : 7;
  return build(`ashlar${large}`, 512, (u, v) => {
    const row = Math.floor(v * rows);
    const per = large ? 3 : 4;
    const off = (row % 2) * 0.5;
    const bu = u * per + off;
    const col = Math.floor(bu);
    const fu = bu - col, fv = v * rows - row;
    const m = 0.035 * per, mv = 0.05;
    const edge = Math.min(smooth(0, m, fu), smooth(0, m, 1 - fu), smooth(0, mv * 1.6, fv), smooth(0, mv * 1.6, 1 - fv));
    const id = hash(((col % per) + per) % per, row, 7);
    const grain = fbm(u, v, 16, 4, 3);
    const speck = hash(Math.floor(u * 512), Math.floor(v * 512), 9) * 0.06;
    let l = 0.86 + (id - 0.5) * 0.08 + (grain - 0.5) * 0.12 - speck * 0.6;
    l = l * (0.8 + 0.2 * edge);
    const h = edge * (0.9 + grain * 0.1) + (fbm(u, v, 8, 3, 21) - 0.5) * 0.04;
    return [l, l * 0.98, l * 0.95, h];
  }, 1.8);
}

/** lime plaster / chunam */
export function plaster() {
  return build('plaster', 512, (u, v) => {
    const n = fbm(u, v, 6, 5, 1);
    const stain = smooth(0.55, 0.8, fbm(u, v * 0.5, 3, 4, 5)) * 0.12;
    const l = 0.9 + (n - 0.5) * 0.1 - stain;
    return [l, l * 0.985, l * 0.96, n * 0.25];
  }, 1.2);
}

/** polished white marble with soft veins */
export function marble() {
  return build('marble', 512, (u, v) => {
    const t = fbm(u, v, 3, 5, 11);
    const vein = Math.pow(Math.abs(Math.sin((u + v * 2 + t * 2.2) * Math.PI)), 40);
    const cloud = fbm(u, v, 5, 4, 12);
    const l = 0.95 - vein * 0.07 + (cloud - 0.5) * 0.05 + (fbm(u, v, 24, 2, 13) - 0.5) * 0.02;
    // subtle panel joints
    const pu = (u * 2) % 1, pv = (v * 2) % 1;
    const joint = Math.min(smooth(0, 0.012, pu), smooth(0, 0.012, 1 - pu), smooth(0, 0.012, pv), smooth(0, 0.012, 1 - pv));
    return [l * (0.85 + 0.15 * joint), l * 0.985 * (0.85 + 0.15 * joint), l * 0.97 * (0.85 + 0.15 * joint), joint * 0.5];
  }, 1.5);
}

/** terracotta half-round roof tiles; rows run along U */
export function roofTiles() {
  return build('tiles', 512, (u, v) => {
    const rows = 8, cols = 10;
    const row = Math.floor(v * rows);
    const fu = (u * cols + (row % 2) * 0.5) % 1;
    const fv = v * rows - row;
    const round = Math.sin(fu * Math.PI);
    const lap = smooth(0.0, 0.25, fv);
    const h = round * 0.8 * lap + (1 - fv) * 0.2;
    const id = hash(Math.floor(u * cols + (row % 2) * 0.5), row, 3);
    const l = (0.55 + round * 0.4) * (0.7 + 0.3 * lap) + (id - 0.5) * 0.12 + (fbm(u, v, 20, 2, 4) - 0.5) * 0.08;
    return [l, l * 0.95, l * 0.9, h];
  }, 3.5);
}

export function planks() {
  return build('planks', 256, (u, v) => {
    const boards = 5;
    const b = Math.floor(u * boards);
    const fu = u * boards - b;
    const grain = fbm(u * 0.3 + b * 0.13, v, 12, 4, 30 + b);
    const ring = Math.sin((v * 30 + grain * 8) * Math.PI) * 0.5 + 0.5;
    const gap = Math.min(smooth(0, 0.04, fu), smooth(0, 0.04, 1 - fu));
    const l = (0.62 + ring * 0.12 + (hash(b, 0, 5) - 0.5) * 0.15) * (0.5 + 0.5 * gap);
    return [l, l * 0.9, l * 0.8, gap * 0.8 + ring * 0.1];
  }, 2);
}

export function thatch() {
  return build('thatch', 256, (u, v) => {
    const strands = fbm(u * 8, v * 0.6, 8, 3, 40);
    const s = Math.pow(Math.abs(Math.sin((u * 90 + strands * 6) * Math.PI)), 3);
    const layer = (v * 6) % 1;
    const l = 0.55 + s * 0.3 - layer * 0.15 + (fbm(u, v, 10, 2, 41) - 0.5) * 0.1;
    return [l, l * 0.88, l * 0.62, s * 0.6 + (1 - layer) * 0.4];
  }, 3);
}

/** fine woven cloth */
export function fabric() {
  return build('fabric', 128, (u, v) => {
    const a = Math.sin(u * 64 * Math.PI * 2) * 0.5 + 0.5;
    const b = Math.sin(v * 64 * Math.PI * 2) * 0.5 + 0.5;
    const w = (Math.floor(u * 64) + Math.floor(v * 64)) % 2 ? a : b;
    const l = 0.9 + w * 0.1 - fbm(u, v, 4, 3, 50) * 0.06;
    return [l, l, l, w * 0.5];
  }, 0.8);
}

/** carved frieze: lotus petals over a bead band (U repeats every unit) */
export function frieze() {
  return build('frieze', 512, (u, v) => {
    const petals = 8;
    const pu = (u * petals) % 1;
    const petal = Math.max(0, 1 - Math.hypot((pu - 0.5) * 2.2, (v - 0.62) * 1.6));
    const tip = smooth(0.0, 0.25, petal);
    const beadV = Math.abs(v - 0.2) < 0.09;
    const bu = (u * petals * 3) % 1;
    const bead = beadV ? Math.max(0, 1 - Math.hypot((bu - 0.5) * 2, (v - 0.2) / 0.09)) : 0;
    const fillet = v > 0.92 || (v > 0.3 && v < 0.34) ? 0.6 : 0;
    const h = Math.max(tip * 0.9, bead * 0.8, fillet);
    const l = 0.62 + h * 0.38 + (fbm(u, v, 16, 3, 60) - 0.5) * 0.08;
    return [l, l * 0.97, l * 0.93, h];
  }, 4);
}

/** stucco/painted plaster with a faded painted border band (for gopuram tiers) */
export function painted() {
  return build('painted', 512, (u, v) => {
    const n = fbm(u, v, 8, 4, 70);
    const niche = (u * 6) % 1;
    const arch = Math.abs(niche - 0.5) < 0.22 && v > 0.25 && v < 0.85 + 0 ? 1 : 0;
    const top = v < 0.85 - Math.max(0, 0.15 - Math.abs(niche - 0.5)) ? 1 : 0;
    const recess = arch * top;
    const l = 0.86 - recess * 0.28 + (n - 0.5) * 0.12;
    return [l, l * 0.96, l * 0.9, 1 - recess * 0.8];
  }, 3);
}

/** fibrous tree bark (U around the trunk, V up) */
export function bark() {
  return build('bark', 256, (u, v) => {
    const groove = fbm(u * 6, v * 0.5, 4, 4, 80);
    const ridge = Math.pow(Math.abs(Math.sin((u * 14 + groove * 3) * Math.PI)), 0.6);
    const l = 0.45 + ridge * 0.3 + (fbm(u, v, 16, 3, 81) - 0.5) * 0.15;
    return [l, l * 0.85, l * 0.7, ridge];
  }, 3);
}

/** rough natural rock */
export function rock() {
  return build('rock', 256, (u, v) => {
    const n = fbm(u, v, 6, 5, 90);
    const cracks = smooth(0.48, 0.5, Math.abs(fbm(u, v, 4, 4, 91) - 0.5) * 2) ;
    const l = 0.62 + (n - 0.5) * 0.35 - (1 - cracks) * 0.15;
    return [l, l * 0.97, l * 0.92, n * 0.8 + cracks * 0.2];
  }, 2.5);
}

// ---------------------------------------------------------------------------
// ground
// ---------------------------------------------------------------------------
export function groundTex(kind: 'grass' | 'dry' | 'dirt' | 'sand') {
  return build('ground_' + kind, 512, (u, v, x, y) => {
    const n = fbm(u, v, 8, 5, kind.length * 13);
    const fine = hash(x, y, kind.length);
    const blades = fbm(u, v, 64, 2, 3);
    const patch = fbm(u, v, 3, 3, 4);
    if (kind === 'grass') {
      const r = 0.42 + patch * 0.1 + blades * 0.08 + (fine - 0.5) * 0.05;
      const g = 0.5 + patch * 0.1 + blades * 0.1 + (fine - 0.5) * 0.05;
      const b = 0.27 + patch * 0.04;
      return [r, g, b, blades * 0.5 + n * 0.5];
    }
    if (kind === 'dry') {
      const l = 0.64 + patch * 0.12 + blades * 0.1 + (fine - 0.5) * 0.06;
      const green = Math.max(0, n - 0.55) * 0.3;
      return [l, l * (0.86 + green), l * (0.58 + green * 0.5), blades * 0.4 + n * 0.5];
    }
    if (kind === 'dirt') {
      const peb = hash(Math.floor(u * 128), Math.floor(v * 128), 9) > 0.92 ? 0.12 : 0;
      const l = 0.54 + n * 0.14 + peb + (fine - 0.5) * 0.06;
      return [l * 1.05, l * 0.82, l * 0.62, n * 0.6 + peb * 2];
    }
    const l = 0.82 + (n - 0.5) * 0.1 + (fine - 0.5) * 0.07;
    return [l, l * 0.93, l * 0.76, n * 0.4 + fine * 0.1];
  }, 1.6);
}

// ---------------------------------------------------------------------------
// foliage (alpha cards)
// ---------------------------------------------------------------------------
function drawCanvas(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const foliageCache = new Map<string, THREE.Texture>();
function cachedTex(key: string, make: () => THREE.Texture) {
  let t = foliageCache.get(key);
  if (!t) foliageCache.set(key, (t = make()));
  return t;
}

/** a cluster of broad leaves (neem / banyan canopy card) */
function leafClusterDrawn() {
  return cachedTex('leaves', () =>
    drawCanvas(256, (g, s) => {
      let seed = 3;
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 260; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.44;
        const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
        const len = 14 + r() * 14;
        const rot = r() * Math.PI * 2;
        const shade = 0.85 + r() * 0.4 - (d / s) * 0.25;
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.fillStyle = `rgb(${Math.round(70 * shade)},${Math.round(120 * shade + 10)},${Math.round(40 * shade)})`;
        g.beginPath();
        g.ellipse(0, 0, len * 0.5, len * 0.2, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = `rgba(30,50,15,0.35)`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-len * 0.45, 0);
        g.lineTo(len * 0.45, 0);
        g.stroke();
        g.restore();
      }
    }),
  );
}

/** a palm frond seen from above */
function frondTexDrawn() {
  return cachedTex('frond', () =>
    drawCanvas(256, (g, s) => {
      g.strokeStyle = '#6a5a2a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(s / 2, s);
      g.quadraticCurveTo(s / 2 + 10, s / 2, s / 2, 4);
      g.stroke();
      for (let i = 0; i < 46; i++) {
        const t = i / 46;
        const y = s - t * (s - 8);
        const len = Math.sin(t * Math.PI) * s * 0.42 + 8;
        for (const side of [-1, 1]) {
          const shade = 0.75 + ((i * 37) % 10) / 40;
          g.strokeStyle = `rgb(${Math.round(70 * shade)},${Math.round(130 * shade)},${Math.round(45 * shade)})`;
          g.lineWidth = 3.2;
          g.beginPath();
          g.moveTo(s / 2, y);
          g.quadraticCurveTo(s / 2 + side * len * 0.6, y - 6, s / 2 + side * len, y + 14);
          g.stroke();
        }
      }
    }),
  );
}

/** grass tuft card */
function grassTuftDrawn() {
  return cachedTex('tuft', () =>
    drawCanvas(128, (g, s) => {
      let seed = 11;
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 38; i++) {
        const x = s / 2 + (r() - 0.5) * s * 0.55;
        const h = s * (0.45 + r() * 0.5);
        const bend = (r() - 0.5) * 30;
        const shade = 0.7 + r() * 0.4;
        g.strokeStyle = `rgb(${Math.round(95 * shade)},${Math.round(135 * shade)},${Math.round(50 * shade)})`;
        g.lineWidth = 2 + r() * 2;
        g.beginPath();
        g.moveTo(x, s);
        g.quadraticCurveTo(x + bend * 0.3, s - h * 0.6, x + bend, s - h);
        g.stroke();
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// photographic foliage composed from CC0 ambientCG atlases
// ---------------------------------------------------------------------------
type Sprite = { x: number; y: number; w: number; h: number };

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

/** draw one atlas sprite centred at (x,y) (or anchored at its base), rotated, `len` px along its long side */
function stamp(g: CanvasRenderingContext2D, img: HTMLCanvasElement, sp: Sprite, x: number, y: number, len: number, rot: number, base = false) {
  const tall = sp.h >= sp.w;
  const k = len / (tall ? sp.h : sp.w);
  const w = sp.w * k, h = sp.h * k;
  g.save();
  g.translate(x, y);
  g.rotate(rot + (tall ? 0 : -Math.PI / 2));
  if (base) g.drawImage(img, sp.x, sp.y, sp.w, sp.h, -w / 2, -h, w, h);
  else g.drawImage(img, sp.x, sp.y, sp.w, sp.h, -w / 2, -h / 2, w, h);
  g.restore();
}

function canvasTexFrom(cv: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

/** darken everything drawn so far (gives canopies inner depth) */
function shadeSoFar(g: CanvasRenderingContext2D, s: number, a: number) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(18,32,8,${a})`;
  g.fillRect(0, 0, s, s);
  g.restore();
}

function atlasOk(name: AtlasName) {
  const a = getAtlas(name);
  return a && a.sprites.length ? a : null;
}

/** canopy card: dense cluster of real photographed leaves */
export function leafCluster() {
  return cachedTex('leaves', () => {
    const a = atlasOk('LeafSet024');
    if (!a) return leafClusterDrawn();
    const s = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d')!;
    const r = seeded(7);
    const layer = (n: number, rad: number, size: number) => {
      for (let i = 0; i < n; i++) {
        const ang = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
        const x = s / 2 + Math.cos(ang) * d, y = s / 2 + Math.sin(ang) * d;
        stamp(g, a.image, a.sprites[Math.floor(r() * a.sprites.length)], x, y, size * (0.75 + r() * 0.5), ang + Math.PI / 2 + (r() - 0.5) * 1.2);
      }
    };
    layer(60, s * 0.3, s * 0.13);
    shadeSoFar(g, s, 0.45);
    layer(70, s * 0.4, s * 0.12);
    shadeSoFar(g, s, 0.12);
    layer(40, s * 0.44, s * 0.11);
    return canvasTexFrom(cv);
  });
}

/** grass tuft card fanned out from real grass blades */
export function grassTuft() {
  return cachedTex('tuft', () => {
    const a1 = atlasOk('Foliage001'), a2 = atlasOk('Foliage006');
    if (!a1 && !a2) return grassTuftDrawn();
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d')!;
    const r = seeded(11);
    for (let i = 0; i < 26; i++) {
      const a = (r() < 0.6 ? a1 : a2) ?? a1 ?? a2!;
      const sp = a.sprites[Math.floor(r() * a.sprites.length)];
      stamp(g, a.image, sp, s / 2 + (r() - 0.5) * s * 0.25, s, s * (0.55 + r() * 0.45), (r() - 0.5) * 1.0, true);
      if (i === 12) shadeSoFar(g, s, 0.3);
    }
    return canvasTexFrom(cv);
  });
}

/** palm frond: a rachis with real blades as leaflets */
export function frondTex() {
  return cachedTex('frond', () => {
    const a = atlasOk('Foliage001');
    if (!a) return frondTexDrawn();
    const s = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d')!;
    const r = seeded(5);
    g.strokeStyle = '#6a5a2a';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(s / 2, s);
    g.quadraticCurveTo(s / 2 + 14, s / 2, s / 2, 6);
    g.stroke();
    for (let i = 0; i < 34; i++) {
      const t = i / 34;
      const y = s - 20 - t * (s - 40);
      const len = (Math.sin(t * Math.PI) * 0.75 + 0.25) * s * 0.48;
      for (const side of [-1, 1]) {
        const sp = a.sprites[Math.floor(r() * a.sprites.length)];
        stamp(g, a.image, sp, s / 2, y, len, side * (Math.PI / 2 - 0.5 - t * 0.3), true);
      }
    }
    return canvasTexFrom(cv);
  });
}
