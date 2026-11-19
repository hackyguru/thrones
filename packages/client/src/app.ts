import { CIVS, CIV_IDS, PLAYER_COLORS, TICK_RATE, type CivId, type Difficulty, type GameInit, type PlayerInfo, type RoomState, type ServerMsg } from '@thrones/shared';
import { Game } from './game/game';
import { Input } from './game/input';
import { Hud, escapeHtml } from './ui/hud';
import { LocalLink, Net, NetLink, type GameLink } from './net/connection';
import { clearSave, readSave, saveMeta, writeSave, writeSaveNow, type SaveMeta } from './net/saves';
import { civPicker, colorSwatches, el, hex, roomList, roomSlots, sounds } from './ui/screens';
import { ICONS } from './ui/icons';
import { controlsTable, orderVerb, settings } from './ui/settings';
import { sfx } from './audio/sfx';

const store = {
  get: (k: string, d = '') => {
    try {
      return localStorage.getItem('thrones.' + k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem('thrones.' + k, v);
    } catch {
      /* ignore */
    }
  },
};

const randomCiv = (): CivId => CIV_IDS[Math.floor(Math.random() * CIV_IDS.length)];

export class App {
  private game: Game | null = null;
  private input: Input | null = null;
  private hud: Hud | null = null;
  private net: Net | null = null;
  private netOff: (() => void) | null = null;
  private room: RoomState | null = null;
  private screen: HTMLElement | null = null;
  name = store.get('name', 'Raja');

  constructor(private stage: HTMLElement, private ui: HTMLElement) {
    window.addEventListener('pointerdown', () => {
      const first = !sfx.ctx;
      sfx.unlock();
      if (first && !this.game) sfx.startDrone();
    });
  }

  start() {
    // a refresh mid-match drops the player straight back into it
    let resume = false;
    try {
      resume = sessionStorage.getItem(PLAYING) === '1' && !!saveMeta();
    } catch {
      /* storage unavailable */
    }
    if (resume) {
      void this.continueSave();
      return;
    }
    this.showTitle();
  }

  // ---------------------------------------------------------------------------
  private show(node: HTMLElement) {
    this.screen?.remove();
    this.screen = node;
    node.classList.add('screen');
    sounds(node);
    this.ui.appendChild(node);
  }

  // ---------------------------------------------------------------------------
  showTitle() {
    const s = el(`<div class="title-screen">
      <div class="title-logo">
        <div class="crown">${ICONS.crown}</div>
        <h1>Thrones</h1>
        <div class="subtitle">Empires of the Indian Subcontinent</div>
      </div>
      <div class="title-menu panel ornate">
        <label class="name-field">Your name<input maxlength="20" value="${escapeHtml(this.name)}" /></label>
        ${saveMeta() ? `<button class="btn primary" data-go="continue">Continue <span class="btn-sub">${escapeHtml(saveMeta()!.civ)} · ${saveMeta()!.minutes} min</span></button>` : ''}
        <button class="btn ${saveMeta() ? '' : 'primary'}" data-go="skirmish">Skirmish vs AI</button>
        <button class="btn" data-go="online">Multiplayer Online</button>
        <button class="btn" data-go="codex">Civilizations</button>
        <button class="btn ghost" data-go="help">How to Play</button>
      </div>
      <div class="title-foot">v0.1 · Fundamentals build</div>
    </div>`);
    const inp = s.querySelector('input')!;
    inp.addEventListener('input', () => {
      this.name = inp.value.trim().slice(0, 20) || 'Raja';
      store.set('name', this.name);
    });
    s.addEventListener('click', (e) => {
      const go = (e.target as HTMLElement).closest('[data-go]')?.getAttribute('data-go');
      if (go === 'skirmish') this.showSkirmish();
      if (go === 'continue') void this.continueSave();
      if (go === 'online') void this.showOnline();
      if (go === 'codex') this.showCodex();
      if (go === 'help') this.showHelp();
    });
    this.show(s);
  }

  showHelp() {
    const s = el(`<div class="page"><div class="panel ornate page-panel narrow">
      <h2>How to Play</h2>
      <div class="help">
        <p><b>Goal:</b> destroy every enemy unit and building. Gather resources, grow your population and raise an army.</p>
        <p><b>Economy:</b> select villagers and right-click trees (wood), bushes or farms (food), gold and stone mines. They carry resources back to your Durbar or a Storehouse — build storehouses near distant resources. Houses raise your population limit.</p>
        <p><b>Commanding units:</b> click a unit to select it (or drag a box around several), then ${orderVerb()} where it should go. You can change how orders are given (two-finger tap / right-click, double-click or single click) in the in-game menu.</p>
        <p><b>Army:</b> Barracks train infantry, the Archery Range archers, the Stable cavalry and war elephants. Spearmen counter cavalry and elephants, archers shred infantry, cavalry runs down archers. Each civilization has a unique unit.</p>
        ${controlsTable()}
      </div>
      <button class="btn" data-back>Back</button></div></div>`);
    s.querySelector('[data-back]')!.addEventListener('click', () => this.showTitle());
    this.show(s);
  }

  showCodex() {
    const s = el(`<div class="page"><div class="panel ornate page-panel">
      <h2>The Civilizations</h2><div class="codex-body"></div>
      <button class="btn" data-back>Back</button></div></div>`);
    s.querySelector('.codex-body')!.appendChild(civPicker('maurya', 0, () => {}, false));
    s.querySelector('[data-back]')!.addEventListener('click', () => this.showTitle());
    this.show(s);
  }

  // ---------------------------------------------------------------------------
  showSkirmish() {
    let myCiv = (store.get('civ', 'random') as CivId | 'random') || 'random';
    let myColor = Number(store.get('color', '0')) || 0;
    let difficulty = (store.get('difficulty', 'normal') as Difficulty) || 'normal';
    if (!DIFFS.some((d) => d.id === difficulty)) difficulty = 'normal';
    const ais: { civ: CivId | 'random' }[] = [{ civ: 'random' }];
    const s = el(`<div class="page"><div class="panel ornate page-panel">
      <h2>Skirmish</h2>
      <div class="setup">
        <div class="setup-left"><h4>Choose your civilization</h4><div class="picker"></div></div>
        <div class="setup-right">
          <h4>Your colour</h4><div class="my-colors"></div>
          <h4>Opponents</h4><div class="ai-list"></div>
          <button class="btn small ghost" data-add>+ Add AI opponent</button>
          <h4>Difficulty</h4>
          <div class="seg">${DIFFS.map((d) => `<button class="btn small" data-diff="${d.id}">${d.name}</button>`).join('')}</div>
          <div class="diff-desc"></div>
          <div class="setup-actions"><button class="btn ghost" data-back>Back</button><button class="btn primary" data-start>Begin Battle</button></div>
        </div>
      </div></div></div>`);
    const picker = s.querySelector('.picker') as HTMLElement;
    const renderPicker = () => {
      picker.innerHTML = '';
      picker.appendChild(civPicker(myCiv, myColor, (c) => {
        myCiv = c;
        store.set('civ', c);
      }));
    };
    const colors = s.querySelector('.my-colors') as HTMLElement;
    colors.appendChild(colorSwatches(myColor, [], (c) => {
      myColor = c;
      store.set('color', String(c));
      renderPicker();
    }));
    const list = s.querySelector('.ai-list') as HTMLElement;
    const renderAis = () => {
      list.innerHTML = ais
        .map((a, i) => `<div class="slot-row"><i class="dot big" style="background:${hex(PLAYER_COLORS[(myColor + i + 1) % 6].hex)}"></i><div class="slot-name">AI Raja ${i + 1}</div>
          <select class="civ-select" data-ai="${i}"><option value="random">🎲 Random</option>${CIV_IDS.map((id) => `<option value="${id}" ${a.civ === id ? 'selected' : ''}>${CIVS[id].emblem} ${CIVS[id].name}</option>`).join('')}</select>
          ${ais.length > 1 ? `<button class="btn small ghost" data-rm="${i}">✕</button>` : '<span></span>'}</div>`)
        .join('');
    };
    const renderDiff = () => {
      s.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-diff') === difficulty));
      (s.querySelector('.diff-desc') as HTMLElement).textContent = DIFFS.find((d) => d.id === difficulty)!.desc;
    };
    list.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.dataset.ai) ais[Number(t.dataset.ai)].civ = t.value as CivId | 'random';
    });
    s.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-add]') && ais.length < 3) {
        ais.push({ civ: 'random' });
        renderAis();
      }
      const rm = t.closest('[data-rm]');
      if (rm) {
        ais.splice(Number(rm.getAttribute('data-rm')), 1);
        renderAis();
      }
      const d = t.closest('[data-diff]');
      if (d) {
        difficulty = d.getAttribute('data-diff') as Difficulty;
        store.set('difficulty', difficulty);
        renderDiff();
      }
      if (t.closest('[data-back]')) this.showTitle();
      if (t.closest('[data-start]')) {
        const players: PlayerInfo[] = [
          { slot: 0, name: this.name, civ: myCiv === 'random' ? randomCiv() : myCiv, color: myColor, isAI: false },
          ...ais.map((a, i) => ({ slot: i + 1, name: `AI Raja ${i + 1}`, civ: a.civ === 'random' ? randomCiv() : a.civ, color: (myColor + i + 1) % 6, isAI: true })),
        ];
        const link = new LocalLink(players, 0, { difficulty });
        this.startGame(link, () => link.start());
      }
    });
    renderPicker();
    renderAis();
    renderDiff();
    this.show(s);
  }

  // ---------------------------------------------------------------------------
  async showOnline() {
    const s = el(`<div class="page"><div class="panel ornate page-panel narrow">
      <h2>Multiplayer</h2><div class="online-body"><div class="empty-note">Connecting to the server…</div></div>
      <div class="setup-actions"><button class="btn ghost" data-back>Back</button><button class="btn primary" data-create disabled>Create Durbar</button></div>
      </div></div>`);
    s.querySelector('[data-back]')!.addEventListener('click', () => {
      this.leaveOnline();
      this.showTitle();
    });
    this.show(s);
    const body = s.querySelector('.online-body') as HTMLElement;
    if (!this.net || !this.net.connected) {
      this.net = new Net();
      try {
        await this.net.connect(this.name);
      } catch (err) {
        body.innerHTML = `<div class="empty-note error">${(err as Error).message}.<br/><small>Start it with <code>npm run dev</code> from the project root.</small></div>`;
        this.net = null;
        return;
      }
      this.netOff = this.net.on((m) => this.onNet(m));
    } else this.net.send({ type: 'listRooms' });
    (s.querySelector('[data-create]') as HTMLButtonElement).disabled = false;
    s.querySelector('[data-create]')!.addEventListener('click', () => this.net?.send({ type: 'createRoom', name: `${this.name}'s Durbar` }));
    body.addEventListener('click', (e) => {
      const j = (e.target as HTMLElement).closest('[data-join]');
      if (j) this.net?.send({ type: 'joinRoom', roomId: j.getAttribute('data-join')! });
    });
  }

  private leaveOnline() {
    this.net?.send({ type: 'leaveRoom' });
    this.netOff?.();
    this.net?.close();
    this.net = null;
    this.room = null;
  }

  private onNet(m: ServerMsg) {
    switch (m.type) {
      case 'rooms':
        if (!this.room && !this.game) {
          const body = this.screen?.querySelector('.online-body');
          if (body) body.innerHTML = roomList(m.rooms);
        }
        break;
      case 'room':
        this.room = m.room;
        if (this.game) break;
        if (m.room) this.showRoom();
        else void this.showOnline();
        break;
      case 'error':
        this.toast(m.message);
        break;
      case 'gameStart':
        this.startOnlineGame(m.init);
        break;
      case 'chat': {
        const log = this.screen?.querySelector('.room-chat .log');
        if (log && !this.game) {
          const d = document.createElement('div');
          d.innerHTML = `<b style="color:${m.color !== undefined ? hex(PLAYER_COLORS[m.color].hex) : '#f3d98b'}"></b> <span></span>`;
          d.querySelector('b')!.textContent = m.from + ':';
          d.querySelector('span')!.textContent = m.text;
          log.appendChild(d);
          log.scrollTop = log.scrollHeight;
        }
        break;
      }
    }
  }

  private showRoom() {
    const room = this.room!;
    const net = this.net!;
    const host = room.hostId === net.id;
    const mySlot = room.slots.find((x) => x.clientId === net.id);
    const existing = this.screen?.classList.contains('room-screen') ? this.screen : null;
    const s = existing ?? el(`<div class="page room-screen"><div class="panel ornate page-panel">
      <h2 class="room-title"></h2>
      <div class="setup">
        <div class="setup-left"><h4>Your civilization</h4><div class="picker"></div></div>
        <div class="setup-right">
          <h4>Players</h4><div class="slots"></div>
          <div class="host-tools"></div>
          <div class="room-chat"><div class="log"></div><input maxlength="200" placeholder="Chat… (Enter)"/></div>
          <div class="setup-actions"><button class="btn ghost" data-leave>Leave</button><button class="btn primary" data-start>Begin Battle</button></div>
        </div>
      </div></div></div>`);
    s.querySelector('.room-title')!.textContent = room.name;
    s.querySelector('.slots')!.innerHTML = roomSlots(room, net.id);
    s.querySelector('.host-tools')!.innerHTML = host && room.slots.length < room.maxPlayers ? `<button class="btn small ghost" data-addai>+ Add AI player</button>` : '';
    const start = s.querySelector('[data-start]') as HTMLButtonElement;
    start.style.display = host ? '' : 'none';
    if (!existing) {
      const picker = s.querySelector('.picker') as HTMLElement;
      picker.appendChild(civPicker(mySlot?.civ ?? 'random', mySlot?.color ?? 0, (c) => net.send({ type: 'setCiv', civ: c })));
      s.addEventListener('change', (e) => {
        const t = e.target as HTMLSelectElement;
        const row = t.closest('[data-slot]');
        if (!row) return;
        const slot = Number(row.getAttribute('data-slot'));
        const isMine = row.classList.contains('mine');
        if (t.classList.contains('civ-select')) net.send({ type: 'setCiv', civ: t.value as CivId | 'random', slot: isMine ? undefined : slot });
        if (t.classList.contains('color-select')) net.send({ type: 'setColor', color: Number(t.value), slot: isMine ? undefined : slot });
      });
      s.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-addai]')) net.send({ type: 'addAI' });
        const rm = t.closest('[data-remove]');
        if (rm) net.send({ type: 'removeSlot', slot: Number(rm.getAttribute('data-remove')) });
        if (t.closest('[data-start]')) net.send({ type: 'startGame' });
        if (t.closest('[data-leave]')) {
          net.send({ type: 'leaveRoom' });
        }
      });
      const chat = s.querySelector('.room-chat input') as HTMLInputElement;
      chat.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && chat.value.trim()) {
          net.send({ type: 'chat', text: chat.value.trim() });
          chat.value = '';
        }
      });
      this.show(s);
    }
  }

  private toast(text: string) {
    const t = el(`<div class="toast"></div>`);
    t.textContent = text;
    this.ui.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  private startOnlineGame(init: GameInit) {
    if (!this.net) return;
    const link = new NetLink(this.net, init);
    this.startGame(link, () => {});
  }

  private async continueSave() {
    const json = await readSave();
    const meta = saveMeta();
    if (!json) {
      if (!this.screen) {
        this.showTitle();
      }
      return;
    }
    let link: LocalLink;
    try {
      link = LocalLink.fromSave(json);
    } catch (err) {
      console.error(err);
      alert('This saved game could not be loaded.');
      clearSave();
      if (!this.screen) {
        this.showTitle();
      }
      return;
    }
    this.startGame(link, () => {
      link.start();
      if (meta?.cam) this.game?.camera.jumpTo(meta.cam[0], meta.cam[1]);
    });
  }

  // ---------------------------------------------------------------------------
  private startGame(link: GameLink, begin: () => void) {
    sfx.stopDrone();
    this.screen?.remove();
    this.screen = null;
    const loading = el(`<div class="loading"><div class="crown">${ICONS.crown}</div><div>Preparing the battlefield…</div></div>`);
    this.ui.appendChild(loading);
    // let the loading screen paint before heavy work
    setTimeout(() => {
      const game = new Game(this.stage, link);
      if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
      const input = new Input(game, this.ui);
      const hud = new Hud(game, input, this.ui);
      this.game = game;
      this.input = input;
      this.hud = hud;
      sfx.listener = (x, y) => game.soundAt(x, y);
      game.listeners.onFrame = (dt) => {
        input.frame();
        hud.update(dt);
        sfx.update(dt);
      };
      game.listeners.onEvent = (ev) => {
        hud.onEvent(ev);
        const nearCam = 'x' in ev && Math.hypot((ev as { x: number }).x - game.camera.target.x, (ev as { y: number }).y - game.camera.target.y) < 22;
        if (ev.e === 'hit') sfx.sword(ev.x, ev.y);
        if (ev.e === 'proj') sfx.arrow(ev.sx, ev.sy);
        if (ev.e === 'die' && nearCam) {
          if (ev.k === 1) sfx.collapse();
          else sfx.death();
        }
      };
      const local = !link.online && (link as unknown as { save?: () => string }).save ? (link as unknown as { save: () => string }) : null;
      if (local) this.startAutosave(game, local);
      link.onGameOver = (info) => {
        if (local) {
          this.stopAutosave();
          clearSave();
        }
        hud.showGameOver(info, () => this.endGame());
      };
      hud.onQuit = () => {
        if (link.online) link.resign();
        if (local) this.autosave(true);
        this.endGame();
      };
      hud.message(`Long live the ${CIVS[game.civOf(game.you)].name}!`, 'good');
      begin();
      loading.classList.add('fade');
      setTimeout(() => loading.remove(), 600);
    }, 60);
  }

  // ---------------------------------------------------------------------------
  // autosave: every 10 s, on tab hide and on page unload, so a refresh never loses the match
  private autosaveTimer = 0;
  private autosaveTarget: { game: Game; link: { save: () => string } } | null = null;
  private onHide = () => {
    if (document.visibilityState === 'hidden') this.autosave(true);
  };
  private onUnload = () => this.autosave(true);

  private startAutosave(game: Game, link: { save: () => string }) {
    this.autosaveTarget = { game, link };
    try {
      sessionStorage.setItem(PLAYING, '1');
    } catch {
      /* storage unavailable */
    }
    this.autosaveTimer = window.setInterval(() => this.autosave(false), 10000);
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onUnload);
  }

  private stopAutosave() {
    clearInterval(this.autosaveTimer);
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('pagehide', this.onUnload);
    this.autosaveTarget = null;
    try {
      sessionStorage.removeItem(PLAYING);
    } catch {
      /* storage unavailable */
    }
  }

  private autosave(now: boolean) {
    const t = this.autosaveTarget;
    if (!t) return;
    try {
      const json = t.link.save();
      const g = t.game;
      const meta: SaveMeta = {
        date: Date.now(),
        civ: CIVS[g.civOf(g.you)].name,
        minutes: Math.round(g.tick / TICK_RATE / 60),
        cam: [Math.round(g.camera.target.x * 10) / 10, Math.round(g.camera.target.y * 10) / 10],
      };
      if (now) writeSaveNow(json, meta);
      else void writeSave(json, meta).catch((err) => console.warn('autosave failed', err));
    } catch (err) {
      console.warn('autosave failed', err);
    }
  }

  private endGame() {
    this.stopAutosave();
    sfx.listener = null;
    this.input?.dispose();
    this.hud?.dispose();
    this.game?.dispose();
    this.input = null;
    this.hud = null;
    this.game = null;
    document.body.className = '';
    sfx.startDrone();
    if (this.net && this.room) this.showRoom();
    else this.showTitle();
  }
}

const PLAYING = 'thrones.playing';

const DIFFS: { id: Difficulty; name: string; desc: string }[] = [
  { id: 'easy', name: 'Easy', desc: 'A gentle rival: small economy, late and small attacks.' },
  { id: 'normal', name: 'Normal', desc: 'Builds a full economy, mixes its army and attacks in growing waves.' },
  { id: 'hard', name: 'Hard', desc: 'Counters your army, retreats from lost fights, raids your villagers.' },
  { id: 'raja', name: 'Raja', desc: 'Relentless: the fastest economy, early pressure, focus fire. No cheats — just better play.' },
];
