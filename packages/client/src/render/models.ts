import * as THREE from 'three';
import { CIVS, UNITS, type ArchStyle, type BuildingType, type CivId, type ResourceType, type UnitType } from '@thrones/shared';
import { boxUV, brass, cloth, darkWood, gold, mat, scaleUV, shade, skinMat, steel, wood } from './materials';
import { patchFow } from './fow';
import { getModel, type ModelName, type PbrName } from './assets';
import { buildHuman, charactersReady, holdLegs, play, type HumanLook, type HumanRig } from './characters';
import { buildMount, mountsReady, playMount, seatRider, type MountRig } from './mounts';
import { grassTuft } from './textures';

let riceMat: THREE.MeshStandardMaterial | null = null;
/** rice seedlings: crossed alpha cards that keep an upward normal on both faces */
function rice() {
  if (!riceMat) {
    riceMat = new THREE.MeshStandardMaterial({ map: grassTuft(), alphaTest: 0.4, side: THREE.DoubleSide, color: 0xcdf08a, roughness: 0.8 });
    patchFow(riceMat, (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    }, 'rice');
  }
  return riceMat;
}
const riceGeo = () =>
  cached('riceCard', () => {
    const parts = [0, Math.PI / 2].map((r) => {
      const p = new THREE.PlaneGeometry(0.3, 0.3);
      p.translate(0, 0.15, 0);
      p.rotateY(r);
      const n = p.getAttribute('normal');
      for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
      return p;
    });
    const g = new THREE.BufferGeometry();
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    let off = 0;
    for (const p of parts) {
      pos.push(...(p.getAttribute('position').array as Float32Array));
      nor.push(...(p.getAttribute('normal').array as Float32Array));
      uv.push(...(p.getAttribute('uv').array as Float32Array));
      idx.push(...Array.from(p.index!.array).map((i) => i + off));
      off += p.getAttribute('position').count;
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  });

// ---------------------------------------------------------------------------
// geometry helpers (cached, with world-scaled UVs)
// ---------------------------------------------------------------------------
const gcache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = gcache.get(key);
  if (!g) gcache.set(key, (g = make()));
  return g;
}
const TAU = Math.PI * 2;

export type ArchKind = 'round' | 'pointed' | 'cusped' | 'horseshoe' | 'trabeate';

export const G = {
  box: (w: number, h: number, d: number) => cached(`b${w},${h},${d}`, () => boxUV(new THREE.BoxGeometry(w, h, d), w, h, d)),
  cyl: (rt: number, rb: number, h: number, s = 16, open = false) =>
    cached(`c${rt},${rb},${h},${s},${open}`, () => scaleUV(new THREE.CylinderGeometry(rt, rb, h, s, 1, open), TAU * Math.max(rt, rb), h)),
  cone: (r: number, h: number, s = 16) => cached(`k${r},${h},${s}`, () => scaleUV(new THREE.ConeGeometry(r, h, s), TAU * r, h)),
  sphere: (r: number, w = 20, h = 14) => cached(`s${r},${w},${h}`, () => scaleUV(new THREE.SphereGeometry(r, w, h), TAU * r, Math.PI * r)),
  dome: (r: number, s = 24) =>
    cached(`d${r},${s}`, () => scaleUV(new THREE.SphereGeometry(r, s, 10, 0, TAU, 0, Math.PI / 2), TAU * r, (Math.PI / 2) * r)),
  capsule: (r: number, len: number, rs = 10) => cached(`p${r},${len},${rs}`, () => scaleUV(new THREE.CapsuleGeometry(r, len, 4, rs), TAU * r, len + 2 * r)),
  torus: (R: number, r: number, arc = TAU, rs = 8, ts = 24) =>
    cached(`t${R},${r},${arc},${rs},${ts}`, () => scaleUV(new THREE.TorusGeometry(R, r, rs, ts, arc), TAU * R, TAU * r)),
  lathe: (key: string, pts: [number, number][], segs = 24) =>
    cached(`l${key}${segs}`, () => {
      const maxR = Math.max(...pts.map((p) => p[0]));
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return scaleUV(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs), TAU * maxR, len);
    }),
  onion: (r: number) =>
    G.lathe(
      `onion${r}`,
      [[0, 0], [0.82, 0.02], [1.02, 0.25], [1.08, 0.55], [0.98, 0.85], [0.75, 1.15], [0.45, 1.42], [0.2, 1.65], [0.07, 1.82], [0, 1.9]].map(
        ([x, y]) => [x * r, y * r] as [number, number],
      ),
      28,
    ),
  /** triangular prism (gable roof) along Z */
  gable: (w: number, h: number, d: number) =>
    cached(`g${w},${h},${d}`, () => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0);
      s.lineTo(w / 2, 0);
      s.lineTo(0, h);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
      g.translate(0, 0, -d / 2);
      return g;
    }),
  /** 4-sided pyramid (hip roof) */
  hip: (w: number, h: number) =>
    cached(`h${w},${h}`, () => {
      const g = new THREE.ConeGeometry(w * 0.7071, h, 4, 1);
      g.rotateY(Math.PI / 4);
      return scaleUV(g, w * 4, h * 1.3);
    }),
  /** square frustum (chhajja eaves), centred, height h, unit footprint scaled by mesh */
  frustum: (wTop: number, wBot: number, h: number) =>
    cached(`f${wTop},${wBot},${h}`, () => {
      const g = new THREE.CylinderGeometry(wTop * 0.7071, wBot * 0.7071, h, 4, 1);
      g.rotateY(Math.PI / 4);
      return scaleUV(g, wBot * 4, h * 3);
    }),
  /** wall slab (x: width, y: height, z: thickness) with arched openings, bottom at y=0 */
  archWall: (w: number, h: number, t: number, n: number, aw: number, ah: number, kind: ArchKind, y0 = 0) =>
    cached(`aw${w},${h},${t},${n},${aw},${ah},${kind},${y0}`, () => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0);
      s.lineTo(w / 2, 0);
      s.lineTo(w / 2, h);
      s.lineTo(-w / 2, h);
      s.closePath();
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + (i + 0.5) * (w / n);
        const p = new THREE.Path();
        archPath(p, cx, y0, aw, ah, kind);
        s.holes.push(p);
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 10 });
      g.translate(0, 0, -t / 2);
      return g;
    }),
  /** decorative trefoil merlon (kangura) */
  kangura: (s: number) =>
    cached(`kg${s}`, () => {
      const sh = new THREE.Shape();
      sh.moveTo(-s / 2, 0);
      sh.lineTo(s / 2, 0);
      sh.lineTo(s / 2, s * 0.7);
      sh.absarc(s * 0.25, s * 0.85, s * 0.2, -Math.PI / 2, Math.PI, false);
      sh.absarc(0, s * 1.15, s * 0.22, 0, Math.PI, false);
      sh.absarc(-s * 0.25, s * 0.85, s * 0.2, 0, Math.PI * 1.5, false);
      sh.lineTo(-s / 2, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: s * 0.35, bevelEnabled: false, curveSegments: 6 });
      g.translate(0, 0, -s * 0.175);
      return g;
    }),
};

function archPath(p: THREE.Path, cx: number, y0: number, w: number, h: number, kind: ArchKind) {
  const hw = w / 2;
  p.moveTo(cx - hw, y0);
  p.lineTo(cx + hw, y0);
  if (kind === 'round') {
    const sp = y0 + h - hw;
    p.lineTo(cx + hw, sp);
    p.absarc(cx, sp, hw, 0, Math.PI, false);
  } else if (kind === 'horseshoe') {
    const R = hw * 1.12;
    const th = Math.acos(hw / R);
    const cy = y0 + h - R;
    p.lineTo(cx + hw, cy - R * Math.sin(th));
    p.absarc(cx, cy, R, -th, Math.PI + th, false);
  } else if (kind === 'trabeate') {
    const top = y0 + h;
    p.lineTo(cx + hw, top - hw * 0.35);
    p.lineTo(cx + hw * 0.72, top - hw * 0.1);
    p.lineTo(cx + hw * 0.6, top);
    p.lineTo(cx - hw * 0.6, top);
    p.lineTo(cx - hw * 0.72, top - hw * 0.1);
    p.lineTo(cx - hw, top - hw * 0.35);
  } else {
    // pointed (optionally cusped / multifoil)
    const off = 0.6 * hw, R = 1.6 * hw, rise = Math.sqrt(R * R - off * off);
    const sp = y0 + h - rise;
    p.lineTo(cx + hw, sp);
    const N = 22;
    const pts: [number, number][] = [];
    const a1 = Math.atan2(rise, off);
    for (let i = 1; i <= N; i++) {
      const a = (a1 * i) / N;
      pts.push([cx - off + Math.cos(a) * R, sp + Math.sin(a) * R]);
    }
    for (let i = N - 1; i >= 0; i--) {
      const a = (a1 * i) / N;
      pts.push([cx + off - Math.cos(a) * R, sp + Math.sin(a) * R]);
    }
    if (kind === 'cusped') {
      for (let i = 0; i < pts.length; i++) {
        const t = i / (pts.length - 1);
        const lobe = Math.abs(Math.sin(t * Math.PI * 5)) * hw * 0.13;
        const [x, y] = pts[i];
        const dx = cx - x, dy = sp - y;
        const l = Math.hypot(dx, dy) || 1;
        pts[i] = [x + (dx / l) * lobe, y + (dy / l) * lobe * 0.6];
      }
    }
    for (const [x, y] of pts) p.lineTo(x, y);
  }
  p.lineTo(cx - hw, y0);
}

export function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// architecture styles
// ---------------------------------------------------------------------------
export interface Style {
  key: ArchStyle;
  wall: THREE.Material;
  inner: THREE.Material;
  trim: THREE.Material;
  plinth: THREE.Material;
  roof: THREE.Material;
  dome: THREE.Material;
  accent: THREE.Material;
  frieze: THREE.Material;
  pillar: THREE.Material;
  floor: THREE.Material;
  arch: ArchKind;
  crown: 'stupa' | 'gopuram' | 'onion' | 'chhatri' | 'fort' | 'mandapa';
  smallRoof: 'barrel' | 'gable' | 'dome' | 'flat' | 'hip';
  parapet: 'kangura' | 'crenel' | 'none';
  base: number;
}

const styleCache = new Map<ArchStyle, Style>();

