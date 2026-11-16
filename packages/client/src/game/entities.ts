import * as THREE from 'three';
import { Anim, BUILDINGS, UNITS, type BuildingType, type CivId, type EntSnap, type ResourceType, type UnitType } from '@thrones/shared';
import { buildBuilding, buildScaffold, buildUnit, type Rig } from '../render/models';
import type { TerrainView } from '../render/terrain';

export interface CEnt {
  id: number;
  kind: 0 | 1;
  type: string;
  owner: number;
  x: number;
  y: number;
  px: number;
  py: number;
  nx: number;
  ny: number;
  facing: number;
  nf: number;
  hp: number;
  m: number;
  a: number;
  c: number;
  ct?: ResourceType;
  g?: ResourceType;
  p?: number;
  q?: [UnitType, number][];
  r?: [number, number];
  fa?: number;
  /** building we remember but can't currently see */
  stale: boolean;
  dying: number;
  selected: boolean;
  hovered: boolean;
  lastDamage: number;
  view: UnitView | BuildingView;
}

const ringGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
const barBg = new THREE.PlaneGeometry(1, 0.11);
const barFg = new THREE.PlaneGeometry(1, 0.075).translate(0.5, 0, 0);
const ringMats = new Map<number, THREE.MeshBasicMaterial>();
function ringMat(color: number) {
  let m = ringMats.get(color);
  if (!m) ringMats.set(color, (m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })));
  return m;
}

class HpBar {
  group = new THREE.Group();
  fg: THREE.Mesh;
  private fgMat: THREE.MeshBasicMaterial;
  constructor(width: number) {
    const bg = new THREE.Mesh(barBg, new THREE.MeshBasicMaterial({ color: 0x150d08, depthTest: false, transparent: true, opacity: 0.85 }));
    this.fgMat = new THREE.MeshBasicMaterial({ color: 0x4caf50, depthTest: false });
    this.fg = new THREE.Mesh(barFg, this.fgMat);
    this.fg.position.set(-0.5 + 0.01, 0, 0.001);
    this.fg.scale.x = 0.98;
    bg.renderOrder = 998;
    this.fg.renderOrder = 999;
    this.group.add(bg, this.fg);
    this.group.scale.set(width, 1, 1);
    this.group.visible = false;
  }
  set(ratio: number, color?: number) {
    this.fg.scale.x = Math.max(0.001, ratio * 0.98);
    this.fgMat.color.setHex(color ?? (ratio > 0.6 ? 0x5bc24f : ratio > 0.3 ? 0xe8b52e : 0xd8402f));
  }
}

