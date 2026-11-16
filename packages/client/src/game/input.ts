import * as THREE from 'three';
import { BUILDINGS, Terrain, type BuildingType, type UnitType, UNITS } from '@thrones/shared';
import type { Game } from './game';
import type { CEnt } from './entities';
import { buildBuilding } from '../render/models';
import { sfx } from '../audio/sfx';
import { isMac, settings } from '../ui/settings';

export type Target =
  | { kind: 'ent'; e: CEnt }
  | { kind: 'res'; id: number; x: number; y: number }
  | null;

/** Mouse & keyboard: selection, smart commands, building placement, control groups. */
export class Input {
  placing: BuildingType | null = null;
  private ghost: THREE.Group | null = null;
  private ghostOk = false;
  private ghostTile = new THREE.Vector2();
  private dragStart: { x: number; y: number } | null = null;
  private box: HTMLDivElement;
  private mouse = { x: 0, y: 0, inside: false };
  private groups = new Map<number, number[]>();
  private lastGroupKey = { k: -1, t: 0 };
  private lastClick = { t: 0, id: 0 };
  /** first click of a potential double-click order */
  private pendingOrderClick = { t: 0, x: 0, y: 0 };
  private middleDrag: { x: number; y: number } | null = null;
  hover: Target = null;
  /** armed command-card orders waiting for a click */
  pendingAttack = false;
  pendingMove = false;
  /** timestamp of the last Esc this class consumed (so the HUD doesn't also open the menu) */
  lastEscHandled = -1;
  /** set once we see trackpad-style scrolling */
  private trackpad = isMac;
  enabled = true;
  onSelectionChange: () => void = () => {};
  private disposers: (() => void)[] = [];