export function styleOf(civ: CivId): Style {
  const key = CIVS[civ].arch;
  const hit = styleCache.get(key);
  if (hit) return hit;
  // photo-scanned materials (CC0), re-tinted to each civilization's palette
  const X = (pbr: PbrName, c: number, scale = 1, extra: Parameters<typeof mat>[1] = {}) => mat(c, { pbr, scale, ...extra });
  const A = (c: number, large = false) => X(large ? 'sandstone_large' : 'sandstone', c, large ? 0.7 : 1.0);
  const P = (c: number) => X('plaster', c, 0.8);
  const F = (c: number) => mat(c, { tex: 'frieze', scale: 2, normal: 1.2 });
  // terracotta roofs keep the scan's natural colour; c only adjusts brightness
  const tiles = (c: number) => mat(0xffffff, { pbr: 'roof_tiles', scale: 1.2, raw: true, rough: 0.6 + (c & 0) });
  let s: Omit<Style, 'floor'>;
  switch (key) {
    case 'mauryan':
      s = { key, wall: A(0xd8b88c), inner: P(0x5e4a36), trim: P(0xc9a675), plinth: A(0xb09070, true), roof: X('thatch', 0xa8844e, 1), dome: X('clay_plaster', 0xeee2cc, 0.8), accent: X('marble', 0xead6aa, 1, { rough: 0.3 }), frieze: F(0xd4b386), pillar: X('marble', 0xece0c4, 1, { rough: 0.25 }), arch: 'horseshoe', crown: 'stupa', smallRoof: 'barrel', parapet: 'none', base: 0xdcbc8e };
      break;
    case 'dravidian':
      s = { key, wall: X('granite', 0xc9b498, 1), inner: P(0x4e3c2e), trim: P(0xb89a74), plinth: X('granite', 0x9e8a72, 0.7), roof: tiles(0xa8502c), dome: X('clay_plaster', 0xd9a66c, 0.8), accent: gold(), frieze: F(0xc8ac86), pillar: X('granite', 0xc2ab8c, 1), arch: 'trabeate', crown: 'gopuram', smallRoof: 'gable', parapet: 'none', base: 0xcfb796 };
      break;
    case 'mughal':
      s = { key, wall: X('marble', 0xf1ede4, 0.8), inner: P(0x7a6a5a), trim: X('red_sandstone', 0xa85a42, 1), plinth: X('red_sandstone', 0x9e5440, 0.7), roof: X('marble', 0xefebe2, 0.8), dome: X('marble', 0xf6f3ec, 0.6, { rough: 0.2 }), accent: X('red_sandstone', 0xa85a42, 1), frieze: F(0xece4d4), pillar: X('marble', 0xf0ebe0, 1), arch: 'cusped', crown: 'onion', smallRoof: 'dome', parapet: 'kangura', base: 0xf4f0e8 };
      break;
    case 'rajput':
      s = { key, wall: A(0xe2bb82), inner: P(0x5a3e2c), trim: P(0xd6a468), plinth: A(0xb8855a, true), roof: P(0xeedcbc), dome: X('clay_plaster', 0xf0e2c6, 0.8), accent: P(0xc23b22), frieze: F(0xdab27c), pillar: A(0xe6c690), arch: 'cusped', crown: 'chhatri', smallRoof: 'flat', parapet: 'kangura', base: 0xe6c088 };
      break;
    case 'maratha':
      s = { key, wall: X('basalt', 0x6a625a, 1), inner: P(0x2a2420), trim: X('basalt', 0x847a70, 1), plinth: X('basalt', 0x4e4740, 0.7), roof: tiles(0x8e4428), dome: P(0x857a70), accent: mat(0xf08a24, { tex: 'fabric', scale: 3 }), frieze: F(0x7e746a), pillar: X('wood', 0x6e4a2c, 1.5), arch: 'pointed', crown: 'fort', smallRoof: 'hip', parapet: 'crenel', base: 0x6c645c };
      break;
    default:
      s = { key, wall: X('granite', 0xb8b0a0, 0.8), inner: P(0x463f38), trim: P(0xa69c8a), plinth: X('granite', 0x8e877a, 0.6), roof: tiles(0x8a7a68), dome: X('clay_plaster', 0xd8cbb0, 0.8), accent: gold(), frieze: F(0xb2a896), pillar: X('granite', 0xb8ae9c, 1), arch: 'trabeate', crown: 'mandapa', smallRoof: 'gable', parapet: 'none', base: 0xbcb4a4 };
  }
  const floorColor: Record<ArchStyle, number> = {
    mauryan: 0xd8c4a0, dravidian: 0xc4b49c, mughal: 0xe9e2d4, rajput: 0xe2c8a0, maratha: 0x8a8076, vijayanagara: 0xb8b0a2,
  };
  const floor = key === 'mughal' ? X('marble', floorColor[key], 0.5) : key === 'mauryan' || key === 'rajput' ? X('red_sandstone_floor', floorColor[key], 0.6) : X('stone_floor', floorColor[key], 0.6);
  const full: Style = { ...s, floor };
  styleCache.set(key, full);
  return full;
}

// ---------------------------------------------------------------------------
// architectural kit
// ---------------------------------------------------------------------------
function kalash(parent: THREE.Object3D, y: number, s = 1) {
  const g = gold();
  add(parent, G.cyl(0.03 * s, 0.05 * s, 0.04 * s, 12), g, 0, y + 0.02 * s, 0);
  add(parent, G.sphere(0.055 * s, 14, 10), g, 0, y + 0.09 * s, 0);
  add(parent, G.cyl(0.02 * s, 0.03 * s, 0.05 * s, 10), g, 0, y + 0.16 * s, 0);
  add(parent, G.sphere(0.035 * s, 12, 8), g, 0, y + 0.21 * s, 0);
  add(parent, G.cone(0.018 * s, 0.14 * s, 8), g, 0, y + 0.3 * s, 0);
}

/** turned column: base, shaft, capital */
function pillar(parent: THREE.Object3D, S: Style, x: number, y: number, z: number, h: number, r = 0.05) {
  const octa = S.key === 'dravidian' || S.key === 'vijayanagara';
  const geo = G.lathe(
    `pil${h},${r}`,
    [
      [0, 0], [r * 1.6, 0], [r * 1.6, h * 0.05], [r * 1.25, h * 0.08], [r * 1.05, h * 0.12],
      [r * 0.92, h * 0.8], [r * 1.15, h * 0.83], [r * 0.95, h * 0.86], [r * 1.5, h * 0.93], [r * 1.6, h], [0, h],
    ],
    octa ? 8 : 16,
  );
  return add(parent, geo, S.pillar, x, y, z);
}

/** stepped plinth; returns top height */
function plinth(g: THREE.Object3D, S: Style, w: number, d: number, h: number, tiers = 2): number {
  let y = -0.25;
  const step = (h + 0.25) / tiers;
  for (let i = 0; i < tiers; i++) {
    const inset = i * 0.14;
    const m = add(g, G.box(w - inset, step, d - inset), S.plinth, 0, y + step / 2, 0);
    m.castShadow = i > 0;
    y += step;
  }
  const iw = w - (tiers - 1) * 0.14, id = d - (tiers - 1) * 0.14;
  add(g, G.box(iw + 0.04, 0.035, id + 0.04), S.trim, 0, h - 0.015, 0);
  add(g, G.box(iw - 0.08, 0.02, id - 0.08), S.floor, 0, h + 0.008, 0, false);
  return h;
}

function steps(g: THREE.Object3D, S: Style, w: number, z: number, h: number, n = 3) {
  for (let i = 0; i < n; i++) {
    const sh = (h / n) * (n - i);
    add(g, G.box(w, sh, 0.12), S.plinth, 0, sh / 2 - 0.02, z + i * 0.12);
  }
}

/** chhajja: sloping stone eave with a cornice band */
function chhajja(g: THREE.Object3D, S: Style, w: number, d: number, y: number, over = 0.22) {
  const m = add(g, G.frustum(1, 1 + (over * 2) / Math.max(w, d), 0.08), S.trim, 0, y, 0);
  m.scale.set(w, 1, d);
  add(g, G.box(w + 0.03, 0.05, d + 0.03), S.trim, 0, y + 0.06, 0);
}

function parapet(g: THREE.Object3D, S: Style, w: number, d: number, y: number) {
  // roof terrace in the floor stone, with a trim band only around the edge
  const band = (h: number) => {
    add(g, G.box(w, h, d), S.floor, 0, y + h / 2, 0);
    for (const sd of [-1, 1]) {
      add(g, G.box(w + 0.01, h + 0.01, 0.07), S.trim, 0, y + h / 2, sd * (d / 2 - 0.03));
      add(g, G.box(0.07, h + 0.01, d + 0.01), S.trim, sd * (w / 2 - 0.03), y + h / 2, 0);
    }
  };
  if (S.parapet === 'none') {
    band(0.08);
    return;
  }
  band(0.06);
  const size = 0.13;
  const geo = S.parapet === 'kangura' ? G.kangura(size) : G.box(size, size * 1.1, size * 0.5);
  const yy = S.parapet === 'kangura' ? y + 0.06 : y + 0.06 + size * 0.55;
  for (const [len, axis] of [[w, 'x'], [d, 'z']] as const) {
    const n = Math.max(2, Math.floor(len / (size * 1.6)));
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + (i + 0.5) * (len / n);
      for (const side of [-1, 1]) {
        const off = (axis === 'x' ? d : w) / 2 - 0.04;
        const m = add(g, geo, S.wall, axis === 'x' ? t : side * off, yy, axis === 'x' ? side * off : t);
        if (axis === 'z') m.rotation.y = Math.PI / 2;
      }
    }
  }
}

/** onion or hemispherical dome on a drum with a lotus base, topped by a kalash */
function domeOn(g: THREE.Object3D, S: Style, r: number, y: number, kind: 'onion' | 'hemi' = 'onion', drum = 0.25) {
  if (drum > 0) {
    add(g, G.cyl(r * 0.92, r * 0.95, drum, 24), S.wall, 0, y + drum / 2, 0);
    add(g, G.cyl(r * 0.97, r * 0.97, 0.04, 24), S.trim, 0, y + drum, 0);
  }
  const by = y + drum;
  const petals = 16;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * TAU;
    const p = add(g, G.sphere(r * 0.2, 8, 6), S.dome, Math.cos(a) * r * 0.82, by + r * 0.06, Math.sin(a) * r * 0.82);
    p.scale.set(0.6, 0.45, 1);
    p.rotation.y = -a;
    p.castShadow = false;
  }
  if (kind === 'onion') {
    add(g, G.onion(r), S.dome, 0, by, 0);
    kalash(g, by + r * 1.86, r * 1.6);
  } else {
    add(g, G.dome(r, 28), S.dome, 0, by, 0);
    kalash(g, by + r * 0.98, r * 1.6);
  }
}

/** open pavilion: four pillars, an eave and a small dome */
function chhatri(g: THREE.Object3D, S: Style, x: number, y: number, z: number, r: number) {
  const p = pivot(g, x, y, z);
  add(p, G.box(r * 2.1, 0.05, r * 2.1), S.trim, 0, 0.025, 0);
  const h = r * 1.5;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pillar(p, S, a * r * 0.78, 0.05, b * r * 0.78, h, r * 0.07);
  chhajja(p, S, r * 1.9, r * 1.9, h + 0.05, r * 0.25);
  domeOn(p, S, r * 0.75, h + 0.14, 'hemi', 0.0);
  return p;
}

/** arched facade on one side of a block, with a dark recess behind the openings */
function facade(g: THREE.Object3D, S: Style, w: number, h: number, n: number, x: number, y: number, z: number, rotY: number, kind = S.arch) {
  if (n <= 0) {
    const m = add(g, G.box(w, h, 0.1), S.wall, x, y + h / 2, z);
    m.rotation.y = rotY;
  } else {
    const aw = Math.min((w / n) * 0.62, 0.7);
    const ah = Math.min(h * 0.62, aw * 2.1);
    const m = add(g, G.archWall(w, h, 0.1, n, aw, ah, kind, 0.02), S.wall, x, y, z);
    m.rotation.y = rotY;
    const back = add(g, G.box(w - 0.04, h - 0.04, 0.02), S.inner, x - Math.sin(rotY) * 0.07, y + h / 2, z - Math.cos(rotY) * 0.07, false);
    back.rotation.y = rotY;
  }
  const fb = add(g, G.box(w + 0.01, 0.09, 0.11), S.frieze, x, y + h - 0.07, z);
  fb.rotation.y = rotY;
}

/** a block of rooms with arcaded faces; returns the roof deck height */
function hall(g: THREE.Object3D, S: Style, w: number, d: number, h: number, y: number, arches: [number, number, number, number], kind = S.arch): number {
  add(g, G.box(w - 0.12, h, d - 0.12), S.inner, 0, y + h / 2, 0, false);
  const [front, back, left, right] = arches;
  facade(g, S, w, h, front, 0, y, d / 2 - 0.05, 0, kind);
  facade(g, S, w, h, back, 0, y, -d / 2 + 0.05, Math.PI, kind);
  facade(g, S, d - 0.2, h, left, -w / 2 + 0.05, y, 0, -Math.PI / 2, kind);
  facade(g, S, d - 0.2, h, right, w / 2 - 0.05, y, 0, Math.PI / 2, kind);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(g, G.box(0.12, h + 0.02, 0.12), S.trim, a * (w / 2 - 0.03), y + h / 2, b * (d / 2 - 0.03));
  const top = y + h;
  add(g, G.box(w - 0.02, 0.06, d - 0.02), S.wall, 0, top + 0.03, 0);
  chhajja(g, S, w, d, top + 0.02);
  // roof terrace
  add(g, G.box(w - 0.06, 0.03, d - 0.06), S.floor, 0, top + 0.105, 0, false);
  return top + 0.12;
}

