import * as THREE from 'three';
import {
  BUILDINGS, PLAYER_COLORS, SNAPSHOT_EVERY, TICK_MS, unitStats,
  type BuildingType, type CivId, type GameEvent, type GameInit, type PlayerSnap, type Snapshot, type UnitType,
} from '@thrones/shared';
import { Engine } from '../render/engine';
import { FogOfWar } from '../render/fow';
import { TerrainView } from '../render/terrain';
import { ResourcesView } from '../render/resources';
import { Effects } from '../render/effects';
import { RtsCamera } from './camera';
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
  me: PlayerSnap = { r: { food: 0, wood: 0, gold: 0, stone: 0 }, pop: 0, cap: 0 };
  alive: boolean[] = [];
  selection = new Set<number>();
  resSelection: number | null = null;
  you: number;
  tick = 0;
  time = 0;
  private snapAt = 0;
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
    this.worldGroup.add(e.view.root);
    applySnap(e, s, now);
    e.x = e.px = e.nx;
    e.y = e.py = e.ny;
    e.facing = e.nf;
    return e;
  }

  private remove(e: CEnt) {
    this.ents.delete(e.id);
    this.selection.delete(e.id);
    this.worldGroup.remove(e.view.root);
  }

  onSnapshot(s: Snapshot) {
    const now = performance.now();
    this.snapAt = now;
    this.tick = s.t;
    if (s.me) this.me = s.me;
    this.alive = s.al;
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
    const k = Math.min(1.25, (now - this.snapAt) / SNAP_MS);
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