  constructor(private game: Game, private el: HTMLElement) {
    this.box = document.createElement('div');
    this.box.className = 'select-box';
    el.appendChild(this.box);
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => t.removeEventListener(type, fn as EventListener));
    };
    const canvas = game.engine.renderer.domElement;
    if (new URLSearchParams(location.search).has('debug')) this.setupDebug(canvas);
    on(canvas, 'mousedown', (e) => this.down(e));
    on(window, 'mousemove', (e) => this.move(e));
    on(window, 'mouseup', (e) => this.up(e));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'wheel', (e) => this.wheel(e), { passive: false });
    // stop pinch gestures from zooming the whole page
    on(window, 'wheel', (e) => {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
    on(window, 'keydown', (e) => this.key(e, true));
    on(window, 'keyup', (e) => this.key(e, false));
    on(document.documentElement, 'mouseleave', () => {
      this.mouse.inside = false;
      game.camera.edge.set(0, 0);
    });
    on(window, 'blur', () => game.camera.keys.clear());
  }

  // --- input diagnostics (open the game with ?debug) ---------------------------
  private debugEl: HTMLDivElement | null = null;
  private debugLines: string[] = [];
  log(msg: string) {
    if (!this.debugEl) return;
    this.debugLines.push(`${(performance.now() / 1000).toFixed(2)}  ${msg}`);
    this.debugLines = this.debugLines.slice(-14);
    this.debugEl.textContent = this.debugLines.join('\n');
  }
  private setupDebug(canvas: HTMLCanvasElement) {
    this.debugEl = document.createElement('div');
    this.debugEl.className = 'input-debug';
    this.el.appendChild(this.debugEl);
    const top = (x: number, y: number) => {
      const t = document.elementFromPoint(x, y) as HTMLElement | null;
      return t ? t.tagName.toLowerCase() + (t.className && typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : '') : 'none';
    };
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'contextmenu', 'click', 'dblclick'] as const) {
      window.addEventListener(type, (e) => {
        const m = e as MouseEvent & { pointerType?: string };
        this.log(`${type} btn=${m.button} btns=${m.buttons} ctrl=${m.ctrlKey ? 1 : 0}${m.pointerType ? ' ' + m.pointerType : ''} on=${top(m.clientX, m.clientY)}${e.target === canvas ? ' [canvas]' : ''}`);
      }, true);
    }
    this.log(`orderClick=${settings.orderClick} mac=${isMac}`);
  }

  dispose() {
    this.debugEl?.remove();
    for (const d of this.disposers) d();
    this.box.remove();
    document.body.classList.remove('cursor-attack', 'cursor-move');
  }

  /** arm a command-card order; the next left-click chooses the target */
  arm(kind: 'move' | 'attack' | null) {
    this.pendingAttack = kind === 'attack';
    this.pendingMove = kind === 'move';
    document.body.classList.toggle('cursor-attack', kind === 'attack');
    document.body.classList.toggle('cursor-move', kind === 'move');
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const cam = this.game.camera;
    if (e.ctrlKey) {
      // trackpad pinch (browsers report it as ctrl+wheel)
      cam.zoom(e.deltaY * 4);
      return;
    }
    const pixelScroll = e.deltaMode === 0;
    if (pixelScroll && (e.deltaX !== 0 || !Number.isInteger(e.deltaY))) this.trackpad = true;
    if (this.trackpad && pixelScroll) {
      const k = cam.dist * 0.0022;
      cam.pan(e.deltaX * k, e.deltaY * k);
    } else cam.zoom(e.deltaY);
  }

  private ndc(x: number, y: number) {
    const r = this.game.engine.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private toScreen(x: number, h: number, y: number) {
    const v = new THREE.Vector3(x, h, y).project(this.game.engine.camera);
    const r = this.game.engine.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, z: v.z };
  }

  ground(x: number, y: number) {
    const n = this.ndc(x, y);
    return this.game.camera.groundFromNdc(n.x, n.y);
  }

  /** What is under the cursor? */
  pick(sx: number, sy: number): Target {
    const g = this.game;
    const gp = this.ground(sx, sy);
    const cam = g.engine.camera;
    const pxPerUnit = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    let best: CEnt | null = null;
    let bd = Infinity;
    for (const e of g.ents.values()) {
      if (e.kind === 0) {
        const def = UNITS[e.type as UnitType];
        const h = def.cls === 'elephant' ? 1.4 : def.cls === 'cavalry' ? 0.9 : 0.6;
        const p = this.toScreen(e.x, g.terrain.groundAt(e.x, e.y) + h, e.y);
        const dist = cam.position.distanceTo(new THREE.Vector3(e.x, 0, e.y));
        const rad = ((def.cls === 'elephant' ? 1.1 : def.cls === 'cavalry' ? 0.8 : 0.55) * pxPerUnit) / dist;
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d < rad && d < bd) {
          bd = d;
          best = e;
        }
      }
    }
    if (best) return { kind: 'ent', e: best };
    if (gp) {
      for (const e of g.ents.values()) {
        if (e.kind !== 1) continue;
        const s = BUILDINGS[e.type as BuildingType].size / 2;
        if (Math.abs(gp.x - e.x) <= s && Math.abs(gp.y - e.y) <= s) return { kind: 'ent', e };
      }
      // tall buildings: check projected centre
      for (const e of g.ents.values()) {
        if (e.kind !== 1) continue;
        const def = BUILDINGS[e.type as BuildingType];
        const p = this.toScreen(e.x, g.terrain.groundAt(e.x, e.y) + def.size * 0.4, e.y);
        const dist = cam.position.distanceTo(new THREE.Vector3(e.x, 0, e.y));
        if (Math.hypot(p.x - sx, p.y - sy) < (def.size * 0.45 * pxPerUnit) / dist) return { kind: 'ent', e };
      }
      // resources: nearest node whose projected canopy/body is under the cursor
      const R = g.resources;
      let rb: number | null = null;
      let rbd = Infinity;
      const size = g.terrain.size;
      for (let dy = -3; dy <= 2; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const tx = Math.floor(gp.x) + dx, ty = Math.floor(gp.y) + dy;
          if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
          const id = R.resAt[ty * size + tx];
          if (!id) continue;
          const en = R.get(id);
          if (!en || !g.fow.isExplored(en.x, en.y)) continue;
          const tall = en.type === 'tree' || en.type === 'palm' ? 1.0 : 0.25;
          const p = this.toScreen(en.x, en.base + tall, en.y);
          const dist = cam.position.distanceTo(new THREE.Vector3(en.x, 0, en.y));
          const d = Math.hypot(p.x - sx, p.y - sy);
          if (d < (0.6 * pxPerUnit) / dist && d < rbd) {
            rbd = d;
            rb = id;
          }
        }
      if (rb) {
        const en = R.get(rb)!;
        return { kind: 'res', id: rb, x: en.x, y: en.y };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  selected(): CEnt[] {
    const out: CEnt[] = [];
    for (const id of this.game.selection) {
      const e = this.game.ents.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  ownUnits(): CEnt[] {
    return this.selected().filter((e) => e.kind === 0 && e.owner === this.game.you);
  }

  setSelection(ids: number[], additive = false) {
    const g = this.game;
    if (!additive) {
      for (const e of g.ents.values()) e.selected = false;
      g.selection.clear();
    }
    for (const id of ids) {
      const e = g.ents.get(id);
      if (!e) continue;
      if (additive && g.selection.has(id) && ids.length === 1) {
        g.selection.delete(id);
        e.selected = false;
        continue;
      }
      g.selection.add(id);
      e.selected = true;
    }
    g.resSelection = null;
    const first = this.selected()[0];
    if (first && first.owner === g.you) sfx.select(first.kind === 0 ? (first.type as string) : 'building');
    this.onSelectionChange();
  }

  /** prune dead entities from selection */
  sync() {
    let changed = false;
    for (const id of [...this.game.selection]) {
      if (!this.game.ents.has(id)) {
        this.game.selection.delete(id);
        changed = true;
      }
    }
    if (changed) this.onSelectionChange();
  }

  // ---------------------------------------------------------------------------
  startPlacing(type: BuildingType) {
    this.cancelPlacing();
    this.placing = type;
    const g = this.game;
    this.ghost = buildBuilding(type, g.civOf(g.you), g.colorOf(g.you));
    this.ghost.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.45, depthWrite: false });
        m.castShadow = false;
      }
    });
    g.engine.scene.add(this.ghost);
    this.updateGhost();
  }

  cancelPlacing() {
    if (this.ghost) {
      this.game.engine.scene.remove(this.ghost);
      this.ghost.traverse((o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose?.());
    }
    this.ghost = null;
    this.placing = null;
  }

  private canPlaceClient(type: BuildingType, tx: number, ty: number) {
    const g = this.game;
    const size = BUILDINGS[type].size;
    const ms = g.terrain.size;
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) {
        if (x < 0 || y < 0 || x >= ms || y >= ms) return false;
        if (g.terrain.terrain[y * ms + x] === Terrain.WATER) return false;
        if (!g.fow.isExplored(x + 0.5, y + 0.5)) return false;
        if (g.resources.resAt[y * ms + x]) return false;
      }
    for (const e of g.ents.values()) {
      if (e.kind !== 1) continue;
      const s = BUILDINGS[e.type as BuildingType].size;
      const ex = Math.round(e.x - s / 2), ey = Math.round(e.y - s / 2);
      if (tx < ex + s && tx + size > ex && ty < ey + s && ty + size > ey) return false;
    }
    return true;
  }

  private updateGhost() {
    if (!this.ghost || !this.placing) return;
    const gp = this.ground(this.mouse.x, this.mouse.y);
    if (!gp) return;
    const size = BUILDINGS[this.placing].size;
    const tx = Math.round(gp.x - size / 2), ty = Math.round(gp.y - size / 2);
    this.ghostTile.set(tx, ty);
    const cx = tx + size / 2, cy = ty + size / 2;
    this.ghost.position.set(cx, this.game.terrain.groundAt(cx, cy), cy);
    const ok = this.canPlaceClient(this.placing, tx, ty);
    if (ok !== this.ghostOk) {
      this.ghostOk = ok;
      this.ghost.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x66ff88 : 0xff4444);
      });
    }
  }

  // ---------------------------------------------------------------------------
  private down(ev: MouseEvent) {
    if (!this.enabled) return;
    // macOS: Control+click is a right-click
    const e = isMac && ev.button === 0 && ev.ctrlKey ? ({ button: 2, clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey, preventDefault: () => ev.preventDefault() } as MouseEvent) : ev;
    if (e.button === 1) {
      this.middleDrag = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (e.button === 0) {
      if (this.placing) {
        this.place(e.shiftKey);
        return;
      }
      if (this.pendingAttack || this.pendingMove) {
        const attack = this.pendingAttack;
        this.arm(null);
        const t = this.pick(e.clientX, e.clientY);
        if (attack) this.issueAt(e.clientX, e.clientY, t, true);
        else this.moveTo(e.clientX, e.clientY);
        return;
      }
      this.dragStart = { x: e.clientX, y: e.clientY };
    }
    if (e.button === 2) {
      if (this.placing) {
        this.cancelPlacing();
        return;
      }
      if (this.pendingAttack || this.pendingMove) {
        this.arm(null);
        return;
      }
      const t = this.pick(e.clientX, e.clientY);
      this.log(`→ order (${this.ownUnits().length} units) target=${t ? t.kind : 'ground'}`);
      this.issueAt(e.clientX, e.clientY, t, false);
    }
  }

  private place(keep: boolean) {
    const g = this.game;
    if (!this.placing) return;
    const vills = this.ownUnits().filter((u) => u.type === 'villager');
    if (!this.ghostOk || !vills.length) {
      sfx.error();
      return;
    }
    g.link.send({ c: 'build', ids: vills.map((v) => v.id), type: this.placing, tx: this.ghostTile.x, ty: this.ghostTile.y });
    sfx.place();
    const s = BUILDINGS[this.placing].size;
    g.effects.dust(this.ghostTile.x + s / 2, this.ghostTile.y + s / 2, s * 0.4, 10);
    if (!keep) this.cancelPlacing();
  }

  /** plain move order (ignores what is under the cursor) */
  moveTo(sx: number, sy: number) {
    const g = this.game;
    const gp = this.ground(sx, sy);
    const units = this.ownUnits();
    if (!gp || !units.length) return;
    g.link.send({ c: 'move', ids: units.map((u) => u.id), x: gp.x, y: gp.y });
    g.effects.marker(gp.x, gp.y, 0x7dff8a);
    sfx.command('move');
  }

  /** right-click style command at a screen position */
  issueAt(sx: number, sy: number, t: Target, attackOnly: boolean) {
    const g = this.game;
    const gp = this.ground(sx, sy);
    if (!gp) return;
    const units = this.ownUnits();
    if (units.length) {
      const ids = units.map((u) => u.id);
      if (t?.kind === 'ent' && t.e.owner !== g.you && t.e.owner >= 0) {
        g.link.send({ c: 'attack', ids, target: t.e.id });
        g.effects.marker(t.e.x, t.e.y, 0xff4433);
        sfx.command('attack');
      } else if (attackOnly) {
        g.link.send({ c: 'move', ids, x: gp.x, y: gp.y });
        g.effects.marker(gp.x, gp.y, 0xff4433);
      } else {
        const target = t?.kind === 'ent' ? t.e.id : t?.kind === 'res' ? t.id : undefined;
        g.link.send({ c: 'smart', ids, x: gp.x, y: gp.y, target });
        const mx = t?.kind === 'res' ? t.x : t?.kind === 'ent' ? t.e.x : gp.x;
        const my = t?.kind === 'res' ? t.y : t?.kind === 'ent' ? t.e.y : gp.y;
        g.effects.marker(mx, my, t ? 0xffd34d : 0x7dff8a);
        sfx.command(t?.kind === 'res' ? 'gather' : 'move');
      }
      return;
    }
    // rally point for own production buildings
    const blds = this.selected().filter((b) => b.kind === 1 && b.owner === g.you && BUILDINGS[b.type as BuildingType].trains.length);
    for (const b of blds) {
      const target = t?.kind === 'ent' ? t.e.id : t?.kind === 'res' ? t.id : undefined;
      g.link.send({ c: 'rally', building: b.id, x: gp.x, y: gp.y, target });
    }
    if (blds.length) {
      g.effects.marker(gp.x, gp.y, 0xffd34d);
      sfx.command('move');
    }
  }

  private move(e: MouseEvent) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.inside = true;
    if (!this.enabled) return;
    const cam = this.game.camera;
    if (this.middleDrag) {
      const dx = e.clientX - this.middleDrag.x, dy = e.clientY - this.middleDrag.y;
      this.middleDrag = { x: e.clientX, y: e.clientY };
      cam.pan(-dx * cam.dist * 0.0022, -dy * cam.dist * 0.0022);
    }
    // edge scrolling
    const m = 6;
    cam.edge.set(e.clientX <= m ? -1 : e.clientX >= window.innerWidth - m ? 1 : 0, e.clientY <= m ? -1 : e.clientY >= window.innerHeight - m ? 1 : 0);
    if (this.dragStart) {
      const x0 = Math.min(this.dragStart.x, e.clientX), y0 = Math.min(this.dragStart.y, e.clientY);
      const w = Math.abs(e.clientX - this.dragStart.x), h = Math.abs(e.clientY - this.dragStart.y);
      if (w > 4 || h > 4) {
        this.box.style.display = 'block';
        Object.assign(this.box.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
      }
    }
  }

  /** called every frame for hover + ghost */
  frame() {
    if (!this.enabled || !this.mouse.inside) return;
    if (this.placing) {
      this.updateGhost();
      return;
    }
    const overUi = (document.elementFromPoint(this.mouse.x, this.mouse.y) as HTMLElement | null)?.closest('.hud-block');
    const prev = this.hover;
    this.hover = overUi ? null : this.pick(this.mouse.x, this.mouse.y);
    if (prev?.kind === 'ent') prev.e.hovered = false;
    if (this.hover?.kind === 'ent') this.hover.e.hovered = true;
    const g = this.game;
    const own = this.ownUnits();
    let cursor = '';
    if (this.pendingAttack) cursor = 'cursor-attack';
    else if (this.pendingMove) cursor = 'cursor-move';
    else if (this.hover?.kind === 'ent' && this.hover.e.owner !== g.you && own.length) cursor = 'cursor-attack';
    else if (!this.hover && own.length && settings.leftClickCommands) cursor = 'cursor-move';
    else if (this.hover?.kind === 'res' && own.some((u) => u.type === 'villager')) cursor = 'cursor-gather';
    else if (this.hover?.kind === 'ent' && this.hover.e.owner === g.you && this.hover.e.p !== undefined && own.some((u) => u.type === 'villager')) cursor = 'cursor-build';
    else if (this.hover) cursor = 'cursor-select';
    document.body.classList.toggle('cursor-attack', cursor === 'cursor-attack');
    document.body.classList.toggle('cursor-gather', cursor === 'cursor-gather');
    document.body.classList.toggle('cursor-build', cursor === 'cursor-build');
    document.body.classList.toggle('cursor-select', cursor === 'cursor-select');
    document.body.classList.toggle('cursor-move', cursor === 'cursor-move');
  }

  private up(e: MouseEvent) {
    if (e.button === 1) {
      this.middleDrag = null;
      return;
    }
    if (e.button !== 0 || !this.dragStart) return;
    const g = this.game;
    const ds = this.dragStart;
    this.dragStart = null;
    this.box.style.display = 'none';
    const w = Math.abs(e.clientX - ds.x), h = Math.abs(e.clientY - ds.y);
    if (w > 4 || h > 4) {
      const x0 = Math.min(ds.x, e.clientX), x1 = Math.max(ds.x, e.clientX);
      const y0 = Math.min(ds.y, e.clientY), y1 = Math.max(ds.y, e.clientY);
      const ids: number[] = [];
      for (const en of g.ents.values()) {
        if (en.kind !== 0 || en.owner !== g.you) continue;
        const p = this.toScreen(en.x, g.terrain.groundAt(en.x, en.y) + 0.4, en.y);
        if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) ids.push(en.id);
      }
      this.log(`→ box select ${ids.length}`);
      this.setSelection(ids, e.shiftKey);
      return;
    }
    const t = this.pick(e.clientX, e.clientY);
    const now = performance.now();
    this.log(`→ left click hit=${t ? (t.kind === 'ent' ? t.e.type + (t.e.owner === g.you ? '(mine)' : '') : 'resource') : 'ground'}`);
    // trackpad-friendly mode: with own units selected, a click on anything that isn't
    // one of your own units/buildings is an order rather than a new selection
    if (settings.leftClickCommands && !e.shiftKey && this.ownUnits().length) {
      const ownTarget = t?.kind === 'ent' && t.e.owner === g.you;
      const foundation = ownTarget && t.e.kind === 1 && (t.e.p !== undefined || t.e.type === 'farm') && this.ownUnits().some((u) => u.type === 'villager');
      if (!ownTarget || foundation) {
        if (settings.orderClick === 'single') {
          this.issueAt(e.clientX, e.clientY, t, false);
          return;
        }
        // double-click mode: first click only arms; the second (quick, nearby) click orders
        const pc = this.pendingOrderClick;
        if (now - pc.t < 400 && Math.hypot(e.clientX - pc.x, e.clientY - pc.y) < 14) {
          this.pendingOrderClick = { t: 0, x: 0, y: 0 };
          this.issueAt(e.clientX, e.clientY, t, false);
        } else {
          this.pendingOrderClick = { t: now, x: e.clientX, y: e.clientY };
          const gp = this.ground(e.clientX, e.clientY);
          if (gp) g.effects.marker(gp.x, gp.y, 0x8a8070, 0.35);
        }
        return;
      }
    }
    if (t?.kind === 'ent') {
      if (now - this.lastClick.t < 350 && this.lastClick.id === t.e.id && t.e.owner === g.you) {
        // double click: all of this type on screen
        const ids: number[] = [];
        for (const en of g.ents.values()) {
          if (en.owner !== g.you || en.type !== t.e.type) continue;
          const p = this.toScreen(en.x, 0, en.y);
          if (p.x >= 0 && p.x <= window.innerWidth && p.y >= 0 && p.y <= window.innerHeight) ids.push(en.id);
        }
        this.setSelection(ids, e.shiftKey);
      } else this.setSelection([t.e.id], e.shiftKey && t.e.owner === g.you);
      this.lastClick = { t: now, id: t.e.id };
    } else if (t?.kind === 'res') {
      this.setSelection([]);
      g.resSelection = t.id;
      this.onSelectionChange();
    } else if (!e.shiftKey) this.setSelection([]);
  }

  private key(e: KeyboardEvent, down: boolean) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const g = this.game;
    if (e.key.startsWith('Arrow')) {
      if (down) g.camera.keys.add(e.key);
      else g.camera.keys.delete(e.key);
      e.preventDefault();
      return;
    }
    if (!down || !this.enabled) return;
    if (e.key === 'Escape') {
      if (this.placing) this.cancelPlacing();
      else if (this.pendingAttack || this.pendingMove) this.arm(null);
      else if (g.selection.size || g.resSelection) this.setSelection([]);
      else return;
      this.lastEscHandled = e.timeStamp;
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      if (!e.ctrlKey && !e.metaKey && this.ownUnits().length) this.arm('move');
      return;
    }
    if (e.key === '=' || e.key === '+') g.camera.zoom(-250);
    if (e.key === '-' || e.key === '_') g.camera.zoom(250);
    if (e.key === '[') g.camera.rotate(-Math.PI / 8);
    if (e.key === ']') g.camera.rotate(Math.PI / 8);
    if (e.key === 'Delete' || (e.key === 'Backspace' && isMac)) {
      const ids = this.selected().filter((s) => s.owner === g.you).map((s) => s.id);
      if (ids.length) g.link.send({ c: 'delete', ids });
    }
    if (/^Digit[0-9]$/.test(e.code)) {
      const k = Number(e.code.slice(5));
      if (e.ctrlKey || e.altKey) {
        e.preventDefault();
        this.groups.set(k, [...g.selection].filter((id) => g.ents.get(id)?.owner === g.you));
      } else {
        const ids = (this.groups.get(k) ?? []).filter((id) => g.ents.has(id));
        if (!ids.length) return;
        this.setSelection(ids);
        const now = performance.now();
        if (this.lastGroupKey.k === k && now - this.lastGroupKey.t < 400) this.centerOnSelection();
        this.lastGroupKey = { k, t: now };
      }
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      for (const en of g.ents.values())
        if (en.owner === g.you && en.type === 'town_center') {
          this.setSelection([en.id]);
          g.camera.jumpTo(en.x, en.y + 2);
          return;
        }
    }
    if (e.key === '.') {
      const idle = [...g.ents.values()].filter((en) => en.owner === g.you && en.type === 'villager' && en.a === 0);
      if (!idle.length) return;
      this.idleIdx = (this.idleIdx + 1) % idle.length;
      const v = idle[this.idleIdx];
      this.setSelection([v.id]);
      g.camera.jumpTo(v.x, v.y);
    }
    if (e.key === ' ') {
      e.preventDefault();
      this.centerOnSelection();
    }
  }
  private idleIdx = -1;

  centerOnSelection() {
    const s = this.selected();
    if (!s.length) return;
    let x = 0, y = 0;
    for (const e of s) {
      x += e.x;
      y += e.y;
    }
    this.game.camera.jumpTo(x / s.length, y / s.length);
  }
}