const angleLerp = (a: number, b: number, t: number) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class UnitView {
  root: THREE.Group;
  rig: Rig;
  ring: THREE.Mesh;
  bar: HpBar;
  phase = Math.random() * 10;
  animT = 0;
  lastAnim = -1;
  radius: number;
  speed: number;
  cooldown: number;

  constructor(public ent: CEnt, civ: CivId, pc: number, ringColor: number) {
    const def = UNITS[ent.type as UnitType];
    this.rig = buildUnit(ent.type as UnitType, civ, pc, ent.id * 7);
    this.root = new THREE.Group();
    this.root.add(this.rig.root);
    this.radius = def.cls === 'elephant' ? 0.8 : def.cls === 'cavalry' ? 0.55 : 0.36;
    this.speed = def.speed;
    this.cooldown = def.cooldown;
    this.ring = new THREE.Mesh(ringGeo, ringMat(ringColor));
    this.ring.scale.setScalar(this.radius);
    this.ring.visible = false;
    this.root.add(this.ring);
    this.bar = new HpBar(def.cls === 'elephant' ? 1.1 : 0.7);
    this.bar.group.position.y = this.rig.height + 0.15;
    this.root.add(this.bar.group);
  }

  update(dt: number, terrain: TerrainView, cam: THREE.Camera, now: number) {
    const e = this.ent;
    const rig = this.rig;
    this.root.position.set(e.x, terrain.groundAt(e.x, e.y), e.y);
    if (e.dying >= 0) {
      e.dying += dt;
      const k = Math.min(1, e.dying / 0.45);
      rig.root.rotation.z = (Math.PI / 2) * k * (rig.kind === 'human' ? 1 : 0.9);
      rig.root.position.y = rig.kind === 'human' ? k * 0.1 : k * (rig.kind === 'elephant' ? 0.5 : 0.25);
      if (e.dying > 1.6) rig.root.position.y -= (e.dying - 1.6) * 0.5;
      this.ring.visible = false;
      this.bar.group.visible = false;
      return;
    }
    e.facing = angleLerp(e.facing, e.nf, Math.min(1, dt * 10));
    rig.root.rotation.y = Math.PI / 2 - e.facing;

    this.ring.visible = e.selected || e.hovered;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = e.selected ? 0.95 : 0.45;
    this.bar.group.visible = e.selected || e.hovered || (e.hp < e.m && now - e.lastDamage < 4000);
    if (this.bar.group.visible) {
      this.bar.set(e.hp / e.m);
      this.bar.group.quaternion.copy(cam.quaternion);
    }

    if (e.a !== this.lastAnim) {
      this.animT = 0;
      this.lastAnim = e.a;
    }
    this.animT += dt;
    this.animate(dt);
  }

  private animate(dt: number) {
    const e = this.ent;
    const r = this.rig;
    const t = this.animT;
    const legs = r.legs;
    // reset
    r.body.position.y = 0;
    r.body.rotation.x = 0;
    if (r.tools.axe) {
      r.tools.axe.visible = e.a === Anim.GATHER && e.g === 'wood';
      r.tools.pick!.visible = e.a === Anim.GATHER && (e.g === 'gold' || e.g === 'stone');
      r.tools.hammer!.visible = e.a === Anim.BUILD;
      r.tools.basket!.visible = e.a === Anim.GATHER && e.g === 'food';
      for (const k of ['wood', 'gold', 'stone', 'food'] as ResourceType[]) {
        const c = r.carry[k];
        if (c) c.visible = e.c > 0 && e.ct === k && e.a !== Anim.GATHER;
      }
    }
    if (e.a === Anim.WALK) {
      this.phase += dt * 9 * (this.speed / 1.6);
    } else this.phase += dt * 2;
    const ph = this.phase;

    if (r.kind === 'human') {
      if (e.a === Anim.WALK) {
        legs[0].rotation.x = Math.sin(ph) * 0.65;
        legs[1].rotation.x = -Math.sin(ph) * 0.65;
        r.armL.rotation.x = -Math.sin(ph) * 0.5;
        r.armR.rotation.x = Math.sin(ph) * 0.5;
        r.body.position.y = Math.abs(Math.sin(ph)) * 0.035;
        if (e.c > 0 && e.ct === 'food') r.armL.rotation.x = r.armR.rotation.x = 0;
      } else {
        legs[0].rotation.x = legs[1].rotation.x = 0;
        r.armL.rotation.x = Math.sin(ph) * 0.04;
        r.armR.rotation.x = -Math.sin(ph) * 0.04;
      }
      r.armR.rotation.z = 0;
      r.armL.rotation.z = 0;
      if (e.a === Anim.ATTACK) this.attackPose(t);
      else if (e.a === Anim.GATHER) {
        if (e.g === 'food') {
          const k = (t % 0.8) / 0.8;
          r.body.rotation.x = 0.35;
          r.armR.rotation.x = -0.9 + Math.sin(k * Math.PI * 2) * 0.4;
          r.armL.rotation.x = -0.7;
        } else {
          const k = (t % 0.9) / 0.9;
          const sw = k < 0.55 ? -2.6 * (k / 0.55) : -2.6 + 3.0 * Math.min(1, (k - 0.55) / 0.15);
          r.armR.rotation.x = sw;
          r.armL.rotation.x = sw * 0.9;
          r.body.rotation.x = k > 0.55 && k < 0.8 ? 0.15 : 0;
        }
      } else if (e.a === Anim.BUILD) {
        const k = (t % 0.5) / 0.5;
        r.armR.rotation.x = k < 0.6 ? -1.9 * (k / 0.6) - 0.3 : -2.2 + 2.4 * ((k - 0.6) / 0.4);
        r.armL.rotation.x = -0.6;
        r.body.rotation.x = 0.2;
      }
    } else if (r.kind === 'horse') {
      if (e.a === Anim.WALK) {
        const s = Math.sin(ph * 1.1);
        legs[0].rotation.x = s * 0.75;
        legs[3].rotation.x = s * 0.75;
        legs[1].rotation.x = -s * 0.75;
        legs[2].rotation.x = -s * 0.75;
        r.body.position.y = Math.abs(Math.cos(ph * 1.1)) * 0.06;
        r.body.rotation.x = Math.sin(ph * 1.1) * 0.04;
      } else for (const l of legs) l.rotation.x = 0;
      if (r.tail) r.tail.rotation.z = Math.sin(ph * 1.3) * 0.25;
      r.armL.rotation.x = -0.6;
      r.armR.rotation.x = -0.6;
      if (e.a === Anim.ATTACK) this.attackPose(t);
    } else {
      if (e.a === Anim.WALK) {
        for (let i = 0; i < 4; i++) legs[i].rotation.x = Math.sin(ph * 0.6 + [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5][i]) * 0.32;
        r.body.position.y = Math.abs(Math.sin(ph * 0.6)) * 0.05;
      } else for (const l of legs) l.rotation.x = 0;
      if (r.trunk) r.trunk.rotation.x = 0.2 + Math.sin(ph * 0.7) * 0.15;
      if (r.tail) r.tail.rotation.z = Math.sin(ph) * 0.2;
      if (e.a === Anim.ATTACK) {
        const k = (t % this.cooldown) / this.cooldown;
        const rear = k < 0.4 ? k / 0.4 : Math.max(0, 1 - (k - 0.4) / 0.2);
        r.body.rotation.x = -0.18 * rear;
        if (r.trunk) r.trunk.rotation.x = 0.2 - rear * 1.2;
        this.attackPose(t);
      }
    }
  }

  private attackPose(t: number) {
    const r = this.rig;
    const k = (t % this.cooldown) / this.cooldown;
    if (r.ranged) {
      r.armL.rotation.x = -1.5;
      r.armR.rotation.x = -1.5;
      r.armR.rotation.z = k < 0.6 ? -0.4 * (k / 0.6) : 0;
      r.armL.rotation.z = 0.15;
    } else {
      let a: number;
      if (k < 0.45) a = -2.5 * (k / 0.45);
      else if (k < 0.58) a = -2.5 + 3.0 * ((k - 0.45) / 0.13);
      else a = 0.5 - 0.5 * ((k - 0.58) / 0.42);
      r.armR.rotation.x = a;
      r.armL.rotation.x = -0.7;
    }
  }
}

