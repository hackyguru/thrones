import * as THREE from 'three';
import {
  BUILDINGS, PLAYER_COLORS, SNAPSHOT_EVERY, TICK_MS, isWall, unitStats,
  type BuildingType, type CivId, type GameEvent, type GameInit, type PlayerSnap, type Snapshot, type UnitType,
} from '@thrones/shared';
import { Engine } from '../render/engine';
import { FogOfWar } from '../render/fow';
import { TerrainView } from '../render/terrain';
import { ResourcesView } from '../render/resources';
import { Effects } from '../render/effects';
import { RtsCamera } from './camera';
import { LINK_E, LINK_N, LINK_S, LINK_W } from '../render/models';
import { applySnap, BuildingView, UnitView, type CEnt } from './entities';
import type { GameLink } from '../net/connection';

const SNAP_MS = TICK_MS * SNAPSHOT_EVERY;

export interface GameOptions {
  spectator?: boolean;
  cinematic?: boolean;
}

export class Game {
  engine: Engine;
  init: GameInit;
  terrain: TerrainView;
  resources: ResourcesView;
  effects: Effects;
  fow: FogOfWar;
  camera: RtsCamera;
  ents = new Map<number, CEnt>();
  dying: { e: CEnt; until: number }[] = [];
  /** wall and gate pieces by tile, so neighbours can join up */
  walls = new Map<number, CEnt>();
  me: PlayerSnap = { r: { food: 0, wood: 0, gold: 0, stone: 0 }, pop: 0, cap: 0 };
  alive: boolean[] = [];
  /** age of every player */
  ages: number[] = [];
  selection = new Set<number>();
  resSelection: number | null = null;
  you: number;
  tick = 0;
  time = 0;
  private snapAt = 0;
  /** smoothed real time between snapshots (ms) */
  private snapInterval = SNAP_MS;
  private visTimer = 0;
  private raf = 0;
  private last = performance.now();
  private worldGroup = new THREE.Group();
  /** hooks for HUD / audio / input */
  listeners: { onEvent?: (ev: GameEvent) => void; onFrame?: (dt: number) => void; onSnapshot?: () => void } = {};
  disposed = false;

  constructor(container: HTMLElement, public link: GameLink, public opts: GameOptions = {}) {
    this.init = link.init;
    this.you = opts.spectator ? -1 : link.init.you;
    this.engine = new Engine(container);
    const size = this.init.mapSize;
    this.fow = new FogOfWar(size);
    this.fow.revealAll = !!opts.spectator;
    this.terrain = new TerrainView(size, this.init.terrain, this.init.seed);
    this.resources = new ResourcesView(this.terrain, this.init.resources, this.init.seed);
    this.effects = new Effects(this.terrain);
    this.worldGroup.add(this.terrain.group, this.resources.group, this.effects.group);
    this.engine.scene.add(this.worldGroup);
    this.camera = new RtsCamera(this.engine.camera, size, this.terrain);
    this.camera.cinematic = !!opts.cinematic;
    const start = this.init.starts[Math.max(0, this.you)] ?? { x: size / 2, y: size / 2 };
    this.camera.jumpTo(start.x, start.y + 2);
    if (opts.cinematic) {
      this.camera.dist = this.camera.wantDist = 24;
      this.camera.pitch = 0.82;
    }
    link.onSnapshot = (s) => this.onSnapshot(s);
    this.fow.animate(0, true);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  civOf(owner: number): CivId {
    return this.init.players[owner]?.civ ?? 'maurya';
  }
  colorOf(owner: number): number {
    const p = this.init.players[owner];
    return p ? PLAYER_COLORS[p.color].hex : 0xcccccc;
  }
  isOwn(e: CEnt) {
    return e.owner === this.you;
  }

  private ringColor(owner: number) {
    return owner === this.you ? 0xf8e7b0 : this.opts.spectator ? this.colorOf(owner) : 0xe2493a;
  }

  private create(s: Snapshot['e'][number], now: number): CEnt {
    const e: CEnt = {
      id: s.i, kind: s.k, type: s.t, owner: s.o, x: s.x, y: s.y, px: s.x, py: s.y, nx: s.x, ny: s.y,
      facing: s.f ?? Math.PI / 2, nf: s.f ?? Math.PI / 2, hp: s.h, m: s.m, a: 0, c: 0,
      stale: false, dying: -1, selected: false, hovered: false, lastDamage: 0, view: null as never,
    };
    const civ = this.civOf(s.o), pc = this.colorOf(s.o);
    e.view = s.k === 0 ? new UnitView(e, civ, pc, this.ringColor(s.o)) : new BuildingView(e, civ, pc, this.ringColor(s.o), this.terrain);
    if (s.k === 1) {
      const size = BUILDINGS[s.t as BuildingType].size;
      this.terrain.clearGrass(Math.round(s.x - size / 2), Math.round(s.y - size / 2), size);
    }
    this.worldGroup.add(e.view.root);
    applySnap(e, s, now);
    e.x = e.px = e.nx;
    e.y = e.py = e.ny;
    e.facing = e.nf;
    if (s.k === 1 && isWall(s.t)) {
      this.walls.set(this.tileKey(e), e);
      this.relinkAround(e);
    }
    return e;
  }

  private tileKey(e: CEnt) {
    return Math.floor(e.x) + Math.floor(e.y) * 4096;
  }

  /** join a wall piece and its four neighbours up again */
  private relinkAround(e: CEnt) {
    const tx = Math.floor(e.x), ty = Math.floor(e.y);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const w = this.walls.get(tx + dx + (ty + dy) * 4096);
      if (!w || !(w.view instanceof BuildingView)) continue;
      const at = (ox: number, oy: number) => {
        const o = this.walls.get(tx + dx + ox + (ty + dy + oy) * 4096);
        return !!o && o.owner === w.owner;
      };
      w.view.setWallMask((at(1, 0) ? LINK_E : 0) | (at(0, 1) ? LINK_S : 0) | (at(-1, 0) ? LINK_W : 0) | (at(0, -1) ? LINK_N : 0));
    }
  }