function door(g: THREE.Object3D, x: number, y: number, z: number, w: number, h: number) {
  add(g, G.box(w, h, 0.03), darkWood(), x, y + h / 2, z, false);
  for (const s of [-1, 1]) add(g, G.sphere(0.012, 6, 4), brass(), x + s * w * 0.15, y + h * 0.5, z + 0.02, false);
}

function flag(parent: THREE.Object3D, pc: number, x: number, y: number, z: number, h = 0.9, size = 1) {
  const p = pivot(parent, x, y, z);
  add(p, G.cyl(0.015, 0.02, h, 8), darkWood(), 0, h / 2, 0);
  add(p, G.sphere(0.03, 8, 6), gold(), 0, h + 0.02, 0);
  const f = pivot(p, 0, h - 0.1 * size, 0);
  add(f, G.box(0.008, 0.18 * size, 0.32 * size), cloth(pc), 0, 0, 0.16 * size, false);
  const tip = add(f, G.cone(0.09 * size, 0.12 * size, 3), cloth(pc), 0, 0, 0.36 * size, false);
  tip.rotation.x = Math.PI / 2;
  tip.scale.set(0.1, 1, 1);
  f.userData.flag = true;
  return p;
}

function smallRoof(g: THREE.Object3D, S: Style, w: number, d: number, y: number) {
  switch (S.smallRoof) {
    case 'barrel': {
      const geo = cached(`barrel${w},${d}`, () => {
        const c = new THREE.CylinderGeometry(w / 2, w / 2, d + 0.16, 18, 1, false, -Math.PI / 2, Math.PI);
        c.rotateX(-Math.PI / 2);
        return scaleUV(c, d * 2, w * 2);
      });
      add(g, geo, S.roof, 0, y, 0).scale.set(1.08, 0.8, 1);
      for (const s of [-1, 1]) add(g, G.torus(w / 2, 0.035, Math.PI, 6, 16), darkWood(), 0, y, s * (d / 2 + 0.08)).scale.set(1.08, 0.8, 1);
      break;
    }
    case 'gable':
      add(g, G.gable(w + 0.3, w * 0.42, d + 0.3), S.roof, 0, y, 0);
      add(g, G.cyl(0.03, 0.03, d + 0.32, 8), S.trim, 0, y + w * 0.42, 0).rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) kalash(pivot(g, 0, 0, s * (d / 2 + 0.1)), y + w * 0.42, 0.6);
      break;
    case 'dome':
      parapet(g, S, w, d, y);
      domeOn(g, S, Math.min(w, d) * 0.24, y + 0.04, 'onion', 0.08);
      break;
    case 'flat':
      parapet(g, S, w, d, y);
      chhatri(g, S, 0, y + 0.05, 0, Math.min(w, d) * 0.22);
      break;
    case 'hip':
      add(g, G.hip(Math.max(w, d) + 0.35, 0.55), S.roof, 0, y + 0.27, 0).scale.set(1, 1, d / w);
      add(g, G.sphere(0.04, 8, 6), S.trim, 0, y + 0.56, 0);
      break;
  }
}

/** place a photo-scanned prop (CC0); `size` = footprint width in world units. Returns false if unavailable. */
function prop(g: THREE.Object3D, name: ModelName, x: number, y: number, z: number, size: number, rot = 0): boolean {
  const m = getModel(name);
  if (!m) return false;
  const p = pivot(g, x, y, z);
  p.rotation.y = rot;
  p.scale.setScalar(size);
  for (const part of m.parts) add(p, part.geometry, part.material);
  return true;
}

function pot(g: THREE.Object3D, x: number, y: number, z: number, s = 1) {
  if (prop(g, s > 0.9 ? 'clay_pot' : 'brass_pot', x, y, z, 0.17 * s, x * 3)) return;
  const m = mat(0xa0522d, { tex: 'plaster' });
  add(g, G.lathe('pot', [[0, 0], [0.05, 0], [0.085, 0.05], [0.09, 0.09], [0.06, 0.14], [0.045, 0.16], [0.055, 0.18], [0, 0.18]], 14), m, x, y, z).scale.setScalar(s);
}

function sack(g: THREE.Object3D, x: number, y: number, z: number, s = 1) {
  if (s > 0.8 && prop(g, 'basket', x, y, z, 0.28 * s, z * 5)) return;
  const m = add(g, G.sphere(0.13, 12, 10), mat(0xc2a476, { tex: 'fabric', scale: 4 }), x, y + 0.1 * s, z);
  m.scale.set(s, s * 0.8, s);
}

function charpai(g: THREE.Object3D, x: number, y: number, z: number, rot: number) {
  const p = pivot(g, x, y, z);
  p.rotation.y = rot;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(p, G.cyl(0.02, 0.02, 0.16, 6), wood(), a * 0.22, 0.08, b * 0.12);
  add(p, G.box(0.5, 0.025, 0.3), mat(0xd8c49a, { tex: 'thatch', scale: 4 }), 0, 0.16, 0);
}

