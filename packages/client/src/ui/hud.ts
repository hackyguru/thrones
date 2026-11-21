import * as THREE from 'three';
import {
  AGES, BUILD_PAGES, BUILDINGS, CIVS, PLAYER_COLORS, RESOURCE_NODES, TECHS, TICK_RATE, Terrain, UNITS, buildingStats, canAfford, techBlocker, techsAt, trainable, unitAge, unitStats, type Age, type TechId,
  type BuildingType, type Cost, type GameEvent, type GameOverInfo, type UnitType,
} from '@thrones/shared';
import type { Game } from '../game/game';
import type { Input } from '../game/input';
import type { CEnt } from '../game/entities';
import { portrait } from '../render/portraits';
import { ICONS, costHtml } from './icons';
import { sfx } from '../audio/sfx';
import { writeSave } from '../net/saves';
import { controlsTable, isMac, orderVerb, settings, type Graphics, type OrderClick } from './settings';

const GRID_KEYS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];

interface CmdButton {
  key: string;
  icon: string;
  title: string;
  desc?: string;
  cost?: Cost;
  disabled?: boolean;
  /** highlighted (current stance) */
  active?: boolean;
  /** not available yet (age or prerequisite) */
  locked?: boolean;
  action: () => void;
}

const fmtTime = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

const TERRAIN_COLORS: Record<number, [number, number, number]> = {
  [Terrain.GRASS]: [110, 140, 70],
  [Terrain.DRY]: [170, 150, 95],
  [Terrain.DIRT]: [150, 120, 85],
  [Terrain.SAND]: [205, 188, 140],
  [Terrain.WATER]: [40, 110, 130],
};

export class Hud {
  root: HTMLDivElement;
  private q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
  private sel: HTMLDivElement;
  private card: HTMLDivElement;
  private tip: HTMLDivElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private miniImg: ImageData;
  private miniBase: HTMLCanvasElement;
  private miniTimer = 0;
  private uiTimer = 0;
  private cardSig = '';
  /** villager build menu page: 0 economic, 1 military */
  private buildPage = 0;
  private buttons: CmdButton[] = [];
  private pings: { x: number; y: number; t: number }[] = [];
  lastAlert: { x: number; y: number } | null = null;
  onQuit: () => void = () => {};
  private disposers: (() => void)[] = [];