  private forgetWall(e: CEnt) {
    if (e.kind !== 1 || !isWall(e.type)) return;
    const k = this.tileKey(e);
    if (this.walls.get(k) !== e) return;
    this.walls.delete(k);
    this.relinkAround(e);
  }

  private remove(e: CEnt) {
    this.ents.delete(e.id);
    this.selection.delete(e.id);
    this.worldGroup.remove(e.view.root);
    this.forgetWall(e);
  }

  private soundV = new THREE.Vector3();
  /** how loud / where in stereo a sound at a world position is for the current camera view */
  soundAt(x: number, y: number) {
    const v = this.soundV.set(x, this.terrain.groundAt(x, y), y).project(this.engine.camera);
    const off = Math.max(Math.abs(v.x), Math.abs(v.y));
    const onScreen = off < 1 ? 1 : Math.max(0, 1 - (off - 1) / 0.8);
    const d = Math.hypot(x - this.camera.target.x, y - this.camera.target.y);
    return { gain: onScreen * Math.max(0.3, 1 - d / 45), pan: Math.max(-0.8, Math.min(0.8, v.x * 0.75)) };
  }

  onSnapshot(s: Snapshot) {
    const now = performance.now();
    if (this.snapAt > 0) {
      const gap = now - this.snapAt;
      if (gap > 5 && gap < 1000) this.snapInterval += (gap - this.snapInterval) * 0.2;
    }
    this.snapAt = now;
    this.tick = s.t;
    if (s.me) this.me = s.me;
    this.alive = s.al;
    if (s.ag) this.ages = s.ag;
    const seen = new Set<number>();
    for (const es of s.e) {
      seen.add(es.i);
      const e = this.ents.get(es.i);
      if (e) applySnap(e, es, now);
      else this.ents.set(es.i, this.create(es, now));
    }
    if (s.rc) for (const [id, amt] of s.rc) this.resources.setAmount(id, amt);
    if (s.ev) for (const ev of s.ev) this.handleEvent(ev);
    for (const e of [...this.ents.values()]) {
      if (seen.has(e.id)) continue;
      if (e.kind === 0 || e.owner === this.you) this.remove(e);
      else {
        // remembered enemy building: drop it once we can see the spot is empty
        if (this.fow.isVisible(e.x, e.y)) this.remove(e);
        else {
          e.stale = true;
          e.px = e.nx = e.x;
          e.py = e.ny = e.y;
        }
      }
    }
    this.listeners.onSnapshot?.();
  }