// ---------------------------------------------------------------------------
// crowns (signature rooftop of the Durbar)
// ---------------------------------------------------------------------------
function crown(g: THREE.Object3D, S: Style, y: number) {
  switch (S.crown) {
    case 'onion': {
      domeOn(g, S, 0.62, y, 'onion', 0.3);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) chhatri(g, S, x * 0.95, y, z * 0.95, 0.2);
      for (const [x, z] of [[-1.72, -1.72], [1.72, -1.72], [-1.72, 1.72], [1.72, 1.72]]) {
        const m = pivot(g, x, 0.2, z);
        add(m, G.cyl(0.09, 0.12, 2.6, 12), S.wall, 0, 1.3, 0);
        for (const hh of [0.9, 1.75]) add(m, G.cyl(0.16, 0.12, 0.06, 12), S.trim, 0, hh, 0);
        chhatri(m, S, 0, 2.6, 0, 0.14);
      }
      break;
    }
    case 'chhatri':
      chhatri(g, S, 0, y, 0, 0.5);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) chhatri(g, S, x * 0.98, y, z * 0.98, 0.24);
      break;
    case 'stupa': {
      add(g, G.cyl(0.95, 1.0, 0.22, 32), S.trim, 0, y + 0.11, 0);
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU;
        add(g, G.box(0.04, 0.16, 0.04), S.pillar, Math.cos(a) * 1.02, y + 0.3, Math.sin(a) * 1.02);
      }
      add(g, G.torus(1.02, 0.018, TAU, 4, 48), S.pillar, 0, y + 0.36, 0).rotation.x = Math.PI / 2;
      add(g, G.dome(0.85, 32), S.dome, 0, y + 0.22, 0);
      add(g, G.box(0.32, 0.18, 0.32), S.trim, 0, y + 1.12, 0);
      add(g, G.cyl(0.018, 0.018, 0.55, 6), darkWood(), 0, y + 1.45, 0);
      for (let i = 0; i < 3; i++) add(g, G.cyl(0.22 - i * 0.05, 0.22 - i * 0.05, 0.03, 20), S.accent, 0, y + 1.32 + i * 0.13, 0);
      // Ashoka pillar with lion capital
      const p = pivot(g, 1.55, 0.2, 1.55);
      add(p, G.cyl(0.07, 0.09, 2.0, 16), S.pillar, 0, 1.0, 0);
      add(p, G.lathe('bell', [[0.06, 0], [0.13, 0.04], [0.12, 0.12], [0.07, 0.16]], 16), S.pillar, 0, 2.0, 0);
      add(p, G.cyl(0.11, 0.11, 0.06, 16), S.accent, 0, 2.2, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        const lion = add(p, G.sphere(0.06, 10, 8), gold(), Math.cos(a) * 0.05, 2.3, Math.sin(a) * 0.05);
        lion.scale.set(0.8, 1, 1.3);
        lion.rotation.y = -a;
      }
      add(p, G.torus(0.05, 0.012, TAU, 6, 16), gold(), 0, 2.42, 0);
      break;
    }
    case 'gopuram': {
      let w = 2.1, d = 1.6, yy = y;
      for (let i = 0; i < 5; i++) {
        add(g, G.box(w, 0.3, d), S.dome, 0, yy + 0.15, 0);
        add(g, G.box(w + 0.08, 0.05, d + 0.08), S.trim, 0, yy + 0.32, 0);
        const n = Math.max(2, Math.round(w / 0.45));
        for (let k = 0; k < n; k++) {
          const x = -w / 2 + (k + 0.5) * (w / n);
          for (const s of [-1, 1]) add(g, G.sphere(0.05, 8, 6), S.dome, x, yy + 0.38, s * (d / 2));
        }
        yy += 0.34;
        w *= 0.82;
        d *= 0.82;
      }
      const geo = cached('gtop', () => {
        const c = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16, 1, false, -Math.PI / 2, Math.PI);
        c.rotateZ(Math.PI / 2);
        return scaleUV(c, 2, 1);
      });
      add(g, geo, S.roof, 0, yy, 0);
      for (const x of [-0.3, 0, 0.3]) kalash(pivot(g, x, 0, 0), yy + 0.28, 1.1);
      break;
    }
    case 'mandapa': {
      add(g, G.box(2.4, 0.08, 2.4), S.trim, 0, y + 0.04, 0);
      for (let i = -2; i <= 2; i++)
        for (const j of [-2, 2]) {
          pillar(g, S, i * 0.52, y + 0.08, j * 0.52, 0.62, 0.05);
          if (Math.abs(i) !== 2) pillar(g, S, j * 0.52, y + 0.08, i * 0.52, 0.62, 0.05);
        }
      chhajja(g, S, 2.3, 2.3, y + 0.72);
      let w = 1.5, yy = y + 0.82;
      for (let i = 0; i < 4; i++) {
        add(g, G.box(w, 0.26, w), i % 2 ? S.dome : S.wall, 0, yy + 0.13, 0);
        add(g, G.box(w + 0.06, 0.04, w + 0.06), S.trim, 0, yy + 0.27, 0);
        yy += 0.28;
        w *= 0.76;
      }
      add(g, G.dome(0.3, 20), S.dome, 0, yy, 0);
      kalash(g, yy + 0.29, 1.2);
      break;
    }
    case 'fort': {
      for (const [x, z] of [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]]) {
        add(g, G.cyl(0.42, 0.52, 1.25, 16), S.wall, x, y - 0.42, z);
        add(g, G.cyl(0.46, 0.46, 0.06, 16), S.trim, x, y + 0.22, z);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU;
          add(g, G.box(0.1, 0.14, 0.08), S.wall, x + Math.cos(a) * 0.4, y + 0.32, z + Math.sin(a) * 0.4).rotation.y = -a;
        }
      }
      add(g, G.box(1.4, 0.55, 1.4), mat(0x6e4a2c, { tex: 'planks', scale: 2 }), 0, y + 0.28, 0);
      for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) add(g, G.box(0.05, 0.55, 0.05), darkWood(), i * 0.33, y + 0.28, s * 0.72);
      add(g, G.hip(1.85, 0.6), S.roof, 0, y + 0.85, 0);
      flag(g, 0xf08a24, 0, y + 1.1, 0, 1.6, 1.8); // Bhagwa Dhwaj
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// buildings
// ---------------------------------------------------------------------------
export function buildBuilding(type: BuildingType, civ: CivId, pc: number): THREE.Group {
  const S = styleOf(civ);
  const g = new THREE.Group();
  switch (type) {
    case 'town_center': {
      const top = plinth(g, S, 3.95, 3.95, 0.32, 3);
      steps(g, S, 1.0, 1.98, 0.32);
      const roof = hall(g, S, 2.7, 2.7, 1.25, top, [3, 3, 3, 3]);
      door(g, 0, top, 1.3, 0.34, 0.62);
      if (S.parapet !== 'none') parapet(g, S, 2.7, 2.7, roof);
      crown(g, S, roof + (S.parapet === 'none' ? 0 : 0.06));
      for (const [x, z] of [[-1.85, 1.85], [1.85, 1.85]]) flag(g, pc, x, top, z, 1.5, 1.3);
      pot(g, -1.5, top, 1.6);
      pot(g, -1.35, top, 1.72, 0.8);
      prop(g, 'basket', 1.45, top, 1.6, 0.28, 0.8);
      prop(g, 'crate', 1.6, top, 1.25, 0.26, 0.3);
      break;
    }
    case 'house': {
      const top = plinth(g, S, 1.75, 1.75, 0.12, 2);
      const roof = hall(g, S, 1.3, 1.1, 0.72, top, [1, 0, 1, 0]);
      door(g, 0, top, 0.5, 0.2, 0.36);
      smallRoof(g, S, 1.3, 1.1, roof);
      const aw = add(g, G.box(0.55, 0.02, 0.28), cloth(pc), 0, top + 0.68, 0.7);
      aw.rotation.x = 0.35;
      for (const s of [-1, 1]) add(g, G.cyl(0.012, 0.012, 0.6, 6), wood(), s * 0.26, top + 0.3, 0.82);
      pot(g, -0.62, top, 0.66);
      pot(g, -0.5, top, 0.74, 0.75);
      charpai(g, 0.55, top, 0.6, 0.3);
      break;
    }
    case 'storehouse': {
      const top = plinth(g, S, 1.8, 1.8, 0.12, 2);
      const hg = pivot(g, 0, 0, -0.3);
      const roof = hall(hg, S, 1.45, 0.95, 0.85, top, [1, 0, 0, 0]);
      smallRoof(hg, S, 1.45, 0.95, roof);
      if (!prop(g, 'log', -0.4, top, 0.6, 0.75, 0.1) || !prop(g, 'log', -0.45, top + 0.06, 0.48, 0.7, -0.05)) {
        for (let i = 0; i < 6; i++) {
          const l = add(g, G.cyl(0.06, 0.06, 0.7, 10), wood(), -0.55 + (i % 3) * 0.13, top + 0.06 + Math.floor(i / 3) * 0.11, 0.55);
          l.rotation.x = Math.PI / 2;
        }
      }
      if (!prop(g, 'barrels', 0.45, top, 0.45, 0.62, 2.4)) add(g, G.box(0.24, 0.24, 0.24), wood(), 0.65, top + 0.12, 0.75);
      prop(g, 'crate', 0.7, top, 0.78, 0.26, 0.4);
      sack(g, 0.1, top, 0.72);
      flag(g, pc, 0.78, top, -0.78, 1.1);
      break;
    }
    case 'farm': {
      add(g, G.box(2.9, 0.12, 2.9), mat(0x6a5236, { tex: 'plaster', scale: 2 }), 0, -0.02, 0, false);
      add(g, G.box(2.62, 0.02, 2.62), mat(0x4b7a78, { rough: 0.12, metal: 0.1 }), 0, 0.05, 0, false);
      for (const [x, z, w, d] of [[0, 1.38, 2.9, 0.16], [0, -1.38, 2.9, 0.16], [1.38, 0, 0.16, 2.9], [-1.38, 0, 0.16, 2.9], [0, 0, 2.6, 0.08]])
        add(g, G.box(w, 0.1, d), mat(0x7a5c3a, { tex: 'plaster', scale: 3 }), x, 0.07, z, false);
      const crops = new THREE.Group();
      crops.name = 'crops';
      for (let i = 0; i < 9; i++)
        for (let j = 0; j < 9; j++) {
          if (j === 4) continue; // central bund
          const c = add(crops, riceGeo(), rice(), -1.15 + i * 0.29 + (j % 2) * 0.07, 0.05, -1.15 + j * 0.29, false);
          c.rotation.y = i * 1.3 + j;
          c.scale.setScalar(0.85 + ((i * 7 + j * 3) % 5) * 0.08);
        }
      g.add(crops);
      add(g, G.cyl(0.015, 0.015, 0.6, 6), darkWood(), 1.3, 0.3, 1.3);
      add(g, G.box(0.18, 0.22, 0.01), cloth(pc), 1.3, 0.48, 1.36);
      break;
    }
    case 'barracks': {
      const top = plinth(g, S, 2.85, 2.85, 0.14, 2);
      const hg = pivot(g, 0, 0, -0.55);
      const roof = hall(hg, S, 2.5, 1.3, 0.95, top, [5, 0, 1, 1]);
      door(hg, 0, top, 0.6, 0.26, 0.48);
      smallRoof(hg, S, 2.5, 1.3, roof);
      add(g, G.box(0.9, 0.05, 0.08), darkWood(), -0.65, top + 0.55, 0.95);
      for (const s of [-1, 1]) add(g, G.box(0.05, 0.6, 0.05), darkWood(), -0.65 + s * 0.45, top + 0.3, 0.95);
      for (let i = 0; i < 5; i++) {
        const sp = add(g, G.cyl(0.01, 0.01, 1.0, 5), wood(), -1.0 + i * 0.17, top + 0.5, 0.95);
        sp.rotation.x = 0.12;
        add(g, G.cone(0.025, 0.1, 6), steel(), -1.0 + i * 0.17, top + 1.02, 1.01);
      }
      prop(g, 'barrels', 1.15, top, -0.05, 0.5, 1.2);
      prop(g, 'crate', 1.12, top, 0.45, 0.24, 0.3);
      add(g, G.cyl(0.03, 0.03, 0.8, 8), wood(), 0.75, top + 0.4, 0.95);
      add(g, G.box(0.42, 0.05, 0.05), wood(), 0.75, top + 0.62, 0.95);
      add(g, G.sphere(0.12, 10, 8), mat(0xc9b48a, { tex: 'thatch', scale: 4 }), 0.75, top + 0.82, 0.95);
      flag(g, pc, -1.3, top, 1.3, 1.5, 1.2);
      flag(g, pc, 1.3, top, 1.3, 1.5, 1.2);
      break;
    }
    case 'archery_range': {
      const top = plinth(g, S, 2.85, 2.85, 0.08, 1);
      for (const [x, z, r] of [[0, -1.32, 0], [-1.32, 0, Math.PI / 2], [1.32, 0, -Math.PI / 2]] as const) {
        const m = add(g, G.archWall(2.8, 0.45, 0.12, 6, 0.22, 0.28, S.arch, 0.1), S.wall, x, top, z);
        m.rotation.y = r;
        add(g, G.box(r ? 0.16 : 2.8, 0.05, r ? 2.8 : 0.16), S.trim, x, top + 0.47, z);
      }
      chhatri(g, S, -0.75, top, -0.75, 0.42);
      for (const [x, z] of [[0.55, -0.7], [0.95, 0.25], [0.35, 0.95]]) {
        add(g, G.cyl(0.02, 0.02, 0.62, 6), darkWood(), x, top + 0.31, z - 0.1);
        const butt = add(g, G.cyl(0.24, 0.24, 0.12, 20), mat(0xd8c08a, { tex: 'thatch', scale: 4 }), x, top + 0.55, z);
        butt.rotation.x = Math.PI / 2 - 0.15;
        for (const [rr, c] of [[0.17, pc], [0.08, 0xd4af37]] as const) {
          const ring = add(g, G.cyl(rr, rr, 0.125, 20), mat(c, { tex: 'fabric', scale: 4 }), x, top + 0.55, z + 0.001);
          ring.rotation.x = Math.PI / 2 - 0.15;
        }
      }
      flag(g, pc, -1.25, top, 1.25, 1.4, 1.2);
      break;
    }
    case 'stable': {
      const top = plinth(g, S, 2.85, 2.85, 0.08, 1);
      const hg = pivot(g, 0, 0, -0.65);
      const roof = hall(hg, S, 2.55, 1.05, 0.8, top, [3, 0, 1, 1], S.arch === 'trabeate' ? 'trabeate' : 'round');
      const roofMat = S.smallRoof === 'gable' || S.smallRoof === 'hip' ? S.roof : mat(0x9a5a34, { tex: 'tiles', scale: 1.5 });
      add(hg, G.gable(2.85, 0.5, 1.35), roofMat, 0, roof, 0).rotation.y = 0;
      for (let i = -3; i <= 3; i++) add(g, G.cyl(0.03, 0.035, 0.42, 8), wood(), i * 0.4, top + 0.21, 1.25);
      for (const yy of [0.18, 0.36]) add(g, G.box(2.5, 0.04, 0.04), wood(), 0, top + yy, 1.25);
      const hay = add(g, G.sphere(0.32, 12, 8), mat(0xd9b84a, { tex: 'thatch', scale: 3 }), -0.85, top + 0.14, 0.45);
      hay.scale.set(1, 0.55, 1);
      prop(g, 'basket', -0.35, top, 0.75, 0.26, 0.6);
      prop(g, 'crate', 1.15, top, 0.9, 0.24, 1.1);
      add(g, G.box(0.7, 0.18, 0.25), wood(), 0.6, top + 0.09, 0.45);
      add(g, G.box(0.62, 0.02, 0.18), mat(0x3a7a8a, { rough: 0.1 }), 0.6, top + 0.17, 0.45);
      flag(g, pc, 1.25, top, -1.25, 1.5, 1.2);
      break;
    }
    case 'blacksmith': {
      const top = plinth(g, S, 2.85, 2.85, 0.1, 2);
      // workshop hall at the back
      const hg = pivot(g, 0, 0, -0.7);
      const roof = hall(hg, S, 2.5, 1.1, 0.85, top, [3, 0, 1, 1]);
      smallRoof(hg, S, 2.5, 1.1, roof);
      // open-sided forge shed in front: four posts and a tiled lean-to
      for (const [x, z] of [[-1.2, 0.15], [1.2, 0.15], [-1.2, 1.25], [1.2, 1.25]]) add(g, G.cyl(0.045, 0.05, 0.85, 8), darkWood(), x, top + 0.42, z);
      const lean = add(g, G.box(2.6, 0.06, 1.35), mat(0x8a4a2a, { tex: 'tiles', scale: 1.5 }), 0, top + 0.9, 0.7);
      lean.rotation.x = 0.16;
      // the hearth: brick box with glowing coals and a chimney
      const brick = mat(0x8a5a40, { tex: 'plaster', scale: 2 });
      add(g, G.box(0.7, 0.42, 0.55), brick, -0.65, top + 0.21, 0.55);
      add(g, G.box(0.5, 0.05, 0.36), mat(0xff6a1a, { emissive: 0xff4a08, emissiveIntensity: 2.2, rough: 0.9 }), -0.65, top + 0.43, 0.55, false);
      add(g, G.cyl(0.13, 0.17, 1.35, 10), brick, -0.85, top + 1.0, 0.35);
      add(g, G.cyl(0.16, 0.16, 0.06, 10), S.trim, -0.85, top + 1.68, 0.35);
      // bellows
      const bel = add(g, G.box(0.32, 0.1, 0.22), mat(0x5a3a22, { tex: 'fabric', scale: 3 }), -0.15, top + 0.3, 0.42);
      bel.rotation.z = 0.25;
      // anvil on a stump, quench trough, weapon rack
      add(g, G.cyl(0.13, 0.15, 0.28, 10), wood(), 0.35, top + 0.14, 0.85);
      add(g, G.box(0.32, 0.1, 0.14), mat(0x3a3c40, { rough: 0.45, metal: 0.8 }), 0.35, top + 0.33, 0.85);
      add(g, G.cone(0.07, 0.14, 8), mat(0x3a3c40, { rough: 0.45, metal: 0.8 }), 0.55, top + 0.33, 0.85).rotation.z = -Math.PI / 2;
      add(g, G.box(0.55, 0.18, 0.22), darkWood(), 0.75, top + 0.09, 0.3);
      add(g, G.box(0.48, 0.02, 0.16), mat(0x2a4a52, { rough: 0.1 }), 0.75, top + 0.18, 0.3, false);
      add(g, G.box(0.9, 0.05, 0.05), darkWood(), 0.6, top + 0.62, 1.32);
      for (let i = 0; i < 5; i++) {
        const bl = add(g, G.box(0.03, 0.62, 0.012), steel(), 0.25 + i * 0.17, top + 0.33, 1.34);
        bl.rotation.z = (i % 2 ? 1 : -1) * 0.08;
      }
      prop(g, 'crate', 1.15, top, -0.05, 0.24, 0.5);
      flag(g, pc, 1.3, top, 1.3, 1.4, 1.2);
      break;
    }
    case 'wall':
    case 'gate':
      return buildWall(type, civ, pc, type === 'gate' ? 1 | 4 : 0);
    case 'tower': {
      const top = plinth(g, S, 1.8, 1.8, 0.12, 2);
      const round = S.key !== 'dravidian' && S.key !== 'vijayanagara';
      add(g, round ? G.cyl(0.52, 0.68, 2.2, 20) : G.frustum(0.95, 1.25, 2.2), S.wall, 0, top + 1.1, 0);
      for (const hh of [0.75, 1.5]) add(g, round ? G.cyl(0.66 - hh * 0.06, 0.66 - hh * 0.06, 0.05, 20) : G.box(1.22 - hh * 0.12, 0.05, 1.22 - hh * 0.12), S.trim, 0, top + hh, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        const slit = add(g, G.box(0.05, 0.22, 0.04), S.inner, Math.cos(a) * 0.6, top + 1.15, Math.sin(a) * 0.6, false);
        slit.rotation.y = -a;
      }
      const ty = top + 2.2;
      add(g, round ? G.cyl(0.74, 0.62, 0.14, 20) : G.box(1.15, 0.14, 1.15), S.trim, 0, ty + 0.07, 0);
      if (S.parapet !== 'none') {
        const n = 12;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          const m = add(g, S.parapet === 'kangura' ? G.kangura(0.14) : G.box(0.13, 0.15, 0.08), S.wall, Math.cos(a) * 0.66, ty + 0.15, Math.sin(a) * 0.66);
          m.rotation.y = -a + Math.PI / 2;
        }
      }
      if (S.crown === 'onion' || S.crown === 'chhatri') chhatri(g, S, 0, ty + 0.14, 0, 0.36);
      else if (S.crown === 'stupa') domeOn(g, S, 0.42, ty + 0.14, 'hemi', 0.05);
      else if (S.crown === 'fort') add(g, G.hip(1.1, 0.5), S.roof, 0, ty + 0.4, 0);
      else {
        add(g, G.hip(1.05, 0.7), S.dome, 0, ty + 0.49, 0);
        kalash(g, ty + 0.84, 1);
      }
      flag(g, pc, 0.5, ty + 0.1, 0.5, 0.9, 1);
      break;
    }
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.castShadow !== false) m.castShadow = true;
  });
  return g;
}