export class BuildingView {
  root = new THREE.Group();
  model: THREE.Group;
  scaffold: THREE.Group | null = null;
  ring: THREE.Mesh;
  bar: HpBar;
  flags: THREE.Object3D[] = [];
  crops: THREE.Object3D | null;
  size: number;
  height: number;

  constructor(public ent: CEnt, civ: CivId, pc: number, ringColor: number, terrain: TerrainView) {
    const def = BUILDINGS[ent.type as BuildingType];
    this.size = def.size;
    this.model = buildBuilding(ent.type as BuildingType, civ, pc);
    this.root.add(this.model);
    // sit on the lowest corner so nothing floats
    let h = Infinity;
    const s = def.size / 2;
    for (const [dx, dy] of [[-s, -s], [s, -s], [-s, s], [s, s], [0, 0]]) h = Math.min(h, terrain.groundAt(ent.x + dx, ent.y + dy));
    this.root.position.set(ent.x, h, ent.y);
    this.model.traverse((o) => {
      if (o.userData.flag) this.flags.push(o);
    });
    this.crops = this.model.getObjectByName('crops') ?? null;
    this.ring = new THREE.Mesh(ringGeo, ringMat(ringColor));
    this.ring.scale.setScalar(def.size * 0.72);
    this.ring.position.y = 0.08;
    this.ring.visible = false;
    this.root.add(this.ring);
    this.height = ent.type === 'tower' ? 3.6 : ent.type === 'town_center' ? 3.8 : ent.type === 'farm' ? 0.6 : 2.0;
    this.bar = new HpBar(Math.min(2.4, def.size * 0.6));
    this.bar.group.position.y = this.height;
    this.root.add(this.bar.group);
  }

  update(dt: number, cam: THREE.Camera, time: number, now: number) {
    const e = this.ent;
    if (e.dying >= 0) {
      e.dying += dt;
      this.model.position.y = -e.dying * 1.4;
      this.model.rotation.z = Math.sin(e.dying * 30) * 0.02;
      this.ring.visible = this.bar.group.visible = false;
      if (this.scaffold) this.scaffold.visible = false;
      return;
    }
    const building = e.p !== undefined;
    if (building) {
      if (!this.scaffold) {
        this.scaffold = buildScaffold(this.size);
        this.root.add(this.scaffold);
      }
      this.model.scale.y = 0.08 + 0.92 * e.p!;
    } else {
      if (this.scaffold) {
        this.root.remove(this.scaffold);
        this.scaffold = null;
      }
      this.model.scale.y = 1;
    }
    if (this.crops && e.fa !== undefined) {
      const k = Math.max(0.15, e.fa / 300);
      this.crops.scale.set(1, building ? 0.2 : k, 1);
    }
    for (let i = 0; i < this.flags.length; i++) this.flags[i].rotation.y = Math.sin(time * 2.6 + i * 1.7 + e.id) * 0.35;
    this.ring.visible = e.selected || e.hovered;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = e.selected ? 0.95 : 0.45;
    this.bar.group.visible = !e.stale && (e.selected || e.hovered || (e.hp < e.m && now - e.lastDamage < 4000) || building);
    if (this.bar.group.visible) {
      this.bar.set(e.hp / e.m, building ? 0xd9a93a : undefined);
      this.bar.group.quaternion.copy(cam.quaternion);
    }
  }
}

export function applySnap(e: CEnt, s: EntSnap, now: number) {
  if (s.h < e.hp) e.lastDamage = now;
  e.px = e.x;
  e.py = e.y;
  e.nx = s.x;
  e.ny = s.y;
  if (Math.hypot(e.nx - e.x, e.ny - e.y) > 3) {
    e.x = e.px = e.nx;
    e.y = e.py = e.ny;
  }
  if (s.f !== undefined) e.nf = s.f;
  e.hp = s.h;
  e.m = s.m;
  e.a = s.a ?? 0;
  e.c = s.c ?? 0;
  e.ct = s.ct;
  e.g = s.g;
  e.p = s.p;
  e.q = s.q;
  e.r = s.r;
  e.fa = s.fa;
  e.owner = s.o;
  e.stale = false;
}