  private handleEvent(ev: GameEvent) {
    switch (ev.e) {
      case 'proj': {
        const src = this.ents.get(ev.a);
        const fromH = src?.kind === 1 ? (src.type === 'tower' ? 3.0 : 2.4) : 0.9;
        this.effects.arrow(ev.sx, ev.sy, ev.tx, ev.ty, (ev.d * TICK_MS) / 1000, fromH, () => {
          const t = this.ents.get(ev.tg);
          return t && t.dying < 0 ? { x: t.x, y: t.y } : null;
        });
        break;
      }
      case 'hit': {
        const t = this.ents.get(ev.tg);
        if (t?.kind === 1) this.effects.burst(ev.x, ev.y, 0.6, 0x9a8a70, 4, { speed: 1.2, up: 1.5 });
        else this.effects.burst(ev.x, ev.y, 0.6, 0xc8b49a, 3, { speed: 1.4, up: 1.6, size: 0.7, life: 0.4 });
        break;
      }
      case 'die': {
        const e = this.ents.get(ev.i);
        if (e) {
          this.ents.delete(e.id);
          this.selection.delete(e.id);
          this.forgetWall(e);
          e.dying = 0;
          e.selected = false;
          this.dying.push({ e, until: this.time + (e.kind === 0 ? 4 : 1.6) });
          if (e.kind === 1) this.effects.dust(e.x, e.y, BUILDINGS[e.type as BuildingType].size * 0.6, 40);
        }
        break;
      }
      case 'built': {
        const e = this.ents.get(ev.i);
        if (e) this.effects.dust(e.x, e.y, BUILDINGS[e.type as BuildingType].size * 0.5, 18);
        break;
      }
    }
    this.listeners.onEvent?.(ev);
  }

  /** gates swing open while their owner's units are passing */
  private updateGates() {
    const gates: CEnt[] = [];
    for (const w of this.walls.values()) if (w.type === 'gate' && w.view instanceof BuildingView) gates.push(w);
    if (!gates.length) return;
    for (const gt of gates) {
      let open = false;
      for (const e of this.ents.values()) {
        if (e.kind === 0 && e.owner === gt.owner && Math.abs(e.x - gt.x) < 1.6 && Math.abs(e.y - gt.y) < 1.6) {
          open = true;
          break;
        }
      }
      (gt.view as BuildingView).doorOpen = open;
    }
  }

  private computeVisibility() {
    if (this.fow.revealAll) return;
    this.fow.beginVisibility();
    for (const e of this.ents.values()) {
      if (e.owner !== this.you) continue;
      if (e.kind === 0) this.fow.stamp(e.x, e.y, unitStats(this.civOf(e.owner), e.type as UnitType).los);
      else {
        const def = BUILDINGS[e.type as BuildingType];
        this.fow.stamp(e.x, e.y, e.p === undefined ? def.los + Math.floor(def.size / 2) : 2);
      }
    }
  }

  private loop(t: number) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.time += dt;
    const now = performance.now();
    // interpolate over the measured snapshot spacing (it shrinks at higher game speeds)
    const k = Math.min(1.25, (now - this.snapAt) / this.snapInterval);
    for (const e of this.ents.values()) {
      if (e.kind === 0) {
        e.x = e.px + (e.nx - e.px) * k;
        e.y = e.py + (e.ny - e.py) * k;
      }
    }
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.2;
      this.computeVisibility();
      this.updateGates();
    }
    this.fow.animate(dt);
    const cam = this.engine.camera;
    for (const e of this.ents.values()) {
      if (e.view instanceof UnitView) e.view.update(dt, this.terrain, cam, now);
      else e.view.update(dt, cam, this.time, now);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      if (d.e.view instanceof UnitView) d.e.view.update(dt, this.terrain, cam, now);
      else d.e.view.update(dt, cam, this.time, now);
      if (this.time > d.until) {
        this.worldGroup.remove(d.e.view.root);
        this.dying.splice(i, 1);
      }
    }
    this.effects.update(dt);
    this.terrain.update(this.time);
    this.camera.update(dt);
    this.engine.focusShadows(this.camera.target.x, this.camera.target.y, this.camera.dist * 1.1);
    this.listeners.onFrame?.(dt);
    this.engine.render();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.link.close();
    this.engine.dispose();
  }
}