/** wall links: which neighbouring tiles hold a wall or gate of the same owner */
export const LINK_E = 1, LINK_S = 2, LINK_W = 4, LINK_N = 8;
const WALL_H = 1.05, WALL_T = 0.44;

/** one row of merlons (or a plain coping) along a stretch of wall top */
function merlons(g: THREE.Object3D, S: Style, len: number, axis: 'x' | 'z', cx: number, cz: number, y: number, thick: number) {
  add(g, axis === 'x' ? G.box(len, 0.06, thick + 0.05) : G.box(thick + 0.05, 0.06, len), S.trim, cx, y + 0.03, cz);
  if (S.parapet === 'none') return;
  const size = 0.14;
  const geo = S.parapet === 'kangura' ? G.kangura(size) : G.box(size, size * 1.1, size * 0.55);
  const yy = S.parapet === 'kangura' ? y + 0.06 : y + 0.06 + size * 0.55;
  const n = Math.max(1, Math.round(len / 0.25));
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + (i + 0.5) * (len / n);
    for (const side of [-1, 1]) {
      const off = side * (thick / 2 - 0.05);
      const m = add(g, geo, S.wall, axis === 'x' ? cx + t : cx + off, yy, axis === 'x' ? cz + off : cz + t);
      if (axis === 'z') m.rotation.y = Math.PI / 2;
    }
  }
}

/**
 * A wall section or gate. Sections join up with their neighbours (mask of LINK_* bits): straight
 * runs read as one continuous curtain wall, with a squat bastion post at corners and ends.
 */
export function buildWall(type: 'wall' | 'gate', civ: CivId, pc: number, mask: number): THREE.Group {
  const S = styleOf(civ);
  const g = new THREE.Group();
  if (type === 'gate') {
    // built along x (wall continues east-west, passage runs north-south); turned if the wall runs the other way
    const body = new THREE.Group();
    g.add(body);
    if (mask & (LINK_N | LINK_S) && !(mask & (LINK_E | LINK_W))) body.rotation.y = Math.PI / 2;
    const H = 1.5;
    add(body, G.box(1.04, 0.12, 0.66), S.plinth, 0, 0.06, 0);
    add(body, G.archWall(1.0, H, 0.56, 1, 0.5, 1.02, S.arch), S.wall, 0, 0.1, 0);
    add(body, G.box(1.06, 0.07, 0.62), S.trim, 0, 0.1 + H * 0.74, 0);
    merlons(body, S, 1.0, 'x', 0, 0, 0.1 + H, 0.56);
    // the two door leaves, hinged at the jambs
    for (const side of [-1, 1]) {
      const hinge = pivot(body, side * 0.25, 0.1, 0);
      hinge.name = side < 0 ? 'doorL' : 'doorR';
      const leaf = add(hinge, G.box(0.25, 0.86, 0.05), darkWood(), -side * 0.125, 0.43, 0);
      for (const yy of [0.2, 0.45, 0.7]) add(hinge, G.box(0.25, 0.03, 0.06), steel(), -side * 0.125, yy, 0);
      // spikes against elephants
      for (const yy of [0.32, 0.58]) for (const k of [0.06, 0.18]) add(hinge, G.cone(0.018, 0.06, 6), steel(), -side * k, yy, 0.05).rotation.x = Math.PI / 2;
      leaf.castShadow = true;
    }
    for (const side of [-1, 1]) add(body, G.box(0.06, 0.06, 0.06), S.accent, side * 0.42, 0.1 + H + 0.25, 0);
    flag(body, pc, 0.4, 0.1 + H, 0.2, 0.7, 0.8);
    return g;
  }
  const H = WALL_H, T = WALL_T;
  const e = mask & LINK_E, w = mask & LINK_W, so = mask & LINK_S, n = mask & LINK_N;
  const straight = (e && w && !so && !n) || (so && n && !e && !w);
  // half-runs from the centre to each linked edge (starting a little behind the centre so they meet cleanly)
  for (const [bit, dx, dz] of [[LINK_E, 1, 0], [LINK_W, -1, 0], [LINK_S, 0, 1], [LINK_N, 0, -1]] as const) {
    if (!(mask & bit)) continue;
    const len = 0.5 + T / 2;
    const c = 0.5 - len / 2; // centre of the run along its axis
    const x = dx * c, z = dz * c;
    const axis = dx ? 'x' : 'z';
    add(g, axis === 'x' ? G.box(len + 0.06, 0.12, T + 0.1) : G.box(T + 0.1, 0.12, len + 0.06), S.plinth, x, 0.06, z);
    add(g, axis === 'x' ? G.box(len, H, T) : G.box(T, H, len), S.wall, x, H / 2, z);
    merlons(g, S, len, axis, x, z, H, T);
  }
  if (!straight) {
    // bastion post at an end, corner or junction
    const P = 0.62, PH = H + 0.28;
    add(g, G.box(P + 0.1, 0.14, P + 0.1), S.plinth, 0, 0.07, 0);
    add(g, G.box(P, PH, P), S.wall, 0, PH / 2, 0);
    add(g, G.box(P + 0.06, 0.07, P + 0.06), S.trim, 0, PH + 0.035, 0);
    if (S.parapet !== 'none') {
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(g, S.parapet === 'kangura' ? G.kangura(0.15) : G.box(0.15, 0.17, 0.15), S.wall, x * (P / 2 - 0.08), PH + 0.07, z * (P / 2 - 0.08));
    } else {
      add(g, G.box(0.3, 0.12, 0.3), S.trim, 0, PH + 0.13, 0);
    }
  }
  return g;
}

/** bamboo scaffolding shown around foundations */
export function buildScaffold(size: number): THREE.Group {
  const g = new THREE.Group();
  const bamboo = mat(0xb89a5a, { rough: 0.6 });
  const h = size * 0.55 + 0.6;
  const s = size * 0.47;
  for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s], [0, s], [0, -s]]) add(g, G.cyl(0.025, 0.03, h, 8), bamboo, x, h / 2, z);
  for (const y of [h * 0.35, h * 0.7, h * 0.98]) {
    for (const [x, z, rot] of [[0, s, 0], [0, -s, 0], [s, 0, 1], [-s, 0, 1]] as const) {
      const p = add(g, G.cyl(0.018, 0.018, size * 0.94, 6), bamboo, x, y, z);
      p.rotation.z = Math.PI / 2;
      if (rot) p.rotation.y = Math.PI / 2;
    }
  }
  add(g, G.box(size * 0.95, 0.04, size * 0.95), mat(0x8a6a44, { tex: 'planks', scale: 2 }), 0, 0.03, 0, false);
  for (let i = 0; i < 4; i++) add(g, G.box(0.22, 0.12, 0.14), mat(0xbcae94, { tex: 'ashlar' }), -s * 0.6 + i * 0.25, 0.1, s + 0.25);
  return g;
}

// ---------------------------------------------------------------------------
// units
// ---------------------------------------------------------------------------
export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  kind: 'human' | 'horse' | 'elephant';
  legs: THREE.Object3D[];
  armR: THREE.Object3D;
  armL: THREE.Object3D;
  tools: Partial<Record<'axe' | 'pick' | 'hammer' | 'basket', THREE.Object3D>>;
  carry: Partial<Record<ResourceType, THREE.Object3D>>;
  trunk?: THREE.Object3D;
  tail?: THREE.Object3D;
  height: number;
  ranged: boolean;
  riderLegs?: THREE.Object3D[];
  /** realistic skinned human (foot units) */
  human?: HumanRig;
  /** skinned riders (cavalry / elephant crew) */
  riders?: HumanRig[];
  /** sculpted, animated horse / elephant */
  mount?: MountRig;
}

/** seated riders: pelvis height above the root in the riding pose (metres) */
const RIDER_DROP = 0.93;


/**
 * Natural dyes of the period (muted, slightly dirty): undyed cotton, madder, indigo, turmeric,
 * safflower, pomegranate-rind khaki, iron black, leaf green. Real armies were not uniformed:
 * each man's turban and coat vary, and the team colour appears as accents (sash, shield, pennant).
 */
const DYE = {
  cotton: 0xd9cdb2, offwhite: 0xcbbf9f, madder: 0x8c3a28, indigo: 0x2e3b56, turmeric: 0xb08a3e,
  safflower: 0xb35e3c, khaki: 0x8c7b56, black: 0x34302b, leaf: 0x4a5a3c, rust: 0x7a4a2c, saffron: 0xbd7b34,
} as const;
const TURBANS = [DYE.cotton, DYE.madder, DYE.saffron, DYE.offwhite, DYE.indigo, DYE.turmeric, DYE.safflower, DYE.khaki, DYE.madder, DYE.cotton];
const pick = <T,>(arr: readonly T[], seed: number, salt = 0) => arr[Math.abs(Math.imul(seed + salt * 977, 2654435761)) % arr.length];
/** the player's colour as a real dyed cloth: a little greyed and darkened */
function teamDye(pc: number) {
  const c = new THREE.Color(pc);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, hsl.s * 0.72, Math.min(0.42, hsl.l * 0.82)).getHex();
}
/** slight per-man variation of a garment colour */
const vary = (c: number, seed: number, salt: number) => shade(c, ((Math.abs(Math.imul(seed + salt, 2246822519)) % 100) / 100 - 0.5) * 0.16);

