import * as THREE from 'three';
import { CIVS, UNITS, type ArchStyle, type BuildingType, type CivId, type ResourceType, type UnitType } from '@thrones/shared';
import { cloth, darkWood, gold, mat, shade, steel, wood } from './materials';

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
const gcache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = gcache.get(key);
  if (!g) gcache.set(key, (g = make()));
  return g;
}
export const G = {
  box: (w: number, h: number, d: number) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt: number, rb: number, h: number, s = 8) => cached(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s)),
  cone: (r: number, h: number, s = 8) => cached(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s)),
  sphere: (r: number, w = 8, h = 6) => cached(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)),
  ico: (r: number, d = 0) => cached(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  dome: (r: number, s = 12) => cached(`d${r},${s}`, () => new THREE.SphereGeometry(r, s, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
  torus: (r: number, t: number, arc: number) => cached(`t${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 4, 10, arc)),
  onion: (r: number) =>
    cached(`o${r}`, () => {
      const pts = [
        [0, 0], [0.8, 0.05], [1.05, 0.35], [1.0, 0.7], [0.72, 1.05], [0.38, 1.35], [0.12, 1.62], [0.04, 1.85], [0, 1.9],
      ].map(([x, y]) => new THREE.Vector2(x * r, y * r));
      return new THREE.LatheGeometry(pts, 14);
    }),
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
      return g;
    }),
};

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
  wall: number;
  wallDark: number;
  roof: number;
  accent: number;
  plinth: number;
  crown: 'stupa' | 'gopuram' | 'onion' | 'chhatri' | 'fort' | 'mandapa';
  smallRoof: 'barrel' | 'gable' | 'dome' | 'flat' | 'hip';
}

export const STYLES: Record<ArchStyle, Style> = {
  mauryan: { wall: 0xc9a473, wallDark: 0x9c7a50, roof: 0x7d4f2a, accent: 0xd4af37, plinth: 0x8f7a5c, crown: 'stupa', smallRoof: 'barrel' },
  dravidian: { wall: 0xd8b47c, wallDark: 0xa8804a, roof: 0xc2713a, accent: 0xe8c15a, plinth: 0x7d6a52, crown: 'gopuram', smallRoof: 'gable' },
  mughal: { wall: 0xf0ebe0, wallDark: 0xd9cfba, roof: 0xf6f3ec, accent: 0xa2452f, plinth: 0xb0654a, crown: 'onion', smallRoof: 'dome' },
  rajput: { wall: 0xe6b27e, wallDark: 0xbd8253, roof: 0xedc795, accent: 0xc23b22, plinth: 0x8c5a3c, crown: 'chhatri', smallRoof: 'flat' },
  maratha: { wall: 0x6e625a, wallDark: 0x4c423b, roof: 0x8a3b1e, accent: 0xf08a24, plinth: 0x3c342f, crown: 'fort', smallRoof: 'hip' },
  vijayanagara: { wall: 0xbdb5a5, wallDark: 0x8d8576, roof: 0xa59b88, accent: 0xc9a447, plinth: 0x6f6a60, crown: 'mandapa', smallRoof: 'gable' },
};

export function styleOf(civ: CivId): Style {
  return STYLES[CIVS[civ].arch];
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
  /** rider legs for mounted units (static) */
  riderLegs?: THREE.Object3D[];
}

const SKINS = [0x8a5634, 0x9b6440, 0x7a4a2c, 0xa9714a, 0x6c4027];

interface HumanOpts {
  skin: number;
  top: number;
  bottom: number;
  head: 'turban' | 'helmet' | 'cap' | 'bare';
  headColor: number;
  weapon: 'sword' | 'spear' | 'bow' | 'lance' | 'none';
  shield?: number;
  mounted?: boolean;
  bigBow?: boolean;
  quiver?: boolean;
}

function human(parent: THREE.Object3D, o: HumanOpts) {
  const g = new THREE.Group();
  parent.add(g);
  const skin = mat(o.skin);
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const p = pivot(g, s * 0.07, 0.36, 0);
    add(p, G.box(0.09, 0.36, 0.1), skin, 0, -0.18, 0);
    legs.push(p);
  }
  add(g, G.cyl(0.11, 0.16, 0.24, 6), cloth(o.bottom), 0, 0.3, 0);
  add(g, G.box(0.26, 0.28, 0.16), cloth(o.top), 0, 0.53, 0);
  add(g, G.box(0.27, 0.045, 0.17), mat(shade(o.bottom, -0.35)), 0, 0.41, 0);
  add(g, G.ico(0.085, 1), skin, 0, 0.75, 0);
  if (o.head === 'turban') {
    const t = add(g, G.sphere(0.1, 8, 5), cloth(o.headColor), 0, 0.81, -0.01);
    t.scale.set(1, 0.72, 1.05);
  } else if (o.head === 'helmet') {
    add(g, G.cone(0.1, 0.17, 8), mat(o.headColor, { rough: 0.35, metal: 0.7 }), 0, 0.87, 0);
  } else if (o.head === 'cap') {
    add(g, G.cyl(0.08, 0.09, 0.07, 8), cloth(o.headColor), 0, 0.83, 0);
  }
  const arms: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const p = pivot(g, s * 0.17, 0.65, 0);
    add(p, G.box(0.07, 0.29, 0.08), skin, 0, -0.14, 0);
    add(p, G.box(0.08, 0.1, 0.09), cloth(o.top), 0, -0.02, 0);
    arms.push(p);
  }
  const [armL, armR] = arms;
  // weapons on the right hand
  if (o.weapon === 'sword') {
    const w = pivot(armR, 0, -0.28, 0.02);
    add(w, G.box(0.03, 0.05, 0.03), gold(), 0, 0, 0);
    const blade = add(w, G.box(0.025, 0.34, 0.012), steel(), 0, -0.19, 0.02);
    blade.rotation.x = 0.15;
    w.rotation.x = -1.2;
  } else if (o.weapon === 'spear' || o.weapon === 'lance') {
    const len = o.weapon === 'lance' ? 1.5 : 1.05;
    const w = pivot(armR, 0, -0.27, 0.02);
    add(w, G.cyl(0.012, 0.012, len, 5), wood(), 0, 0.15, 0);
    add(w, G.cone(0.03, 0.12, 5), steel(), 0, 0.15 + len / 2 + 0.05, 0);
    if (o.weapon === 'lance') add(w, G.box(0.005, 0.12, 0.1), cloth(o.headColor), 0, 0.15 + len / 2 - 0.12, 0.05);
    w.rotation.x = o.mounted ? -1.25 : -0.15;
  }
  if (o.weapon === 'bow') {
    const w = pivot(armL, 0, -0.28, 0.04);
    const r = o.bigBow ? 0.3 : 0.24;
    const bow = add(w, G.torus(r, 0.014, Math.PI * 0.85), darkWood(), 0, 0, 0);
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.075);
    w.rotation.x = -1.3;
  }
  if (o.quiver || o.weapon === 'bow') {
    const q = add(g, G.cyl(0.04, 0.035, 0.3, 6), mat(0x6b3a1e), 0.06, 0.58, -0.11);
    q.rotation.z = 0.35;
  }
  if (o.shield !== undefined) {
    const s = pivot(armL, -0.04, -0.18, 0.04);
    const sh = add(s, G.cyl(0.14, 0.14, 0.03, 10), mat(o.shield), 0, 0, 0);
    sh.rotation.z = Math.PI / 2;
    add(s, G.sphere(0.035, 6, 4), gold(), -0.02, 0, 0);
  }
  if (o.mounted) {
    legs[0].rotation.set(-1.35, 0, -0.45);
    legs[1].rotation.set(-1.35, 0, 0.45);
  }
  return { g, legs, armL, armR };
}

interface Look {
  top: number;
  bottom: number;
  head: HumanOpts['head'];
  headColor: number;
  weapon: HumanOpts['weapon'];
  shield?: number;
  bigBow?: boolean;
}

function lookFor(type: UnitType, pc: number, st: Style): Look {
  switch (type) {
    case 'villager': return { top: 0xe9dfc8, bottom: 0xf3ecd9, head: 'turban', headColor: pc, weapon: 'none' };
    case 'swordsman': return { top: pc, bottom: 0xe8dcc0, head: 'turban', headColor: shade(pc, -0.25), weapon: 'sword', shield: 0x5a3a22 };
    case 'spearman': return { top: shade(pc, 0.1), bottom: 0xd9c9a3, head: 'turban', headColor: 0xe9e0c8, weapon: 'spear', shield: shade(pc, -0.3) };
    case 'archer': return { top: shade(pc, 0.15), bottom: 0xe6dcc4, head: 'turban', headColor: pc, weapon: 'bow' };
    case 'velaikkarar': return { top: pc, bottom: 0x7a1f1a, head: 'helmet', headColor: 0xd4af37, weapon: 'sword', shield: st.accent };
    case 'nayaka_archer': return { top: pc, bottom: 0x5a2a3a, head: 'helmet', headColor: 0xb8bcc4, weapon: 'bow', bigBow: true };
    case 'horseman': return { top: pc, bottom: 0xe8dcc0, head: 'turban', headColor: 0xf3ecd9, weapon: 'sword' };
    case 'mansabdar': return { top: pc, bottom: 0x2f4a3a, head: 'helmet', headColor: 0xb8bcc4, weapon: 'bow' };
    case 'rajput_lancer': return { top: pc, bottom: 0xc23b22, head: 'helmet', headColor: 0xb8bcc4, weapon: 'lance', shield: 0x3a2a1e };
    case 'bargir': return { top: 0xf08a24, bottom: 0xf3ecd9, head: 'turban', headColor: pc, weapon: 'spear' };
    default: return { top: pc, bottom: 0xe8dcc0, head: 'turban', headColor: pc, weapon: 'none' };
  }
}

function horse(parent: THREE.Object3D, coat: number, caparison: number, armored: boolean) {
  const g = new THREE.Group();
  parent.add(g);
  const m = mat(coat);
  const dark = mat(shade(coat, -0.45));
  add(g, G.box(0.3, 0.32, 0.78), m, 0, 0.74, 0);
  const neck = add(g, G.box(0.16, 0.42, 0.2), m, 0, 0.98, 0.38);
  neck.rotation.x = 0.55;
  const head = add(g, G.box(0.14, 0.15, 0.34), m, 0, 1.13, 0.58);
  head.rotation.x = 0.35;
  add(g, G.box(0.04, 0.16, 0.22), dark, 0, 1.07, 0.32).rotation.x = 0.55; // mane
  add(g, G.box(0.36, armored ? 0.34 : 0.18, 0.62), cloth(caparison), 0, armored ? 0.7 : 0.8, -0.02);
  if (armored) add(g, G.box(0.17, 0.16, 0.3), steel(), 0, 1.15, 0.6).rotation.x = 0.35;
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.1, 0.3], [0.1, 0.3], [-0.1, -0.3], [0.1, -0.3]]) {
    const p = pivot(g, x, 0.62, z);
    add(p, G.box(0.075, 0.6, 0.08), m, 0, -0.3, 0);
    add(p, G.box(0.08, 0.06, 0.09), dark, 0, -0.58, 0);
    legs.push(p);
  }
  const tail = pivot(g, 0, 0.84, -0.4);
  add(tail, G.box(0.05, 0.38, 0.05), dark, 0, -0.17, 0);
  tail.rotation.x = -0.4;
  return { g, legs, tail };
}

function elephant(parent: THREE.Object3D, pc: number, st: Style, armored: boolean) {
  const g = new THREE.Group();
  parent.add(g);
  const skin = mat(0x6f6863);
  const b = add(g, G.sphere(1, 10, 8), skin, 0, 1.2, 0);
  b.scale.set(0.58, 0.58, 0.88);
  const head = add(g, G.sphere(1, 9, 7), skin, 0, 1.42, 0.86);
  head.scale.set(0.38, 0.4, 0.36);
  for (const s of [-1, 1]) {
    const ear = add(g, G.cyl(0.32, 0.32, 0.03, 9), skin, s * 0.36, 1.45, 0.72);
    ear.rotation.set(0, 0, Math.PI / 2);
    ear.rotation.y = s * 0.3;
    const tusk = add(g, G.cone(0.035, 0.36, 5), mat(0xf4ecd8), s * 0.14, 1.12, 1.12);
    tusk.rotation.x = Math.PI / 2 + 0.6;
  }
  // trunk chain
  let t: THREE.Object3D = pivot(g, 0, 1.3, 1.12);
  const trunkRoot = t;
  for (let i = 0; i < 4; i++) {
    const r = 0.11 - i * 0.02;
    add(t, G.cyl(r * 0.85, r, 0.24, 7), skin, 0, -0.12, 0);
    const n = pivot(t, 0, -0.22, 0);
    n.rotation.x = 0.18;
    t = n;
  }
  trunkRoot.rotation.x = 0.2;
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.3, 0.45], [0.3, 0.45], [-0.3, -0.45], [0.3, -0.45]]) {
    const p = pivot(g, x, 0.9, z);
    add(p, G.cyl(0.15, 0.16, 0.9, 8), skin, 0, -0.45, 0);
    legs.push(p);
  }
  const tail = pivot(g, 0, 1.3, -0.86);
  add(tail, G.cyl(0.02, 0.02, 0.5, 4), skin, 0, -0.25, 0);
  tail.rotation.x = -0.25;
  // drape + howdah
  add(g, G.box(1.0, 0.5, 0.95), cloth(pc), 0, 1.45, -0.05);
  add(g, G.box(1.02, 0.06, 0.97), gold(), 0, 1.22, -0.05);
  const hy = 1.82;
  add(g, G.box(0.66, 0.3, 0.66), mat(armored ? st.accent : 0x8a5a2b), 0, hy, -0.1);
  for (const [x, z] of [[-0.28, 0.18], [0.28, 0.18], [-0.28, -0.38], [0.28, -0.38]]) add(g, G.cyl(0.025, 0.025, 0.42, 5), gold(), x, hy + 0.36, z);
  const canopy = add(g, armored ? G.dome(0.42) : G.hip(0.8, 0.3), cloth(shade(pc, -0.2)), 0, hy + 0.58 + (armored ? 0 : 0.15), -0.1);
  if (armored) {
    canopy.scale.set(1, 0.7, 1);
    add(g, G.box(0.5, 0.36, 0.08), gold(), 0, 1.5, 1.14).rotation.x = -0.4;
    add(g, G.box(1.1, 0.3, 0.6), steel(), 0, 1.2, 0.2);
  }
  return { g, legs, tail, trunk: trunkRoot };
}

export function buildUnit(type: UnitType, civ: CivId, pc: number, seed: number): Rig {
  const def = UNITS[type];
  const st = styleOf(civ);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const skin = SKINS[seed % SKINS.length];
  const look = lookFor(type, pc, st);
  const tools: Rig['tools'] = {};
  const carry: Rig['carry'] = {};
  let rig: Rig;

  if (def.cls === 'cavalry') {
    const coats = [0x5a3a24, 0x7a4e2c, 0xd9d2c4, 0x2e2622, 0x9a6a3a];
    const h = horse(body, type === 'rajput_lancer' ? 0xd9d2c4 : coats[seed % coats.length], type === 'rajput_lancer' ? 0x8c8f96 : pc, type === 'rajput_lancer');
    const rider = new THREE.Group();
    rider.position.set(0, 0.6, -0.02);
    body.add(rider);
    const hu = human(rider, { ...look, skin, mounted: true });
    rig = { root, body, kind: 'horse', legs: h.legs, armL: hu.armL, armR: hu.armR, tools, carry, tail: h.tail, height: 1.55, ranged: !!def.ranged, riderLegs: hu.legs };
  } else if (def.cls === 'elephant') {
    const armored = type === 'gajasena';
    const e = elephant(body, pc, st, armored);
    const mahout = new THREE.Group();
    mahout.position.set(0, 1.25, 0.55);
    mahout.scale.setScalar(0.85);
    body.add(mahout);
    const hu = human(mahout, { skin, top: 0xe9dfc8, bottom: 0xf3ecd9, head: 'turban', headColor: pc, weapon: 'none', mounted: true });
    const rider = new THREE.Group();
    rider.position.set(0, 1.7, -0.15);
    rider.scale.setScalar(0.9);
    body.add(rider);
    const r2 = human(rider, { skin: SKINS[(seed + 2) % SKINS.length], top: pc, bottom: 0xe8dcc0, head: armored ? 'helmet' : 'turban', headColor: armored ? 0xd4af37 : 0xf3ecd9, weapon: armored ? 'bow' : 'spear' });
    r2.legs.forEach((l) => (l.visible = false));
    if (armored) root.scale.setScalar(1.1);
    rig = { root, body, kind: 'elephant', legs: e.legs, armL: r2.armL, armR: r2.armR, tools, carry, trunk: e.trunk, tail: e.tail, height: 2.6, ranged: false };
    void hu;
  } else {
    const hu = human(body, { ...look, skin });
    rig = { root, body, kind: 'human', legs: hu.legs, armL: hu.armL, armR: hu.armR, tools, carry, height: 1.0, ranged: !!def.ranged };
    if (type === 'villager') {
      const hand = pivot(hu.armR, 0, -0.28, 0.02);
      const axe = new THREE.Group();
      add(axe, G.cyl(0.012, 0.012, 0.36, 5), wood(), 0, -0.1, 0);
      add(axe, G.box(0.02, 0.08, 0.1), steel(), 0, -0.26, 0.05);
      const pick = new THREE.Group();
      add(pick, G.cyl(0.012, 0.012, 0.36, 5), wood(), 0, -0.1, 0);
      add(pick, G.box(0.02, 0.03, 0.26), steel(), 0, -0.27, 0);
      const hammer = new THREE.Group();
      add(hammer, G.cyl(0.012, 0.012, 0.26, 5), wood(), 0, -0.07, 0);
      add(hammer, G.box(0.05, 0.05, 0.1), darkWood(), 0, -0.2, 0);
      for (const t of [axe, pick, hammer]) {
        t.rotation.x = -1.4;
        t.visible = false;
        hand.add(t);
      }
      const basket = add(hu.armL, G.cyl(0.09, 0.06, 0.08, 8), mat(0xb08a4a), 0, -0.3, 0.06);
      basket.visible = false;
      tools.axe = axe;
      tools.pick = pick;
      tools.hammer = hammer;
      tools.basket = basket;
      const logs = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const l = add(logs, G.cyl(0.035, 0.035, 0.42, 6), wood(), -0.04 + i * 0.04, 0.0 + (i % 2) * 0.035, 0);
        l.rotation.z = Math.PI / 2;
      }
      logs.position.set(0, 0.72, -0.1);
      logs.visible = false;
      body.add(logs);
      carry.wood = logs;
      const sackG = add(body, G.ico(0.11, 0), mat(0x9b7a4a), 0, 0.58, -0.15);
      add(sackG, G.ico(0.04, 0), gold(), 0, 0.08, 0);
      sackG.visible = false;
      carry.gold = sackG;
      const sackS = add(body, G.ico(0.11, 0), mat(0x8a8a86), 0, 0.58, -0.15);
      sackS.visible = false;
      carry.stone = sackS;
      const food = new THREE.Group();
      add(food, G.cyl(0.11, 0.08, 0.08, 8), mat(0xb08a4a), 0, 0, 0);
      add(food, G.sphere(0.08, 6, 4), mat(0x5b2a6b), 0, 0.05, 0);
      food.position.set(0, 0.92, 0);
      food.visible = false;
      body.add(food);
      carry.food = food;
    }
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  // units are drawn a bit larger than life for readability, as in classic RTS games
  root.scale.multiplyScalar(1.25);
  rig.height *= 1.25;
  return rig;
}

// ---------------------------------------------------------------------------
// buildings
// ---------------------------------------------------------------------------
function flag(parent: THREE.Object3D, pc: number, x: number, y: number, z: number, h = 0.9, size = 1) {
  const p = pivot(parent, x, y, z);
  add(p, G.cyl(0.02, 0.025, h, 5), darkWood(), 0, h / 2, 0);
  const f = pivot(p, 0, h - 0.12 * size, 0);
  add(f, G.box(0.01, 0.2 * size, 0.34 * size), cloth(pc), 0, 0, 0.17 * size, false);
  f.userData.flag = true;
  return p;
}

function finial(parent: THREE.Object3D, y: number, s = 1) {
  add(parent, G.sphere(0.06 * s, 6, 4), gold(), 0, y, 0);
  add(parent, G.cone(0.03 * s, 0.18 * s, 5), gold(), 0, y + 0.12 * s, 0);
}

function smallRoof(parent: THREE.Object3D, st: Style, w: number, d: number, y: number, pc: number) {
  const r = mat(st.roof);
  switch (st.smallRoof) {
    case 'barrel': {
      const geo = cached(`barrel${w},${d}`, () => {
        const c = new THREE.CylinderGeometry(w / 2, w / 2, d + 0.1, 10, 1, false, -Math.PI / 2, Math.PI);
        c.rotateX(-Math.PI / 2);
        return c;
      });
      add(parent, geo, r, 0, y, 0).scale.set(1.05, 0.75, 1);
      break;
    }
    case 'gable':
      add(parent, G.gable(w + 0.15, w * 0.42, d + 0.15), r, 0, y, 0);
      add(parent, G.box(0.06, 0.14, 0.06), gold(), 0, y + w * 0.42 + 0.05, d / 2);
      add(parent, G.box(0.06, 0.14, 0.06), gold(), 0, y + w * 0.42 + 0.05, -d / 2);
      break;
    case 'dome':
      add(parent, G.box(w + 0.1, 0.08, d + 0.1), mat(st.wallDark), 0, y + 0.04, 0);
      add(parent, G.box(w + 0.12, 0.03, d + 0.12), mat(st.accent), 0, y + 0.0, 0);
      add(parent, G.onion(Math.min(w, d) * 0.22), mat(st.roof), 0, y + 0.08, 0);
      finial(parent, y + 0.08 + Math.min(w, d) * 0.42, 0.7);
      break;
    case 'flat': {
      add(parent, G.box(w + 0.08, 0.1, d + 0.08), mat(st.wallDark), 0, y + 0.05, 0);
      const n = Math.max(2, Math.round(w / 0.3));
      for (let i = 0; i < n; i++) {
        const xx = -w / 2 + (i + 0.5) * (w / n);
        add(parent, G.box(0.1, 0.12, 0.1), mat(st.wall), xx, y + 0.16, d / 2);
        add(parent, G.box(0.1, 0.12, 0.1), mat(st.wall), xx, y + 0.16, -d / 2);
      }
      // small chhatri
      const c = pivot(parent, 0, y + 0.1, 0);
      for (const [x, z] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) add(c, G.box(0.04, 0.26, 0.04), mat(st.wall), x, 0.13, z);
      add(c, G.box(0.38, 0.04, 0.38), mat(st.wallDark), 0, 0.28, 0);
      add(c, G.dome(0.17), mat(st.roof), 0, 0.3, 0);
      void pc;
      break;
    }
    case 'hip':
      add(parent, G.hip(Math.max(w, d) + 0.25, 0.5), r, 0, y + 0.25, 0).scale.set(1, 1, d / w);
      break;
  }
}

function plinth(parent: THREE.Object3D, st: Style, w: number, d: number, h = 0.16) {
  add(parent, G.box(w, h + 0.3, d), mat(st.plinth), 0, h / 2 - 0.15, 0);
  add(parent, G.box(w - 0.12, 0.06, d - 0.12), mat(shade(st.plinth, 0.15)), 0, h + 0.03, 0);
}

function door(parent: THREE.Object3D, x: number, y: number, z: number, w = 0.24, h = 0.38) {
  add(parent, G.box(w, h, 0.04), mat(0x2a1a10), x, y + h / 2, z, false);
  add(parent, G.box(w + 0.08, 0.05, 0.06), gold(), x, y + h + 0.02, z, false);
}

function crown(parent: THREE.Object3D, st: Style, y: number, s: number, pc: number) {
  const W = mat(st.wall), D = mat(st.wallDark), R = mat(st.roof), A = mat(st.accent);
  switch (st.crown) {
    case 'stupa': {
      add(parent, G.cyl(0.95 * s, 1.0 * s, 0.18 * s, 16), D, 0, y + 0.09 * s, 0);
      add(parent, G.dome(0.85 * s, 16), mat(0xe6d6b4), 0, y + 0.18 * s, 0);
      add(parent, G.box(0.3 * s, 0.18 * s, 0.3 * s), A, 0, y + 1.1 * s, 0);
      add(parent, G.cyl(0.02 * s, 0.02 * s, 0.5 * s, 4), darkWood(), 0, y + 1.4 * s, 0);
      for (let i = 0; i < 3; i++) add(parent, G.cyl(0.2 * s - i * 0.05 * s, 0.2 * s - i * 0.05 * s, 0.03, 10), gold(), 0, y + 1.3 * s + i * 0.13 * s, 0);
      // Ashoka pillar beside
      const p = pivot(parent, 1.35 * s, y - 0.2, 1.35 * s);
      add(p, G.cyl(0.07, 0.09, 1.8 * s, 8), mat(0xe9dcc0, { rough: 0.3 }), 0, 0.9 * s, 0);
      add(p, G.cyl(0.13, 0.09, 0.14, 8), A, 0, 1.85 * s, 0);
      add(p, G.ico(0.11, 0), gold(), 0, 2.0 * s, 0);
      break;
    }
    case 'gopuram': {
      let w = 1.9 * s, yy = y;
      for (let i = 0; i < 5; i++) {
        add(parent, G.box(w, 0.32 * s, w * 0.72), i % 2 ? R : mat(shade(st.roof, 0.12)), 0, yy + 0.16 * s, 0);
        // little niches
        add(parent, G.box(w + 0.02, 0.05 * s, w * 0.74), A, 0, yy + 0.32 * s, 0);
        yy += 0.34 * s;
        w *= 0.8;
      }
      const top = add(parent, cached(`gb${s}`, () => new THREE.CylinderGeometry(0.28 * s, 0.28 * s, 0.75 * s, 10, 1, false, 0, Math.PI)), R, 0, yy, 0);
      top.rotation.z = Math.PI / 2;
      top.rotation.y = Math.PI / 2;
      for (const x of [-0.25, 0, 0.25]) finial(pivot(parent, x * s, 0, 0), yy + 0.25 * s, 0.8 * s);
      break;
    }
    case 'onion': {
      add(parent, G.cyl(0.62 * s, 0.7 * s, 0.35 * s, 16), W, 0, y + 0.17 * s, 0);
      add(parent, G.cyl(0.66 * s, 0.66 * s, 0.05, 16), A, 0, y + 0.35 * s, 0);
      add(parent, G.onion(0.6 * s), mat(0xfaf8f2, { rough: 0.5 }), 0, y + 0.35 * s, 0);
      finial(parent, y + 1.5 * s, 1.4 * s);
      for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
        const m = pivot(parent, x * s, y - 1.0, z * s);
        add(m, G.cyl(0.1 * s, 0.13 * s, 2.3 * s, 8), W, 0, 1.15 * s, 0);
        add(m, G.cyl(0.15 * s, 0.15 * s, 0.05, 8), A, 0, 1.6 * s, 0);
        add(m, G.onion(0.12 * s), W, 0, 2.3 * s, 0);
      }
      break;
    }
    case 'chhatri': {
      const c = (x: number, z: number, r: number) => {
        const p = pivot(parent, x, y, z);
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(p, G.box(0.06 * r, 0.5 * r, 0.06 * r), W, a * 0.3 * r, 0.25 * r, b * 0.3 * r);
        add(p, G.box(0.8 * r, 0.07 * r, 0.8 * r), D, 0, 0.53 * r, 0);
        add(p, G.dome(0.36 * r), R, 0, 0.56 * r, 0);
        finial(p, 0.92 * r, 0.6 * r);
      };
      c(0, 0, 1.5 * s);
      for (const [x, z] of [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]]) c(x * s, z * s, 0.8 * s);
      break;
    }
    case 'fort': {
      for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
        add(parent, G.cyl(0.42 * s, 0.5 * s, 1.0 * s, 10), D, x * s, y - 0.3 * s, z * s);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          add(parent, G.box(0.12, 0.14, 0.12), D, x * s + Math.cos(a) * 0.38 * s, y + 0.27 * s, z * s + Math.sin(a) * 0.38 * s);
        }
      }
      add(parent, G.box(1.3 * s, 0.6 * s, 1.3 * s), W, 0, y + 0.3 * s, 0);
      void A;
      add(parent, G.hip(1.6 * s, 0.6 * s), R, 0, y + 0.9 * s, 0);
      flag(parent, 0xf08a24, 0, y + 1.1 * s, 0, 1.6 * s, 1.8);
      break;
    }
    case 'mandapa': {
      add(parent, G.box(2.3 * s, 0.1, 2.3 * s), D, 0, y + 0.05, 0);
      for (let i = -2; i <= 2; i++)
        for (const j of [-2, 2]) {
          add(parent, G.box(0.12, 0.6 * s, 0.12), W, i * 0.5 * s, y + 0.3 * s, j * 0.5 * s);
          if (Math.abs(i) !== 2) add(parent, G.box(0.12, 0.6 * s, 0.12), W, j * 0.5 * s, y + 0.3 * s, i * 0.5 * s);
        }
      add(parent, G.box(2.4 * s, 0.12, 2.4 * s), D, 0, y + 0.66 * s, 0);
      let w = 1.5 * s, yy = y + 0.72 * s;
      for (let i = 0; i < 4; i++) {
        add(parent, G.box(w, 0.28 * s, w), i % 2 ? R : W, 0, yy + 0.14 * s, 0);
        yy += 0.28 * s;
        w *= 0.76;
      }
      add(parent, G.dome(0.3 * s), A, 0, yy, 0);
      finial(parent, yy + 0.3 * s, s);
      break;
    }
  }
  void pc;
}

export function buildBuilding(type: BuildingType, civ: CivId, pc: number): THREE.Group {
  const st = styleOf(civ);
  const g = new THREE.Group();
  const W = mat(st.wall), D = mat(st.wallDark);
  switch (type) {
    case 'town_center': {
      plinth(g, st, 3.9, 3.9, 0.2);
      add(g, G.box(3.2, 0.12, 3.2), mat(shade(st.plinth, 0.25)), 0, 0.26, 0);
      add(g, G.box(2.5, 1.25, 2.5), W, 0, 0.9, 0);
      add(g, G.box(2.62, 0.1, 2.62), mat(st.accent), 0, 1.57, 0);
      add(g, G.box(2.7, 0.08, 2.7), D, 0, 0.3, 0);
      // arcade of pillars at the front
      for (let i = -2; i <= 2; i++) add(g, G.box(0.1, 1.0, 0.1), D, i * 0.55, 0.78, 1.38);
      add(g, G.box(2.6, 0.12, 0.36), D, 0, 1.33, 1.3);
      door(g, 0, 0.32, 1.26, 0.5, 0.75);
      for (const s of [-1, 1]) {
        add(g, G.box(0.04, 0.3, 0.2), mat(0x2a1a10), s * 1.26, 1.0, 0.4);
        add(g, G.box(0.04, 0.3, 0.2), mat(0x2a1a10), s * 1.26, 1.0, -0.4);
      }
      crown(g, st, 1.62, 1, pc);
      flag(g, pc, -1.65, 0.3, 1.65, 1.6, 1.4);
      flag(g, pc, 1.65, 0.3, 1.65, 1.6, 1.4);
      flag(g, pc, -1.65, 0.3, -1.65, 1.2, 1.1);
      flag(g, pc, 1.65, 0.3, -1.65, 1.2, 1.1);
      // steps
      add(g, G.box(1.0, 0.1, 0.3), mat(shade(st.plinth, 0.1)), 0, 0.05, 2.0);
      break;
    }
    case 'house': {
      plinth(g, st, 1.7, 1.7, 0.1);
      add(g, G.box(1.3, 0.75, 1.1), W, 0, 0.5, 0);
      add(g, G.box(1.36, 0.06, 1.16), mat(st.accent), 0, 0.88, 0);
      door(g, 0.15, 0.12, 0.56, 0.22, 0.4);
      add(g, G.box(0.18, 0.16, 0.04), mat(0x2a1a10), -0.35, 0.55, 0.56);
      smallRoof(g, st, 1.3, 1.1, 0.9, pc);
      // awning in player colour
      const aw = add(g, G.box(0.5, 0.03, 0.24), cloth(pc), 0.15, 0.6, 0.66);
      aw.rotation.x = 0.35;
      add(g, G.cyl(0.08, 0.06, 0.14, 7), mat(0xa0522d), -0.62, 0.17, 0.6);
      break;
    }
    case 'storehouse': {
      plinth(g, st, 1.8, 1.8, 0.1);
      add(g, G.box(1.4, 0.8, 1.0), W, 0, 0.5, -0.3);
      add(g, G.box(1.1, 0.5, 0.02), mat(0x2a1a10), 0, 0.4, 0.21, false);
      smallRoof(g, st, 1.4, 1.0, 0.9, pc);
      for (let i = 0; i < 4; i++) {
        const l = add(g, G.cyl(0.07, 0.07, 0.7, 6), wood(), -0.5 + (i % 2) * 0.14, 0.18 + Math.floor(i / 2) * 0.13, 0.55);
        l.rotation.z = Math.PI / 2;
        l.rotation.y = Math.PI / 2;
      }
      add(g, G.ico(0.14, 0), mat(0x9b7a4a), 0.35, 0.2, 0.5);
      add(g, G.ico(0.12, 0), mat(0x9b7a4a), 0.55, 0.18, 0.4);
      add(g, G.box(0.25, 0.25, 0.25), darkWood(), 0.6, 0.22, 0.7);
      flag(g, pc, 0.75, 0.1, -0.75, 1.1);
      break;
    }
    case 'farm': {
      add(g, G.box(2.9, 0.08, 2.9), mat(0x6b5236), 0, 0.0, 0, false);
      add(g, G.box(2.7, 0.04, 2.7), mat(0x4f7b6e, { rough: 0.25 }), 0, 0.05, 0, false);
      for (const [x, z, w, d] of [[0, 1.4, 2.9, 0.12], [0, -1.4, 2.9, 0.12], [1.4, 0, 0.12, 2.9], [-1.4, 0, 0.12, 2.9]])
        add(g, G.box(w, 0.12, d), mat(0x7a5c3a), x, 0.06, z, false);
      const crops = new THREE.Group();
      crops.name = 'crops';
      for (let i = 0; i < 7; i++)
        for (let j = 0; j < 7; j++) {
          const c = add(crops, G.cone(0.08, 0.3, 4), mat(i % 2 ? 0x7fb83a : 0x6fa832), -1.08 + i * 0.36, 0.2, -1.08 + j * 0.36, false);
          c.rotation.y = (i * 7 + j) * 0.7;
        }
      g.add(crops);
      add(g, G.box(0.2, 0.25, 0.04), cloth(pc), 1.3, 0.35, 1.3);
      add(g, G.cyl(0.015, 0.015, 0.5, 4), darkWood(), 1.3, 0.25, 1.32);
      break;
    }
    case 'barracks': {
      plinth(g, st, 2.8, 2.8, 0.12);
      add(g, G.box(2.4, 0.95, 1.3), W, 0, 0.6, -0.6);
      add(g, G.box(2.46, 0.08, 1.36), mat(st.accent), 0, 1.1, -0.6);
      for (let i = -3; i <= 3; i++) add(g, G.box(0.08, 0.85, 0.08), D, i * 0.36, 0.55, 0.08);
      smallRoof(g, st, 2.4, 1.3, 1.12, pc);
      door(g, 0, 0.12, 0.06, 0.4, 0.6);
      // weapon rack + training dummy
      add(g, G.box(0.8, 0.05, 0.08), darkWood(), -0.6, 0.55, 0.95);
      for (let i = 0; i < 4; i++) {
        const sp = add(g, G.cyl(0.012, 0.012, 0.9, 4), wood(), -0.9 + i * 0.2, 0.55, 0.95);
        sp.rotation.x = 0.15;
        add(g, G.cone(0.025, 0.08, 4), steel(), -0.9 + i * 0.2, 1.02, 1.02);
      }
      add(g, G.cyl(0.03, 0.03, 0.8, 5), wood(), 0.7, 0.45, 0.95);
      add(g, G.box(0.4, 0.06, 0.06), wood(), 0.7, 0.7, 0.95);
      add(g, G.ico(0.1, 0), mat(0xc9b48a), 0.7, 0.9, 0.95);
      flag(g, pc, -1.25, 0.12, 1.25, 1.4, 1.2);
      flag(g, pc, 1.25, 0.12, 1.25, 1.4, 1.2);
      break;
    }
    case 'archery_range': {
      plinth(g, st, 2.8, 2.8, 0.08);
      // low compound wall
      for (const [x, z, w, d] of [[0, -1.3, 2.7, 0.14], [-1.3, 0, 0.14, 2.7], [1.3, 0, 0.14, 2.7]])
        add(g, G.box(w, 0.4, d), W, x, 0.3, z);
      // pavilion
      add(g, G.box(1.2, 0.8, 0.8), W, -0.6, 0.5, -0.7);
      smallRoof(g, st, 1.2, 0.8, 0.9, pc);
      g.children[g.children.length - 1].position.x -= 0.6;
      // targets
      for (const [x, z] of [[0.5, -0.8], [0.9, 0.2], [0.3, 0.9]]) {
        add(g, G.cyl(0.02, 0.02, 0.6, 4), darkWood(), x, 0.35, z - 0.08);
        const t = add(g, G.cyl(0.22, 0.22, 0.05, 12), mat(0xe9dcc0), x, 0.55, z);
        t.rotation.x = Math.PI / 2;
        const t2 = add(g, G.cyl(0.14, 0.14, 0.055, 12), cloth(pc), x, 0.55, z);
        t2.rotation.x = Math.PI / 2;
        const t3 = add(g, G.cyl(0.06, 0.06, 0.06, 10), mat(0xd4af37), x, 0.55, z);
        t3.rotation.x = Math.PI / 2;
      }
      flag(g, pc, -1.25, 0.1, 1.25, 1.4, 1.2);
      break;
    }
    case 'stable': {
      plinth(g, st, 2.8, 2.8, 0.08);
      add(g, G.box(2.5, 0.75, 1.0), D, 0, 0.45, -0.75);
      for (let i = -3; i <= 3; i++) add(g, G.box(0.08, 0.8, 0.08), mat(0x5a3a22), i * 0.38, 0.45, -0.2);
      add(g, G.box(2.7, 0.08, 1.4), mat(st.roof), 0, 0.9, -0.55).rotation.x = -0.18;
      // fence
      for (let i = -3; i <= 3; i++) add(g, G.box(0.05, 0.4, 0.05), wood(), i * 0.4, 0.25, 1.25);
      add(g, G.box(2.5, 0.05, 0.04), wood(), 0, 0.38, 1.25);
      add(g, G.box(2.5, 0.05, 0.04), wood(), 0, 0.22, 1.25);
      // hay & trough
      add(g, G.ico(0.32, 0), mat(0xd9b84a), -0.85, 0.25, 0.5).scale.set(1, 0.6, 1);
      add(g, G.box(0.7, 0.18, 0.25), darkWood(), 0.6, 0.15, 0.5);
      add(g, G.box(0.62, 0.02, 0.18), mat(0x3a7a8a, { rough: 0.2 }), 0.6, 0.24, 0.5);
      flag(g, pc, 1.25, 0.1, -1.25, 1.5, 1.2);
      break;
    }
    case 'tower': {
      plinth(g, st, 1.8, 1.8, 0.12);
      add(g, G.cyl(0.55, 0.7, 2.2, 8), W, 0, 1.2, 0);
      add(g, G.cyl(0.72, 0.72, 0.12, 8), mat(st.accent), 0, 2.32, 0);
      add(g, G.cyl(0.66, 0.6, 0.35, 8), D, 0, 2.55, 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        add(g, G.box(0.14, 0.18, 0.14), D, Math.cos(a) * 0.6, 2.8, Math.sin(a) * 0.6);
      }
      for (const y of [0.9, 1.6]) add(g, G.box(0.08, 0.2, 0.04), mat(0x1a120c), 0, y, 0.62, false);
      const roofG = new THREE.Group();
      roofG.position.y = 2.75;
      g.add(roofG);
      if (st.crown === 'onion') add(roofG, G.onion(0.35), mat(0xfaf8f2), 0, 0.05, 0);
      else if (st.crown === 'gopuram' || st.crown === 'mandapa') add(roofG, G.hip(0.9, 0.7), mat(st.roof), 0, 0.4, 0);
      else if (st.crown === 'stupa') add(roofG, G.dome(0.45), mat(0xe6d6b4), 0, 0.05, 0);
      else if (st.crown === 'chhatri') {
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(roofG, G.box(0.05, 0.4, 0.05), W, x * 0.25, 0.2, z * 0.25);
        add(roofG, G.dome(0.36), mat(st.roof), 0, 0.42, 0);
      } else add(roofG, G.hip(1.0, 0.55), mat(st.roof), 0, 0.3, 0);
      flag(g, pc, 0, 3.0, 0, 1.0, 1.1);
      break;
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.castShadow !== false) o.castShadow = true;
  });
  return g;
}

/** wooden scaffolding shown around foundations */
export function buildScaffold(size: number): THREE.Group {
  const g = new THREE.Group();
  const h = size * 0.55 + 0.6;
  const s = size * 0.46;
  for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) add(g, G.box(0.06, h, 0.06), wood(), x, h / 2, z);
  for (const y of [h * 0.4, h * 0.85]) {
    add(g, G.box(size * 0.92, 0.05, 0.05), wood(), 0, y, s);
    add(g, G.box(size * 0.92, 0.05, 0.05), wood(), 0, y, -s);
    add(g, G.box(0.05, 0.05, size * 0.92), wood(), s, y, 0);
    add(g, G.box(0.05, 0.05, size * 0.92), wood(), -s, y, 0);
  }
  add(g, G.box(size * 0.95, 0.04, size * 0.95), mat(0x8a6a44), 0, 0.03, 0, false);
  return g;
}