  constructor(private game: Game, private input: Input, parent: HTMLElement) {
    const civ = CIVS[game.civOf(game.you)];
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top hud-block">
        <div class="res" data-r="food" title="Food">${ICONS.food}<span>0</span></div>
        <div class="res" data-r="wood" title="Wood">${ICONS.wood}<span>0</span></div>
        <div class="res" data-r="gold" title="Gold">${ICONS.gold}<span>0</span></div>
        <div class="res" data-r="stone" title="Stone">${ICONS.stone}<span>0</span></div>
        <div class="res pop" title="Population">${ICONS.pop}<span>0/0</span></div>
        <div class="top-civ"><span class="emblem">${civ.emblem}</span><span>${civ.name}<small class="top-age">${AGES[1].name}</small></span></div>
        <div class="top-clock">00:00</div>
        <button class="icon-btn help-btn" title="Controls">?</button>
        <button class="icon-btn speed-btn" title="Game speed">1×</button>
        <button class="icon-btn mute-btn" title="Sound">${sfx.muted ? ICONS.mute : ICONS.sound}</button>
        <button class="icon-btn menu-btn" title="Menu (F10)">${ICONS.menu}</button>
      </div>
      <div class="hud-players hud-block"></div>
      <div class="hud-msgs"></div>
      <div class="hud-bottom">
        <div class="minimap hud-block"><div class="mm-rot"><canvas width="256" height="256"></canvas></div></div>
        <div class="sel-panel hud-block"></div>
        <div class="cmd-card hud-block"></div>
      </div>
      <div class="hud-tip"></div>
      <div class="hud-chat"><div class="chat-log"></div><input class="chat-input" maxlength="200" placeholder="Say something… (Enter)" /></div>
      <div class="overlay controls hidden"><div class="panel ornate wide"><h2>Controls</h2><div class="controls-body"></div><button class="btn" data-close>Close</button></div></div>
      <div class="hint hud-block hidden"></div>
      <div class="overlay pause hidden">
        <div class="panel ornate">
          <h2>Durbar Paused</h2>
          <button class="btn" data-act="resume">Resume</button>
          <button class="btn" data-act="save">Save Game</button>
          <button class="btn" data-act="resign">Resign</button>
          <button class="btn ghost" data-act="quit">Quit to Menu</button>
          <label class="toggle">Give orders with
            <select class="order-click">
              <option value="right" ${settings.orderClick === 'right' ? 'selected' : ''}>Two-finger tap / right-click</option>
              <option value="double" ${settings.orderClick === 'double' ? 'selected' : ''}>Double-click</option>
              <option value="single" ${settings.orderClick === 'single' ? 'selected' : ''}>Single click</option>
            </select></label>
          <label class="toggle">Graphics
            <select class="graphics">
              <option value="auto" ${settings.graphics === 'auto' ? 'selected' : ''}>Auto (smoothest)</option>
              <option value="high" ${settings.graphics === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${settings.graphics === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${settings.graphics === 'low' ? 'selected' : ''}>Low</option>
            </select></label>
          <button class="btn ghost" data-act="controls">Controls</button>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.sel = this.q('.sel-panel');
    this.card = this.q('.cmd-card');
    this.tip = this.q('.hud-tip');
    this.mini = this.q('.minimap canvas');
    this.miniCtx = this.mini.getContext('2d')!;
    const size = game.terrain.size;
    this.miniImg = this.miniCtx.createImageData(size, size);
    this.miniBase = document.createElement('canvas');
    this.miniBase.width = this.miniBase.height = size;
    if (!game.link.online) this.q('.hud-chat').style.display = 'none';

    const on = (t: EventTarget, type: string, fn: (e: Event) => void) => {
      t.addEventListener(type, fn);
      this.disposers.push(() => t.removeEventListener(type, fn));
    };
    on(this.q('.menu-btn'), 'click', () => this.togglePause());
    on(this.q('.mute-btn'), 'click', () => {
      sfx.setMuted(!sfx.muted);
      this.q('.mute-btn').innerHTML = sfx.muted ? ICONS.mute : ICONS.sound;
    });
    on(this.q('.pause'), 'click', (e) => {
      const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
      if (act === 'resume') this.togglePause(false);
      if (act === 'resign') {
        game.link.resign();
        this.togglePause(false);
      }
      if (act === 'quit') this.onQuit();
      if (act === 'controls') this.showControls();
      if (act === 'save') void this.saveGame();
    });
    const local = game.link as unknown as { speed?: number; save?: () => string };
    if (game.link.online || !local.save) {
      this.q('.speed-btn').style.display = 'none';
      (this.q('[data-act="save"]') as HTMLElement).style.display = 'none';
    }
    on(this.q('.speed-btn'), 'click', () => {
      const speeds = [1, 1.5, 2, 3];
      const next = speeds[(speeds.indexOf(local.speed ?? 1) + 1) % speeds.length];
      local.speed = next;
      this.q('.speed-btn').textContent = `${next}×`;
    });
    on(this.q('.order-click'), 'change', (e) => {
      settings.orderClick = (e.target as HTMLSelectElement).value as OrderClick;
    });
    on(this.q('.graphics'), 'change', (e) => {
      settings.graphics = (e.target as HTMLSelectElement).value as Graphics;
      game.engine.setGraphics(settings.graphics);
    });
    on(this.q('.help-btn'), 'click', () => this.showControls());
    on(this.q('.controls'), 'click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]') || e.target === this.q('.controls')) this.q('.controls').classList.add('hidden');
    });
    on(this.card, 'mousedown', (e) => {
      const b = (e.target as HTMLElement).closest('[data-i]');
      if (!b) return;
      (e as MouseEvent).preventDefault();
      this.trigger(Number(b.getAttribute('data-i')));
    });
    on(this.card, 'mouseover', (e) => {
      const b = (e.target as HTMLElement).closest('[data-i]');
      if (!b) return this.hideTip();
      const btn = this.buttons[Number(b.getAttribute('data-i'))];
      if (btn) this.showTip(b as HTMLElement, btn);
    });
    on(this.card, 'mouseleave', () => this.hideTip());
    on(this.sel, 'mousedown', (e) => {
      const t = e.target as HTMLElement;
      const qi = t.closest('[data-q]');
      if (qi) {
        const [bid, idx] = qi.getAttribute('data-q')!.split(':').map(Number);
        game.link.send({ c: 'cancel', building: bid, index: idx });
        sfx.click();
        return;
      }
      const si = t.closest('[data-sel]');
      if (si) {
        const id = Number(si.getAttribute('data-sel'));
        if ((e as MouseEvent).shiftKey) input.setSelection([id], true);
        else input.setSelection([id]);
      }
    });
    // minimap
    const mmCmd = (e: MouseEvent) => {
      const p = this.miniToMap(e);
      if (!p) return;
      if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
        const t = null;
        const units = input.ownUnits();
        if (units.length) {
          game.link.send({ c: 'move', ids: units.map((u) => u.id), x: p.x, y: p.y });
          game.effects.marker(p.x, p.y, 0x7dff8a);
          sfx.command('move');
        }
        void t;
      } else game.camera.jumpTo(p.x, p.y);
    };
    let mmDrag = false;
    on(this.mini, 'mousedown', (e) => {
      mmDrag = (e as MouseEvent).button === 0;
      mmCmd(e as MouseEvent);
    });
    on(this.mini, 'mousemove', (e) => {
      if (mmDrag) mmCmd(e as MouseEvent);
    });
    on(window, 'mouseup', () => (mmDrag = false));
    on(this.mini, 'contextmenu', (e) => e.preventDefault());
    // keyboard
    on(window, 'keydown', (ev) => {
      const e = ev as KeyboardEvent;
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === 'Enter' && game.link.online) {
        const inp = this.q<HTMLInputElement>('.chat-input');
        if (document.activeElement === inp) {
          if (inp.value.trim()) game.link.chat(inp.value.trim());
          inp.value = '';
          inp.blur();
        } else inp.focus();
        return;
      }
      if (tag === 'INPUT') return;
      if (e.key === 'Escape' && e.timeStamp === input.lastEscHandled) return;
      if (e.key === 'Escape' && !this.q('.controls').classList.contains('hidden')) {
        this.q('.controls').classList.add('hidden');
        return;
      }
      if (e.key === 'F10' || (e.key === 'Escape' && !input.placing && !input.pendingAttack && !input.pendingMove)) {
        e.preventDefault();
        this.togglePause();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toUpperCase();
      const idx = this.buttons.findIndex((b) => b.key === k);
      if (idx >= 0) {
        e.preventDefault();
        this.trigger(idx);
      }
    });
    game.link.onChat = (from, text, color) => this.chat(from, text, color);
    input.onSelectionChange = () => {
      this.cardSig = '';
      this.buildPage = 0;
      this.renderSelection();
    };
    this.buildMinimapBase();
    this.renderPlayers();
    if (!settings.hintSeen) this.showHint();
  }

  showControls() {
    this.q('.controls-body').innerHTML = controlsTable();
    this.q('.controls').classList.remove('hidden');
  }

  /** first-game coaching card */
  private showHint() {
    const h = this.q('.hint');
    const order = orderVerb();
    h.innerHTML = `<div class="hint-title">How to command your people</div>
      <ol>
        <li><b>Select</b> — ${isMac ? 'tap' : 'click'} a villager or soldier, or drag a box around several.${settings.orderClick === 'double' ? ' One click only selects.' : ''}</li>
        <li><b>Move</b> — ${order} on the ground where they should go (or press <kbd>M</kbd> then click).</li>
        <li><b>Work &amp; fight</b> — ${order} a tree, bush or mine to gather; ${order} an enemy to attack.</li>
        <li><b>Build</b> — with villagers selected, pick a building on the bottom-right card and click to place it.</li>
      </ol>
      ${isMac && settings.orderClick === 'right' ? `<div class="hint-note">Taps not working? In <i>System Settings → Trackpad</i> turn on <b>Tap to click</b> and set <b>Secondary click</b> to “Click or Tap with Two Fingers”. Holding ⌃ Control and clicking always works.</div>` : ''}
      <div class="hint-foot"><span>Press <kbd>?</kbd> for all controls · change click style in the menu.</span> <button class="btn small" data-hint-close>Got it</button></div>`;
    h.classList.remove('hidden');
    h.querySelector('[data-hint-close]')!.addEventListener('click', () => {
      settings.hintSeen = true;
      h.classList.add('hidden');
    });
  }

  dispose() {
    for (const d of this.disposers) d();
    this.root.remove();
  }

  private paused = false;
  private shownAge = 1;
  private async saveGame() {
    const link = this.game.link as unknown as { save?: () => string };
    if (!link.save) return;
    try {
      const json = link.save();
      await writeSave(json, { date: Date.now(), civ: CIVS[this.game.civOf(this.game.you)].name, minutes: Math.round(this.game.tick / TICK_RATE / 60) });
      this.message('Game saved', 'good');
    } catch (err) {
      console.error(err);
      this.message('Could not save the game (browser storage full?)', 'warn');
    }
  }

  togglePause(force?: boolean) {
    this.paused = force ?? !this.paused;
    this.q('.pause').classList.toggle('hidden', !this.paused);
    this.input.enabled = !this.paused;
    const link = this.game.link as { setPaused?: (p: boolean) => void };
    link.setPaused?.(this.paused);
  }

  // ---------------------------------------------------------------------------
  message(text: string, kind: 'info' | 'warn' | 'good' = 'info') {
    const box = this.q('.hud-msgs');
    const el = document.createElement('div');
    el.className = `msg ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild!.remove();
    setTimeout(() => el.classList.add('fade'), 3500);
    setTimeout(() => el.remove(), 4500);
  }

  chat(from: string, text: string, color?: number) {
    const log = this.q('.chat-log');
    const el = document.createElement('div');
    const c = color !== undefined ? '#' + PLAYER_COLORS[color].hex.toString(16).padStart(6, '0') : '#f3d98b';
    el.innerHTML = `<b style="color:${c}"></b> <span></span>`;
    el.querySelector('b')!.textContent = from + ':';
    el.querySelector('span')!.textContent = text;
    log.appendChild(el);
    while (log.children.length > 6) log.firstChild!.remove();
    setTimeout(() => el.classList.add('fade'), 12000);
  }

  onEvent(ev: GameEvent) {
    const g = this.game;
    switch (ev.e) {
      case 'alert':
        this.message('Your people are under attack!', 'warn');
        this.pings.push({ x: ev.x, y: ev.y, t: 3 });
        this.lastAlert = { x: ev.x, y: ev.y };
        sfx.alert();
        break;
      case 'popcap':
        this.message('You need more houses.', 'warn');
        sfx.error();
        break;
      case 'built': {
        const def = BUILDINGS[ev.t as BuildingType];
        this.message(`${def.name} completed.`, 'good');
        sfx.built();
        break;
      }
      case 'trained':
        sfx.trained();
        break;
      case 'researched': {
        const def = TECHS[ev.t as TechId];
        if (!def) break;
        const age = def.effect.age;
        if (ev.o === g.you) {
          this.message(age ? `Your empire has entered the ${AGES[age].name}!` : `${def.name} researched.`, 'good');
          if (age) sfx.victory();
          else sfx.built();
        } else if (age) {
          const p = g.init.players[ev.o];
          if (p) this.message(`${p.name} (${CIVS[p.civ].short}) has entered the ${AGES[age].name}.`, 'info');
        }
        this.renderPlayers();
        break;
      }
      case 'defeat': {
        const p = g.init.players[ev.o];
        if (ev.o === g.you) this.message('You have been defeated.', 'warn');
        else if (p) this.message(`${p.name} (${CIVS[p.civ].short}) has been defeated!`, 'info');
        this.renderPlayers();
        break;
      }
    }
  }

  private renderPlayers() {
    const g = this.game;
    this.q('.hud-players').innerHTML = g.init.players
      .map((p) => {
        const c = '#' + PLAYER_COLORS[p.color].hex.toString(16).padStart(6, '0');
        const dead = g.alive.length && !g.alive[p.slot];
        const age = ['', 'I', 'II', 'III'][g.ages[p.slot] ?? 1];
        return `<div class="pl ${dead ? 'dead' : ''}"><i style="background:${c}"></i>${escapeHtml(p.name)} <small>${CIVS[p.civ].short} · ${age}</small></div>`;
      })
      .join('');
  }

  // ---------------------------------------------------------------------------
  update(dt: number) {
    const g = this.game;
    this.uiTimer -= dt;
    this.miniTimer -= dt;
    for (const p of this.pings) p.t -= dt;
    this.pings = this.pings.filter((p) => p.t > 0);
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.15;
      const me = g.me;
      for (const r of ['food', 'wood', 'gold', 'stone'] as const) this.q(`[data-r="${r}"] span`).textContent = String(me.r[r]);
      const pop = this.q('.pop span');
      pop.textContent = `${me.pop}/${me.cap}`;
      pop.parentElement!.classList.toggle('capped', me.pop >= me.cap);
      this.q('.top-clock').textContent = fmtTime(g.tick / TICK_RATE);
      const age = (g.ages[g.you] ?? 1) as Age;
      if (age !== this.shownAge) {
        this.shownAge = age;
        this.q('.top-age').textContent = AGES[age].name;
        this.renderPlayers();
      }
      this.renderSelection();
    }
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.25;
      this.drawMinimap();
    }
    this.drawMinimapOverlay();
  }

  // ---------------------------------------------------------------------------
  private trigger(i: number) {
    const b = this.buttons[i];
    if (!b) return;
    if (b.disabled) {
      sfx.error();
      const req = /tip-req">([^<]+)</.exec(b.desc ?? '')?.[1];
      if (req) this.message(req + '.', 'warn');
      else if (b.cost && !canAfford(this.game.me.r, b.cost)) this.message('Not enough resources.', 'warn');
      return;
    }
    sfx.click();
    b.action();
    this.cardSig = '';
  }

  private showTip(el: HTMLElement, b: CmdButton) {
    this.tip.innerHTML = `<div class="tip-title">${b.title} <kbd>${b.key}</kbd></div>${b.cost ? `<div class="tip-cost">${costHtml(b.cost, this.game.me.r)}</div>` : ''}${b.desc ? `<div class="tip-desc">${b.desc}</div>` : ''}`;
    const r = el.getBoundingClientRect();
    this.tip.style.display = 'block';
    const tr = this.tip.getBoundingClientRect();
    this.tip.style.left = Math.min(window.innerWidth - tr.width - 8, r.left + r.width / 2 - tr.width / 2) + 'px';
    this.tip.style.top = r.top - tr.height - 10 + 'px';
  }
  private hideTip() {
    this.tip.style.display = 'none';
  }

  private buildButtons(sel: CEnt[]): CmdButton[] {
    const g = this.game;
    const civ = g.civOf(g.you);
    const pc = g.colorOf(g.you);
    const own = sel.filter((e) => e.owner === g.you);
    const out: CmdButton[] = [];
    const myAge = (g.ages[g.you] ?? 1) as Age;
    const techs = g.me.tc ?? [];
    if (!own.length) return out;
    const units = own.filter((e) => e.kind === 0);
    if (units.length) {
      const moveBtn: CmdButton = { key: 'X', icon: ICONS.boot, title: 'Move', desc: 'Click where the selected units should go (M).', action: () => this.input.arm('move') };
      if (units.some((u) => u.type === 'villager')) {
        out.push(moveBtn);
        const page = BUILD_PAGES[this.buildPage];
        const other = BUILD_PAGES[1 - this.buildPage];
        const flip = () => {
          this.buildPage = 1 - this.buildPage;
          this.renderSelection();
        };
        out.push({
          key: this.buildPage === 0 ? 'A' : 'F', icon: this.buildPage === 0 ? ICONS.shield : ICONS.plough, title: `${other.name} buildings…`,
          desc: other.types.map((t) => BUILDINGS[t].name).join(', '), action: flip,
        });
        page.types.forEach((t, i) => {
          const bs = buildingStats(civ, t);
          const locked = bs.def.age > myAge;
          out.push({
            key: GRID_KEYS[i], icon: `<img src="${portrait('building', t, civ, pc)}"/>`, title: `Build ${bs.def.name}`,
            desc: `<i>${bs.def.native}</i> — ${bs.def.description}${locked ? `<div class="tip-req">Requires the ${AGES[bs.def.age].name}</div>` : ''}`, cost: bs.cost, disabled: locked || !canAfford(g.me.r, bs.cost), locked,
            action: () => this.input.startPlacing(t),
          });
        });
      } else {
        out.push({ ...moveBtn, key: 'Q' });
        out.push({ key: 'A', icon: ICONS.attack, title: 'Attack-move', desc: 'Click an enemy to attack it, or the ground to march there in formation, fighting everything met on the way.', action: () => this.input.arm('attack') });
        const st = (s: number) => units.every((u) => (u.st ?? 0) === s);
        const stance = (s: 0 | 1 | 2) => () => g.link.send({ c: 'stance', ids: units.map((u) => u.id), s });
        out.push({ key: 'S', icon: ICONS.aggressive, title: 'Stance: Aggressive', desc: 'Attack any enemy in sight and chase it.', active: st(0), action: stance(0) });
        out.push({ key: 'D', icon: ICONS.defensive, title: 'Stance: Defensive', desc: 'Fight enemies that come close, then return to post.', active: st(1), action: stance(1) });
        out.push({ key: 'F', icon: ICONS.hold, title: 'Stance: Hold Ground', desc: 'Never move; only strike what is in reach. Good for archers behind a wall of spears.', active: st(2), action: stance(2) });
      }
      out.push({ key: 'Z', icon: ICONS.stop, title: 'Stop', desc: 'Halt current orders.', action: () => g.link.send({ c: 'stop', ids: units.map((u) => u.id) }) });
      out.push({ key: 'V', icon: ICONS.trash, title: 'Delete', desc: 'Dismiss the selected units (Del).', action: () => g.link.send({ c: 'delete', ids: units.map((u) => u.id) }) });
      return out;
    }
    const b = own[0];
    if (b.p !== undefined) {
      out.push({ key: 'V', icon: ICONS.trash, title: 'Cancel construction', action: () => g.link.send({ c: 'delete', ids: [b.id] }) });
      return out;
    }
    const sameType = own.filter((e) => e.type === b.type);
    const trains = trainable(civ, b.type as BuildingType);
    trains.forEach((t, i) => {
      const us = unitStats(civ, t, TICK_RATE, techs);
      const def = UNITS[t];
      const age = unitAge(civ, t);
      const locked = age > myAge;
      out.push({
        key: GRID_KEYS[i], icon: `<img src="${portrait('unit', t, civ, pc)}"/>`,
        title: `Train ${def.name}${def.uniqueTo ? ' ★' : ''}`,
        desc: `<i>${def.native}</i> — ${def.description}<div class="tip-stats">${ICONS.sword}${us.attack} ${ICONS.shield}${us.armorMelee}/${us.armorPierce} ♥${us.maxHp}${def.ranged ? ` ${ICONS.bow}${us.range}` : ''}</div>${locked ? `<div class="tip-req">Requires the ${AGES[age].name}</div>` : ''}`,
        cost: us.cost,
        locked,
        disabled: locked || !canAfford(g.me.r, us.cost),
        action: () => {
          const target = sameType.reduce((a, c) => ((c.q?.length ?? 0) < (a.q?.length ?? 0) ? c : a), sameType[0]);
          g.link.send({ c: 'train', building: target.id, type: t });
        },
      });
    });
    // research: hide what is done, show what's next (locked ones explain why)
    const queued: string[] = this.queuedTechsElsewhere(b.type as BuildingType);
    let k = trains.length;
    for (const id of techsAt(b.type as BuildingType)) {
      if (techs.includes(id) || k >= GRID_KEYS.length - 1) continue;
      const def = TECHS[id];
      if (def.requires && !techs.includes(def.requires) && !queued.includes(def.requires)) continue;
      const why = techBlocker(id, techs, queued);
      const busy = why === 'Already being researched' || why === 'Already advancing';
      out.push({
        key: GRID_KEYS[k++], icon: ICONS[def.icon], title: def.name,
        desc: `${def.description}<div class="tip-time">${def.time}s</div>${why ? `<div class="tip-req">${why}</div>` : ''}`,
        cost: def.cost,
        locked: !!why && !busy,
        disabled: !!why || !canAfford(g.me.r, def.cost),
        active: busy,
        action: () => g.link.send({ c: 'research', building: b.id, tech: id }),
      });
    }
    out.push({ key: 'V', icon: ICONS.trash, title: 'Delete building', action: () => g.link.send({ c: 'delete', ids: [b.id] }) });
    return out;
  }

  /** tech ids queued in my other buildings (so we don't offer them twice) */
  private queuedTechsElsewhere(_type: BuildingType): string[] {
    const g = this.game;
    const out: string[] = [];
    for (const e of g.ents.values()) if (e.owner === g.you && e.kind === 1 && e.q) for (const [t] of e.q) if (t in TECHS) out.push(t);
    return out;
  }

  private renderSelection() {
    const g = this.game;
    this.input.sync();
    const sel = this.input.selected();
    // command card (re-render only on change)
    const buttons = this.buildButtons(sel);
    const sig = buttons.map((b) => b.key + b.title + (b.disabled ? 0 : 1) + (b.active ? 'a' : '') + (b.locked ? 'l' : '')).join('|');
    if (sig !== this.cardSig) {
      this.cardSig = sig;
      this.buttons = buttons;
      this.card.innerHTML = GRID_KEYS.map((k) => {
        const i = buttons.findIndex((b) => b.key === k);
        if (i < 0) return `<div class="cmd empty"></div>`;
        const b = buttons[i];
        return `<button class="cmd ${b.disabled ? 'disabled' : ''} ${b.active ? 'active' : ''} ${b.locked ? 'locked' : ''}" data-i="${i}">${b.icon}<kbd>${k}</kbd></button>`;
      }).join('');
    }
    // selection panel
    if (!sel.length) {
      const rid = g.resSelection;
      const r = rid ? g.resources.get(rid) : undefined;
      if (r) {
        const def = RESOURCE_NODES[r.type];
        this.sel.innerHTML = `<div class="sel-single"><div class="portrait res-portrait">${ICONS[def.resType]}</div>
          <div class="sel-info"><div class="sel-name">${def.name}</div><div class="sel-sub">Gaia</div>
          <div class="sel-stats">${ICONS[def.resType]} ${Math.ceil(r.amount)} remaining</div></div></div>`;
      } else {
        const civ = CIVS[g.civOf(g.you)];
        this.sel.innerHTML = `<div class="sel-empty"><div class="emblem big">${civ.emblem}</div><div><div class="sel-name">${civ.name}</div><div class="sel-sub">${civ.tagline}</div></div></div>`;
      }
      return;
    }
    if (sel.length === 1) {
      this.sel.innerHTML = this.single(sel[0]);
      return;
    }
    this.sel.innerHTML = `<div class="sel-multi">${sel
      .slice(0, 36)
      .map((e) => {
        const civ = g.civOf(e.owner);
        const img = portrait(e.kind === 0 ? 'unit' : 'building', e.type, civ, g.colorOf(e.owner));
        return `<div class="mini-port" data-sel="${e.id}"><img src="${img}"/><i style="width:${(e.hp / e.m) * 100}%"></i></div>`;
      })
      .join('')}${sel.length > 36 ? `<div class="more">+${sel.length - 36}</div>` : ''}</div>`;
  }

  private single(e: CEnt): string {
    const g = this.game;
    const civ = g.civOf(e.owner);
    const pc = g.colorOf(e.owner);
    const owner = g.init.players[e.owner];
    const colorCss = '#' + pc.toString(16).padStart(6, '0');
    const hpPct = (e.hp / e.m) * 100;
    let name: string, native: string, stats = '', extra = '';
    if (e.kind === 0) {
      const us = unitStats(civ, e.type as UnitType, TICK_RATE, e.owner === g.you ? g.me.tc : undefined);
      const def = us.def;
      name = def.name + (def.uniqueTo ? ' <span class="uq">★ Unique</span>' : '');
      native = def.native;
      stats = `<span>${ICONS.sword}${us.attack}</span><span>${ICONS.shield}${us.armorMelee}/${us.armorPierce}</span>${def.ranged ? `<span>${ICONS.bow}${us.range}</span>` : ''}<span>${ICONS.boot}${us.speed.toFixed(1)}</span>`;
      if (e.c > 0 && e.ct) extra = `<div class="carry">Carrying ${ICONS[e.ct]} ${e.c}</div>`;
    } else {
      const bs = buildingStats(civ, e.type as BuildingType, e.owner === g.you ? g.me.tc : undefined);
      name = bs.def.name;
      native = bs.def.native;
      if (bs.def.attack) stats += `<span>${ICONS.sword}${bs.attackDamage}</span><span>${ICONS.bow}${bs.attackRange}</span>`;
      stats += `<span>${ICONS.shield}${bs.def.armor.melee}/${bs.def.armor.pierce}</span>`;
      if (bs.def.pop) stats += `<span>${ICONS.pop}+${bs.def.pop}</span>`;
      if (e.p !== undefined) extra = `<div class="progress"><i style="width:${e.p * 100}%"></i><b>Under construction ${Math.floor(e.p * 100)}%</b></div>`;
      else if (e.type === 'farm' && e.fa !== undefined) extra = `<div class="carry">${ICONS.food} ${e.fa} food remaining</div>`;
      if (e.q?.length && e.owner === g.you) {
        extra += `<div class="queue">${e.q
          .map(([t, p], i) => {
            const tech = TECHS[t as TechId];
            const icon = tech ? `<span class="q-tech">${ICONS[tech.icon]}</span>` : `<img src="${portrait('unit', t, civ, pc)}"/>`;
            return `<div class="q-item" data-q="${e.id}:${i}" title="${tech ? tech.name + ' — click to cancel' : 'Click to cancel'}">${icon}${i === 0 ? `<i style="height:${(1 - p) * 100}%"></i>` : ''}</div>`;
          })
          .join('')}</div>`;
      }
    }
    return `<div class="sel-single">
      <div class="portrait" style="border-color:${colorCss}"><img src="${portrait(e.kind === 0 ? 'unit' : 'building', e.type, civ, pc)}"/></div>
      <div class="sel-info">
        <div class="sel-name">${name}</div>
        <div class="sel-sub"><i>${native}</i> · <span style="color:${colorCss}">${owner ? escapeHtml(owner.name) : ''}</span> · ${CIVS[civ].short}</div>
        <div class="hp"><i style="width:${hpPct}%"></i><b>${e.hp} / ${e.m}</b></div>
        <div class="sel-stats">${stats}</div>
        ${extra}
      </div></div>`;
  }

  // ---------------------------------------------------------------------------
  private buildMinimapBase() {
    const g = this.game;
    const size = g.terrain.size;
    const ctx = this.miniBase.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const c = TERRAIN_COLORS[g.terrain.terrain[i]];
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  private drawMinimap() {
    const g = this.game;
    const size = g.terrain.size;
    const base = this.miniBase.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, size, size).data;
    const d = this.miniImg.data;
    const fow = g.fow;
    for (let i = 0; i < size * size; i++) {
      let r = base[i * 4], gg = base[i * 4 + 1], b = base[i * 4 + 2];
      const rid = g.resources.resAt[i];
      if (rid) {
        const en = g.resources.get(rid);
        if (en) {
          if (en.type === 'tree' || en.type === 'palm') [r, gg, b] = [45, 85, 35];
          else if (en.type === 'gold_mine') [r, gg, b] = [240, 200, 60];
          else if (en.type === 'stone_mine') [r, gg, b] = [190, 190, 185];
          else [r, gg, b] = [150, 60, 160];
        }
      }
      const f = fow.revealAll || fow.visible[i] ? 1 : fow.explored[i] ? 0.5 : 0.06;
      d[i * 4] = r * f;
      d[i * 4 + 1] = gg * f;
      d[i * 4 + 2] = b * f;
      d[i * 4 + 3] = 255;
    }
    this.miniBase2 ??= document.createElement('canvas');
    this.miniBase2.width = this.miniBase2.height = size;
    this.miniBase2.getContext('2d')!.putImageData(this.miniImg, 0, 0);
  }
  private miniBase2: HTMLCanvasElement | undefined;

  private drawMinimapOverlay() {
    const g = this.game;
    const ctx = this.miniCtx;
    const W = this.mini.width;
    const size = g.terrain.size;
    const s = W / size;
    ctx.imageSmoothingEnabled = false;
    if (this.miniBase2) ctx.drawImage(this.miniBase2, 0, 0, W, W);
    for (const e of g.ents.values()) {
      ctx.fillStyle = '#' + g.colorOf(e.owner).toString(16).padStart(6, '0');
      if (e.kind === 1) {
        const bs = BUILDINGS[e.type as BuildingType].size;
        ctx.fillRect((e.x - bs / 2) * s, (e.y - bs / 2) * s, bs * s, bs * s);
        if (e.selected) {
          ctx.strokeStyle = '#fff';
          ctx.strokeRect((e.x - bs / 2) * s, (e.y - bs / 2) * s, bs * s, bs * s);
        }
      } else {
        ctx.fillRect(e.x * s - 2, e.y * s - 2, 4, 4);
        if (e.selected) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(e.x * s - 1, e.y * s - 1, 2, 2);
        }
      }
    }
    for (const p of this.pings) {
      ctx.strokeStyle = `rgba(255,70,50,${Math.min(1, p.t)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, (3 - p.t) * 12 + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // camera footprint
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => g.camera.groundFromNdc(x, y * 0.98));
    if (corners.every(Boolean)) {
      ctx.strokeStyle = 'rgba(255,240,200,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      corners.forEach((c, i) => (i ? ctx.lineTo(c!.x * s, c!.y * s) : ctx.moveTo(c!.x * s, c!.y * s)));
      ctx.closePath();
      ctx.stroke();
    }
    (this.q('.mm-rot') as HTMLElement).style.transform = `rotate(${g.camera.yaw}rad) scale(0.7071)`;
  }

  private miniToMap(e: MouseEvent) {
    const r = this.q('.minimap').getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const yaw = -this.game.camera.yaw;
    const rx = dx * Math.cos(yaw) - dy * Math.sin(yaw);
    const ry = dx * Math.sin(yaw) + dy * Math.cos(yaw);
    dx = rx / 0.7071;
    dy = ry / 0.7071;
    const size = this.game.terrain.size;
    const half = r.width / 2;
    const x = ((dx + half) / r.width) * size, y = ((dy + half) / r.width) * size;
    if (x < 0 || y < 0 || x > size || y > size) return null;
    return new THREE.Vector2(x, y);
  }

  // ---------------------------------------------------------------------------
  showGameOver(info: GameOverInfo, onDone: () => void) {
    const g = this.game;
    const won = info.winner === g.you;
    if (won) sfx.victory();
    else sfx.defeat();
    const rows = info.stats
      .map((p) => {
        const c = '#' + PLAYER_COLORS[p.color].hex.toString(16).padStart(6, '0');
        const s = p.stats;
        const total = Math.floor(s.gathered.food + s.gathered.wood + s.gathered.gold + s.gathered.stone);
        return `<tr class="${p.slot === info.winner ? 'winner' : ''}"><td><i class="dot" style="background:${c}"></i>${escapeHtml(p.name)}${p.slot === info.winner ? ' 👑' : ''}</td><td>${CIVS[p.civ].short}</td>
          <td>${total}</td><td>${s.unitsTrained}</td><td>${s.kills}</td><td>${s.unitsLost}</td><td>${s.buildingsBuilt}</td><td>${s.razed}</td></tr>`;
      })
      .join('');
    const ov = document.createElement('div');
    ov.className = 'overlay gameover';
    ov.innerHTML = `<div class="panel ornate wide">
      <div class="go-banner ${won ? 'win' : 'lose'}">${won ? 'Victory' : 'Defeat'}</div>
      <p class="go-sub">${won ? 'Your dynasty will be remembered for a thousand years.' : 'Your throne has fallen.'} · ${fmtTime(info.durationSec)}</p>
      <table class="stats"><thead><tr><th>Ruler</th><th>Civ</th><th>Gathered</th><th>Trained</th><th>Kills</th><th>Lost</th><th>Built</th><th>Razed</th></tr></thead><tbody>${rows}</tbody></table>
      <button class="btn">Return to Menu</button></div>`;
    this.root.appendChild(ov);
    this.input.enabled = false;
    ov.querySelector('button')!.addEventListener('click', onDone);
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