/** clothing & kit for each unit type (historically inspired) */
function humanLook(type: UnitType, pc: number, seed: number): HumanLook {
  const team = teamDye(pc);
  const turban = vary(pick(TURBANS, seed, 1), seed, 2);
  const legs = vary(pick([DYE.cotton, DYE.offwhite, DYE.cotton, DYE.khaki], seed, 3), seed, 4);
  const coat = (choices: number[]) => vary(pick(choices, seed, 5), seed, 6);
  switch (type) {
    case 'villager':
      return seed % 2
        ? { dhoti: vary(DYE.offwhite, seed, 7), sash: team, head: 'turban', headColor: vary(pick([DYE.cotton, DYE.offwhite, DYE.khaki, DYE.turmeric], seed, 8), seed, 9), weapon: 'none' }
        : { dhoti: vary(DYE.cotton, seed, 7), top: coat([DYE.cotton, DYE.offwhite, DYE.khaki]), sash: team, head: 'turban', headColor: turban, weapon: 'none' };
    case 'swordsman': return { top: coat([DYE.cotton, DYE.offwhite, DYE.cotton, DYE.khaki]), long: true, legs, sash: team, head: 'turban', headColor: turban, weapon: 'sword', shield: team };
    case 'spearman': return { top: coat([DYE.rust, DYE.khaki, DYE.madder]), legs, sash: team, head: 'turban', headColor: turban, weapon: 'spear', shield: team };
    case 'archer': return { top: coat([DYE.indigo, DYE.cotton, DYE.leaf]), dhoti: vary(DYE.offwhite, seed, 7), sash: team, head: 'turban', headColor: turban, weapon: 'bow' };
    case 'velaikkarar': return { top: coat([DYE.madder, DYE.rust]), dhoti: vary(DYE.offwhite, seed, 7), armor: true, sash: team, head: 'helmet', headColor: 0xd4af37, weapon: 'sword', shield: team };
    case 'nayaka_archer': return { top: coat([DYE.madder, DYE.black, DYE.indigo]), long: true, legs, sash: team, head: 'turban', headColor: turban, plume: true, weapon: 'bow', bigBow: true };
    case 'horseman': return { top: coat([DYE.cotton, DYE.offwhite, DYE.khaki]), long: true, legs, sash: team, head: 'turban', headColor: turban, weapon: 'sword' };
    case 'mansabdar': return { top: coat([DYE.leaf, DYE.indigo, DYE.madder]), long: true, legs, sash: team, head: 'turban', headColor: turban, plume: true, weapon: 'bow' };
    case 'rajput_lancer': return { top: coat([DYE.turmeric, DYE.saffron, DYE.madder]), long: true, legs: vary(DYE.madder, seed, 4), armor: true, sash: team, head: 'helmet', headColor: 0xc4c8d0, weapon: 'lance', shield: team };
    case 'bargir': return { top: coat([DYE.cotton, DYE.offwhite]), legs, sash: team, head: 'turban', headColor: turban, weapon: 'spear' };
    default: return { top: coat([DYE.cotton]), legs, sash: team, head: 'turban', headColor: turban, weapon: 'none' };
  }
}

/** villager tools & carried goods for skinned humans (units: metres, in hand / back space) */
function humanVillagerKit(h: HumanRig, tools: Rig['tools'], carry: Rig['carry']) {
  // two-handed tools: the grip (right hand) sits partway up the handle so the left hand holds the end;
  // the head crosses the shaft, its working edge leading the swing (+y)
  const tool = (len: number, headZ: number, head: (t: THREE.Group) => void) => {
    const t = new THREE.Group();
    const shaft = add(t, G.cyl(0.016, 0.019, len, 8), wood(), 0, 0, len * 0.5 - 0.3);
    shaft.rotation.x = Math.PI / 2;
    const g = new THREE.Group();
    g.position.z = headZ;
    t.add(g);
    head(g);
    t.visible = false;
    h.handR.add(t);
    return t;
  };
  tools.axe = tool(0.85, 0.5, (g) => {
    add(g, G.box(0.03, 0.05, 0.06), steel(), 0, 0, 0);
    const blade = add(g, G.box(0.012, 0.11, 0.1), steel(), 0, 0.075, 0);
    blade.scale.set(1, 1, 1);
  });
  tools.pick = tool(0.85, 0.5, (g) => {
    add(g, G.cone(0.022, 0.2, 6), steel(), 0, 0.1, 0);
    add(g, G.cone(0.022, 0.16, 6), steel(), 0, -0.08, 0).rotation.x = Math.PI;
    add(g, G.box(0.04, 0.04, 0.05), darkWood(), 0, 0, 0);
  });
  tools.hammer = tool(0.6, 0.28, (g) => {
    add(g, G.box(0.07, 0.15, 0.07), darkWood(), 0, 0, 0);
  });
  const basket = add(h.handL, G.lathe('basketM', [[0, 0], [0.09, 0], [0.14, 0.1], [0.15, 0.13], [0, 0.13]], 14), mat(0xb08a4a, { tex: 'thatch', scale: 4 }), 0, -0.08, 0.05);
  basket.visible = false;
  tools.basket = basket;
  const logs = new THREE.Group();
  for (let i = 0; i < 3; i++) add(logs, G.cyl(0.05, 0.055, 0.85, 10), wood(), -0.05 + i * 0.05, (i % 2) * 0.05, 0).rotation.z = Math.PI / 2;
  logs.position.set(0, 0.12, -0.02);
  const sackG = new THREE.Group();
  sack(sackG, 0, -0.12, 0, 1.6);
  add(sackG, G.sphere(0.05, 8, 6), gold(), 0, 0.2, 0.08);
  const stoneG = new THREE.Group();
  add(stoneG, G.box(0.28, 0.2, 0.2), mat(0xa8a49a, { tex: 'ashlar' }), 0, 0, 0).rotation.y = 0.3;
  const food = new THREE.Group();
  add(food, G.lathe('fbasketM', [[0, 0], [0.12, 0], [0.19, 0.1], [0, 0.1]], 14), mat(0xb08a4a, { tex: 'thatch', scale: 4 }));
  for (let i = 0; i < 6; i++) add(food, G.sphere(0.05, 8, 6), mat(0x4a1f5c, { rough: 0.35 }), Math.cos(i * 1.1) * 0.08, 0.1, Math.sin(i * 1.1) * 0.08);
  food.position.y = 0.02;
  for (const [g, parent, k] of [[logs, h.back, 'wood'], [sackG, h.back, 'gold'], [stoneG, h.back, 'stone'], [food, h.headTop, 'food']] as const) {
    g.visible = false;
    parent.add(g);
    carry[k] = g;
  }
}

const SKINS = [0x8a5634, 0x9b6440, 0x7a4a2c, 0xa9714a, 0x6c4027];
const HAIR = 0x1e1510;

interface HumanOpts {
  skin: number;
  top: number;
  bottom: number;
  head: 'turban' | 'helmet' | 'bare';
  headColor: number;
  weapon: 'sword' | 'spear' | 'bow' | 'lance' | 'none';
  shield?: number;
  mounted?: boolean;
  bigBow?: boolean;
  long?: boolean;
  beard?: boolean;
  plume?: boolean;
  armor?: boolean;
}

function human(parent: THREE.Object3D, o: HumanOpts) {
  const g = new THREE.Group();
  parent.add(g);
  const skin = skinMat(o.skin);
  const top = cloth(o.top);
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const p = pivot(g, s * 0.062, 0.36, 0);
    add(p, G.capsule(0.04, 0.24), skin, 0, -0.17, 0);
    add(p, G.sphere(0.04, 10, 8), mat(0x4a3020, { rough: 0.7 }), 0, -0.34, 0.025).scale.set(0.9, 0.5, 1.6);
    legs.push(p);
  }
  // lower garment: dhoti for villagers, a flared jama for soldiers
  const hem = o.long ? 0.13 : 0.22;
  add(g, G.lathe(`skirt${hem}`, [[0.095, 0.44], [0.11, 0.38], [0.13, 0.3], [0.148, hem], [0.14, hem - 0.01]], 18), mat(o.bottom, { tex: 'fabric', scale: 4, side: THREE.DoubleSide }));
  const torso = add(g, G.lathe('torso', [[0, 0.39], [0.092, 0.4], [0.1, 0.45], [0.118, 0.53], [0.124, 0.595], [0.1, 0.635], [0.045, 0.66], [0, 0.665]], 18), top);
  torso.scale.z = 0.74;
  if (o.armor) add(g, G.lathe('cuirass', [[0, 0.45], [0.105, 0.46], [0.124, 0.53], [0.128, 0.59], [0, 0.6]], 18), steel(), 0, 0, 0.003).scale.z = 0.78;
  const sash = add(g, G.torus(0.098, 0.02, TAU, 6, 20), cloth(shade(o.bottom, -0.35)), 0, 0.42, 0);
  sash.rotation.x = Math.PI / 2;
  sash.scale.y = 0.76;
  add(g, G.cyl(0.03, 0.035, 0.06, 10), skin, 0, 0.675, 0);
  add(g, G.sphere(0.07, 18, 14), skin, 0, 0.74, 0).scale.set(0.92, 1.05, 0.98);
  add(g, G.cone(0.014, 0.035, 6), skin, 0, 0.735, 0.068).rotation.x = Math.PI / 2;
  if (o.beard) add(g, G.sphere(0.05, 10, 8), mat(HAIR, { rough: 0.9 }), 0, 0.695, 0.035).scale.set(1.05, 0.9, 0.8);
  add(g, G.torus(0.025, 0.007, Math.PI, 4, 10), mat(HAIR), 0, 0.712, 0.066).rotation.z = Math.PI;
  if (o.head === 'turban') {
    const tm = cloth(o.headColor);
    add(g, G.torus(0.062, 0.03, TAU, 10, 20), tm, 0, 0.785, -0.004).rotation.x = Math.PI / 2 - 0.12;
    add(g, G.torus(0.052, 0.027, TAU, 10, 20), tm, 0, 0.815, -0.008).rotation.x = Math.PI / 2 + 0.1;
    add(g, G.sphere(0.062, 14, 10), tm, 0, 0.82, -0.01).scale.set(1, 0.62, 1.05);
    if (o.plume) {
      add(g, G.sphere(0.014, 8, 6), gold(), 0, 0.845, 0.055);
      add(g, G.cone(0.012, 0.1, 6), mat(0xf6f0e0), 0.01, 0.9, 0.04).rotation.z = -0.4;
    }
  } else if (o.head === 'helmet') {
    const hm = mat(o.headColor, { rough: 0.3, metal: 0.85 });
    add(g, G.dome(0.078, 18), hm, 0, 0.775, 0);
    add(g, G.cone(0.012, 0.09, 8), hm, 0, 0.88, 0);
    add(g, G.lathe('aventail', [[0.075, 0.78], [0.085, 0.72], [0.09, 0.67]], 14), mat(0x8a8c92, { rough: 0.5, metal: 0.7, side: THREE.DoubleSide }), 0, 0, -0.005);
  }
  const arms: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const p = pivot(g, s * 0.135, 0.612, 0);
    add(p, G.capsule(0.036, 0.12), top, 0, -0.07, 0);
    add(p, G.capsule(0.03, 0.12), skin, 0, -0.19, 0);
    add(p, G.sphere(0.03, 10, 8), skin, 0, -0.28, 0.005);
    if (o.armor) add(p, G.cyl(0.036, 0.034, 0.08, 10), steel(), 0, -0.2, 0);
    arms.push(p);
  }
  const [armL, armR] = arms;
  if (o.weapon === 'sword') {
    const w = pivot(armR, 0, -0.28, 0.01);
    add(w, G.box(0.08, 0.012, 0.02), gold(), 0, 0, 0);
    add(w, G.cyl(0.012, 0.012, 0.07, 8), mat(0x3a2414), 0, 0.04, 0);
    add(w, G.sphere(0.018, 8, 6), gold(), 0, 0.08, 0);
    add(w, G.box(0.022, 0.2, 0.006), steel(), 0, -0.1, 0);
    add(w, G.box(0.02, 0.16, 0.006), steel(), 0, -0.27, 0.025).rotation.x = 0.28; // curved talwar tip
    w.rotation.x = -1.2;
  } else if (o.weapon === 'spear' || o.weapon === 'lance') {
    const len = o.weapon === 'lance' ? 1.55 : 1.1;
    const w = pivot(armR, 0, -0.27, 0.01);
    add(w, G.cyl(0.011, 0.013, len, 8), wood(), 0, 0.15, 0);
    add(w, G.sphere(0.03, 8, 6), steel(), 0, 0.15 + len / 2 + 0.06, 0).scale.set(0.5, 2.6, 0.25);
    add(w, G.sphere(0.022, 8, 6), cloth(0xc23b22), 0, 0.15 + len / 2 - 0.03, 0);
    if (o.weapon === 'lance') add(w, G.box(0.004, 0.14, 0.12), cloth(o.headColor), 0, 0.15 + len / 2 - 0.13, 0.06);
    w.rotation.x = o.mounted ? -1.25 : -0.15;
  }
  if (o.weapon === 'bow') {
    const w = pivot(armL, 0, -0.28, 0.03);
    const r = o.bigBow ? 0.32 : 0.25;
    add(w, G.torus(r, 0.012, Math.PI * 0.82, 6, 24), darkWood(), 0, 0, 0).rotation.set(0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.09);
    add(w, G.cyl(0.002, 0.002, r * 1.92, 3), mat(0xeee6d0), 0, 0, -r * 0.42);
    w.rotation.x = -1.3;
    add(g, G.cyl(0.04, 0.033, 0.32, 10), mat(0x6b3a1e, { tex: 'fabric', scale: 4 }), 0.07, 0.56, -0.11).rotation.z = 0.35;
    for (let i = 0; i < 4; i++) add(g, G.box(0.02, 0.06, 0.004), mat(0xf3ecd9), 0.12 + (i % 2) * 0.02, 0.73 + (i % 2) * 0.01, -0.11 + (i - 1.5) * 0.015).rotation.z = 0.35;
  }
  if (o.shield !== undefined) {
    const s = pivot(armL, -0.04, -0.18, 0.04);
    const sh = add(s, G.dome(0.13, 20), mat(o.shield, { tex: 'plaster', rough: 0.5 }), 0, 0, 0);
    sh.rotation.z = Math.PI / 2;
    sh.scale.set(0.35, 1, 1);
    for (const [a, b] of [[0, 0], [0.06, 0.05], [-0.06, 0.05], [0, -0.07]]) add(s, G.sphere(0.017, 8, 6), brass(), -0.045, a, b);
    add(s, G.torus(0.128, 0.01, TAU, 6, 24), brass(), -0.004, 0, 0).rotation.y = Math.PI / 2;
  }
  if (o.mounted) {
    legs[0].rotation.set(-1.35, 0, -0.45);
    legs[1].rotation.set(-1.35, 0, 0.45);
  }
  return { g, legs, armL, armR };
}

type Look = Omit<HumanOpts, 'skin' | 'mounted'>;

function lookFor(type: UnitType, pc: number, seed: number): Look {
  const beard = seed % 3 !== 0;
  switch (type) {
    case 'villager': return { top: 0xe9dfc8, bottom: 0xf6f0e2, head: 'turban', headColor: seed % 2 ? pc : 0xf3ecd9, weapon: 'none', beard: seed % 4 === 0 };
    case 'swordsman': return { top: pc, bottom: 0xe8dcc0, head: 'turban', headColor: shade(pc, -0.25), weapon: 'sword', shield: 0x6a3a1e, long: true, beard };
    case 'spearman': return { top: shade(pc, 0.1), bottom: 0xd9c9a3, head: 'turban', headColor: 0xe9e0c8, weapon: 'spear', shield: shade(pc, -0.35), long: true, beard };
    case 'archer': return { top: shade(pc, 0.15), bottom: 0xe6dcc4, head: 'turban', headColor: pc, weapon: 'bow', beard };
    case 'velaikkarar': return { top: pc, bottom: 0x7a1f1a, head: 'helmet', headColor: 0xd4af37, weapon: 'sword', shield: 0x8a2a1a, long: true, beard: true, armor: true };
    case 'nayaka_archer': return { top: pc, bottom: 0x5a2a3a, head: 'turban', headColor: 0xf3ecd9, weapon: 'bow', bigBow: true, beard: true, plume: true };
    case 'horseman': return { top: pc, bottom: 0xe8dcc0, head: 'turban', headColor: 0xf3ecd9, weapon: 'sword', beard };
    case 'mansabdar': return { top: pc, bottom: 0x2f4a3a, head: 'turban', headColor: 0xf6f0e0, weapon: 'bow', plume: true, beard: true };
    case 'rajput_lancer': return { top: pc, bottom: 0xc23b22, head: 'helmet', headColor: 0xc4c8d0, weapon: 'lance', shield: 0x3a2a1e, beard: true, armor: true };
    case 'bargir': return { top: 0xf2ead8, bottom: 0xf6f0e2, head: 'turban', headColor: 0xf08a24, weapon: 'spear', beard };
    default: return { top: pc, bottom: 0xe8dcc0, head: 'turban', headColor: pc, weapon: 'none' };
  }
}

function horse(parent: THREE.Object3D, coat: number, caparison: number, armored: boolean) {
  const g = new THREE.Group();
  parent.add(g);
  const m = mat(coat, { rough: 0.55 });
  const dark = mat(shade(coat, -0.55), { rough: 0.7 });
  const body = add(g, G.capsule(0.16, 0.46, 14), m, 0, 0.8, 0);
  body.rotation.x = Math.PI / 2;
  body.scale.set(0.92, 1, 1.05);
  add(g, G.sphere(0.165, 16, 12), m, 0, 0.82, 0.26).scale.set(0.95, 1.05, 1);
  add(g, G.sphere(0.17, 16, 12), m, 0, 0.84, -0.25).scale.set(1, 1, 1.05);
  const neck = add(g, G.capsule(0.075, 0.28, 12), m, 0, 1.02, 0.4);
  neck.rotation.x = 0.62;
  neck.scale.z = 1.25;
  add(g, G.capsule(0.058, 0.2, 12), m, 0, 1.15, 0.56).rotation.x = 1.95;
  add(g, G.sphere(0.06, 12, 10), m, 0, 1.2, 0.5);
  for (const s of [-1, 1]) {
    add(g, G.cone(0.02, 0.07, 8), m, s * 0.035, 1.28, 0.47).rotation.x = -0.2;
    add(g, G.sphere(0.012, 6, 4), mat(0x111111, { rough: 0.2 }), s * 0.052, 1.19, 0.56);
  }
  add(g, G.box(0.03, 0.34, 0.07), dark, 0, 1.08, 0.36).rotation.x = 0.62;
  add(g, G.torus(0.055, 0.007, TAU, 4, 14), mat(0x3a2414), 0, 1.13, 0.62).rotation.x = 0.4;
  // draped saddle cloth (or full barding for armoured horses)
  const drape = cached(`hdrape${armored}`, () => {
    const c = new THREE.CylinderGeometry(armored ? 0.21 : 0.19, armored ? 0.24 : 0.2, armored ? 0.82 : 0.46, 20, 1, true, -Math.PI * 0.68, Math.PI * 1.36);
    c.rotateX(-Math.PI / 2);
    return scaleUV(c, 1.4, 0.6);
  });
  add(g, drape, mat(caparison, { tex: 'fabric', scale: 4, side: THREE.DoubleSide }), 0, armored ? 0.76 : 0.8, -0.02);
  for (const sd of [-1, 1]) add(g, G.box(0.015, 0.025, armored ? 0.82 : 0.46), gold(), sd * (armored ? 0.21 : 0.17), armored ? 0.6 : 0.69, -0.02);
  add(g, G.box(0.22, 0.06, 0.3), mat(0x5a2a14, { rough: 0.6 }), 0, 0.98, -0.02);
  if (armored) {
    add(g, G.box(0.13, 0.05, 0.24), steel(), 0, 1.2, 0.56).rotation.x = 1.95 - Math.PI / 2;
    add(g, G.cone(0.02, 0.12, 6), cloth(caparison), 0, 1.33, 0.46).rotation.x = -0.3;
  }
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.09, 0.27], [0.09, 0.27], [-0.09, -0.27], [0.09, -0.27]]) {
    const p = pivot(g, x, 0.68, z);
    add(p, G.capsule(0.05, 0.2, 10), m, 0, -0.13, 0);
    add(p, G.cyl(0.026, 0.032, 0.28, 10), m, 0, -0.44, 0);
    add(p, G.sphere(0.032, 8, 6), m, 0, -0.31, 0.005);
    add(p, G.cyl(0.036, 0.042, 0.07, 10), dark, 0, -0.63, 0.008);
    legs.push(p);
  }
  const tail = pivot(g, 0, 0.92, -0.42);
  add(tail, G.capsule(0.035, 0.32, 8), dark, 0, -0.18, 0).scale.set(1, 1, 0.7);
  tail.rotation.x = -0.35;
  return { g, legs, tail };
}

function elephant(parent: THREE.Object3D, pc: number, S: Style, armored: boolean) {
  const g = new THREE.Group();
  parent.add(g);
  const skin = mat(0x6f6863, { tex: 'plaster', scale: 2, rough: 0.9, normal: 2 });
  add(g, G.sphere(1, 24, 18), skin, 0, 1.2, 0).scale.set(0.58, 0.6, 0.9);
  add(g, G.sphere(1, 20, 16), skin, 0, 1.45, 0.86).scale.set(0.37, 0.42, 0.36);
  add(g, G.sphere(0.16, 12, 10), skin, 0, 1.65, 0.8);
  for (const s of [-1, 1]) {
    const ear = add(g, G.sphere(1, 16, 12), skin, s * 0.36, 1.45, 0.7);
    ear.scale.set(0.04, 0.3, 0.26);
    ear.rotation.y = s * 0.35;
    add(g, G.torus(0.2, 0.026, Math.PI * 0.5, 6, 12), mat(0xf4ecd8, { rough: 0.35 }), s * 0.14, 1.08, 1.0).rotation.set(0, Math.PI / 2, Math.PI);
    add(g, G.sphere(0.025, 8, 6), mat(0x111111, { rough: 0.2 }), s * 0.2, 1.52, 1.08);
  }
  let t: THREE.Object3D = pivot(g, 0, 1.3, 1.13);
  const trunkRoot = t;
  for (let i = 0; i < 5; i++) {
    const r = 0.11 - i * 0.017;
    add(t, G.cyl(r * 0.88, r, 0.22, 14), skin, 0, -0.11, 0);
    const n = pivot(t, 0, -0.2, 0);
    n.rotation.x = 0.16;
    t = n;
  }
  trunkRoot.rotation.x = 0.2;
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.3, 0.45], [0.3, 0.45], [-0.3, -0.45], [0.3, -0.45]]) {
    const p = pivot(g, x, 0.9, z);
    add(p, G.cyl(0.15, 0.17, 0.9, 16), skin, 0, -0.45, 0);
    for (let k = -1; k <= 1; k++) add(p, G.sphere(0.035, 8, 6), mat(0xe8e0cc), k * 0.07, -0.86, 0.15);
    legs.push(p);
  }
  const tail = pivot(g, 0, 1.3, -0.88);
  add(tail, G.cyl(0.015, 0.025, 0.5, 6), skin, 0, -0.25, 0);
  tail.rotation.x = -0.25;
  // draped jhool: an open half-cylinder over the back with a gold border and tassels
  const drape = cached('jhool', () => {
    const c = new THREE.CylinderGeometry(0.62, 0.66, 0.95, 24, 1, true, -Math.PI * 0.62, Math.PI * 1.24);
    c.rotateX(-Math.PI / 2); // arc centred on +Y, length along Z
    return scaleUV(c, 3, 1);
  });
  const jhool = new THREE.Mesh(drape, mat(pc, { tex: 'fabric', scale: 4, side: THREE.DoubleSide }));
  jhool.position.set(0, 1.18, -0.05);
  jhool.castShadow = true;
  g.add(jhool);
  for (const s of [-1, 1]) {
    add(g, G.box(0.03, 0.05, 0.96), gold(), s * 0.6, 0.8, -0.05);
    for (let i = -4; i <= 4; i++) add(g, G.cone(0.02, 0.06, 6), gold(), s * 0.6, 0.75, i * 0.1 - 0.05).rotation.x = Math.PI;
  }
  // forehead ornament (mukhapatta)
  const plate = add(g, G.sphere(0.2, 14, 10), armored ? steel() : gold(), 0, 1.55, 1.12);
  plate.scale.set(0.9, 1.1, 0.25);
  plate.rotation.x = -0.35;
  add(g, G.sphere(0.04, 8, 6), cloth(pc), 0, 1.58, 1.18);
  const hy = 1.78;
  add(g, G.box(0.7, 0.32, 0.7), armored ? S.accent : mat(0x8a5a2b, { tex: 'planks', scale: 3 }), 0, hy, -0.12);
  add(g, G.box(0.74, 0.04, 0.74), gold(), 0, hy + 0.17, -0.12);
  for (const [x, z] of [[-0.3, 0.18], [0.3, 0.18], [-0.3, -0.42], [0.3, -0.42]]) add(g, G.cyl(0.022, 0.022, 0.46, 8), gold(), x, hy + 0.38, z);
  if (armored) {
    add(g, G.dome(0.44, 20), cloth(shade(pc, -0.15)), 0, hy + 0.6, -0.12).scale.set(1, 0.65, 1);
    kalash(pivot(g, 0, 0, -0.12), hy + 0.88, 1);
    add(g, G.box(1.12, 0.32, 0.65), steel(), 0, 1.22, 0.25);
  } else {
    add(g, G.dome(0.4, 20), cloth(shade(pc, -0.1)), 0, hy + 0.6, -0.12).scale.set(1, 0.45, 1);
    add(g, G.torus(0.4, 0.015, TAU, 4, 24), gold(), 0, hy + 0.6, -0.12).rotation.x = Math.PI / 2;
    kalash(pivot(g, 0, 0, -0.12), hy + 0.78, 0.8);
  }
  return { g, legs, tail, trunk: trunkRoot };
}

export function buildUnit(type: UnitType, civ: CivId, pc: number, seed: number): Rig {
  const def = UNITS[type];
  const S = styleOf(civ);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const skin = SKINS[seed % SKINS.length];
  const look = lookFor(type, pc, seed);
  const tools: Rig['tools'] = {};
  const carry: Rig['carry'] = {};
  let rig: Rig;

  if (charactersReady()) {
    const hl = humanLook(type, pc, seed);
    const dummy = () => new THREE.Group();
    if (def.cls === 'cavalry' && mountsReady()) {
      // bay, chestnut, grey, black, dun: horse coats of the period
      const coats = [0x5a3420, 0x7a4424, 0xc9c2b4, 0x2a2420, 0x9a7444];
      const lancer = type === 'rajput_lancer';
      const m = buildMount('horse', { coat: lancer ? 0xc9c2b4 : coats[seed % coats.length], team: teamDye(pc), armored: lancer });
      body.add(m.root);
      const r = buildHuman(hl, seed);
      seatRider(m.seats.seat, r.root, RIDER_DROP);
      holdLegs(r, 'Ride_Loop');
      play(r, 'Ride_Loop', { upper: true });
      playMount(m, 'Idle');
      m.mixer.update(Math.random() * 3);
      rig = { root, body, kind: 'horse', legs: [], armL: dummy(), armR: dummy(), tools, carry, height: 1.45, ranged: !!def.ranged, riders: [r], mount: m };
    } else if (def.cls === 'elephant' && mountsReady()) {
      const armored = type === 'gajasena';
      const m = buildMount('elephant', { team: teamDye(pc), armored });
      body.add(m.root);
      const mahout = buildHuman({ dhoti: DYE.offwhite, sash: teamDye(pc), head: 'turban', headColor: pick(TURBANS, seed, 11), weapon: 'none' }, seed + 1);
      seatRider(m.seats.seat_mahout, mahout.root, RIDER_DROP);
      holdLegs(mahout, 'Ride_Loop');
      play(mahout, 'Ride_Loop', { upper: true });
      const warrior = buildHuman({ top: DYE.cotton, sash: teamDye(pc), legs: DYE.offwhite, head: armored ? 'helmet' : 'turban', headColor: pick(TURBANS, seed, 12), weapon: armored ? 'bow' : 'spear' }, seed + 2);
      seatRider(m.seats.seat_howdah, warrior.root, 0.42);
      holdLegs(warrior, 'Sitting_Idle_Loop');
      play(warrior, 'Sitting_Idle_Loop', { upper: true });
      playMount(m, 'Idle');
      m.mixer.update(Math.random() * 3);
      if (armored) root.scale.setScalar(1.1);
      rig = { root, body, kind: 'elephant', legs: [], armL: dummy(), armR: dummy(), tools, carry, height: 2.7, ranged: false, riders: [warrior, mahout], mount: m };
    } else {
      const r = buildHuman(hl, seed);
      body.add(r.root);
      play(r, hl.weapon === 'sword' ? 'Sword_Idle' : 'Idle_Loop');
      r.mixer.update(Math.random() * 2);
      rig = { root, body, kind: 'human', legs: [dummy(), dummy()], armL: dummy(), armR: dummy(), tools, carry, height: 1.0, ranged: !!def.ranged, human: r };
      if (type === 'villager') humanVillagerKit(r, tools, carry);
    }
  } else if (def.cls === 'cavalry') {
    const coats = [0x5a3a24, 0x7a4e2c, 0xd9d2c4, 0x2e2622, 0x9a6a3a];
    const lancer = type === 'rajput_lancer';
    const h = horse(body, lancer ? 0xe0dacc : coats[seed % coats.length], lancer ? 0x7c7f86 : pc, lancer);
    const rider = new THREE.Group();
    rider.position.set(0, 0.64, -0.02);
    body.add(rider);
    const hu = human(rider, { ...look, skin, mounted: true });
    rig = { root, body, kind: 'horse', legs: h.legs, armL: hu.armL, armR: hu.armR, tools, carry, tail: h.tail, height: 1.6, ranged: !!def.ranged, riderLegs: hu.legs };
  } else if (def.cls === 'elephant') {
    const armored = type === 'gajasena';
    const e = elephant(body, pc, S, armored);
    const mahout = new THREE.Group();
    mahout.position.set(0, 1.27, 0.55);
    mahout.scale.setScalar(0.85);
    body.add(mahout);
    human(mahout, { skin, top: 0xe9dfc8, bottom: 0xf3ecd9, head: 'turban', headColor: pc, weapon: 'none', mounted: true });
    const rider = new THREE.Group();
    rider.position.set(0, 1.72, -0.15);
    rider.scale.setScalar(0.9);
    body.add(rider);
    const r2 = human(rider, { skin: SKINS[(seed + 2) % SKINS.length], top: pc, bottom: 0xe8dcc0, head: armored ? 'helmet' : 'turban', headColor: armored ? 0xd4af37 : 0xf3ecd9, weapon: armored ? 'bow' : 'spear', beard: true });
    r2.legs.forEach((l) => (l.visible = false));
    if (armored) root.scale.setScalar(1.1);
    rig = { root, body, kind: 'elephant', legs: e.legs, armL: r2.armL, armR: r2.armR, tools, carry, trunk: e.trunk, tail: e.tail, height: 2.6, ranged: false };
  } else {
    const hu = human(body, { ...look, skin });
    rig = { root, body, kind: 'human', legs: hu.legs, armL: hu.armL, armR: hu.armR, tools, carry, height: 1.0, ranged: !!def.ranged };
    if (type === 'villager') {
      const hand = pivot(hu.armR, 0, -0.28, 0.01);
      const axe = new THREE.Group();
      add(axe, G.cyl(0.011, 0.013, 0.38, 8), wood(), 0, -0.1, 0);
      add(axe, G.box(0.012, 0.09, 0.11), steel(), 0, -0.27, 0.05).rotation.x = 0.1;
      const pick = new THREE.Group();
      add(pick, G.cyl(0.011, 0.013, 0.38, 8), wood(), 0, -0.1, 0);
      add(pick, G.cone(0.018, 0.28, 6), steel(), 0, -0.28, 0).rotation.x = Math.PI / 2;
      const hammer = new THREE.Group();
      add(hammer, G.cyl(0.011, 0.012, 0.26, 8), wood(), 0, -0.07, 0);
      add(hammer, G.cyl(0.03, 0.03, 0.1, 10), darkWood(), 0, -0.2, 0).rotation.x = Math.PI / 2;
      for (const t of [axe, pick, hammer]) {
        t.rotation.x = -1.4;
        t.visible = false;
        hand.add(t);
      }
      const basket = add(hu.armL, G.lathe('basket', [[0, 0], [0.06, 0], [0.09, 0.06], [0.095, 0.08], [0, 0.08]], 14), mat(0xb08a4a, { tex: 'thatch', scale: 6 }), 0, -0.34, 0.06);
      basket.visible = false;
      tools.axe = axe;
      tools.pick = pick;
      tools.hammer = hammer;
      tools.basket = basket;
      const logs = new THREE.Group();
      for (let i = 0; i < 3; i++) add(logs, G.cyl(0.032, 0.035, 0.44, 10), wood(), -0.035 + i * 0.035, (i % 2) * 0.032, 0).rotation.z = Math.PI / 2;
      logs.position.set(0, 0.7, -0.1);
      logs.visible = false;
      body.add(logs);
      carry.wood = logs;
      const sackG = new THREE.Group();
      sack(sackG, 0, 0, 0, 0.75);
      add(sackG, G.sphere(0.03, 8, 6), gold(), 0, 0.18, 0.03);
      sackG.position.set(0, 0.46, -0.15);
      sackG.visible = false;
      body.add(sackG);
      carry.gold = sackG;
      const stoneG = new THREE.Group();
      add(stoneG, G.box(0.16, 0.12, 0.12), mat(0xa8a49a, { tex: 'ashlar' }), 0, 0, 0).rotation.y = 0.3;
      stoneG.position.set(0, 0.6, -0.14);
      stoneG.visible = false;
      body.add(stoneG);
      carry.stone = stoneG;
      const food = new THREE.Group();
      add(food, G.lathe('fbasket', [[0, 0], [0.07, 0], [0.11, 0.06], [0, 0.06]], 14), mat(0xb08a4a, { tex: 'thatch', scale: 6 }));
      for (let i = 0; i < 5; i++) add(food, G.sphere(0.03, 8, 6), mat(0x4a1f5c, { rough: 0.35 }), Math.cos(i * 1.3) * 0.05, 0.06, Math.sin(i * 1.3) * 0.05);
      food.position.set(0, 0.86, 0);
      food.visible = false;
      body.add(food);
      carry.food = food;
    }
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  root.scale.multiplyScalar(1.25);
  rig.height *= 1.25;
  return rig;
}
